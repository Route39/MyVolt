import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, FileUp, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api, downloadBlob, errMsg } from "@/lib/api";
import { FLEET_CITIES, normalizeCity } from "@/lib/format";

const todayIso = () => new Date().toISOString().slice(0, 10);
const PREVIEW_PAGE_SIZE = 50;
const CHUNK_SIZE = 100;

const blankRow = (city = "Bangalore", rent = 700) => ({
  name: "",
  mobile: "",
  city,
  daily_rent: Number(rent) || 700,
  joining_date: todayIso(),
  handover_date: "",
  rent_start_date: "",
  driver_code: "",
  reg_no: "",
  vehicle_type: "",
  vin: "",
  rental_ends: "",
  rental_status: "",
  status: "Active",
  details: "",
  has_daily_rent: true,
  has_joining_date: true,
});

export const ImportDialog = ({ open, onOpenChange, defaultMode = "drivers_and_vehicles", onImported }) => {
  const [mode, setMode] = useState(defaultMode);
  const [updateExisting, setUpdateExisting] = useState(true);
  const [defaultCity, setDefaultCity] = useState("Bangalore");
  const [defaultRent, setDefaultRent] = useState("700");
  const [filename, setFilename] = useState("");
  const [rows, setRows] = useState([]);
  const [rawPreview, setRawPreview] = useState("");
  const [ocrUsed, setOcrUsed] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [progress, setProgress] = useState(null);
  const [previewPage, setPreviewPage] = useState(1);
  const [downloadingTpl, setDownloadingTpl] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (open) {
      setMode(defaultMode);
      setFilename("");
      setRows([]);
      setRawPreview("");
      setOcrUsed(false);
      setProgress(null);
      setPreviewPage(1);
      setResult(null);
    }
  }, [open, defaultMode]);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true);
    setResult(null);
    setProgress(null);
    setFilename(file.name);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/import/parse", fd, { timeout: 120000 });
      setRows(data.rows || []);
      setPreviewPage(1);
      setRawPreview(data.raw_text_preview || "");
      setOcrUsed(!!data.ocr_used);
      if (defaultMode === "drivers_and_vehicles" && data.detected_mode && data.rows?.length > 0) {
        setMode(data.detected_mode);
      }
      if (data.rows?.length) {
        toast.success(`Extracted ${data.rows.length} row(s) from ${file.name}`);
      } else {
        toast.error("No structured rows detected automatically — review raw text or add rows manually");
      }
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setParsing(false);
      e.target.value = "";
    }
  };

  const downloadTemplate = async () => {
    setDownloadingTpl(true);
    try {
      const r = await api.get("/import/template", { params: { mode }, responseType: "blob" });
      const fname = mode === "drivers" ? "myvolt_drivers_template.xlsx" : mode === "vehicles" ? "myvolt_vehicles_template.xlsx" : "myvolt_import_template.xlsx";
      downloadBlob(r.data, fname);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setDownloadingTpl(false);
    }
  };

  const updateCell = (idx, key, val) => {
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== idx) return r;
        const next = { ...r, [key]: val };
        if (key === "daily_rent") next.has_daily_rent = true;
        if (key === "joining_date") next.has_joining_date = true;
        return next;
      })
    );
  };

  const updateStatusCell = (idx, val) => {
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== idx) return r;
        if (val === "available" || val === "rented") {
          return { ...r, status: "Active", rental_status: val };
        }
        return { ...r, status: val, rental_status: "" };
      })
    );
  };

  const removeRow = (idx) => {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  };

  const applyDefaultsToEmpty = () => {
    setRows((prev) =>
      prev.map((r) => {
        const hasRent = Number(r.daily_rent) > 0;
        return {
          ...r,
          city: r.city || defaultCity || "Bengaluru",
          daily_rent: hasRent ? r.daily_rent : Number(defaultRent) || 700,
          has_daily_rent: hasRent ? r.has_daily_rent : true,
        };
      })
    );
    toast.success("Applied defaults to empty fields");
  };

  const commit = async () => {
    const valid = rows.filter((r) =>
      mode === "vehicles" ? r.reg_no?.trim() : mode === "drivers" ? r.name?.trim() : r.name?.trim() || r.reg_no?.trim()
    );
    if (!valid.length) {
      toast.error("Add or upload at least one valid row to import");
      return;
    }
    setCommitting(true);
    setProgress({ done: 0, total: valid.length });
    const summary = {
      drivers_created: 0,
      drivers_updated: 0,
      vehicles_created: 0,
      vehicles_updated: 0,
      assignments_created: 0,
      errors: [],
    };
    try {
      for (let i = 0; i < valid.length; i += CHUNK_SIZE) {
        const chunk = valid.slice(i, i + CHUNK_SIZE);
        const payload = {
          mode,
          update_existing: updateExisting,
          rows: chunk.map((r) => ({
            ...r,
            city: (r.city || defaultCity || "Bengaluru").trim(),
            daily_rent: Number(r.daily_rent) || Number(defaultRent) || 700,
            joining_date: r.joining_date || "",
            has_daily_rent: r.has_daily_rent,
            has_joining_date: r.has_joining_date,
          })),
        };
        const { data } = await api.post("/import/commit", payload, { timeout: 120000 });
        summary.drivers_created += data.drivers_created || 0;
        summary.drivers_updated += data.drivers_updated || 0;
        summary.vehicles_created += data.vehicles_created || 0;
        summary.vehicles_updated += data.vehicles_updated || 0;
        summary.assignments_created += data.assignments_created || 0;
        if (data.errors?.length) summary.errors.push(...data.errors);
        setProgress({ done: Math.min(i + CHUNK_SIZE, valid.length), total: valid.length });
      }
      setResult(summary);
      const parts = [];
      if (summary.drivers_created || summary.drivers_updated) {
        parts.push(`${summary.drivers_created} driver(s) created, ${summary.drivers_updated} updated`);
      }
      if (summary.vehicles_created || summary.vehicles_updated) {
        parts.push(`${summary.vehicles_created} vehicle(s) created, ${summary.vehicles_updated} updated`);
      }
      if (summary.assignments_created) {
        parts.push(`${summary.assignments_created} assigned`);
      }
      toast.success(parts.length ? `Import complete: ${parts.join(" · ")}` : "Import completed");
      onImported?.();
      if (!summary.errors?.length) {
        onOpenChange(false);
      }
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setCommitting(false);
      setProgress(null);
    }
  };

  const missingMobileCount = rows.filter((r) => mode !== "vehicles" && r.name?.trim() && !/^\d{10}$/.test(r.mobile || "")).length;
  const missingRegCount = rows.filter((r) => mode === "vehicles" && !r.reg_no?.trim()).length;
  const totalPages = Math.max(1, Math.ceil(rows.length / PREVIEW_PAGE_SIZE));
  const safePage = Math.min(previewPage, totalPages);
  const startIdx = (safePage - 1) * PREVIEW_PAGE_SIZE;
  const visibleRows = rows.slice(startIdx, startIdx + PREVIEW_PAGE_SIZE);
  const isDriversOnly = mode === "drivers";
  const isVehiclesOnly = mode === "vehicles";
  const showAll = mode === "drivers_and_vehicles";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[94vh] w-[calc(100%-16px)] max-w-[1320px] flex-col overflow-y-auto md:overflow-hidden w1920:max-w-[1600px]" data-testid="import-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-6 text-base sm:text-lg">
            <FileSpreadsheet className="h-5 w-5 text-[#B91C1C]" />
            {isDriversOnly
              ? "Import Drivers (Excel / PDF / Image / CSV)"
              : isVehiclesOnly
                ? "Import Vehicles (Excel / PDF / Image / CSV)"
                : "Import Drivers & Vehicles (Excel / PDF / Image / CSV)"}
          </DialogTitle>
          <DialogDescription className="hidden sm:block">
            {isDriversOnly
              ? "Upload your Drivers sheet (Excel, PDF, Image, or CSV). Columns: DRIVER ID, DRIVER NAME, PHONE NUMBER, CITY, JOINING DATE, RENT."
              : isVehiclesOnly
                ? "Upload your Vehicles sheet (Excel, PDF, Image, or CSV). Columns: Vehicle, Status, Driver, City, VIN, Rental Ends."
                : "Upload any Excel (.xlsx), PDF (text or scanned), CSV, or screenshot image (.png, .jpg, .webp) from your old platform. Review or edit extracted records before saving into MyVolt."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-[#CBD5E1] bg-[#F8FAFB] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-[#DC2626] w425:w-auto px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#B91C1C]">
              {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              <span>{parsing ? "Extracting data..." : filename ? "Upload another file" : "Choose File (Excel / PDF / Image)"}</span>
              <input
                type="file"
                accept=".pdf,.xlsx,.xlsm,.csv,.png,.jpg,.jpeg,.webp"
                onChange={handleFile}
                disabled={parsing}
                className="hidden"
                data-testid="import-file-input"
              />
            </label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 w-full bg-white text-xs w425:w-auto"
              disabled={downloadingTpl}
              onClick={downloadTemplate}
              data-testid="import-download-template"
            >
              {downloadingTpl ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
              Download Sample Excel
            </Button>
            {filename && (
              <span className="text-xs font-medium text-[#17212B]" data-testid="import-filename">
                {filename} · <strong>{rows.length}</strong> row(s)
              </span>
            )}
            {ocrUsed && (
              <span className="inline-flex items-center rounded bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700" data-testid="import-ocr-badge">
                Extracted via OCR — double-check spelling before importing
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex w-full items-center gap-2 w425:w-auto">
              <Label className="shrink-0 text-xs text-[#64748B]">Import mode</Label>
              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger className="h-8 w-full bg-white text-xs w425:w-[220px]" data-testid="import-mode-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="drivers_and_vehicles">Drivers &amp; Vehicles (auto-assign)</SelectItem>
                  <SelectItem value="drivers">Drivers Only</SelectItem>
                  <SelectItem value="vehicles">Vehicles Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-xs font-medium text-[#334155]">
              <Switch checked={updateExisting} onCheckedChange={setUpdateExisting} data-testid="import-update-existing" />
              Update existing matches
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[#64748B]">Defaults:</span>
            <Select value={normalizeCity(defaultCity)} onValueChange={setDefaultCity}>
              <SelectTrigger className="h-8 w-[140px] bg-white text-xs" data-testid="import-default-city">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FLEET_CITIES.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!isVehiclesOnly && (
              <Input
                type="number"
                min="1"
                value={defaultRent}
                onChange={(e) => setDefaultRent(e.target.value)}
                placeholder="Daily rent"
                className="h-8 w-[100px] text-xs"
                data-testid="import-default-rent"
              />
            )}
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={applyDefaultsToEmpty} disabled={!rows.length}>
              Apply defaults
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {missingMobileCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700">
                <AlertTriangle className="h-3 w-3" />
                {missingMobileCount} without 10-digit phone
              </span>
            )}
            {missingRegCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700">
                <AlertTriangle className="h-3 w-3" />
                {missingRegCount} missing vehicle
              </span>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setRows((prev) => [...prev, blankRow(defaultCity, defaultRent)])}
              data-testid="import-add-row"
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add row
            </Button>
          </div>
        </div>

        {result && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-900" data-testid="import-result-banner">
            <div className="flex items-center gap-1.5 font-semibold">
              <CheckCircle2 className="h-4 w-4 text-red-600" />
              Drivers: +{result.drivers_created} created, {result.drivers_updated} updated · Vehicles: +{result.vehicles_created} created,{" "}
              {result.vehicles_updated} updated · Assignments: {result.assignments_created}
            </div>
            {result.errors?.length > 0 && (
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-red-700">
                {result.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="min-h-[240px] flex-1 overflow-auto rounded-md border bg-white">
          {rows.length > 0 ? (
            <table className="data-table w-full whitespace-nowrap" data-testid="import-preview-table">
              <thead>
                <tr>
                  <th>#</th>
                  {isDriversOnly && (
                    <>
                      <th>DRIVER ID</th>
                      <th>DRIVER NAME</th>
                      <th>PHONE NUMBER</th>
                      <th>CITY</th>
                      <th>JOINING DATE</th>
                      <th>RENT</th>
                    </>
                  )}
                  {showAll && (
                    <>
                      <th>Driver</th>
                      <th>ID</th>
                      <th>Phone</th>
                      <th>Vehicle</th>
                      <th>City</th>
                      <th>Joining Date</th>
                      <th>VIN</th>
                      <th>Rental Ends</th>
                      <th>Daily Rent (₹)</th>
                      <th>Status</th>
                      <th>Details</th>
                    </>
                  )}
                  {isVehiclesOnly && (
                    <>
                      <th>Vehicle</th>
                      <th>Status</th>
                      <th>Driver</th>
                      <th>City</th>
                      <th>VIN</th>
                      <th>Rental Ends</th>
                    </>
                  )}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r, localIdx) => {
                  const i = startIdx + localIdx;
                  const statusVal = r.rental_status && r.status === "Active" ? r.rental_status : r.status || "Active";
                  return (
                    <tr key={i} data-testid={`import-row-${i}`}>
                      <td className="text-xs text-[#64748B]">{i + 1}</td>
                      {isDriversOnly && (
                        <>
                          <td>
                            <Input
                              value={r.driver_code || ""}
                              onChange={(e) => updateCell(i, "driver_code", e.target.value)}
                              placeholder="DRIVER ID"
                              className="h-8 min-w-[115px] font-mono text-xs uppercase"
                              data-testid={`import-row-code-${i}`}
                            />
                          </td>
                          <td>
                            <Input
                              value={r.name || ""}
                              onChange={(e) => updateCell(i, "name", e.target.value)}
                              placeholder="DRIVER NAME"
                              className="h-8 min-w-[125px] text-xs"
                              data-testid={`import-row-name-${i}`}
                            />
                          </td>
                          <td>
                            <Input
                              value={r.mobile || ""}
                              onChange={(e) => updateCell(i, "mobile", e.target.value)}
                              placeholder="PHONE NUMBER"
                              className="h-8 min-w-[110px] font-mono text-xs"
                              data-testid={`import-row-mobile-${i}`}
                            />
                          </td>
                          <td>
                            <Select
                              value={normalizeCity(r.city)}
                              onValueChange={(v) => updateCell(i, "city", v)}
                            >
                              <SelectTrigger className="h-8 min-w-[125px] bg-white text-xs" data-testid={`import-row-city-${i}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {FLEET_CITIES.map((c) => (
                                  <SelectItem key={c} value={c}>{c}</SelectItem>
                                ))}
                                {r.city && !FLEET_CITIES.includes(r.city) && r.city !== "Bengaluru" && (
                                  <SelectItem value={r.city}>{r.city}</SelectItem>
                                )}
                              </SelectContent>
                            </Select>
                          </td>
                          <td>
                            <Input
                              type="date"
                              value={r.joining_date || ""}
                              onChange={(e) => updateCell(i, "joining_date", e.target.value)}
                              className="h-8 w-[130px] text-xs"
                              data-testid={`import-row-joining-${i}`}
                            />
                          </td>
                          <td>
                            <Input
                              type="number"
                              min="0"
                              value={r.daily_rent ?? ""}
                              onChange={(e) => updateCell(i, "daily_rent", e.target.value)}
                              placeholder="RENT"
                              className="h-8 min-w-[90px] text-xs font-mono"
                              data-testid={`import-row-rent-${i}`}
                            />
                          </td>
                        </>
                      )}
                      {showAll && (
                        <>
                          <td>
                            <Input
                              value={r.name || ""}
                              onChange={(e) => updateCell(i, "name", e.target.value)}
                              placeholder="Driver name"
                              className="h-8 min-w-[125px] text-xs"
                              data-testid={`import-row-name-${i}`}
                            />
                          </td>
                          <td>
                            <Input
                              value={r.driver_code || ""}
                              onChange={(e) => updateCell(i, "driver_code", e.target.value)}
                              placeholder="R39D-TUP001"
                              className="h-8 min-w-[115px] font-mono text-xs uppercase"
                              data-testid={`import-row-code-${i}`}
                            />
                          </td>
                          <td>
                            <Input
                              value={r.mobile || ""}
                              onChange={(e) => updateCell(i, "mobile", e.target.value)}
                              placeholder="10-digit phone"
                              className="h-8 min-w-[110px] font-mono text-xs"
                              data-testid={`import-row-mobile-${i}`}
                            />
                          </td>
                          <td>
                            <Input
                              value={r.reg_no || ""}
                              onChange={(e) => updateCell(i, "reg_no", e.target.value)}
                              placeholder="TUP001 - ..."
                              className="h-8 min-w-[140px] font-mono text-xs"
                              data-testid={`import-row-reg-${i}`}
                            />
                          </td>
                          <td>
                            <Select
                              value={normalizeCity(r.city)}
                              onValueChange={(v) => updateCell(i, "city", v)}
                            >
                              <SelectTrigger className="h-8 min-w-[125px] bg-white text-xs" data-testid={`import-row-city-${i}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {FLEET_CITIES.map((c) => (
                                  <SelectItem key={c} value={c}>{c}</SelectItem>
                                ))}
                                {r.city && !FLEET_CITIES.includes(r.city) && r.city !== "Bengaluru" && (
                                  <SelectItem value={r.city}>{r.city}</SelectItem>
                                )}
                              </SelectContent>
                            </Select>
                          </td>
                          <td>
                            <Input
                              type="date"
                              value={r.joining_date || ""}
                              onChange={(e) => updateCell(i, "joining_date", e.target.value)}
                              className="h-8 w-[130px] text-xs"
                              data-testid={`import-row-joining-${i}`}
                            />
                          </td>
                          <td>
                            <Input
                              value={r.vin || ""}
                              onChange={(e) => updateCell(i, "vin", e.target.value)}
                              placeholder="MBX0007..."
                              className="h-8 min-w-[145px] font-mono text-xs uppercase"
                              data-testid={`import-row-vin-${i}`}
                            />
                          </td>
                          <td>
                            <Input
                              value={r.rental_ends || ""}
                              onChange={(e) => updateCell(i, "rental_ends", e.target.value)}
                              placeholder="YYYY-MM-DD"
                              className="h-8 w-[115px] font-mono text-xs"
                              data-testid={`import-row-rental-ends-${i}`}
                            />
                          </td>
                          <td>
                            <Input
                              type="number"
                              min="1"
                              value={r.daily_rent || ""}
                              onChange={(e) => updateCell(i, "daily_rent", e.target.value)}
                              className="h-8 w-[85px] text-xs"
                              data-testid={`import-row-rent-${i}`}
                            />
                          </td>
                          <td>
                            <Select value={statusVal} onValueChange={(v) => updateStatusCell(i, v)}>
                              <SelectTrigger className="h-8 w-[108px] text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Active">Active</SelectItem>
                                <SelectItem value="available">available</SelectItem>
                                <SelectItem value="rented">rented</SelectItem>
                                <SelectItem value="Inactive">Inactive</SelectItem>
                                <SelectItem value="Suspended">Suspended</SelectItem>
                                <SelectItem value="Maintenance">Maintenance</SelectItem>
                              </SelectContent>
                            </Select>
                          </td>
                          <td>
                            <Input
                              value={r.details || ""}
                              onChange={(e) => updateCell(i, "details", e.target.value)}
                              placeholder="Details"
                              className="h-8 min-w-[115px] text-xs"
                              data-testid={`import-row-details-${i}`}
                            />
                          </td>
                        </>
                      )}
                      {isVehiclesOnly && (
                        <>
                          <td>
                            <Input
                              value={r.reg_no || ""}
                              onChange={(e) => updateCell(i, "reg_no", e.target.value)}
                              placeholder="141 - KA51AJ2624"
                              className="h-8 min-w-[150px] font-mono text-xs"
                              data-testid={`import-row-reg-${i}`}
                            />
                          </td>
                          <td>
                            <Select value={statusVal} onValueChange={(v) => updateStatusCell(i, v)}>
                              <SelectTrigger className="h-8 w-[112px] text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="available">available</SelectItem>
                                <SelectItem value="rented">rented</SelectItem>
                                <SelectItem value="Active">Active</SelectItem>
                                <SelectItem value="Maintenance">Maintenance</SelectItem>
                                <SelectItem value="Inactive">Inactive</SelectItem>
                              </SelectContent>
                            </Select>
                          </td>
                          <td>
                            <Input
                              value={r.name || ""}
                              onChange={(e) => updateCell(i, "name", e.target.value)}
                              placeholder="Not Assigned"
                              className="h-8 min-w-[130px] text-xs"
                              data-testid={`import-row-name-${i}`}
                            />
                          </td>
                          <td>
                            <Select
                              value={normalizeCity(r.city)}
                              onValueChange={(v) => updateCell(i, "city", v)}
                            >
                              <SelectTrigger className="h-8 min-w-[125px] bg-white text-xs" data-testid={`import-row-city-${i}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {FLEET_CITIES.map((c) => (
                                  <SelectItem key={c} value={c}>{c}</SelectItem>
                                ))}
                                {r.city && !FLEET_CITIES.includes(r.city) && r.city !== "Bengaluru" && (
                                  <SelectItem value={r.city}>{r.city}</SelectItem>
                                )}
                              </SelectContent>
                            </Select>
                          </td>
                          <td>
                            <Input
                              value={r.vin || ""}
                              onChange={(e) => updateCell(i, "vin", e.target.value)}
                              placeholder="MBX0007..."
                              className="h-8 min-w-[165px] font-mono text-xs uppercase"
                              data-testid={`import-row-vin-${i}`}
                            />
                          </td>
                          <td>
                            <Input
                              value={r.rental_ends || ""}
                              onChange={(e) => updateCell(i, "rental_ends", e.target.value)}
                              placeholder="(blank)"
                              className="h-8 w-[120px] font-mono text-xs"
                              data-testid={`import-row-rental-ends-${i}`}
                            />
                          </td>
                        </>
                      )}
                      {showAll && (
                        <>
                          <td>
                            <Input
                              value={r.vin || ""}
                              onChange={(e) => updateCell(i, "vin", e.target.value)}
                              placeholder="MBX0007..."
                              className="h-8 min-w-[145px] font-mono text-xs uppercase"
                              data-testid={`import-row-vin-${i}`}
                            />
                          </td>
                          <td>
                            <Input
                              value={r.rental_ends || ""}
                              onChange={(e) => updateCell(i, "rental_ends", e.target.value)}
                              placeholder="YYYY-MM-DD"
                              className="h-8 w-[115px] font-mono text-xs"
                              data-testid={`import-row-rental-ends-${i}`}
                            />
                          </td>
                          <td>
                            <Input
                              type="number"
                              min="1"
                              value={r.daily_rent || ""}
                              onChange={(e) => updateCell(i, "daily_rent", e.target.value)}
                              className="h-8 w-[85px] text-xs"
                              data-testid={`import-row-rent-${i}`}
                            />
                          </td>
                          <td>
                            <Select value={statusVal} onValueChange={(v) => updateStatusCell(i, v)}>
                              <SelectTrigger className="h-8 w-[108px] text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Active">Active</SelectItem>
                                <SelectItem value="available">available</SelectItem>
                                <SelectItem value="rented">rented</SelectItem>
                                <SelectItem value="Inactive">Inactive</SelectItem>
                                <SelectItem value="Suspended">Suspended</SelectItem>
                                <SelectItem value="Maintenance">Maintenance</SelectItem>
                              </SelectContent>
                            </Select>
                          </td>
                          <td>
                            <Input
                              value={r.details || ""}
                              onChange={(e) => updateCell(i, "details", e.target.value)}
                              placeholder="Details"
                              className="h-8 min-w-[115px] text-xs"
                              data-testid={`import-row-details-${i}`}
                            />
                          </td>
                        </>
                      )}
                      <td className="text-right">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-[#64748B] hover:text-red-600"
                          onClick={() => removeRow(i)}
                          data-testid={`import-row-delete-${i}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="flex h-full min-h-[220px] flex-col items-center justify-center p-6 text-center">
              <FileUp className="h-8 w-8 text-[#94A3B8]" />
              <p className="mt-2 text-sm font-medium text-[#17212B]">Upload your old platform Excel, PDF, CSV, or screenshot image</p>
              <p className="mt-1 max-w-md text-xs text-[#64748B]">
                Accepts your old platform PDFs (text or scanned), Excel spreadsheets (.xlsx), CSV files, and table screenshots (.png, .jpg, .webp) — including Driver IDs, Vehicle VINs, Rental Ends, Cities, and Rent Rates.
              </p>
              {rawPreview && (
                <pre className="mt-4 max-h-36 w-full max-w-2xl overflow-auto rounded border bg-[#F8FAFB] p-2.5 text-left font-mono text-[11px] text-[#334155]">
                  {rawPreview}
                </pre>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="flex flex-wrap items-center gap-3 text-xs text-[#64748B]">
            <span>
              Ready to import <strong>{rows.length}</strong> row(s) in{" "}
              <strong>{mode === "drivers_and_vehicles" ? "Drivers & Vehicles" : mode === "drivers" ? "Drivers Only" : "Vehicles Only"}</strong> mode
            </span>
            {rows.length > PREVIEW_PAGE_SIZE && (
              <div className="inline-flex items-center gap-1.5" data-testid="import-preview-pager">
                <span>
                  Showing {startIdx + 1}–{Math.min(startIdx + PREVIEW_PAGE_SIZE, rows.length)} of {rows.length}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  disabled={safePage <= 1}
                  onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}
                >
                  Prev
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  disabled={safePage >= totalPages}
                  onClick={() => setPreviewPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next
                </Button>
              </div>
            )}
          </div>
          <div className="flex w-full gap-2 sm:w-auto [&>button]:flex-1 sm:[&>button]:flex-none">
            <Button type="button" variant="outline" disabled={committing} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={committing || !rows.length} onClick={commit} data-testid="import-commit-button">
              {committing && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {committing && progress
                ? `Importing ${progress.done} / ${progress.total}...`
                : `Import ${rows.length ? `${rows.length} Record(s)` : "Records"}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
