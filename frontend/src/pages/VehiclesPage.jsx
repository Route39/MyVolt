import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, ArrowLeftRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DriverSearch } from "@/components/DriverSearch";
import { api, errMsg } from "@/lib/api";
import { PageHeader, Pager, usePaged } from "@/components/kit";

const EMPTY = { reg_no: "", city: "", vehicle_type: "", status: "Active", details: "" };
const STATUS_CLS = { Active: "st-verified", Maintenance: "st-pending", Inactive: "st-none" };

const VehicleDialog = ({ open, onOpenChange, vehicle, onSaved }) => {
  const [f, setF] = useState(EMPTY);
  useEffect(() => {
    if (open) setF(vehicle ? { reg_no: vehicle.reg_no, city: vehicle.city, vehicle_type: vehicle.vehicle_type || "", status: vehicle.status, details: vehicle.details || "" } : EMPTY);
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
      <DialogContent className="sm:max-w-[480px]" data-testid="vehicle-form-dialog">
        <DialogHeader>
          <DialogTitle>{vehicle ? `Edit ${vehicle.vehicle_id}` : "Add vehicle"}</DialogTitle>
          <DialogDescription>{vehicle ? "Vehicle ID is permanent and cannot be changed." : "Vehicle ID is generated from the city (e.g. BLR-005)."}</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label className="text-xs">Registration number</Label><Input required value={f.reg_no} onChange={set("reg_no")} className="font-mono" data-testid="vehicle-form-reg" /></div>
          <div className="space-y-1"><Label className="text-xs">City</Label><Input required value={f.city} onChange={set("city")} placeholder="Bengaluru, Chennai…" data-testid="vehicle-form-city" /></div>
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
  const load = useCallback(() => api.get("/vehicles", { params: { q } }).then((r) => setRows(r.data)), [q]);
  const [status, setStatus] = useState("all");
  const filtered = rows.filter((v) => status === "all" || v.status === status);
  const paged = usePaged(filtered, 25, [q, status]);
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);
  return (
    <div className="space-y-4 fade-up">
      <PageHeader title="Vehicle Management" subtitle={`${rows.length} vehicles · Vehicle IDs are permanent and never reused`}
        actions={<Button onClick={() => setEdit(null)} data-testid="add-vehicle-button"><Plus className="mr-1.5 h-4 w-4" />Add vehicle</Button>} />
      <div className="r-card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <Input placeholder="Search Vehicle ID, registration, city" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 max-w-sm" data-testid="vehicles-search" />
        <Select value={status} onValueChange={setStatus}><SelectTrigger className="h-9 w-[150px]" data-testid="vehicles-filter-status"><SelectValue /></SelectTrigger>
          <SelectContent>{["all", "Active", "Maintenance", "Inactive"].map((s) => <SelectItem key={s} value={s}>{s === "all" ? "All statuses" : s}</SelectItem>)}</SelectContent></Select>
      </div>
      <div className="overflow-x-auto">
        <table className="data-table w-full" data-testid="vehicles-table">
          <thead><tr><th>Vehicle ID</th><th>Registration</th><th>City</th><th>Type</th><th>Status</th><th>Current driver</th><th>Details</th><th></th></tr></thead>
          <tbody>
            {paged.slice.map((v) => (
              <tr key={v.vehicle_id} data-testid={`vehicle-row-${v.vehicle_id}`}>
                <td className="font-mono text-xs font-semibold">{v.vehicle_id}</td>
                <td className="font-mono text-xs">{v.reg_no}</td>
                <td>{v.city}</td>
                <td>{v.vehicle_type || "—"}</td>
                <td><span className={`${STATUS_CLS[v.status]} st-pill rounded-full px-2 py-0.5 text-[11px] font-medium`}>{v.status}</span></td>
                <td>{v.current_driver ? <span>{v.current_driver.name} <span className="font-mono text-[11px] text-muted-foreground">{v.current_driver.driver_code}</span></span> : <span className="text-muted-foreground">Unassigned</span>}</td>
                <td className="max-w-[200px] truncate">{v.details || "—"}</td>
                <td className="text-right">
                  <Button size="icon" variant="ghost" className="h-8 w-8" title="Assign driver" onClick={() => setAssign(v)} data-testid={`vehicle-assign-${v.vehicle_id}`}><ArrowLeftRight className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8" title="Edit" onClick={() => setEdit(v)} data-testid={`vehicle-edit-${v.vehicle_id}`}><Pencil className="h-4 w-4" /></Button>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={8} className="py-8 text-center text-muted-foreground">No vehicles found</td></tr>}
          </tbody>
        </table>
      </div>
      <Pager page={paged.page} pageSize={paged.size} total={paged.total} onPage={paged.setPage} testId="vehicles-pager" />
      </div>
      <VehicleDialog open={edit !== undefined} onOpenChange={(o) => !o && setEdit(undefined)} vehicle={edit} onSaved={load} />
      <AssignDriverDialog open={!!assign} onOpenChange={(o) => !o && setAssign(null)} vehicle={assign} onSaved={load} />
    </div>
  );
}
