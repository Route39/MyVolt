import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ImagePlus, Loader2, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AuthImage } from "@/components/AuthImage";
import { VehicleSelect, useVehicles } from "@/components/Vehicles";
import { api, errMsg } from "@/lib/api";
import { fmtDate, inr } from "@/lib/format";

const TITLES = { new: "ADD RENT PAYMENT", split: "ADD SPLIT PAYMENT", resubmit: "CORRECT & RESUBMIT", correct: "ADMIN CORRECTION" };
const METHODS = ["UPI", "Bank Transfer", "Cash"];
const TYPES = ["image/jpeg", "image/png", "image/webp"];

const Screenshot = ({ file, existingId, uploading, scanning, onPick, onClear }) => {
  const ref = useRef();
  const pick = (f) => f && onPick(f);
  return (
    <div>
      <input ref={ref} type="file" accept=".jpg,.jpeg,.png,.webp" className="hidden" data-testid="payment-screenshot-input" onChange={(e) => { pick(e.target.files[0]); e.target.value = ""; }} />
      {file || existingId ? (
        <div className="relative flex items-center gap-3 rounded-md border p-2">
          {file ? <img src={file.preview} alt="Preview" className="h-20 w-16 rounded object-cover" data-testid="payment-screenshot-preview" /> : <AuthImage fileId={existingId} className="h-20 w-16 rounded" />}
          <div className="min-w-0 flex-1 text-xs">
            <div className="truncate font-medium">{file ? file.name : "Current screenshot"}</div>
            <div className="text-muted-foreground">{uploading ? "Uploading…" : scanning ? "Scanning payment screenshot…" : file ? "Uploaded" : "Kept unless replaced"}</div>
          </div>
          {uploading || scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : (
            <div className="flex gap-1">
              <Button type="button" variant="outline" size="sm" onClick={() => ref.current.click()} data-testid="payment-screenshot-replace">Replace</Button>
              {file && <Button type="button" variant="ghost" size="icon" onClick={onClear} data-testid="payment-screenshot-clear"><X className="h-4 w-4" /></Button>}
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          data-testid="payment-screenshot-dropzone"
          onClick={() => ref.current.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}
          className="flex w-full flex-col items-center gap-1 rounded-md border border-dashed px-3 py-5 text-sm text-muted-foreground transition-colors hover:border-[var(--r39-green)] hover:bg-[var(--r39-green-bg)]"
        >
          <ImagePlus className="h-5 w-5" />
          <span>Click or drop payment screenshot (optional)</span>
          <span className="text-[11px]">Upload if available · JPG, PNG, WEBP</span>
        </button>
      )}
    </div>
  );
};

export const PaymentDialog = ({ open, onOpenChange, mode = "new", driver, date, txn, onDone }) => {
  const [form, setForm] = useState({ amount: "", utr: "", method: "UPI", remarks: "", reason: "", vehicle_id: null });
  const vehicles = useVehicles(open);
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const editing = mode === "resubmit" || mode === "correct";

  useEffect(() => {
    if (!open) return;
    setForm({
      amount: String(txn?.amount ?? driver?.daily_rent ?? ""), utr: txn?.utr || "", method: txn?.method || "UPI",
      remarks: txn?.remarks || "", reason: "", vehicle_id: txn ? txn.vehicle_id : driver?.current_vehicle_id || null,
    });
    setFile(null);
    setScanning(false);
    setError("");
  }, [open, txn, driver]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target ? e.target.value : e }));

  const onPick = async (f) => {
    if (!TYPES.includes(f.type)) return toast.error("Only JPG, JPEG, PNG or WEBP images are allowed");
    const preview = URL.createObjectURL(f);
    setFile({ name: f.name, preview, id: null });
    setUploading(true);
    let fileId = null;
    try {
      const fd = new FormData();
      fd.append("file", f);
      const { data } = await api.post("/upload", fd);
      fileId = data.file_id;
      setFile({ name: f.name, preview, id: fileId });
    } catch (e) {
      setFile(null);
      toast.error(errMsg(e));
      return;
    } finally {
      setUploading(false);
    }
    if (form.method === "Cash") return;      // cash: screenshot is optional, nothing to scan
    // scan the screenshot: must be a real payment receipt; the UTR / transaction id is filled in (still editable)
    setScanning(true);
    try {
      const { data: scan } = await api.post("/upload/scan", { file_id: fileId });
      if (!scan.scanned) {
        toast.info("Could not read the screenshot automatically. Please enter the UTR manually.");
      } else if (!scan.is_payment) {
        setFile(null);
        toast.error("This does not look like a payment screenshot. Please upload a clear screenshot of the payment.");
      } else if (scan.utr) {
        setForm((f) => ({ ...f, utr: scan.utr }));
        toast.success(`Payment screenshot verified. UTR ${scan.utr} filled in.`);
      } else {
        toast.info("Payment screenshot detected, but the transaction ID could not be read. Please enter it manually.");
      }
    } catch (e2) {
      toast.info("Could not scan the screenshot. Please enter the UTR manually.");
    } finally {
      setScanning(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (submitting || uploading || scanning) return;
    setError("");
    const body = { amount: Number(form.amount), utr: form.utr.trim(), method: form.method, remarks: form.remarks, file_id: file?.id || txn?.file_id || null, vehicle_id: form.vehicle_id };
    setSubmitting(true);
    try {
      if (mode === "resubmit") await api.put(`/transactions/${txn.id}/resubmit`, body);
      else if (mode === "correct") await api.put(`/transactions/${txn.id}/correct`, { ...body, reason: form.reason });
      else await api.post("/transactions", { ...body, driver_id: driver.id, payment_date: date, is_split: mode === "split" });
      toast.success(mode === "correct" ? "Correction saved — sent back for verification" : "Pending Accounts Verification", {
        description: `${driver.name} · ${fmtDate(date)} · ${inr(body.amount)}`,
      });
      onOpenChange(false);
      onDone?.();
    } catch (e2) {
      setError(errMsg(e2));
    } finally {
      setSubmitting(false);
    }
  };

  const cash = form.method === "Cash";
  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-[520px]" data-testid="payment-dialog">
        <DialogHeader>
          <DialogTitle className="text-base tracking-wide" data-testid="payment-dialog-title">{TITLES[mode]}</DialogTitle>
          <DialogDescription className="sr-only">Enter payment details</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 rounded-md bg-[var(--surface)] p-3 text-sm sm:grid-cols-4">
          <div><div className="text-[11px] text-muted-foreground">Driver</div><div className="truncate font-medium" data-testid="payment-dialog-driver">{driver?.name}</div></div>
          <div><div className="text-[11px] text-muted-foreground">Driver ID</div><div className="truncate font-mono text-xs font-medium" data-testid="payment-dialog-driver-code">{driver?.driver_code}</div></div>
          <div><div className="text-[11px] text-muted-foreground">Date</div><div className="font-medium" data-testid="payment-dialog-date">{fmtDate(date)}</div></div>
          <div><div className="text-[11px] text-muted-foreground">Daily rent</div><div className="font-medium">{inr(driver?.daily_rent)}</div></div>
          <div className="col-span-2 sm:col-span-4"><span className="text-[11px] text-muted-foreground">Current vehicle </span><span className="font-mono text-xs font-medium" data-testid="payment-dialog-current-vehicle">{driver?.current_vehicle_id || "None"}{driver?.vehicle_no ? ` · ${driver.vehicle_no}` : ""}</span></div>
        </div>
        {mode === "resubmit" && txn?.rejection_reason && (
          <div className="st-rejected st-pill flex gap-2 rounded-md p-3 text-sm" data-testid="payment-dialog-rejection">
            <AlertTriangle className="h-4 w-4 shrink-0" /><span><b>Rejected:</b> {txn.rejection_reason}</span>
          </div>
        )}
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="amt">Payment amount (₹)</Label>
              <Input id="amt" type="number" min="1" step="1" required autoFocus value={form.amount} onChange={set("amount")} className="h-11 text-base font-semibold" data-testid="payment-amount-input" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="utr">UTR / Transaction ref. {cash && <span className="text-muted-foreground">(optional)</span>}</Label>
              <Input id="utr" required={!cash} value={form.utr} onChange={(e) => setForm((f) => ({ ...f, utr: e.target.value.toUpperCase() }))} placeholder="e.g. 432198765012" className="h-11 font-mono" data-testid="payment-utr-input" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Vehicle ID used for this payment</Label>
            <VehicleSelect vehicles={vehicles.filter((v) => v.status !== "Inactive" || v.vehicle_id === form.vehicle_id)} value={form.vehicle_id}
              onChange={(v) => setForm((f) => ({ ...f, vehicle_id: v }))} testId="payment-vehicle-select" placeholder={editing && !txn?.vehicle_id ? "Vehicle ID not recorded — select" : "Select vehicle"} />
          </div>
          <div className="space-y-1.5">
            <Label>Payment method</Label>
            <div className="grid grid-cols-3 gap-2">
              {METHODS.map((m) => (
                <button type="button" key={m} onClick={() => set("method")(m)} data-testid={`payment-method-${m.replace(" ", "-").toLowerCase()}`}
                  className={`h-10 rounded-md border px-1 text-xs font-medium leading-tight transition-colors w375:text-sm ${form.method === m ? "border-[var(--r39-green)] bg-[var(--r39-green-bg)] text-[var(--r39-green-text)]" : "hover:bg-muted"}`}>
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Payment screenshot <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Screenshot file={file} existingId={editing ? txn?.file_id : null} uploading={uploading} scanning={scanning} onPick={onPick} onClear={() => setFile(null)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rem">Remarks <span className="text-muted-foreground">(optional)</span></Label>
            <Textarea id="rem" rows={2} value={form.remarks} onChange={set("remarks")} data-testid="payment-remarks-input" />
          </div>
          {mode === "correct" && (
            <div className="space-y-1.5">
              <Label htmlFor="reason">Reason for correction (required)</Label>
              <Textarea id="reason" rows={2} required minLength={5} value={form.reason} onChange={set("reason")} data-testid="payment-correction-reason-input" />
              <p className="text-[11px] text-muted-foreground">Logged in the audit trail. The payment goes back to Accounts for re-verification.</p>
            </div>
          )}
          {error && <div className="st-rejected st-pill rounded-md p-2.5 text-sm" data-testid="payment-dialog-error">{error}</div>}
          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting} data-testid="payment-cancel-button">CANCEL</Button>
            <Button type="submit" disabled={submitting || uploading || scanning} className="h-10" data-testid="payment-submit-button">
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mode === "correct" ? "SAVE CORRECTION" : mode === "resubmit" ? "RESUBMIT FOR VERIFICATION" : "SUBMIT FOR VERIFICATION"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
