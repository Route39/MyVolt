import { Image as ImageIcon } from "lucide-react";
import { StatusPill } from "@/components/StatusPill";
import { AuthImage } from "@/components/AuthImage";
import { NOT_RECORDED } from "@/components/Vehicles";
import { SortTh, SkeletonRows, EmptyState } from "@/components/kit";
import { fmtDate, fmtDateTime, inr } from "@/lib/format";

const COLS = {
  payment_date: ["Payment date", (t) => fmtDate(t.payment_date)],
  driver: ["Driver", (t) => <div><div className="font-medium">{t.driver_name}</div><div className="font-mono text-[11px] text-muted-foreground">{t.driver_code}</div></div>],
  vehicle: ["Vehicle", (t) => (
    <div className="font-mono text-xs">
      <div className={t.vehicle_id ? "font-semibold" : "font-sans text-[11px] italic text-muted-foreground"}>{t.vehicle_id || NOT_RECORDED}</div>
      <div className="text-[11px] text-muted-foreground">{t.vehicle_no}</div>
    </div>
  )],
  city: ["City", (t) => t.city],
  amount: ["Amount", (t) => <span className="font-semibold">{inr(t.amount)}</span>],
  utr: ["UTR", (t) => <span className="font-mono text-xs">{t.utr}</span>],
  method: ["Method", (t) => t.method],
  thumb: ["Screenshot", (t) => <AuthImage fileId={t.file_id} className="h-10 w-8 rounded border" />],
  icon: ["Screenshot", (t) => (t.file_id ? <ImageIcon className="h-4 w-4 text-[var(--r39-green-text)]" /> : <span className="text-muted-foreground">—</span>)],
  submitted_by: ["Entered by", (t) => t.submitted_by_name],
  submitted_at: ["Submitted", (t) => fmtDateTime(t.submitted_at)],
  verified_by: ["Verified by", (t) => t.verified_by_name || "—"],
  verified_at: ["Verified at", (t) => fmtDateTime(t.verified_at)],
  status: ["Status", (t) => <StatusPill status={t.status} testId={`txn-status-${t.id}`} />],
  reason: ["Rejection reason", (t) => <span className="block max-w-[240px] truncate" title={t.rejection_reason}>{t.rejection_reason || "—"}</span>],
  action: ["", (t) => <span className="rounded border px-2 py-1 text-[11px] font-semibold text-[#17212B]" data-testid={`review-${t.id}`}>{t.status === "pending" ? "Review" : "View"}</span>],
};

export const VERIFY_COLS = ["thumb", "driver", "vehicle", "payment_date", "amount", "utr", "method", "submitted_by", "submitted_at", "status", "action"];
export const HISTORY_COLS = ["payment_date", "amount", "vehicle", "utr", "method", "submitted_by", "submitted_at", "verified_by", "status"];
export const ALL_COLS = ["payment_date", "driver", "vehicle", "amount", "utr", "method", "status", "submitted_by", "verified_by", "submitted_at", "icon"];

const SORT_KEYS = { payment_date: "payment_date", driver: "driver_name", amount: "amount", submitted_at: "submitted_at", verified_at: "verified_at", status: "status" };

export const TransactionsTable = ({ rows, cols = ALL_COLS, onRowClick, testId = "txn-table", empty = "No transactions found", sort, onSort, loading, footer }) => (
  <div className="r-card overflow-hidden" data-testid={testId}>
    <div className="max-h-[64vh] overflow-auto">
    <table className="data-table w-full">
      <thead><tr>{cols.map((c) => (sort && SORT_KEYS[c]
        ? <SortTh key={c} k={SORT_KEYS[c]} label={COLS[c][0]} sort={sort} onSort={onSort} className={c === "amount" ? "num" : ""} />
        : <th key={c} className={c === "amount" ? "num" : ""}>{COLS[c][0]}</th>))}</tr></thead>
      <tbody>
        {loading && !rows.length && <SkeletonRows cols={cols.length} />}
        {rows.map((t) => (
          <tr key={t.id} className="clickable" onClick={() => onRowClick?.(t)} data-testid={`${testId}-row-${t.id}`}>
            {cols.map((c) => <td key={c} className={c === "amount" ? "num" : ""}>{COLS[c][1](t)}</td>)}
          </tr>
        ))}
        {!rows.length && !loading && <tr><td colSpan={cols.length}><EmptyState title={empty} testId={`${testId}-empty`} /></td></tr>}
      </tbody>
    </table>
    </div>
    {footer}
  </div>
);
