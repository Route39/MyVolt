import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, CalendarDays, Check, X, PencilLine, RotateCcw, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScreenshotViewer } from "@/components/ScreenshotViewer";
import { StatusPill } from "@/components/StatusPill";
import { PaymentDialog } from "@/components/PaymentDialog";
import { useUser } from "@/context/UserContext";
import { api, errMsg } from "@/lib/api";
import { fmtDate, fmtDateTime, inr } from "@/lib/format";

const Row = ({ label, children, testId }) => (
  <div className="flex items-start justify-between gap-4 py-2">
    <span className="text-[13px] text-muted-foreground">{label}</span>
    <span className="text-right text-sm font-medium" data-testid={testId}>{children}</span>
  </div>
);

const AuditTrail = ({ items }) => (
  <section className="rounded-lg border bg-white p-4">
    <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Audit trail</h3>
    <ol className="space-y-3" data-testid="txn-audit-trail">
      {items.map((a) => (
        <li key={a.id} className="border-l-2 pl-3 text-[13px]">
          <div className="font-medium">{a.action}</div>
          {(a.prev || a.new) && <div className="text-xs text-muted-foreground">{a.prev && <span className="line-through">{a.prev}</span>} {a.prev && "→"} {a.new}</div>}
          <div className="text-[11px] text-muted-foreground">{a.user_name} · {fmtDateTime(a.ts)}</div>
        </li>
      ))}
    </ol>
  </section>
);

const RejectDialog = ({ open, onOpenChange, onConfirm, busy }) => {
  const [remarks, setRemarks] = useState("");
  useEffect(() => { if (open) setRemarks(""); }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="reject-dialog">
        <DialogHeader>
          <DialogTitle>Reject payment</DialogTitle>
          <DialogDescription>Rejection remarks are required and will be sent to the staff member.</DialogDescription>
        </DialogHeader>
        <Textarea rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. UTR not found in bank statement" data-testid="reject-remarks-input" />
        <div className="flex flex-wrap gap-1.5">
          {["UTR not found in bank statement", "Amount does not match screenshot", "Screenshot unclear", "Duplicate entry"].map((r) => (
            <button key={r} type="button" onClick={() => setRemarks(r)} className="rounded-full border px-2.5 py-1 text-xs hover:bg-muted">{r}</button>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" disabled={remarks.trim().length < 3 || busy} onClick={() => onConfirm(remarks.trim())} data-testid="reject-confirm-button">Confirm rejection</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const Actions = ({ t, user, onApprove, onReject, onCorrect, onResubmit }) => {
  const canVerify = ["accounts", "admin"].includes(user.role) && t.status === "pending";
  const own = t.submitted_by === user.id || t.last_modified_by === user.id;
  return (
    <div className="space-y-2">
      {canVerify && own && <div className="flex gap-2 rounded-md bg-muted p-3 text-xs"><Info className="h-4 w-4 shrink-0" />You entered this payment, so another person must verify it.</div>}
      {canVerify && (
        <div className="grid grid-cols-2 gap-2">
          <Button disabled={own} onClick={onApprove} className="h-11 bg-[var(--r39-green)] hover:bg-[var(--r39-green-hover)]" data-testid="approve-payment-button"><Check className="mr-1.5 h-4 w-4" />APPROVE PAYMENT</Button>
          <Button disabled={own} variant="destructive" onClick={onReject} className="h-11" data-testid="reject-payment-button"><X className="mr-1.5 h-4 w-4" />REJECT PAYMENT</Button>
        </div>
      )}
      {t.status === "rejected" && (user.role === "admin" || own) && (
        <Button className="w-full" onClick={onResubmit} data-testid="resubmit-payment-button"><RotateCcw className="mr-1.5 h-4 w-4" />Correct & Resubmit</Button>
      )}
      {user.role === "admin" && t.status !== "rejected" && (
        <Button variant="outline" className="w-full" onClick={onCorrect} data-testid="admin-correct-button"><PencilLine className="mr-1.5 h-4 w-4" />Authorised correction</Button>
      )}
    </div>
  );
};

export default function TransactionDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useUser();
  const [t, setT] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [reject, setReject] = useState(false);
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.get(`/transactions/${id}`).then((r) => setT(r.data)).catch((e) => toast.error(errMsg(e))), [id]);
  useEffect(() => { load(); }, [load]);

  const act = async (path, body, msg) => {
    setBusy(true);
    try {
      const { data } = await api.post(`/transactions/${id}/${path}`, body);
      setT(data);
      toast.success(msg);
      setConfirm(false);
      setReject(false);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (!t) return null;
  const d = t.driver;
  return (
    <div className="space-y-4 fade-up">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => nav(-1)} data-testid="txn-back-button"><ArrowLeft className="mr-1 h-4 w-4" />Back</Button>
        <span className="font-mono text-sm text-muted-foreground" data-testid="txn-id">{t.id}</span>
        <StatusPill status={t.status} testId="txn-detail-status" />
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => nav(`/calendar?driver=${t.driver_id}&month=${t.payment_date.slice(0, 7)}`)} data-testid="txn-open-calendar">
          <CalendarDays className="mr-1.5 h-4 w-4" />Open calendar
        </Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        <ScreenshotViewer fileId={t.file_id} filename={`${t.id}_${t.utr}.png`} />
        <div className="space-y-4">
          <section className="rounded-lg border bg-white p-4">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-lg font-semibold" data-testid="txn-driver-name">{t.driver_name}</h2>
              <span className="text-2xl font-semibold tracking-tight" data-testid="txn-amount">{inr(t.amount)}</span>
            </div>
            <div className="divide-y">
              <Row label="Driver ID" testId="txn-driver-code"><span className="font-mono">{t.driver_code}</span></Row>
              <Row label="Mobile"><span className="font-mono">{d?.mobile}</span></Row>
              <Row label="Vehicle ID (this payment)" testId="txn-vehicle-id">
                {t.vehicle_id ? <span className="font-mono">{t.vehicle_id}</span> : <span className="italic text-muted-foreground">Vehicle ID not recorded</span>}
              </Row>
              <Row label="Vehicle reg. (this payment)" testId="txn-vehicle-reg"><span className="font-mono">{t.vehicle_no}</span></Row>
              {d && d.current_vehicle_id !== t.vehicle_id && <Row label="Driver's current vehicle"><span className="font-mono text-muted-foreground">{d.current_vehicle_id || "none"}</span></Row>}
              <Row label="City">{t.city}</Row>
              <Row label="Joining date">{fmtDate(d?.joining_date)}</Row>
              <Row label="Payment date" testId="txn-payment-date">{fmtDate(t.payment_date)}</Row>
              <Row label="Daily rent">{inr(d?.daily_rent)}{d && t.amount < d.daily_rent && <span className="ml-2 text-xs text-[oklch(0.44_0.1_245)]">(partial)</span>}</Row>
              <Row label="UTR" testId="txn-utr"><span className="font-mono">{t.utr}</span></Row>
              <Row label="Payment method">{t.method}{t.is_split ? " · split" : ""}</Row>
              <Row label="Entered by">{t.submitted_by_name}</Row>
              <Row label="Entry time">{fmtDateTime(t.submitted_at)}</Row>
              {t.verified_by_name && <Row label={t.status === "rejected" ? "Rejected by" : "Verified by"} testId="txn-verified-by">{t.verified_by_name} · {fmtDateTime(t.verified_at)}</Row>}
              <Row label="Remarks">{t.remarks || "—"}</Row>
            </div>
            {t.status === "rejected" && <div className="st-rejected st-pill mt-3 rounded-md p-3 text-sm" data-testid="txn-rejection-reason"><b>Rejection reason:</b> {t.rejection_reason}</div>}
          </section>
          <Actions t={t} user={user} onApprove={() => setConfirm(true)} onReject={() => setReject(true)}
            onCorrect={() => setEdit("correct")} onResubmit={() => setEdit("resubmit")} />
          <AuditTrail items={t.audit} />
        </div>
      </div>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent data-testid="approve-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Approve {inr(t.amount)}?</AlertDialogTitle>
            <AlertDialogDescription>Are you sure you have verified the payment screenshot and transaction reference?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="approve-cancel-button">Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} className="bg-[var(--r39-green)] hover:bg-[var(--r39-green-hover)]" data-testid="approve-confirm-button"
              onClick={(e) => { e.preventDefault(); act("approve", {}, "Payment verified"); }}>Yes, approve</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <RejectDialog open={reject} onOpenChange={setReject} busy={busy} onConfirm={(remarks) => act("reject", { remarks }, "Payment rejected — staff notified")} />
      <PaymentDialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)} mode={edit} driver={d} date={t.payment_date} txn={t} onDone={load} />
    </div>
  );
}
