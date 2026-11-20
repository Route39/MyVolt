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

const todayIso = () => new Date().toISOString().slice(0, 10);

const blankRow = (city = "Bengaluru", rent = 700) => ({
  name: "",
  mobile: "",
  city,
  daily_rent: Number(rent) || 700,
  joining_date: todayIso(),
  handover_date: "",
  rent_start_date: "",
  driver_code: "",
  package: "",
  reg_no: "",
  vehicle_type: "",
  vin: "",
  rental_ends: "",
  rental_status: "",
  status: "Active",
  details: "",
});

export const ImportDialog = ({ open, onOpenChange, defaultMode = "drivers_and_vehicles", onImported }) => {
  const [mode, setMode] = useState(defaultMode);
  const [updateExisting, setUpdateExisting] = useState(true);
  const [defaultCity, setDefaultCity] = useState("Bengaluru");
  const [defaultRent, setDefaultRent] = useState("700");
  const [filename, setFilename] = useState("");
  const [rows, setRows] = useState([]);
  const [rawPreview, setRawPreview] = useState("");
  const [parsing, setParsing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [downloadingTpl, setDownloadingTpl] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (open) {
      setMode(defaultMode);
      setFilename("");
      setRows([]);
      setRawPreview("");
      setResult(null);
    }
  }, [open, defaultMode]);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true);
    setResult(null);
    setFilename(file.name);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/import/parse", fd);
      setRows(data.rows || []);
      setRawPreview(data.raw_text_preview || "");
      if (data.detected_mode && data.rows?.length > 0) {
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
      const r = await api.get("/import/template", { responseType: "blob" });
      downloadBlob(r.data, "myvolt_import_template.xlsx");
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setDownloadingTpl(false);
    }
  };

  const updateCell = (idx, key, val) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [key]: val } : r)));
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
      prev.map((r) => ({
        ...r,
        city: r.city || defaultCity || "Bengaluru",
        daily_rent: Number(r.daily_rent) > 0 ? r.daily_rent : Number(defaultRent) || 700,
      }))
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
    try {
      const payload = {
        mode,
        update_existing: updateExisting,
        rows: valid.map((r) => ({
          ...r,
          city: (r.city || defaultCity || "Bengaluru").trim(),
          daily_rent: Number(r.daily_rent) || Number(defaultRent) || 700,
          joining_date: r.joining_date || todayIso(),
        })),
      };
      const { data } = await api.post("/import/commit", payload);
      setResult(data);
      const parts = [];
      if (data.drivers_created || data.drivers_updated) {
        parts.push(`${data.drivers_created} driver(s) created, ${data.drivers_updated} updated`);
      }
      if (data.vehicles_created || data.vehicles_updated) {
        parts.push(`${data.vehicles_created} vehicle(s) created, ${data.vehicles_updated} updated`);
      }
      if (data.assignments_created) {
        parts.push(`${data.assignments_created} assigned`);
      }
      toast.success(parts.length ? `Import complete: ${parts.join(" · ")}` : "Import completed");
      onImported?.();
      if (!data.errors?.length) {
        onOpenChange(false);
      }
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setCommitting(false);
    }
  };

  const missingMobileCount = rows.filter((r) => mode !== "vehicles" && r.name?.trim() && !/^\d{10}$/.test(r.mobile || "")).length;
  const missingRegCount = rows.filter((r) => mode !== "drivers" && !r.reg_no?.trim()).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[97vw] max-w-[1320px] flex-col overflow-hidden" data-testid="import-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-[#15803D]" />
            Import Drivers &amp; Vehicles from Excel / PDF / CSV
          </DialogTitle>
          <DialogDescription>
            Upload any Excel (.xlsx), PDF, or CSV export from your old platform. Review or edit extracted records before saving into MyVolt.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-[#CBD5E1] bg-[#F8FAFB] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-[#16A34A] px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#15803D]">
              {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              <span>{parsing ? "Extracting data..." : filename ? "Upload another file" : "Choose Excel / PDF / CSV"}</span>
              <input
                type="file"
                accept=".pdf,.xlsx,.xlsm,.csv"
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
              className="h-8 bg-white text-xs"
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
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Label className="text-xs text-[#64748B]">Import mode</Label>
              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger className="h-8 w-[220px] bg-white text-xs" data-testid="import-mode-select">
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
            <Input
              value={defaultCity}
              onChange={(e) => setDefaultCity(e.target.value)}
              placeholder="City"
              className="h-8 w-[130px] text-xs"
              data-testid="import-default-city"
            />
            <Input
              type="number"
              min="1"
              value={defaultRent}
              onChange={(e) => setDefaultRent(e.target.value)}
              placeholder="Daily rent"
              className="h-8 w-[100px] text-xs"
              data-testid="import-default-rent"
            />
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={applyDefaultsToEmpty} disabled={!rows.length}>
              Apply defaults
            </Button>
          </div>

          <div className="flex items-center gap-2">
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
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900" data-testid="import-result-banner">
            <div className="flex items-center gap-1.5 font-semibold">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
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
            <table className="data-table w-full" data-testid="import-preview-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Driver</th>
                  <th>ID</th>
                  <th>Phone</th>
                  <th>Vehicle</th>
                  <th>Package</th>
                  <th>City</th>
                  <th>Joining Date</th>
                  <th>VIN</th>
                  <th>Rental Ends</th>
                  <th>Daily Rent (₹)</th>
                  <th>Status</th>
                  <th>Details</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const statusVal = r.rental_status && r.status === "Active" ? r.rental_status : r.status || "Active";
                  return (
                    <tr key={i} data-testid={`import-row-${i}`}>
                      <td className="text-xs text-[#64748B]">{i + 1}</td>
                      <td>
                        <Input
                          value={r.name || ""}
                          onChange={(e) => updateCell(i, "name", e.target.value)}
                          placeholder="Not Assigned"
                          className="h-8 min-w-[125px] text-xs"
                          data-testid={`import-row-name-${i}`}
                        />
                      </td>
                      <td>
                        <Input
                          value={r.driver_code || ""}
                          onChange={(e) => updateCell(i, "driver_code", e.target.value)}
                          placeholder="Auto / R39D-..."
                          className="h-8 min-w-[110px] font-mono text-xs uppercase"
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
                          placeholder="141 - KA51AJ2624"
                          className="h-8 min-w-[140px] font-mono text-xs"
                          data-testid={`import-row-reg-${i}`}
                        />
                      </td>
                      <td>
                        <Input
                          value={r.package || ""}
                          onChange={(e) => updateCell(i, "package", e.target.value)}
                          placeholder="Silver Package"
                          className="h-8 min-w-[115px] text-xs"
                          data-testid={`import-row-package-${i}`}
                        />
                      </td>
                      <td>
                        <Input
                          value={r.city || ""}
                          onChange={(e) => updateCell(i, "city", e.target.value)}
                          placeholder="Bengaluru"
                          className="h-8 min-w-[105px] text-xs"
                          data-testid={`import-row-city-${i}`}
                        />
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
              <p className="mt-2 text-sm font-medium text-[#17212B]">Upload your old platform Excel, PDF, or CSV export</p>
              <p className="mt-1 max-w-md text-xs text-[#64748B]">
                Accepts your old platform PDFs, Excel spreadsheets (.xlsx), and CSV files — including Driver IDs, Packages, Vehicle VINs, Rental Ends, Cities, and Rent Rates.
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
          <div className="text-xs text-[#64748B]">
            Ready to import <strong>{rows.length}</strong> row(s) in{" "}
            <strong>{mode === "drivers_and_vehicles" ? "Drivers & Vehicles" : mode === "drivers" ? "Drivers Only" : "Vehicles Only"}</strong> mode
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={committing || !rows.length} onClick={commit} data-testid="import-commit-button">
              {committing && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Import {rows.length ? `${rows.length} Record(s)` : "Records"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
