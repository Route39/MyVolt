import { useNavigate } from "react-router-dom";
import { Plus, RotateCcw, ExternalLink, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/StatusPill";
import { useUser } from "@/context/UserContext";
import { fmtDate, inr } from "@/lib/format";

export const DayDialog = ({ open, onOpenChange, day, onAddSplit, onResubmit, onRemoveStatus, onDeleteTxn }) => {
  const nav = useNavigate();
  const { user, hasRole } = useUser();
  if (!day) return null;
  const canSubmit = hasRole("staff", "accounts", "admin");
  const ds = day.day_status;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100%-24px)] overflow-y-auto sm:max-w-[520px]" data-testid="day-dialog">
        <DialogHeader>
          <DialogTitle className="text-base">{day.txns.length ? `Payments on ${fmtDate(day.date)}` : `Day Status · ${fmtDate(day.date)}`}</DialogTitle>
          <DialogDescription>
            {day.txns.length ? `${day.txns.length} payment${day.txns.length !== 1 ? "s" : ""} recorded for this date` : "Closed without rent"}
          </DialogDescription>
        </DialogHeader>
        {ds && (
          <div className="rounded-md border p-3" data-testid="day-status-summary">
            <div className="flex items-center justify-between gap-2">
              <StatusPill status={ds.type} testId="day-status-pill" />
              {ds.no_ride && <span className="text-xs font-medium text-muted-foreground">₹0 rent (No ride)</span>}
            </div>
            {ds.type === "ev_issue" && (
              <div className="mt-1.5 text-xs text-muted-foreground">
                Replacement vehicle: <b>{ds.replacement_given ? `Yes${ds.replacement_vehicle_id ? ` (${ds.replacement_vehicle_id})` : ""}` : "No (Did not ride)"}</b>
              </div>
            )}
            <div className="mt-1 text-sm">{ds.reason}</div>
            {ds.marked_by_name && <div className="mt-1 text-xs text-muted-foreground">Marked by {ds.marked_by_name}</div>}
            {canSubmit && !day.txns.length && onRemoveStatus && (
              <div className="mt-3">
                <Button size="sm" variant="outline" onClick={() => onRemoveStatus(day)} data-testid="day-remove-status-button">
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />Remove status
                </Button>
              </div>
            )}
          </div>
        )}
        <div className="space-y-2">
          {day.txns.map((t) => (
            <div key={t.id} className="rounded-md border p-3" data-testid={`day-txn-${t.id}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="text-base font-semibold">{inr(t.amount)}</div>
                <StatusPill status={t.status} testId={`day-txn-status-${t.id}`} />
              </div>
              <div className="mt-1 break-all font-mono text-xs text-muted-foreground">{t.id} · UTR {t.utr} · {t.method}{t.is_split ? " · split" : ""}</div>
              <div className="break-all font-mono text-xs text-muted-foreground" data-testid={`day-txn-vehicle-${t.id}`}>Vehicle {t.vehicle_id || "ID not recorded"} · {t.vehicle_no}</div>
              <div className="text-xs text-muted-foreground">Entered by {t.submitted_by_name}</div>
              {t.status === "pending" && <div className="mt-1 text-xs font-medium text-[oklch(0.46_0.12_50)]">Pending Accounts Verification</div>}
              {t.status === "rejected" && <div className="st-rejected st-pill mt-2 rounded p-2 text-xs"><b>Reason:</b> {t.rejection_reason}</div>}
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => nav(`/transactions/${t.id}`)} data-testid={`day-txn-view-${t.id}`}>
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" />View details
                </Button>
                {t.status === "rejected" && (user.role === "admin" || t.submitted_by === user.id) && (
                  <Button size="sm" onClick={() => onResubmit(t)} data-testid={`day-txn-resubmit-${t.id}`}>
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" />Correct & Resubmit
                  </Button>
                )}
                {onDeleteTxn && (user.role === "admin" || (t.status === "pending" && t.submitted_by === user.id)) && (
                  <Button size="sm" variant="outline" className="text-red-600 hover:text-red-700" onClick={() => onDeleteTxn(t)} data-testid={`day-txn-delete-${t.id}`}>
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />Delete
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
        {canSubmit && !ds?.no_ride && (
          <Button variant="outline" className="w-full sm:w-auto" onClick={onAddSplit} data-testid="day-add-split-button">
            <Plus className="mr-1.5 h-4 w-4" />Add split payment for this date
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
};
