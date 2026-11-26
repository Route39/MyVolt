import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MONTHS, STATUS, inr, todayIso } from "@/lib/format";

const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const LEGEND = [
  ["unpaid", "Not paid"],
  ["verified", "Verified"],
  ["pending", "Pending verification"],
  ["partial", "Pending / Partial"],
  ["joining", "Joining Date"],
  ["week_off", "Week Off"],
  ["ev_issue", "EV Issue"],
  ["other_issue", "Other Issue"],
  ["rejected", "Rejected"],
  ["none", "No entry"],
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
      title={day.day_status?.reason || day.reason || (isJoining ? "Joining Date · Rent Free" : isUnpaid ? "Not paid" : s.label)}
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
        <span className="mt-auto truncate text-[10px] font-bold text-slate-600">Joined · No Rent</span>
      )}
      {isUnpaid && (
        <span className="mt-auto hidden text-[10px] font-medium text-[#B91C1C] sm:block">Not paid</span>
      )}
      {!isJoining && ["week_off", "ev_issue", "other_issue"].includes(day.status) && (
        <div className="mt-auto min-w-0">
          <span className="block truncate text-[10px] font-semibold leading-tight" style={{ color: "var(--st-text)" }}>{s.label}</span>
          <span className="hidden truncate text-[9px] leading-tight text-muted-foreground sm:block">
            {day.status === "ev_issue" ? "No Ride · No Rent" : "No Rent"}
          </span>
        </div>
      )}
      {!isJoining && day.status !== "none" && !["week_off", "ev_issue", "other_issue"].includes(day.status) && (
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

export const RentCalendar = ({ ym, onMonthChange, days, onDayClick, loading, selectedDate, weekOffsUsed = 0, weekOffLimit = 3 }) => {
  const lead = days.length ? (new Date(`${days[0].date}T00:00:00`).getDay() + 6) % 7 : 0;
  return (
    <section className="r-card p-3 sm:p-4" data-testid="rent-calendar">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-base font-semibold tracking-tight" data-testid="calendar-month-label">{MONTHS[ym.m]} {ym.y}</h2>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${weekOffsUsed >= weekOffLimit ? "st-week_off st-pill" : "bg-muted text-muted-foreground"}`} data-testid="calendar-weekoff-count">
            Week Offs: {weekOffsUsed}/{weekOffLimit} this month
          </span>
        </div>
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
