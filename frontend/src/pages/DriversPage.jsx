import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Plus, CalendarDays, Pencil, SlidersHorizontal, ArrowLeftRight, FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { DriverFormDialog, AdjustmentsDialog } from "@/components/DriverDialogs";
import { VehicleAssignDialog } from "@/components/Vehicles";
import { ImportDialog } from "@/components/ImportDialog";
import { api, errMsg } from "@/lib/api";
import { fmtDate, inr } from "@/lib/format";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader, Pager, usePaged } from "@/components/kit";

const RentRules = () => {
  const [s, setS] = useState(null);
  useEffect(() => {
    api.get("/settings").then((r) => setS(r.data));
  }, []);
  const save = async (next) => {
    setS(next);
    try {
      await api.put("/settings", { allow_future_dates: next.allow_future_dates, allow_multiple_per_date: next.allow_multiple_per_date, delayed_days: Number(next.delayed_days) || 0 });
      toast.success("Rent rules saved");
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  if (!s) return null;
  return (
    <section className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-lg border bg-[var(--surface)] px-4 py-3" data-testid="rent-rules">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Rent rules</span>
      <label className="flex items-center gap-2 text-sm"><Switch checked={s.allow_future_dates} onCheckedChange={(v) => save({ ...s, allow_future_dates: v })} data-testid="rule-future-dates" />Allow future dates (advance rent)</label>
      <label className="flex items-center gap-2 text-sm"><Switch checked={s.allow_multiple_per_date} onCheckedChange={(v) => save({ ...s, allow_multiple_per_date: v })} data-testid="rule-multiple-per-date" />Allow multiple payments per date</label>
      <label className="flex items-center gap-2 text-sm">Delayed if entered after
        <Input type="number" min="0" max="30" value={s.delayed_days} onChange={(e) => setS({ ...s, delayed_days: e.target.value })} onBlur={() => save(s)} className="h-8 w-16" data-testid="rule-delayed-days" />days</label>
    </section>
  );
};

export default function DriversPage() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState([]);
  const [edit, setEdit] = useState(undefined);
  const [adj, setAdj] = useState(null);
  const [veh, setVeh] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [status, setStatus] = useState("all");
  const [city, setCity] = useState("all");
  const cities = [...new Set(rows.map((d) => d.city))].sort();
  const filtered = rows.filter((d) => (status === "all" || d.status === status) && (city === "all" || d.city === city));
  const paged = usePaged(filtered, 25, [q, status, city]);

  const load = useCallback(() => api.get("/drivers", { params: { q } }).then((r) => setRows(r.data)), [q]);
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="space-y-4 fade-up">
      <PageHeader title="Driver Management" subtitle={`${rows.length} drivers · Driver IDs are permanent`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setImportOpen(true)} data-testid="import-drivers-button"><FileUp className="mr-1.5 h-4 w-4" />Import PDF / Excel</Button>
            <Button onClick={() => setEdit(null)} data-testid="add-driver-button"><Plus className="mr-1.5 h-4 w-4" />Add driver</Button>
          </div>
        } />
      <div className="r-card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <Input placeholder="Search name, mobile, Driver ID, vehicle" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 max-w-sm" data-testid="drivers-search" />
        <Select value={city} onValueChange={setCity}><SelectTrigger className="h-9 w-[150px]" data-testid="drivers-filter-city"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All cities</SelectItem>{cities.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select>
        <Select value={status} onValueChange={setStatus}><SelectTrigger className="h-9 w-[150px]" data-testid="drivers-filter-status"><SelectValue /></SelectTrigger>
          <SelectContent>{["all", "Active", "Suspended", "Inactive"].map((s) => <SelectItem key={s} value={s}>{s === "all" ? "All statuses" : s}</SelectItem>)}</SelectContent></Select>
      </div>
      <div className="overflow-x-auto">
        <table className="data-table w-full" data-testid="drivers-table">
          <thead><tr><th>Driver ID</th><th>Name</th><th>Mobile</th><th>Current vehicle</th><th>City</th><th>Joining</th><th>Handover</th><th>Rent starts</th><th>Daily rent</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {paged.slice.map((d) => (
              <tr key={d.id} data-testid={`driver-row-${d.id}`}>
                <td className="font-mono text-xs font-semibold">{d.driver_code}</td>
                <td className="font-medium">{d.name}</td>
                <td className="font-mono text-xs">{d.mobile}</td>
                <td className="font-mono text-xs"><span className="font-semibold">{d.current_vehicle_id || "—"}</span> <span className="text-muted-foreground">{d.vehicle_no}</span></td>
                <td>{d.city}</td>
                <td>{fmtDate(d.joining_date)}</td>
                <td>{fmtDate(d.handover_date)}</td>
                <td>{fmtDate(d.rent_start_date)}</td>
                <td className="font-semibold">{inr(d.daily_rent)}</td>
                <td>{d.status}</td>
                <td className="text-right">
                  <Button size="icon" variant="ghost" className="h-8 w-8" title="Open calendar" onClick={() => nav(`/calendar?driver=${d.id}`)} data-testid={`driver-calendar-${d.id}`}><CalendarDays className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8" title="Change vehicle" onClick={() => setVeh(d)} data-testid={`driver-vehicle-${d.id}`}><ArrowLeftRight className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8" title="Adjustments" onClick={() => setAdj(d)} data-testid={`driver-adjust-${d.id}`}><SlidersHorizontal className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8" title="Edit" onClick={() => setEdit(d)} data-testid={`driver-edit-${d.id}`}><Pencil className="h-4 w-4" /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={paged.page} pageSize={paged.size} total={paged.total} onPage={paged.setPage} testId="drivers-pager" />
      </div>
      <DriverFormDialog open={edit !== undefined} onOpenChange={(o) => !o && setEdit(undefined)} driver={edit} onSaved={load} />
      <AdjustmentsDialog open={!!adj} onOpenChange={(o) => !o && setAdj(null)} driver={adj} onSaved={load} />
      <VehicleAssignDialog open={!!veh} onOpenChange={(o) => !o && setVeh(null)} driver={veh} onSaved={load} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} defaultMode="drivers_and_vehicles" onImported={load} />
    </div>
  );
}
