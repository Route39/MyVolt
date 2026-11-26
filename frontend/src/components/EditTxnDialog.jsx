import { useState } from "react";
import { Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";

const F = ({ label, children }) => (
  <label className="block space-y-1 text-sm"><span className="text-muted-foreground">{label}</span>{children}</label>
);

export function EditTxnDialog({ t, onSaved }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({});
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const start = () => {
    setF({ amount: t.amount, payment_date: t.payment_date || "", utr: t.utr || "", method: t.method,
           vehicle_id: t.vehicle_id || "", remarks: t.remarks || "", reason: "" });
    setErr(""); setOpen(true);
  };
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v?.target ? v.target.value : v }));
  const save = async () => {
    setBusy(true); setErr("");
    try {
      const { data } = await api.put(`/transactions/${t.id}/edit`, {
        ...f, amount: Number(f.amount), vehicle_id: f.vehicle_id || null, file_id: null });
      setOpen(false); onSaved?.(data);
    } catch (e) {
      const d = e?.response?.data?.detail;
      setErr(typeof d === "string" ? d : Array.isArray(d) ? d.map((x) => x.msg).join(", ") : "Save failed");
    } finally { setBusy(false); }
  };
  return (
    <>
      <Button variant="outline" className="w-full" onClick={start} data-testid="edit-payment-btn">
        <Pencil className="mr-1.5 h-4 w-4" />Edit Payment
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Edit Payment · {t.id}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <F label="Amount (₹)"><Input type="number" value={f.amount ?? ""} onChange={set("amount")} /></F>
            <F label="Payment date"><Input type="date" value={f.payment_date ?? ""} onChange={set("payment_date")} /></F>
            <F label="UTR / Ref no."><Input value={f.utr ?? ""} onChange={set("utr")} className="font-mono" /></F>
            <F label="Payment method">
              <Select value={f.method} onValueChange={set("method")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="UPI">UPI</SelectItem>
                  <SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
                  <SelectItem value="Cash">Cash</SelectItem>
                </SelectContent>
              </Select>
            </F>
            <F label="Vehicle ID (e.g. BLR10)"><Input value={f.vehicle_id ?? ""} onChange={set("vehicle_id")} /></F>
            <F label="Remarks"><Input value={f.remarks ?? ""} onChange={set("remarks")} /></F>
            <div className="sm:col-span-2"><F label="Reason for edit"><Input value={f.reason ?? ""} onChange={set("reason")} placeholder="Why is this being changed?" /></F></div>
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={busy}>{busy ? "Saving..." : "Save changes"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
