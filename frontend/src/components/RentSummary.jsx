import { inr } from "@/lib/format";

const Row = ({ label, value, cls, strong, testId }) => (
  <div className="flex items-center justify-between py-1.5">
    <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
      {cls && <span className={`${cls} st-dot h-2 w-2 rounded-full`} />}
      {label}
    </span>
    <span data-testid={testId} className={`fig text-[14px] ${strong ? "text-[16px]" : ""}`}>{value}</span>
  </div>
);

export const RentSummary = ({ title, summary, prefix }) => (
  <section className="r-card p-4" data-testid={`${prefix}-summary`}>
    <h3 className="r-label mb-1">{title}</h3>
    <div className="divide-y">
      <Row label="Rent expected" value={inr(summary.expected)} testId={`${prefix}-expected`} />
      <Row label="Payments submitted" value={inr(summary.submitted)} testId={`${prefix}-submitted`} />
      <Row label="Verified by Accounts" value={inr(summary.verified)} cls="st-verified" testId={`${prefix}-verified`} />
      <Row label="Waiting for verification" value={inr(summary.pending)} cls="st-pending" testId={`${prefix}-pending`} />
      <Row
        label="Outstanding rent"
        value={<span className={summary.outstanding > 0 ? "text-[#B91C1C]" : "text-[#15803D]"}>{inr(summary.outstanding)}</span>}
        strong
        testId={`${prefix}-outstanding`}
      />
    </div>
    <p className="mt-2 text-[11px] text-muted-foreground">Only Accounts-verified payments reduce outstanding rent.</p>
  </section>
);
