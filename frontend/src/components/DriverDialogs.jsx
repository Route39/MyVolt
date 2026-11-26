import { useEffect, useState } from "react";
import { toast } from "sonner";
import { X, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, errMsg } from "@/lib/api";
import { useUser } from "@/context/UserContext";
import { VehicleSelect, useVehicles } from "@/components/Vehicles";
import { fmtDate, fmtDateTime, inr, FLEET_CITIES, normalizeCity } from "@/lib/format";

const EMPTY = { name: "", mobile: "", city: "Bangalore", joining_date: "", handover_date: "", rent_start_date: "", daily_rent: "", driver_code: "", status: "Active" };

const F = ({ label, children }) => <div className="space-y-1"><Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</Label>{children}</div>;

export const DriverFormDialog = ({ open, onOpenChange, driver, onSaved }) => {
  const { hasRole } = useUser();
  const isAdmin = hasRole("admin");
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (open) {
      const today = new Date().toISOString().slice(0, 10);
      setF(
        driver
          ? {
              name: driver.name || "",
              mobile: driver.mobile || "",
              city: driver.city || "Bangalore",
              joining_date: driver.joining_date || "",
              handover_date: driver.handover_date || driver.joining_date || "",
              rent_start_date: driver.rent_start_date || driver.handover_date || driver.joining_date || "",
              daily_rent: driver.daily_rent !== undefined && driver.daily_rent !== null ? String(driver.daily_rent) : "",
              driver_code: driver.driver_code || "",
              status: driver.status || "Active",
            }
          : { ...EMPTY, joining_date: today, handover_date: today, rent_start_date: today }
      );
      setConfirmDelete(false);
    }
  }, [open, driver]);
  const set = (k) => (e) => setF((prev) => ({ ...prev, [k]: e?.target ? e.target.value : e }));
  const onJoiningChange = (e) => {
    const val = e.target.value;
    setF((prev) => {
      const next = { ...prev, joining_date: val };
      if (!prev.handover_date || prev.handover_date === prev.joining_date) next.handover_date = val;
      if (!prev.rent_start_date || prev.rent_start_date === prev.joining_date || prev.rent_start_date === prev.handover_date) {
        next.rent_start_date = val;
      }
      return next;
    });
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const body = {
      name: f.name.trim(),
      mobile: f.mobile.trim(),
      city: f.city,
      joining_date: f.joining_date || null,
      handover_date: f.handover_date || f.joining_date || null,
      rent_start_date: f.rent_start_date || f.handover_date || f.joining_date || null,
      daily_rent: Number(f.daily_rent) || 0,
      status: f.status || "Active",
    };
    ["id", "summary", "adjustments", "created_at", "current_vehicle", "assignments", "vehicle_no", "package"].forEach((k) => delete body[k]);
    if (driver) {
      body.driver_code = f.driver_code.trim().toUpperCase() || null;
    } else {
      body.driver_code = f.driver_code.trim() || null;
    }
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
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-[560px]" data-testid="driver-form-dialog">
        <DialogHeader>
          <DialogTitle>{driver ? `Edit Driver · ${driver.name}` : "Add Driver"}</DialogTitle>
          <DialogDescription>Driver information is saved directly to the database.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-3.5 sm:grid-cols-2">
            {driver ? (
              <F label="DRIVER ID">
                <Input value={f.driver_code} onChange={set("driver_code")} className="font-mono uppercase" data-testid="driver-form-code-edit" />
              </F>
            ) : (
              <F label="DRIVER ID">
                <Input
                  value={f.driver_code}
                  onChange={set("driver_code")}
                  placeholder="e.g. BLR-D-001 (auto if empty)"
                  className="font-mono"
                  data-testid="driver-form-code"
                />
              </F>
            )}
            <F label="DRIVER NAME">
              <Input required value={f.name} onChange={set("name")} placeholder="Driver name" data-testid="driver-form-name" />
            </F>
            <F label="PHONE NUMBER">
              <Input
                required
                pattern="\d{10}"
                value={f.mobile}
                onChange={set("mobile")}
                placeholder="10-digit mobile number"
                data-testid="driver-form-mobile"
              />
            </F>
            <F label="CITY">
              <Select value={normalizeCity(f.city)} onValueChange={set("city")}>
                <SelectTrigger data-testid="driver-form-city">
                  <SelectValue placeholder="Select city" />
                </SelectTrigger>
                <SelectContent>
                  {FLEET_CITIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                  {f.city && !FLEET_CITIES.includes(f.city) && f.city !== "Bengaluru" && (
                    <SelectItem value={f.city}>{f.city}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </F>
            <F label="JOINING DATE">
              <Input type="date" required value={f.joining_date} onChange={onJoiningChange} data-testid="driver-form-joining" />
            </F>
            <F label="VEHICLE HANDOVER DATE">
              <Input type="date" value={f.handover_date} onChange={set("handover_date")} data-testid="driver-form-handover" />
            </F>
            <F label="RENT START DATE">
              <Input type="date" value={f.rent_start_date} onChange={set("rent_start_date")} data-testid="driver-form-rent-start" />
            </F>
            <F label="RENT">
              <Input
                type="number"
                min="1"
                required
                value={f.daily_rent}
                onChange={set("daily_rent")}
                placeholder="Daily rent (₹)"
                data-testid="driver-form-rent"
              />
            </F>
            <F label="STATUS">
              <Select value={f.status} onValueChange={set("status")}>
                <SelectTrigger data-testid="driver-form-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Suspended">Suspended</SelectItem>
                  <SelectItem value="Inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </F>
          </div>
          <div className="flex flex-col-reverse gap-2 w425:flex-row w425:items-center w425:justify-between pt-2">
            {driver && isAdmin ? (
              <Button
                type="button"
                variant="ghost"
                className="text-[#DC2626] hover:bg-red-50 hover:text-[#B91C1C] text-xs h-9 gap-1.5"
                onClick={() => setConfirmDelete(true)}
                data-testid="driver-form-delete-button"
              >
                <Trash2 className="h-4 w-4" />
                Delete driver
              </Button>
            ) : <div />}
            <div className="flex flex-col-reverse gap-2 w425:flex-row w425:justify-end">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={busy} data-testid="driver-form-save">Save driver</Button>
            </div>
          </div>
        </form>
      </DialogContent>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent data-testid="driver-form-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Driver</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete driver <span className="font-semibold text-foreground">{driver?.name}</span> ({driver?.driver_code})? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[#DC2626] hover:bg-[#B91C1C]"
              onClick={async () => {
                try {
                  await api.delete(`/drivers/${driver.id}`);
                  toast.success(`Driver ${driver.name} deleted`);
                  setConfirmDelete(false);
                  onOpenChange(false);
                  onSaved();
                } catch (err) {
                  toast.error(errMsg(err));
                }
              }}
              data-testid="confirm-driver-form-delete"
            >
              Delete driver
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
            <div key={a.id} className="flex justify-between gap-3 rounded-md border p-2.5 text-sm">
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
