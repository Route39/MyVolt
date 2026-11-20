import { STATUS } from "@/lib/format";

export const StatusPill = ({ status, testId }) => {
  const s = STATUS[status] || STATUS.none;
  return (
    <span
      data-testid={testId}
      className={`${s.cls} st-pill inline-flex items-center gap-1.5 rounded px-1.5 py-[3px] text-[10.5px] font-semibold uppercase tracking-wide whitespace-nowrap`}
    >
      <span className="st-dot h-1.5 w-1.5 rounded-full" />
      {s.short || s.label}
    </span>
  );
};
