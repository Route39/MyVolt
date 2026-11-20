import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, CalendarIcon, ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtDate, isoDate, todayIso } from "@/lib/format";

export const PageHeader = ({ title, subtitle, actions }) => (
  <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 className="text-[22px] font-bold leading-tight tracking-tight text-[#17212B]" data-testid="page-heading">{title}</h1>
      {subtitle && <p className="mt-0.5 text-[13px] text-[#64748B]">{subtitle}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>
);

export const StatCard = ({ label, value, hint, tone, testId, children }) => (
  <div className="r-card px-4 py-3.5 transition-shadow hover:shadow-md">
    <div className="flex items-center gap-1.5 r-label">
      {tone && <span className={`${tone} st-dot h-1.5 w-1.5 rounded-full`} />}
      {label}
    </div>
    <div className="fig mt-1.5 text-[22px] leading-none text-[#17212B]" data-testid={testId}>{value}</div>
    {hint && <div className="mt-1.5 text-[11.5px] text-[#64748B]">{hint}</div>}
    {children}
  </div>
);

export const Progress = ({ value, testId }) => (
  <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-[#EEF0F3]" data-testid={testId}>
    <div className="h-full rounded-full bg-[#DC2626] transition-[width] duration-500" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
  </div>
);

export const EmptyState = ({ title = "Nothing here yet", hint, testId }) => (
  <div className="flex flex-col items-center py-10 text-center" data-testid={testId}>
    <Inbox className="h-6 w-6 text-[#94A3B8]" />
    <div className="mt-2 text-sm font-medium">{title}</div>
    {hint && <div className="text-xs text-[#64748B]">{hint}</div>}
  </div>
);

export const SkeletonRows = ({ cols, rows = 6 }) =>
  Array.from({ length: rows }).map((_, i) => (
    <tr key={`sk${i}`}>{Array.from({ length: cols }).map((__, j) => <td key={j}><Skeleton className="h-4 w-full max-w-[120px]" /></td>)}</tr>
  ));

export const SortTh = ({ label, k, sort, onSort, className = "" }) => {
  const active = sort.key === k;
  return (
    <th className={`sortable ${className}`} onClick={() => onSort({ key: k, dir: active && sort.dir === "asc" ? "desc" : "asc" })} data-testid={`sort-${k}`}>
      <span className="inline-flex items-center gap-1">
        {label}
        {active && (sort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </span>
    </th>
  );
};

export const Pager = ({ page, pageSize, total, onPage, testId = "pager" }) => {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= 0) return null;
  return (
    <div className="flex items-center justify-between gap-2 border-t px-3 py-2 text-xs text-[#64748B]" data-testid={testId}>
      <span>{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}</span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => onPage(page - 1)} data-testid={`${testId}-prev`}><ChevronLeft className="h-3.5 w-3.5" /></Button>
        <span className="px-2 tabular-nums">Page {page} / {pages}</span>
        <Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= pages} onClick={() => onPage(page + 1)} data-testid={`${testId}-next`}><ChevronRight className="h-3.5 w-3.5" /></Button>
      </div>
    </div>
  );
};

export const usePaged = (rows, size = 25, deps = []) => {
  const [page, setPage] = useState(1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(1); }, deps);
  const slice = useMemo(() => rows.slice((page - 1) * size, page * size), [rows, page, size]);
  return { page, setPage, slice, total: rows.length, size };
};

export const DateField = ({ value, onChange, placeholder = "Pick date", testId, className = "" }) => {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className={`h-9 justify-start gap-2 px-3 text-[13px] font-normal ${value ? "" : "text-[#64748B]"} ${className}`} data-testid={testId}>
          <CalendarIcon className="h-3.5 w-3.5 text-[#64748B]" />{value ? fmtDate(value) : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="single" selected={value ? new Date(`${value}T00:00:00`) : undefined} defaultMonth={value ? new Date(`${value}T00:00:00`) : undefined}
          onSelect={(d) => { onChange(d ? isoDate(d) : ""); setOpen(false); }} initialFocus />
        {value && <div className="border-t p-2"><Button variant="ghost" size="sm" className="w-full" onClick={() => { onChange(""); setOpen(false); }}>Clear</Button></div>}
      </PopoverContent>
    </Popover>
  );
};

export const DateStepper = ({ value, onChange }) => {
  const shift = (n) => {
    const d = new Date(`${value}T00:00:00`);
    d.setDate(d.getDate() + n);
    onChange(isoDate(d));
  };
  return (
    <div className="flex items-center gap-1.5" data-testid="date-stepper">
      <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => shift(-1)} data-testid="date-prev"><ChevronLeft className="h-4 w-4" /></Button>
      <DateField value={value} onChange={(v) => v && onChange(v)} testId="date-picker" className="min-w-[150px] font-medium text-[#17212B]" />
      <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => shift(1)} data-testid="date-next"><ChevronRight className="h-4 w-4" /></Button>
      <Button variant="outline" className="h-9" disabled={value === todayIso()} onClick={() => onChange(todayIso())} data-testid="date-today">Today</Button>
    </div>
  );
};
