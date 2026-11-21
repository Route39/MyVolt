import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, ArrowLeftRight, FileUp, Download, Loader2, MapPin, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DriverSearch } from "@/components/DriverSearch";
import { ImportDialog } from "@/components/ImportDialog";
import { api, downloadBlob, errMsg } from "@/lib/api";
import { inr, todayIso, FLEET_CITIES, normalizeCity } from "@/lib/format";
import { PageHeader, Pager, StatCard, usePaged } from "@/components/kit";

const EMPTY = { vehicle_id: "", reg_no: "", vin: "", city: "Bangalore", status: "Active" };

const VehicleDialog = ({ open, onOpenChange, vehicle, onSaved }) => {
  const [f, setF] = useState(EMPTY);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setConfirmDelete(false);
      setBusy(false);
      setF(
        vehicle
          ? {
              vehicle_id: vehicle.vehicle_id || "",
              reg_no: vehicle.reg_no || "",
              vin: vehicle.vin || "",
              city: vehicle.city || "Bangalore",
              status: vehicle.status || "Active",
            }
          : EMPTY
      );
    }
  }, [open, vehicle]);
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e });
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const body = {
      reg_no: f.reg_no.trim(),
      vin: f.vin.trim().toUpperCase(),
      city: f.city,
      status: f.status || "Active",
    };
    if (f.vehicle_id?.trim()) {
      body.vehicle_id = f.vehicle_id.trim();
    }
    try {
      const { data } = vehicle ? await api.put(`/vehicles/${vehicle.vehicle_id}`, body) : await api.post("/vehicles", body);
      toast.success(vehicle ? "Vehicle updated" : `Vehicle ${data.vehicle_id} added`);
      onOpenChange(false);
      onSaved();
    } catch (e2) {
      toast.error(errMsg(e2));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]" data-testid="vehicle-form-dialog">
        <DialogHeader>
          <DialogTitle>{vehicle ? `Edit Vehicle · ${vehicle.vehicle_id}` : "Add Vehicle"}</DialogTitle>
          <DialogDescription>Vehicle details are recorded directly in the fleet master.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-3.5 sm:grid-cols-2">
          {vehicle ? (
            <div className="space-y-1">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">VEHICLE ID</Label>
              <Input disabled value={vehicle.vehicle_id} className="font-mono bg-muted" data-testid="vehicle-form-id-locked" />
            </div>
          ) : (
            <div className="space-y-1">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">VEHICLE ID</Label>
              <Input value={f.vehicle_id} onChange={set("vehicle_id")} placeholder="Auto or e.g. 141, BLR-005" className="font-mono" data-testid="vehicle-form-id" />
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">VEHICLE NUMBER</Label>
            <Input required value={f.reg_no} onChange={set("reg_no")} placeholder="e.g. KA51AJ2624" className="font-mono" data-testid="vehicle-form-reg" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">VIN NUMBER</Label>
            <Input value={f.vin} onChange={set("vin")} placeholder="e.g. MBX0007EF2B266083" className="font-mono uppercase" data-testid="vehicle-form-vin" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">CITY</Label>
            <Select value={normalizeCity(f.city)} onValueChange={set("city")}>
              <SelectTrigger data-testid="vehicle-form-city"><SelectValue placeholder="Select city" /></SelectTrigger>
              <SelectContent>
                {FLEET_CITIES.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
                {f.city && !FLEET_CITIES.includes(f.city) && f.city !== "Bengaluru" && (
                  <SelectItem value={f.city}>{f.city}</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col-reverse gap-2 w425:flex-row w425:items-center w425:justify-between sm:col-span-2 pt-2">
            {vehicle ? (
              <Button
                type="button"
                variant="ghost"
                className="text-[#DC2626] hover:bg-red-50 hover:text-[#B91C1C] text-xs h-9 gap-1.5"
                onClick={() => setConfirmDelete(true)}
                data-testid="vehicle-form-delete-button"
              >
                <Trash2 className="h-4 w-4" />
                Delete vehicle
              </Button>
            ) : <div />}
            <div className="flex flex-col-reverse gap-2 w425:flex-row w425:justify-end">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={busy} data-testid="vehicle-form-save">Save vehicle</Button>
            </div>
          </div>
        </form>
      </DialogContent>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent data-testid="vehicle-form-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Vehicle</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete vehicle <span className="font-semibold text-foreground">{vehicle?.reg_no}</span> ({vehicle?.vehicle_id})? This will unassign any active driver.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[#DC2626] hover:bg-[#B91C1C]"
              onClick={async () => {
                try {
                  await api.delete(`/vehicles/${vehicle.vehicle_id}`);
                  toast.success(`Vehicle ${vehicle.reg_no} deleted`);
                  setConfirmDelete(false);
                  onOpenChange(false);
                  onSaved();
                } catch (err) {
                  toast.error(errMsg(err));
                }
              }}
              data-testid="confirm-vehicle-form-delete"
            >
              Delete vehicle
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
};

const AssignDriverDialog = ({ open, onOpenChange, vehicle, onSaved }) => {
  const [driver, setDriver] = useState(null);
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (open) { setDriver(null); setReason(""); }
  }, [open]);
  const save = async () => {
    try {
      await api.post(`/drivers/${driver.id}/assign-vehicle`, { vehicle_id: vehicle.vehicle_id, reason });
      toast.success(`${vehicle.vehicle_id} assigned to ${driver.name}`);
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]" data-testid="vehicle-assign-driver-dialog">
        <DialogHeader>
          <DialogTitle>Assign {vehicle?.vehicle_id}</DialogTitle>
          <DialogDescription>{vehicle?.current_driver ? `Currently with ${vehicle.current_driver.name}. Change that driver's vehicle first to free it.` : "Pick the driver who will use this vehicle."}</DialogDescription>
        </DialogHeader>
        <DriverSearch value={driver} onSelect={setDriver} testId="vehicle-assign-driver-search" />
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" data-testid="vehicle-assign-reason" />
        <div className="flex flex-col-reverse gap-2 w425:flex-row w425:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!driver} onClick={save} data-testid="vehicle-assign-save">Assign</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default function VehiclesPage() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState([]);
  const [edit, setEdit] = useState(undefined);
  const [assign, setAssign] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState("all");
  const [city, setCity] = useState("all");
  const [assignment, setAssignment] = useState("all");

  const load = useCallback(() => api.get("/vehicles", { params: { q } }).then((r) => setRows(r.data)), [q]);
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  const cities = useMemo(() => {
    const set = new Set([...FLEET_CITIES, ...rows.map((v) => v.city).filter(Boolean)]);
    return [...set].sort();
  }, [rows]);
  const filtered = useMemo(
    () =>
      rows.filter((v) => {
        const displayStatus = v.status === "Active" ? (v.current_driver ? "rented" : v.rental_status || "available") : v.status;
        const statusOk = status === "all" || v.status === status || displayStatus === status;
        const cityOk = city === "all" || v.city === city;
        const assignOk = assignment === "all" || (assignment === "assigned" ? !!v.current_driver : !v.current_driver);
        return statusOk && cityOk && assignOk;
      }),
    [rows, status, city, assignment]
  );
  const paged = usePaged(filtered, 25, [q, status, city, assignment]);

  const cityStats = useMemo(() => {
    const map = {};
    rows.forEach((v) => {
      const c = v.city || "Other";
      if (!map[c]) map[c] = { city: c, count: 0 };
      map[c].count += 1;
    });
    return Object.values(map).sort((a, b) => a.city.localeCompare(b.city));
  }, [rows]);

  const assignedCount = useMemo(() => filtered.filter((v) => !!v.current_driver).length, [filtered]);
  const availableCount = useMemo(() => filtered.filter((v) => !v.current_driver).length, [filtered]);
  const totalVehicleRent = useMemo(
    () => filtered.reduce((acc, v) => acc + Number(v.current_driver?.daily_rent || v.daily_rent || 0), 0),
    [filtered]
  );

  const exportXlsx = async () => {
    setExporting(true);
    try {
      const params = { q };
      if (city !== "all") params.city = city;
      if (status !== "all") params.status = status;
      if (assignment !== "all") params.assignment = assignment;
      params.format = "xlsx";
      const r = await api.get("/vehicles", { params, responseType: "blob" });
      downloadBlob(r.data, `myvolt_vehicles_${todayIso()}.xlsx`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4 fade-up">
      <PageHeader
        title="Vehicle Management"
        subtitle={`${rows.length} vehicles · Vehicle IDs are permanent and never reused`}
        actions={
          <div className="flex w-full flex-wrap gap-2 sm:w-auto [&>button]:flex-1 sm:[&>button]:flex-none">
            <Button variant="outline" onClick={exportXlsx} disabled={exporting} data-testid="export-vehicles-button">
              {exporting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
              Export Excel
            </Button>
            <Button variant="outline" onClick={() => setImportOpen(true)} data-testid="import-vehicles-button">
              <FileUp className="mr-1.5 h-4 w-4" />
              <span className="hidden w425:inline">Import Excel / PDF / Image</span><span className="w425:hidden">Import</span>
            </Button>
            <Button onClick={() => setEdit(null)} data-testid="add-vehicle-button">
              <Plus className="mr-1.5 h-4 w-4" />
              Add vehicle
            </Button>
          </div>
        }
      />

      <section className="space-y-2.5" data-testid="vehicles-summary-bar">
        <div className="grid grid-cols-1 gap-3 w375:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Showing vehicles" value={filtered.length} hint={city === "all" ? "All cities" : city} testId="vehicles-kpi-total" />
          <StatCard label="Rented / assigned" value={assignedCount} tone="st-verified" testId="vehicles-kpi-assigned" />
          <StatCard label="Available / unassigned" value={availableCount} tone="st-partial" testId="vehicles-kpi-available" />
          <StatCard label="Active daily rent" value={inr(totalVehicleRent)} tone="st-verified" hint="Total vehicle rent rate" testId="vehicles-kpi-rent" />
        </div>
        {cityStats.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto whitespace-nowrap pb-1 [&>*]:shrink-0 md:flex-wrap md:overflow-visible" data-testid="vehicles-city-pills">
            <span className="inline-flex items-center gap-1 pr-1 text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">
              <MapPin className="h-3 w-3" /> Cities:
            </span>
            <button
              type="button"
              onClick={() => setCity("all")}
              data-testid="vehicles-city-pill-all"
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                city === "all" ? "border-[#B91C1C] bg-[#FEF2F2] text-[#B91C1C]" : "border-[#E5E7EB] bg-white text-[#475569] hover:bg-[#F8FAFB]"
              }`}
            >
              All ({rows.length})
            </button>
            {cityStats.map((cs) => (
              <button
                key={cs.city}
                type="button"
                onClick={() => setCity(city === cs.city ? "all" : cs.city)}
                data-testid={`vehicles-city-pill-${cs.city}`}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  city === cs.city ? "border-[#B91C1C] bg-[#FEF2F2] text-[#B91C1C]" : "border-[#E5E7EB] bg-white text-[#475569] hover:bg-[#F8FAFB]"
                }`}
              >
                {cs.city} · {cs.count}
              </button>
            ))}
          </div>
        )}
      </section>

      <div className="r-card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <Input placeholder="Search Vehicle ID, Number, VIN, City…" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 w-full sm:max-w-sm" data-testid="vehicles-search" />
          <Select value={city} onValueChange={setCity}>
            <SelectTrigger className="h-9 w-full w425:w-[calc(50%-4px)] sm:w-[160px]" data-testid="vehicles-filter-city">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All cities</SelectItem>
              {cities.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table w-full min-w-[700px] whitespace-nowrap" data-testid="vehicles-table">
            <thead>
              <tr>
                <th>VEHICLE ID</th>
                <th>VEHICLE NUMBER</th>
                <th>VIN NUMBER</th>
                <th>CITY</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {paged.slice.map((v) => (
                <tr key={v.vehicle_id} data-testid={`vehicle-row-${v.vehicle_id}`} onClick={() => setEdit(v)} className="cursor-pointer">
                  <td className="font-mono text-xs font-semibold">{v.vehicle_id}</td>
                  <td className="font-mono text-xs font-semibold text-[#17212B]">{v.reg_no}</td>
                  <td className="font-mono text-xs">{v.vin || "—"}</td>
                  <td>{v.city}</td>
                  <td className="whitespace-nowrap text-right">
                    <Button size="icon" variant="ghost" className="h-8 w-8" title="Assign driver" onClick={(e) => { e.stopPropagation(); setAssign(v); }} data-testid={`vehicle-assign-${v.vehicle_id}`}>
                      <ArrowLeftRight className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8" title="Edit" onClick={(e) => { e.stopPropagation(); setEdit(v); }} data-testid={`vehicle-edit-${v.vehicle_id}`}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-[#94A3B8] hover:text-[#DC2626]" title="Delete vehicle" onClick={(e) => { e.stopPropagation(); setToDelete(v); }} data-testid={`vehicle-delete-${v.vehicle_id}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
              {!paged.slice.length && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-muted-foreground">No vehicles found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pager page={paged.page} pageSize={paged.size} total={paged.total} onPage={paged.setPage} testId="vehicles-pager" />
      </div>
      <VehicleDialog open={edit !== undefined} onOpenChange={(o) => !o && setEdit(undefined)} vehicle={edit} onSaved={load} />
      <AssignDriverDialog open={!!assign} onOpenChange={(o) => !o && setAssign(null)} vehicle={assign} onSaved={load} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} defaultMode="vehicles" onImported={load} />
      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent data-testid="vehicle-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Vehicle</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete vehicle <span className="font-semibold text-foreground">{toDelete?.reg_no}</span> ({toDelete?.vehicle_id})? This will unassign any active driver.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[#DC2626] hover:bg-[#B91C1C]"
              onClick={async () => {
                try {
                  await api.delete(`/vehicles/${toDelete.vehicle_id}`);
                  toast.success(`Vehicle ${toDelete.reg_no} deleted`);
                  setToDelete(null);
                  load();
                } catch (e) {
                  toast.error(errMsg(e));
                }
              }}
              data-testid="confirm-vehicle-delete"
            >
              Delete vehicle
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
