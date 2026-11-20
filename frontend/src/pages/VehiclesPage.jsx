import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, ArrowLeftRight, FileUp, Download, Loader2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DriverSearch } from "@/components/DriverSearch";
import { ImportDialog } from "@/components/ImportDialog";
import { api, downloadBlob, errMsg } from "@/lib/api";
import { inr, todayIso } from "@/lib/format";
import { PageHeader, Pager, StatCard, usePaged } from "@/components/kit";

const EMPTY = { reg_no: "", city: "", vehicle_type: "", vin: "", rental_ends: "", status: "Active", details: "" };
const STATUS_CLS = {
  rented: "st-verified",
  available: "st-partial",
  Active: "st-verified",
  Maintenance: "st-pending",
  Inactive: "st-none",
};

const VehicleDialog = ({ open, onOpenChange, vehicle, onSaved }) => {
  const [f, setF] = useState(EMPTY);
  useEffect(() => {
    if (open) {
      setF(
        vehicle
          ? {
              reg_no: vehicle.reg_no,
              city: vehicle.city,
              vehicle_type: vehicle.vehicle_type || "",
              vin: vehicle.vin || "",
              rental_ends: vehicle.rental_ends || "",
              status: vehicle.status,
              details: vehicle.details || "",
            }
          : EMPTY
      );
    }
  }, [open, vehicle]);
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e });
  const save = async (e) => {
    e.preventDefault();
    try {
      const { data } = vehicle ? await api.put(`/vehicles/${vehicle.vehicle_id}`, f) : await api.post("/vehicles", f);
      toast.success(vehicle ? "Vehicle updated" : `Vehicle ${data.vehicle_id} added`);
      onOpenChange(false);
      onSaved();
    } catch (e2) {
      toast.error(errMsg(e2));
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]" data-testid="vehicle-form-dialog">
        <DialogHeader>
          <DialogTitle>{vehicle ? `Edit ${vehicle.vehicle_id}` : "Add vehicle"}</DialogTitle>
          <DialogDescription>{vehicle ? "Vehicle ID is permanent and cannot be changed." : "Vehicle ID is generated from the city (e.g. BLR-005)."}</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label className="text-xs">Vehicle / Reg. number</Label><Input required value={f.reg_no} onChange={set("reg_no")} className="font-mono" data-testid="vehicle-form-reg" /></div>
          <div className="space-y-1"><Label className="text-xs">City</Label><Input required value={f.city} onChange={set("city")} placeholder="Bengaluru, Chennai…" data-testid="vehicle-form-city" /></div>
          <div className="space-y-1"><Label className="text-xs">VIN / Chassis No.</Label><Input value={f.vin} onChange={set("vin")} placeholder="e.g. MBX0007EF2B266083" className="font-mono uppercase" data-testid="vehicle-form-vin" /></div>
          <div className="space-y-1"><Label className="text-xs">Rental Ends</Label><Input type="date" value={f.rental_ends} onChange={set("rental_ends")} data-testid="vehicle-form-rental-ends" /></div>
          <div className="space-y-1"><Label className="text-xs">Vehicle type</Label><Input value={f.vehicle_type} onChange={set("vehicle_type")} placeholder="e.g. Sedan, EV" data-testid="vehicle-form-type" /></div>
          <div className="space-y-1"><Label className="text-xs">Status</Label>
            <Select value={f.status} onValueChange={set("status")}>
              <SelectTrigger data-testid="vehicle-form-status"><SelectValue /></SelectTrigger>
              <SelectContent>{["Active", "Maintenance", "Inactive"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1 sm:col-span-2"><Label className="text-xs">Details (optional)</Label><Input value={f.details} onChange={set("details")} placeholder="Make, model, colour…" data-testid="vehicle-form-details" /></div>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" data-testid="vehicle-form-save">Save vehicle</Button>
          </div>
        </form>
      </DialogContent>
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
        <div className="flex justify-end gap-2">
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

  const cities = useMemo(() => [...new Set(rows.map((v) => v.city).filter(Boolean))].sort(), [rows]);
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
      if (["Active", "Maintenance", "Inactive"].includes(status)) params.status = status;
      params.format = "xlsx";
      const r = await api.get("/vehicles", { params, responseType: "blob" });
      downloadBlob(r.data, `route39_vehicles_${todayIso()}.xlsx`);
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
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={exportXlsx} disabled={exporting} data-testid="export-vehicles-button">
              {exporting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
              Export Excel
            </Button>
            <Button variant="outline" onClick={() => setImportOpen(true)} data-testid="import-vehicles-button">
              <FileUp className="mr-1.5 h-4 w-4" />
              Import Excel / PDF
            </Button>
            <Button onClick={() => setEdit(null)} data-testid="add-vehicle-button">
              <Plus className="mr-1.5 h-4 w-4" />
              Add vehicle
            </Button>
          </div>
        }
      />

      <section className="space-y-2.5" data-testid="vehicles-summary-bar">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Showing vehicles" value={filtered.length} hint={city === "all" ? "All cities" : city} testId="vehicles-kpi-total" />
          <StatCard label="Rented / assigned" value={assignedCount} tone="st-verified" testId="vehicles-kpi-assigned" />
          <StatCard label="Available / unassigned" value={availableCount} tone="st-partial" testId="vehicles-kpi-available" />
          <StatCard label="Active daily rent" value={inr(totalVehicleRent)} tone="st-verified" hint="Total vehicle rent rate" testId="vehicles-kpi-rent" />
        </div>
        {cityStats.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5" data-testid="vehicles-city-pills">
            <span className="inline-flex items-center gap-1 pr-1 text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">
              <MapPin className="h-3 w-3" /> Cities:
            </span>
            <button
              type="button"
              onClick={() => setCity("all")}
              data-testid="vehicles-city-pill-all"
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                city === "all" ? "border-[#15803D] bg-[#F0FDF4] text-[#15803D]" : "border-[#E5E7EB] bg-white text-[#475569] hover:bg-[#F8FAFB]"
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
                  city === cs.city ? "border-[#15803D] bg-[#F0FDF4] text-[#15803D]" : "border-[#E5E7EB] bg-white text-[#475569] hover:bg-[#F8FAFB]"
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
          <Input placeholder="Search Vehicle, VIN, ID, city…" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 max-w-sm" data-testid="vehicles-search" />
          <Select value={city} onValueChange={setCity}>
            <SelectTrigger className="h-9 w-[160px]" data-testid="vehicles-filter-city">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All cities</SelectItem>
              {cities.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-9 w-[150px]" data-testid="vehicles-filter-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["all", "available", "rented", "Active", "Maintenance", "Inactive"].map((s) => (
                <SelectItem key={s} value={s}>{s === "all" ? "All statuses" : s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={assignment} onValueChange={setAssignment}>
            <SelectTrigger className="h-9 w-[150px]" data-testid="vehicles-filter-assignment">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All vehicles</SelectItem>
              <SelectItem value="assigned">Assigned</SelectItem>
              <SelectItem value="unassigned">Unassigned</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table w-full" data-testid="vehicles-table">
            <thead>
              <tr>
                <th>Vehicle</th>
                <th>Status</th>
                <th>Driver</th>
                <th>City</th>
                <th>VIN</th>
                <th>Rental Ends</th>
                <th>Daily Rent</th>
                <th>Details</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {paged.slice.map((v) => {
                const rent = v.current_driver?.daily_rent || v.daily_rent;
                const displayStatus = v.status === "Active" ? (v.current_driver ? "rented" : v.rental_status || "available") : v.status;
                return (
                  <tr key={v.vehicle_id} data-testid={`vehicle-row-${v.vehicle_id}`}>
                    <td className="font-mono text-xs">
                      <span className="font-semibold text-[#17212B]">{v.reg_no}</span>{" "}
                      <span className="rounded bg-[#F1F5F9] px-1.5 py-0.5 text-[10px] text-[#64748B]">{v.vehicle_id}</span>
                    </td>
                    <td>
                      <span className={`${STATUS_CLS[displayStatus] || "st-none"} st-pill rounded-full px-2 py-0.5 text-[11px] font-medium`}>
                        {displayStatus}
                      </span>
                    </td>
                    <td>
                      {v.current_driver ? (
                        <span>
                          {v.current_driver.name} <span className="font-mono text-[11px] text-muted-foreground">{v.current_driver.driver_code}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Not Assigned</span>
                      )}
                    </td>
                    <td>{v.city}</td>
                    <td className="font-mono text-xs">{v.vin || "—"}</td>
                    <td className="font-mono text-xs">{v.rental_ends || "(blank)"}</td>
                    <td className="font-semibold">{rent ? inr(rent) : "—"}</td>
                    <td className="max-w-[180px] truncate" title={v.details || v.vehicle_type || ""}>{v.details || v.vehicle_type || "—"}</td>
                    <td className="text-right">
                      <Button size="icon" variant="ghost" className="h-8 w-8" title="Assign driver" onClick={() => setAssign(v)} data-testid={`vehicle-assign-${v.vehicle_id}`}>
                        <ArrowLeftRight className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" title="Edit" onClick={() => setEdit(v)} data-testid={`vehicle-edit-${v.vehicle_id}`}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {!paged.slice.length && (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-muted-foreground">No vehicles found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pager page={paged.page} pageSize={paged.size} total={paged.total} onPage={paged.setPage} testId="vehicles-pager" />
      </div>
      <VehicleDialog open={edit !== undefined} onOpenChange={(o) => !o && setEdit(undefined)} vehicle={edit} onSaved={load} />
      <AssignDriverDialog open={!!assign} onOpenChange={(o) => !o && setAssign(null)} vehicle={assign} onSaved={load} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} defaultMode="drivers_and_vehicles" onImported={load} />
    </div>
  );
}
