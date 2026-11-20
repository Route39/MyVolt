import { useEffect, useState } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, errMsg } from "@/lib/api";
import { VehicleSelect, useVehicles } from "@/components/Vehicles";
import { fmtDate, fmtDateTime, inr } from "@/lib/format";

const EMPTY = { name: "", mobile: "", city: "", joining_date: "", handover_date: "", rent_start_date: "", daily_rent: "", package: "", status: "Active", rent_free_dates: [], driver_code: "", current_vehicle_id: null };

const F = ({ label, children }) => <div className="space-y-1"><Label className="text-xs">{label}</Label>{children}</div>;

export const DriverFormDialog = ({ open, onOpenChange, driver, onSaved }) => {
  const [f, setF] = useState(EMPTY);
  const [freeDate, setFreeDate] = useState("");
  const [busy, setBusy] = useState(false);
  const vehicles = useVehicles(open && !driver);
  useEffect(() => {
    if (open) setF(driver ? { ...EMPTY, ...driver, daily_rent: String(driver.daily_rent) } : EMPTY);
  }, [open, driver]);
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e });

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const body = { ...f, daily_rent: Number(f.daily_rent), handover_date: f.handover_date || null, rent_start_date: f.rent_start_date || null };
    ["id", "summary", "adjustments", "created_at", "current_vehicle", "assignments", "vehicle_no"].forEach((k) => delete body[k]);
    if (driver) { delete body.driver_code; delete body.current_vehicle_id; }
    else body.driver_code = f.driver_code.trim() || null;
    try {
      if (driver) await api.put(`/drivers/${driver.id}`, body);
      else await api.post("/drivers", body);
      toast.success(driver ? "Driver updated" : "Driver added");
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
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-[600px]" data-testid="driver-form-dialog">
        <DialogHeader><DialogTitle>{driver ? `Edit ${driver.name}` : "Add driver"}</DialogTitle><DialogDescription>Changes are recorded in the audit log.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <F label="Driver name"><Input required value={f.name} onChange={set("name")} data-testid="driver-form-name" /></F>
            <F label="Mobile (10 digits)"><Input required pattern="\d{10}" value={f.mobile} onChange={set("mobile")} data-testid="driver-form-mobile" /></F>
            {driver ? (
              <F label="Driver ID (permanent)"><Input disabled value={driver.driver_code} className="font-mono" data-testid="driver-form-code-locked" /></F>
            ) : (
              <F label="Driver ID override (optional)"><Input value={f.driver_code} onChange={set("driver_code")} placeholder="Auto, e.g. BLR-D-005" className="font-mono" data-testid="driver-form-code" /></F>
            )}
            {!driver && (
              <F label="Assign vehicle (optional)">
                <VehicleSelect vehicles={vehicles.filter((v) => !v.current_driver && v.status !== "Inactive")} value={f.current_vehicle_id}
                  onChange={(v) => setF({ ...f, current_vehicle_id: v })} testId="driver-form-vehicle" allowNone />
              </F>
            )}
            <F label="City"><Input required value={f.city} onChange={set("city")} data-testid="driver-form-city" /></F>
            <F label="Joining date"><Input type="date" required value={f.joining_date} onChange={set("joining_date")} data-testid="driver-form-joining" /></F>
            <F label="Vehicle handover date"><Input type="date" value={f.handover_date || ""} onChange={set("handover_date")} data-testid="driver-form-handover" /></F>
            <F label="Rent calculation start date"><Input type="date" value={f.rent_start_date || ""} onChange={set("rent_start_date")} data-testid="driver-form-rent-start" /></F>
            <F label="Daily rent (₹)"><Input type="number" min="1" required value={f.daily_rent} onChange={set("daily_rent")} data-testid="driver-form-rent" /></F>
            <F label="Package (optional)"><Input value={f.package || ""} onChange={set("package")} placeholder="e.g. Silver Package" data-testid="driver-form-package" /></F>
            <F label="Status">
              <Select value={f.status} onValueChange={set("status")}>
                <SelectTrigger data-testid="driver-form-status"><SelectValue /></SelectTrigger>
                <SelectContent>{["Active", "Suspended", "Inactive"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </F>
          </div>
          <p className="text-[11px] text-muted-foreground">If left blank, rent starts from the vehicle handover date (or joining date when no handover date is set).</p>
          <F label="Rent-free days">
            <div className="flex gap-2">
              <Input type="date" value={freeDate} onChange={(e) => setFreeDate(e.target.value)} data-testid="driver-form-free-date" />
              <Button type="button" variant="outline" data-testid="driver-form-add-free-date" onClick={() => { if (freeDate && !f.rent_free_dates.includes(freeDate)) setF({ ...f, rent_free_dates: [...f.rent_free_dates, freeDate].sort() }); setFreeDate(""); }}>Add</Button>
            </div>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {f.rent_free_dates.map((d) => (
                <span key={d} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">{fmtDate(d)}
                  <button type="button" onClick={() => setF({ ...f, rent_free_dates: f.rent_free_dates.filter((x) => x !== d) })}><X className="h-3 w-3" /></button>
                </span>
              ))}
            </div>
          </F>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy} data-testid="driver-form-save">Save driver</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export const AdjustmentsDialog = ({ open, onOpenChange, driver, onSaved }) => {
  const [f, setF] = useState({ date: "", amount: "", reason: "" });
  const [items, setItems] = useState([]);
  useEffect(() => {
    if (open && driver) { setItems(driver.adjustments || []); setF({ date: "", amount: "", reason: "" }); }
  }, [open, driver]);
  const add = async (e) => {
    e.preventDefault();
    try {
      const { data } = await api.post(`/drivers/${driver.id}/adjustments`, { ...f, amount: Number(f.amount) });
      setItems(data.adjustments);
      setF({ date: "", amount: "", reason: "" });
      toast.success("Adjustment approved");
      onSaved();
    } catch (e2) {
      toast.error(errMsg(e2));
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]" data-testid="adjustments-dialog">
        <DialogHeader><DialogTitle>Rental adjustments · {driver?.name}</DialogTitle><DialogDescription>Approved waivers reduce expected rent for that date.</DialogDescription></DialogHeader>
        <div className="max-h-[220px] space-y-2 overflow-y-auto">
          {items.map((a) => (
            <div key={a.id} className="flex justify-between rounded-md border p-2.5 text-sm">
              <div><div className="font-medium">{fmtDate(a.date)} · −{inr(a.amount)}</div><div className="text-xs text-muted-foreground">{a.reason}</div></div>
              <div className="text-right text-[11px] text-muted-foreground">{a.by}<br />{fmtDateTime(a.at)}</div>
            </div>
          ))}
          {!items.length && <p className="text-sm text-muted-foreground">No adjustments yet.</p>}
        </div>
        <form onSubmit={add} className="grid gap-2 sm:grid-cols-[1fr_110px]">
          <Input type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} data-testid="adjustment-date" />
          <Input type="number" min="1" required placeholder="₹ amount" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} data-testid="adjustment-amount" />
          <Input required minLength={3} placeholder="Reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} className="sm:col-span-2" data-testid="adjustment-reason" />
          <Button type="submit" className="sm:col-span-2" data-testid="adjustment-save">Approve adjustment</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};
