import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MONTHS, STATUS, inr, todayIso } from "@/lib/format";

const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const LEGEND = [
  ["none", "No entry"], ["unpaid", "Not paid"], ["pending", "Pending verification"], ["verified", "Verified"], ["joining", "Joining Date (Rent Free)"], ["rejected", "Rejected"], ["partial", "Partial / adjustment"],
];

export const CalendarLegend = () => (
  <div className="flex flex-wrap gap-x-4 gap-y-2" data-testid="calendar-legend">
    {LEGEND.map(([k, l]) => (
      <span key={k} className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className={`${STATUS[k].cls} h-3 w-3 rounded-sm border`} style={{ background: "var(--st-bg)", borderColor: "var(--st-accent)" }} />
        {l}
      </span>
    ))}
  </div>
);

const MonthNav = ({ ym, onChange }) => {
  const years = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 4 + i);
  const shift = (d) => {
    const m = ym.m + d;
    onChange({ y: ym.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 });
  };
  const now = new Date();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => shift(-1)} data-testid="calendar-prev-month"><ChevronLeft className="h-4 w-4" /></Button>
      <Select value={String(ym.m)} onValueChange={(v) => onChange({ ...ym, m: Number(v) })}>
        <SelectTrigger className="h-9 w-[112px] w375:w-[130px]" data-testid="calendar-month-select"><SelectValue /></SelectTrigger>
        <SelectContent>{MONTHS.map((n, i) => <SelectItem key={n} value={String(i)}>{n}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={String(ym.y)} onValueChange={(v) => onChange({ ...ym, y: Number(v) })}>
        <SelectTrigger className="h-9 w-[84px] w375:w-[92px]" data-testid="calendar-year-select"><SelectValue /></SelectTrigger>
        <SelectContent>{years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
      </Select>
      <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => shift(1)} data-testid="calendar-next-month"><ChevronRight className="h-4 w-4" /></Button>
      <Button variant="ghost" size="sm" className="h-9 text-[var(--r39-green-text)]" onClick={() => onChange({ y: now.getFullYear(), m: now.getMonth() })} data-testid="calendar-current-month">
        Today
      </Button>
    </div>
  );
};

const DayCell = ({ day, onClick, selected }) => {
  const s = STATUS[day.status] || STATUS.none;
  const num = Number(day.date.slice(8));
  const isToday = day.date === todayIso();
  const isJoining = day.is_joining;
  const isUnpaid = !isJoining && day.status === "none" && !day.rent_free && !day.adjusted && !day.disabled && day.date < todayIso();
  return (
    <button
      data-testid={`calendar-day-${day.date}`}
      data-status={day.status}
      disabled={day.disabled}
      title={day.reason || (isJoining ? "Joining Date · Rent Free" : s.label)}
      onClick={() => onClick(day)}
      className={`cal-cell ${isUnpaid ? "st-unpaid" : s.cls} ${isToday ? "is-today" : ""} ${selected ? "is-selected" : ""} ${
        isJoining ? "ring-1 ring-slate-300 font-medium" : ""
      } relative flex min-h-[48px] min-w-0 flex-col overflow-hidden rounded-md p-1 text-left w375:min-h-[58px] w425:p-1.5 sm:min-h-[76px] sm:p-2 w1600:min-h-[90px]`}
    >
      <div className="flex items-center justify-between">
        <span className={`text-xs font-semibold sm:text-sm ${isToday ? "text-[var(--r39-green-text)]" : isJoining ? "text-slate-600 font-bold" : ""}`}>
          {num}
        </span>
        {day.status !== "none" && <span className="st-dot h-2 w-2 rounded-full" />}
      </div>
      {day.amount > 0 && (
        <span className="mt-auto truncate text-[9px] font-semibold w425:text-[11px] sm:text-sm" data-testid={`calendar-day-amount-${day.date}`}>
          {inr(day.amount)}
        </span>
      )}
      {isJoining && (
        <span className="mt-auto truncate text-[10px] font-bold text-[#047857]">Joined · No Rent</span>
      )}
      {!isJoining && day.status !== "none" && (
        <span className="hidden text-[10px] font-medium leading-tight sm:block">{s.label}{day.txns.length > 1 ? ` · ${day.txns.length}` : ""}</span>
      )}
      {!isJoining && day.status === "none" && day.rent_free && (
        <span className="mt-auto truncate text-[10px] font-medium text-muted-foreground">Rent free</span>
      )}
      {!isJoining && day.status === "none" && day.adjusted && !day.rent_free && (
        <span className="mt-auto truncate text-[10px] font-medium text-[oklch(0.44_0.1_245)]">Adjusted</span>
      )}
    </button>
  );
};

export const RentCalendar = ({ ym, onMonthChange, days, onDayClick, loading, selectedDate }) => {
  const lead = days.length ? (new Date(`${days[0].date}T00:00:00`).getDay() + 6) % 7 : 0;
  return (
    <section className="r-card p-3 sm:p-4" data-testid="rent-calendar">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <h2 className="text-base font-semibold tracking-tight" data-testid="calendar-month-label">{MONTHS[ym.m]} {ym.y}</h2>
        <MonthNav ym={ym} onChange={onMonthChange} />
      </div>
      <div className="mb-4"><CalendarLegend /></div>
      <div className={`grid grid-cols-7 gap-0.5 w375:gap-1 sm:gap-1.5 ${loading ? "opacity-60" : ""}`}>
        {WEEK.map((w) => <div key={w} className="pb-1 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{w}</div>)}
        {Array.from({ length: lead }).map((_, i) => <div key={`l${i}`} />)}
        {days.map((d) => <DayCell key={d.date} day={d} onClick={onDayClick} selected={d.date === selectedDate} />)}
      </div>
    </section>
  );
};
