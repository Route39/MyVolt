import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarDays, ShieldCheck, Users } from "lucide-react";
import { PageHeader, StatCard, Progress } from "@/components/kit";
import { TrendChart } from "@/components/TrendChart";
import { Skeleton } from "@/components/ui/skeleton";
import { useUser } from "@/context/UserContext";
import { api } from "@/lib/api";
import { inr, MONTHS } from "@/lib/format";

const Quick = ({ to, icon: Icon, label, hint, testId }) => (
  <Link to={to} data-testid={testId} className="r-card group flex items-center gap-3 px-4 py-3 transition-shadow hover:shadow-md">
    <div className="grid h-9 w-9 place-items-center rounded-md bg-[#F0FDF4] text-[#15803D]"><Icon className="h-4 w-4" /></div>
    <div className="min-w-0 flex-1"><div className="text-[13px] font-semibold">{label}</div><div className="text-xs text-[#64748B]">{hint}</div></div>
    <ArrowRight className="h-4 w-4 text-[#94A3B8] transition-transform group-hover:translate-x-0.5" />
  </Link>
);

export const useOverview = () => {
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get("/overview").then((r) => setData(r.data));
  }, []);
  return data;
};

export const MonthKpis = ({ data }) => {
  if (!data) return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[92px]" />)}</div>;
  const m = data.month;
  const pct = m.expected ? (m.verified / m.expected) * 100 : 0;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard label="Rent expected (MTD)" value={inr(m.expected)} hint={`${data.counts.active_drivers} active drivers`} testId="ov-expected" />
      <StatCard label="Verified collection" value={inr(m.verified)} tone="st-verified" hint={`${pct.toFixed(1)}% of expected`} testId="ov-verified"><Progress value={pct} /></StatCard>
      <StatCard label="Pending verification" value={inr(m.pending)} tone="st-pending" hint={`${data.counts.pending_txns} payments waiting`} testId="ov-pending" />
      <StatCard label="Outstanding rent" value={inr(m.outstanding)} tone="st-rejected" hint="Expected minus verified" testId="ov-outstanding" />
    </div>
  );
};

export default function OverviewPage() {
  const data = useOverview();
  const { hasRole } = useUser();
  const now = new Date();
  return (
    <div className="space-y-5 fade-up">
      <PageHeader title="Overview" subtitle={`Fleet rent collection for ${MONTHS[now.getMonth()]} ${now.getFullYear()} · only Accounts-verified payments count as collected`} />
      <MonthKpis data={data} />
      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <section className="r-card min-w-0 p-4">
          <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-bold">Collection trend · last 14 days</h2></div>
          {data ? <TrendChart series={data.series} /> : <Skeleton className="h-[240px]" />}
        </section>
        <div className="space-y-2.5">
          <Quick to="/board" icon={Users} label="All Drivers" hint="Today's collection by driver" testId="quick-board" />
          <Quick to="/calendar" icon={CalendarDays} label="Rent Calendar" hint="Enter a payment for a driver" testId="quick-calendar" />
          {hasRole("accounts", "admin") && <Quick to="/verification" icon={ShieldCheck} label="Accounts Verification" hint={data ? `${data.counts.pending_txns} pending` : "Review payments"} testId="quick-verification" />}
          {data && (
            <div className="r-card px-4 py-3 text-[13px]">
              <div className="r-label mb-1.5">Fleet</div>
              <div className="flex justify-between py-0.5"><span className="text-[#64748B]">Active drivers</span><span className="fig">{data.counts.active_drivers}</span></div>
              <div className="flex justify-between py-0.5"><span className="text-[#64748B]">Vehicles (active / total)</span><span className="fig">{data.counts.vehicles_active} / {data.counts.vehicles}</span></div>
            </div>
          )}
        </div>
      </div>
      {data?.by_city?.length > 0 && (
        <section className="r-card overflow-hidden" data-testid="overview-by-city">
          <div className="border-b px-4 py-3">
            <h2 className="text-sm font-bold">Fleet by City</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table w-full">
              <thead>
                <tr>
                  <th>City</th>
                  <th className="num">Active Drivers</th>
                  <th className="num">Vehicles (Rented / Available)</th>
                  <th className="num">Expected MTD</th>
                  <th className="num">Verified MTD</th>
                </tr>
              </thead>
              <tbody>
                {data.by_city.map((c) => (
                  <tr key={c.city} data-testid={`ov-city-${c.city}`}>
                    <td className="font-medium">{c.city}</td>
                    <td className="num fig">{c.active_drivers}</td>
                    <td className="num fig">
                      {c.vehicles_rented} / {c.vehicles_available}
                      <span className="ml-1 text-xs text-[#64748B]">({c.vehicles_total} total)</span>
                    </td>
                    <td className="num fig">{inr(c.expected)}</td>
                    <td className="num fig font-semibold text-[#15803D]">{inr(c.verified)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
