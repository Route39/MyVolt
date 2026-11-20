import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DriverSearch } from "@/components/DriverSearch";
import { AuditLogPanel } from "@/components/AuditLogPanel";
import { useUser } from "@/context/UserContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader, DateField } from "@/components/kit";
import { TrendChart } from "@/components/TrendChart";
import { useOverview, MonthKpis } from "@/pages/OverviewPage";
import { api, downloadBlob, errMsg } from "@/lib/api";
import { todayIso, inr } from "@/lib/format";

const REPORTS = [
  { id: "daily", label: "Daily Rent Collection", desc: "All payments entered for a date" },
  { id: "pending", label: "Pending Accounts Verification", desc: "Waiting for Accounts approval" },
  { id: "verified", label: "Verified Payments", desc: "All approved payments" },
  { id: "rejected", label: "Rejected Payments", desc: "With reason and submitting staff" },
  { id: "driver_history", label: "Driver Payment History", desc: "Full history for one driver" },
  { id: "staff_performance", label: "Staff Performance", desc: "Entries, approvals, delays per staff" },
];

const Cell = ({ v, col }) => (typeof v === "number" && /₹/.test(col) ? inr(v) : v ?? "—");

const ReportBuilder = () => {
  const [kind, setKind] = useState("daily");
  const [p, setP] = useState({ date: todayIso(), date_from: "", date_to: "", city: "all" });
  const [cities, setCities] = useState([]);
  useEffect(() => { api.get("/drivers").then((r) => setCities([...new Set(r.data.map((d) => d.city))].sort())); }, []);
  const [driver, setDriver] = useState(null);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const params = { ...(kind === "daily" ? { date: p.date } : { date_from: p.date_from, date_to: p.date_to }), driver_id: driver?.id, city: p.city === "all" ? "" : p.city };
  const ready = kind !== "driver_history" || driver;

  useEffect(() => {
    if (!ready) return setData(null);
    api.get(`/reports/${kind}`, { params }).then((r) => setData(r.data)).catch((e) => toast.error(errMsg(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, p, driver]);

  const exportXlsx = async () => {
    setBusy(true);
    try {
      const r = await api.get(`/reports/${kind}`, { params: { ...params, format: "xlsx" }, responseType: "blob" });
      downloadBlob(r.data, `route39_${kind}_${todayIso()}.xlsx`);
    } catch (e) {
      toast.error("Export failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <div className="r-card space-y-0.5 self-start p-1.5" data-testid="report-list">
        {REPORTS.map((r) => (
          <button key={r.id} onClick={() => setKind(r.id)} data-testid={`report-type-${r.id}`}
            className={`relative block w-full rounded-md px-3 py-2.5 text-left transition-colors ${kind === r.id ? "bg-[#FEF2F2]" : "hover:bg-[#F8FAFB]"}`}>
            {kind === r.id && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-[#EF4444]" />}
            <div className={`text-[13px] font-semibold ${kind === r.id ? "text-[#B91C1C]" : ""}`}>{r.label}</div>
            <div className="text-[11px] text-muted-foreground">{r.desc}</div>
          </button>
        ))}
      </div>
      <div className="r-card min-w-0 space-y-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          {kind === "daily" ? (
            <div className="space-y-1"><Label className="text-xs">Date</Label><DateField value={p.date} onChange={(v) => v && setP({ ...p, date: v })} testId="report-date" /></div>
          ) : (
            <>
              <div className="space-y-1"><Label className="text-xs">From</Label><DateField value={p.date_from} onChange={(v) => setP({ ...p, date_from: v })} testId="report-date-from" /></div>
              <div className="space-y-1"><Label className="text-xs">To</Label><DateField value={p.date_to} onChange={(v) => setP({ ...p, date_to: v })} testId="report-date-to" /></div>
            </>
          )}
          {kind !== "staff_performance" && (
            <div className="space-y-1"><Label className="text-xs">City</Label>
              <Select value={p.city} onValueChange={(v) => setP({ ...p, city: v })}><SelectTrigger className="h-9 w-[150px]" data-testid="report-city"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">All cities</SelectItem>{cities.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select>
            </div>
          )}
          {kind === "driver_history" && <div className="w-full max-w-md"><DriverSearch value={driver} onSelect={setDriver} testId="report-driver-search" /></div>}
          <Button className="ml-auto" disabled={!ready || busy} onClick={exportXlsx} data-testid="report-export-button">
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}Export Excel
          </Button>
        </div>
        {!ready && <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Select a driver to view their history</div>}
        {data && (
          <div>
            <div className="mb-2 text-sm font-semibold" data-testid="report-title">{data.title} <span className="font-normal text-muted-foreground">· {data.rows.length} {data.rows.length === 1 ? "row" : "rows"}</span></div>
            <div className="max-h-[60vh] overflow-auto rounded-md border">
              <table className="data-table w-full" data-testid="report-table">
                <thead><tr>{data.columns.map((c) => <th key={c} className={/₹/.test(c) ? "num" : ""}>{c}</th>)}</tr></thead>
                <tbody>
                  {data.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className={/₹/.test(data.columns[j]) ? "num" : ""}><Cell v={v} col={data.columns[j]} /></td>)}</tr>)}
                  {!data.rows.length && <tr><td colSpan={data.columns.length} className="py-8 text-center text-muted-foreground">No data</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const Analytics = () => {
  const data = useOverview();
  return (
    <div className="space-y-4">
      <MonthKpis data={data} />
      <section className="r-card min-w-0 p-4"><h2 className="mb-3 text-sm font-bold">Daily collection · last 14 days</h2>{data && <TrendChart series={data.series} height={220} />}</section>
    </div>
  );
};

export default function ReportsPage() {
  const { hasRole } = useUser();
  return (
    <div className="space-y-4 fade-up">
      <PageHeader title="Reports & Analytics" subtitle="Collection performance and downloadable audit reports" />
      <Analytics />
      {!hasRole("admin") ? <ReportBuilder /> : (
        <Tabs defaultValue="reports">
          <TabsList className="mb-3">
            <TabsTrigger value="reports" data-testid="tab-reports">Reports</TabsTrigger>
            <TabsTrigger value="audit" data-testid="tab-audit-log">Audit Log</TabsTrigger>
          </TabsList>
          <TabsContent value="reports"><ReportBuilder /></TabsContent>
          <TabsContent value="audit"><AuditLogPanel /></TabsContent>
        </Tabs>
      )}
    </div>
  );
}
