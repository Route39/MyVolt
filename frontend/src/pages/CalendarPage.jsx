import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CalendarSearch, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DriverSearch } from "@/components/DriverSearch";
import { DriverCard } from "@/components/DriverCard";
import { RentSummary } from "@/components/RentSummary";
import { RentCalendar } from "@/components/RentCalendar";
import { PaymentDialog } from "@/components/PaymentDialog";
import { DayDialog } from "@/components/DayDialog";
import { MonthlySheetDialog } from "@/components/MonthlySheetDialog";
import { TransactionsTable, HISTORY_COLS } from "@/components/TransactionsTable";
import { VehicleAssignDialog, AssignmentHistory } from "@/components/Vehicles";
import { DriverFormDialog } from "@/components/DriverDialogs";
import { useUser } from "@/context/UserContext";
import { PageHeader } from "@/components/kit";
import { api, errMsg } from "@/lib/api";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

const parseMonth = (s) => {
  const [y, m] = (s || "").split("-").map(Number);
  const now = new Date();
  return y && m ? { y, m: m - 1 } : { y: now.getFullYear(), m: now.getMonth() };
};

const QuickPicks = ({ onPick }) => {
  const [drivers, setDrivers] = useState([]);
  useEffect(() => {
    api.get("/drivers").then((r) => setDrivers(r.data.slice(0, 8)));
  }, []);
  return (
    <div className="r-card p-5 text-center sm:p-8 fade-up" data-testid="calendar-empty-state">
      <CalendarSearch className="mx-auto h-7 w-7 text-[var(--r39-green)]" />
      <p className="mt-3 text-sm font-medium">Select a driver to open their rent calendar</p>
      <p className="text-xs text-muted-foreground">Search above, or pick one below</p>
      <div className="mx-auto mt-5 flex max-w-3xl flex-wrap justify-center gap-2">
        {drivers.map((d) => (
          <button key={d.id} onClick={() => onPick(d)} data-testid={`quick-pick-${d.id}`}
            className="rounded-full border px-3 py-1.5 text-xs transition-colors hover:border-[var(--r39-green)] hover:bg-[var(--r39-green-bg)]">
            <span className="font-medium">{d.name}</span> <span className="font-mono text-muted-foreground">{d.vehicle_no}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default function CalendarPage() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const { hasRole } = useUser();
  const driverId = params.get("driver");
  const ym = parseMonth(params.get("month"));
  const [cal, setCal] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [entry, setEntry] = useState(null);
  const [dayOpen, setDayOpen] = useState(null);
  const [changeVehicle, setChangeVehicle] = useState(false);
  const [editDriver, setEditDriver] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selected, setSelected] = useState(null);

  const monthKey = `${ym.y}-${String(ym.m + 1).padStart(2, "0")}`;
  const load = useCallback(async () => {
    if (!driverId) return setCal(null);
    setLoading(true);
    try {
      const [y, m] = monthKey.split("-").map(Number);
      const [c, h] = await Promise.all([
        api.get(`/drivers/${driverId}/calendar`, { params: { year: y, month: m } }),
        api.get("/transactions", { params: { driver_id: driverId } }),
      ]);
      setCal(c.data);
      setHistory(h.data);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [driverId, monthKey]);

  useEffect(() => {
    load();
  }, [load]);

  const go = (id, month = monthKey) => setParams({ driver: id, month });
  const onDayClick = (day) => {
    setSelected(day.date);
    if (day.txns.length || day.day_status?.no_ride) return setDayOpen(day);
    if (!hasRole("staff", "accounts", "admin")) return toast.info("No payment entered for this date");
    setEntry({ mode: "new", date: day.date });
  };
  const [confirmTxn, setConfirmTxn] = useState(null);
  const onDeleteTxn = (t) => setConfirmTxn(t);
  const doDeleteTxn = async () => {
    const t = confirmTxn;
    setConfirmTxn(null);
    try {
      await api.delete(`/transactions/${t.id}`);
      toast.success("Payment deleted");
      setDayOpen(null);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const onRemoveStatus = async (day) => {
    try {
      await api.delete(`/drivers/${driver.id}/day-status/${day.date}`);
      toast.success("Day status removed");
      setDayOpen(null);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const driver = cal?.driver;

  return (
    <div className="space-y-4 fade-up">
      <PageHeader title="Rent Calendar" subtitle="Select a driver, click a date and record the payment for Accounts verification"
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            {hasRole("staff", "accounts", "admin") && (
              <Button variant="outline" className="h-9 shrink-0" onClick={() => setSheetOpen(true)} data-testid="calendar-monthly-sheet-button">
                <FileSpreadsheet className="mr-1.5 h-4 w-4 text-[#047857]" />Monthly Excel
              </Button>
            )}
            <div className="w-full sm:w-[380px]"><DriverSearch value={driver && driver.id === driverId ? driver : null} onSelect={(d) => go(d.id)} /></div>
          </div>
        } />
      {!driverId && <QuickPicks onPick={(d) => go(d.id)} />}
      {cal && (
        <div className="grid gap-4 w1200:grid-cols-[300px_1fr] w1440:grid-cols-[340px_1fr] w1920:grid-cols-[380px_1fr] w1200:grid-rows-[auto_1fr]">
          <DriverCard
            driver={driver}
            onChangeVehicle={hasRole("staff", "accounts", "admin") ? () => setChangeVehicle(true) : null}
            onEdit={hasRole("staff", "accounts", "admin") ? () => setEditDriver(true) : null}
          />
          <div className="order-last space-y-4 w1200:order-none w1200:col-start-1 w1200:row-start-2">
            <RentSummary title="Monthly financial summary" summary={cal.month_summary} prefix="month" />
            <RentSummary
              title="Since rent start"
              subtitle={
                driver?.joining_date
                  ? `Rent counted from ${cal.rent_calc_start || "next day"} to today (joining date ${driver.joining_date} is rent-free)`
                  : "From day after joining date to today"
              }
              summary={cal.overall_summary}
              prefix="overall"
            />
          </div>
          <div className="min-w-0 space-y-4 w1200:col-start-2 w1200:row-span-2 w1200:row-start-1">
            <RentCalendar ym={ym} loading={loading} days={cal.days} onDayClick={onDayClick} selectedDate={selected}
              weekOffsUsed={cal.week_offs_used || 0} weekOffLimit={cal.week_off_limit || 3}
              onMonthChange={(v) => go(driverId, `${v.y}-${String(v.m + 1).padStart(2, "0")}`)} />
            <section>
              <h3 className="mb-2 text-sm font-semibold">Payment history <span className="font-normal text-muted-foreground">· {history.length} transactions</span></h3>
              <TransactionsTable rows={history} cols={HISTORY_COLS} testId="driver-history-table" onRowClick={(t) => { api.put("/user/state/txnNav", { value: { ids: ((history) || []).map((x) => x.id) } }).catch(() => {}).finally(() => nav(`/transactions/${t.id}`)); }} />
            </section>
            <AssignmentHistory items={driver.assignments || []} />
          </div>
        </div>
      )}
      <VehicleAssignDialog open={changeVehicle} onOpenChange={setChangeVehicle} driver={driver} onSaved={load} />
      <DriverFormDialog open={editDriver} onOpenChange={setEditDriver} driver={driver} onSaved={load} />
      <MonthlySheetDialog
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        defaultScope={driver ? "driver" : "city"}
        defaultDriver={driver}
        defaultCity={driver?.city || "Coimbatore"}
        defaultMonth={monthKey}
        onApplied={load}
      />
      <PaymentDialog open={!!entry} onOpenChange={(o) => !o && setEntry(null)} mode={entry?.mode} driver={driver}
        date={entry?.date} txn={entry?.txn} weekOffsUsed={cal?.week_offs_used || 0} weekOffLimit={cal?.week_off_limit || 3} onDone={load} />
      <DayDialog open={!!dayOpen} onOpenChange={(o) => !o && setDayOpen(null)} day={dayOpen}
        onRemoveStatus={onRemoveStatus} onDeleteTxn={onDeleteTxn}
        onAddSplit={() => { setEntry({ mode: "split", date: dayOpen.date }); setDayOpen(null); }}
        onResubmit={async (t) => {
          const { data } = await api.get(`/transactions/${t.id}`);
          setEntry({ mode: "resubmit", date: dayOpen.date, txn: data });
          setDayOpen(null);
        }} />
      <AlertDialog open={!!confirmTxn} onOpenChange={(o) => !o && setConfirmTxn(null)}>
        <AlertDialogContent data-testid="delete-txn-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this payment?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmTxn && `${confirmTxn.id} · ₹${confirmTxn.amount} · UTR ${confirmTxn.utr}. This cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 text-white hover:bg-red-700" onClick={doDeleteTxn} data-testid="delete-txn-confirm">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
