import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errMsg } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";

export const NOT_RECORDED = "Vehicle ID not recorded";

export const useVehicles = (open = true) => {
  const [vehicles, setVehicles] = useState([]);
  useEffect(() => {
    if (open) api.get("/vehicles").then((r) => setVehicles(r.data));
  }, [open]);
  return vehicles;
};

export const VehicleSelect = ({ vehicles, value, onChange, testId, placeholder = "Select vehicle", allowNone }) => (
  <Select value={value || (allowNone ? "none" : "")} onValueChange={(v) => onChange(v === "none" ? null : v)}>
    <SelectTrigger className="h-10" data-testid={testId}><SelectValue placeholder={placeholder} /></SelectTrigger>
    <SelectContent>
      {allowNone && <SelectItem value="none">No vehicle</SelectItem>}
      {vehicles.map((v) => (
        <SelectItem key={v.vehicle_id} value={v.vehicle_id} data-testid={`${testId}-option-${v.vehicle_id}`}>
          <span className="font-mono text-xs font-semibold">{v.vehicle_id}</span>
          <span className="font-mono text-xs text-muted-foreground"> · {v.reg_no}</span>
          {v.status !== "Active" && <span className="text-xs text-muted-foreground"> · {v.status}</span>}
          {v.current_driver && <span className="text-xs text-muted-foreground"> · {v.current_driver.name}</span>}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

export const VehicleAssignDialog = ({ open, onOpenChange, driver, onSaved }) => {
  const all = useVehicles(open);
  const [vid, setVid] = useState(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) { setVid(null); setReason(""); }
  }, [open]);
  const options = all.filter((v) => v.status !== "Inactive" && v.vehicle_id !== driver?.current_vehicle_id && (!v.current_driver || v.current_driver.id === driver?.id));
  const save = async () => {
    setBusy(true);
    try {
      await api.post(`/drivers/${driver.id}/assign-vehicle`, { vehicle_id: vid, reason });
      toast.success(vid ? `Vehicle changed to ${vid}` : "Vehicle unassigned");
      onOpenChange(false);
      onSaved?.();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]" data-testid="vehicle-assign-dialog">
        <DialogHeader>
          <DialogTitle>Change vehicle · {driver?.name}</DialogTitle>
          <DialogDescription>Current: {driver?.current_vehicle_id || "none"}{driver?.vehicle_no ? ` (${driver.vehicle_no})` : ""}. Past payments keep their recorded vehicle.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label className="text-xs">New vehicle (free vehicles only)</Label>
            <VehicleSelect vehicles={options} value={vid} onChange={setVid} testId="assign-vehicle-select" allowNone />
          </div>
          <div className="space-y-1"><Label className="text-xs">Reason (optional)</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Old vehicle sent for service" data-testid="assign-vehicle-reason" />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy || (vid === null && !driver?.current_vehicle_id)} onClick={save} data-testid="assign-vehicle-save">Save change</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export const AssignmentHistory = ({ items }) => (
  <section>
    <h3 className="mb-2 text-sm font-semibold">Vehicle assignment history</h3>
    <div className="overflow-x-auto rounded-lg border bg-white">
      <table className="data-table w-full" data-testid="assignment-history-table">
        <thead><tr><th>Vehicle ID</th><th>Registration</th><th>Start</th><th>End</th><th>Changed by</th><th>Reason</th></tr></thead>
        <tbody>
          {items.map((a) => (
            <tr key={a.id}>
              <td className="font-mono text-xs font-semibold">{a.vehicle_id}</td>
              <td className="font-mono text-xs">{a.reg_no}</td>
              <td>{fmtDateTime(a.start_at)}</td>
              <td>{a.end_at ? fmtDateTime(a.end_at) : <span className="text-[var(--r39-green-text)]">Current</span>}</td>
              <td>{a.changed_by_name}</td>
              <td className="max-w-[240px] truncate" title={a.reason}>{a.reason || "—"}</td>
            </tr>
          ))}
          {!items.length && <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">No vehicle assigned yet</td></tr>}
        </tbody>
      </table>
    </div>
  </section>
);
