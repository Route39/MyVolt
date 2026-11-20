import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Download, Loader2, Search, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader, StatCard, Progress, DateStepper, SortTh, Pager, SkeletonRows, EmptyState } from "@/components/kit";
import { StatusPill } from "@/components/StatusPill";
import { api, downloadBlob } from "@/lib/api";
import { inr, todayIso } from "@/lib/format";

const STATUSES = [["all", "All statuses"], ["verified", "Verified"], ["pending", "Pending"], ["unpaid", "Unpaid"], ["rejected", "Rejected"], ["partial", "Partial"], ["inactive", "Inactive"], ["not_started", "Not started"], ["rent_free", "Rent free"]];

const Kpis = ({ k }) => {
  const pct = k.expected ? (k.verified / k.expected) * 100 : 0;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8" data-testid="board-kpis">
      <StatCard label="Eligible drivers" value={k.eligible} testId="kpi-eligible" />
      <StatCard label="Paid" value={k.paid} tone="st-verified" hint={k.partial ? `+${k.partial} partial` : "Verified"} testId="kpi-paid" />
      <StatCard label="Unpaid" value={k.unpaid} tone="st-unpaid" testId="kpi-unpaid" />
      <StatCard label="Pending" value={k.pending} tone="st-pending" hint="Awaiting Accounts" testId="kpi-pending" />
      <StatCard label="Rejected" value={k.rejected} tone="st-rejected" testId="kpi-rejected" />
      <StatCard label="Expected rent" value={inr(k.expected)} testId="kpi-expected" />
      <StatCard label="Verified collection" value={inr(k.verified)} tone="st-verified" hint={`${pct.toFixed(0)}% collected`} testId="kpi-verified"><Progress value={pct} testId="kpi-progress" /></StatCard>
      <StatCard label="Outstanding" value={inr(k.outstanding)} tone="st-rejected" testId="kpi-outstanding" />
    </div>
  );
};

const Filters = ({ f, setF, staff, cities, searching }) => {
  const set = (key) => (v) => setF({ ...f, [key]: v?.target ? v.target.value : v });
  const sel = (key, items, testId, w = "w-[150px]") => (
    <Select value={f[key]} onValueChange={set(key)}>
      <SelectTrigger className={`h-9 ${w}`} data-testid={testId}><SelectValue /></SelectTrigger>
      <SelectContent>{items.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
    </Select>
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-[280px]">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-[#94A3B8]" />
        <Input value={f.q} onChange={set("q")} placeholder="Name, Driver ID, mobile, vehicle…" className="h-9 pl-8" data-testid="board-search" />
        {searching && <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-[#94A3B8]" />}
      </div>
      {sel("city", [["all", "All cities"], ...cities.map((c) => [c, c])], "board-filter-city")}
      {sel("status", STATUSES, "board-filter-status")}
      {sel("staff_id", [["all", "All staff"], ...staff.map((s) => [s.id, s.name])], "board-filter-staff")}
      {sel("active", [["all", "All drivers"], ["active", "Active only"], ["inactive", "Inactive only"]], "board-filter-active", "w-[130px]")}
    </div>
  );
};

const COLS = [["name", "Driver"], ["driver_code", "Driver ID"], ["mobile", "Mobile"], ["city", "City"], ["current_vehicle_id", "Vehicle ID"], ["vehicle_no", "Reg. No."],
  ["daily_rent", "Daily rent", 1], ["expected", "Expected", 1], ["submitted", "Submitted", 1], ["verified", "Verified", 1], ["outstanding", "Outstanding", 1], ["status", "Status"], ["staff", "Staff"]];

export default function AllDriversPage() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const day = params.get("date") || todayIso();
  const [f, setF] = useState({ q: "", city: "all", status: "all", staff_id: "all", active: "all" });
  const [sort, setSort] = useState({ key: "name", dir: "asc" });
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [staff, setStaff] = useState([]);
  const [cities, setCities] = useState([]);

  useEffect(() => {
    api.get("/users/staff").then((r) => setStaff(r.data));
    api.get("/drivers").then((r) => setCities([...new Set(r.data.map((d) => d.city))].sort()));
  }, []);
  useEffect(() => { setPage(1); }, [f, day, sort]);

  const params_ = { date: day, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v && v !== "all")), sort: sort.key, dir: sort.dir };
  const key = JSON.stringify({ ...params_, page });
  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => {
      api.get("/board", { params: { ...params_, page, page_size: 25 } }).then((r) => setData(r.data)).finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const exportXlsx = async () => {
    setExporting(true);
    try {
      const r = await api.get("/board", { params: { ...params_, format: "xlsx" }, responseType: "blob" });
      downloadBlob(r.data, `route39_all_drivers_${day}.xlsx`);
    } catch {
      toast.error("Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4 fade-up">
      <PageHeader title="ALL DRIVERS" subtitle="Daily fleet rent collection overview." actions={<DateStepper value={day} onChange={(d) => setParams({ date: d })} />} />
      {data ? <Kpis k={data.kpis} /> : <div className="h-[92px]" />}
      <section className="r-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
          <Filters f={f} setF={setF} staff={staff} cities={cities} searching={loading} />
          <Button variant="outline" className="h-9" onClick={exportXlsx} disabled={exporting} data-testid="board-export">
            {exporting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}Export Excel
          </Button>
        </div>
        <div className="max-h-[62vh] overflow-auto">
          <table className="data-table w-full" data-testid="board-table">
            <thead><tr>{COLS.map(([k, l, n]) => <SortTh key={k} k={k} label={l} sort={sort} onSort={setSort} className={n ? "num" : ""} />)}<th /></tr></thead>
            <tbody>
              {!data && <SkeletonRows cols={COLS.length + 1} />}
              {data?.rows.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => nav(`/calendar?driver=${r.id}&month=${day.slice(0, 7)}`)} data-testid={`board-row-${r.id}`}>
                  <td className="font-medium">
                    <div>{r.name}</div>
                    {r.package && <div className="text-[11px] font-normal text-[#64748B]">{r.package}</div>}
                  </td>
                  <td className="font-mono text-xs">{r.driver_code}</td>
                  <td className="font-mono text-xs text-[#64748B]">{r.mobile}</td>
                  <td>{r.city}</td>
                  <td className="font-mono text-xs font-semibold">{r.current_vehicle_id || "—"}</td>
                  <td className="font-mono text-xs text-[#64748B]">{r.vehicle_no || "—"}</td>
                  <td className="num">{inr(r.daily_rent)}</td>
                  <td className="num">{inr(r.expected)}</td>
                  <td className="num">{r.submitted ? inr(r.submitted) : "—"}</td>
                  <td className="num font-semibold text-[#B91C1C]">{r.verified ? inr(r.verified) : "—"}</td>
                  <td className={`num font-semibold ${r.outstanding ? "text-[#B91C1C]" : "text-[#64748B]"}`}>{r.outstanding ? inr(r.outstanding) : "—"}</td>
                  <td><StatusPill status={r.status} testId={`board-status-${r.id}`} /></td>
                  <td className="text-[#64748B]">{r.staff || "—"}</td>
                  <td><ChevronRight className="h-4 w-4 text-[#94A3B8]" /></td>
                </tr>
              ))}
              {data && !data.rows.length && <tr><td colSpan={COLS.length + 1}><EmptyState title="No drivers match these filters" testId="board-empty" /></td></tr>}
            </tbody>
          </table>
        </div>
        {data && <Pager page={page} pageSize={25} total={data.total} onPage={setPage} testId="board-pager" />}
      </section>
    </div>
  );
}
