import { useEffect, useMemo, useState } from "react";
import { Car, KeyRound, CircleCheck, UserX, CarFront } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";

const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const Card = ({ label, value, tone, Icon, tint, onClick }) => (
  <div onClick={onClick} className="cursor-pointer transition hover:-translate-y-0.5 hover:shadow-md rounded-xl border bg-card p-4">
    {Icon && <div className={`mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl ${tint}`}><Icon className="h-5 w-5" /></div>}
    <div className={`text-3xl font-bold ${tone || ""}`}>{value ?? 0}</div>
    <div className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
  </div>
);
const Stat = ({ v, l, c, onClick }) => (
  <div className="text-center cursor-pointer rounded-md py-1 hover:bg-muted" onClick={(e) => { if (onClick) { e.stopPropagation(); onClick(); } }}><div className={`text-2xl font-bold ${c}`}>{v}</div>
  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{l}</div></div>
);

export default function FleetDashboard() {
  const [date, setDate] = useState(iso(new Date()));
  const [city, setCity] = useState("All");
  const [data, setData] = useState(null);
  const nav = useNavigate();
  const go = (path, q = "") => nav(`${path}?${city === "All" ? "" : `city=${encodeURIComponent(city)}&`}${q}`);
  useEffect(() => { api.get("/overview/fleet", { params: { date } }).then((r) => setData(r.data)).catch(() => setData(null)); }, [date]);
  const rows = useMemo(() => (data?.cities || []).filter((r) => city === "All" || r.city === city), [data, city]);
  const t = useMemo(() => rows.reduce((a, r) => { Object.keys(r).forEach((k) => { if (k !== "city") a[k] = (a[k] || 0) + r[k]; }); return a; }, {}), [rows]);
  const today = iso(new Date()), yest = iso(new Date(Date.now() - 86400000));
  const chip = (on) => `rounded-full border px-3 py-1 text-sm ${on ? "bg-red-600 text-white border-red-600" : "bg-card hover:bg-muted"}`;
  const total = t.vehicles || 0, pct = total ? (t.rented || 0) / total : 0, R = 54, CIRC = 2 * Math.PI * R;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {["All", ...(data?.cities || []).map((r) => r.city)].map((c) => (
          <button key={c} className={chip(city === c)} onClick={() => setCity(c)}>{c === "All" ? "All Cities" : c}</button>))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className={chip(date === today)} onClick={() => setDate(today)}>Today</button>
        <button className={chip(date === yest)} onClick={() => setDate(yest)}>Yesterday</button>
        <input id="fleet-dashboard-date" name="fleet_date" aria-label="Select date" type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} className="rounded-md border bg-card px-2 py-1 text-sm" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Card label="Total vehicles" value={t.vehicles} Icon={Car} onClick={() => go("/vehicles")} tint="bg-red-50 text-red-500" />
        <Card label="Rented" value={t.rented} tone="text-red-600" Icon={KeyRound} onClick={() => go("/vehicles", "status=rented")} tint="bg-red-50 text-red-500" />
        <Card label="Available" value={t.available} tone="text-emerald-600" Icon={CircleCheck} onClick={() => go("/vehicles", "status=available")} tint="bg-emerald-50 text-emerald-600" />
        <Card label="Drivers without vehicle" value={t.drivers_without_vehicle} tone="text-orange-500" Icon={UserX} onClick={() => go("/drivers", "vehicle=none")} tint="bg-orange-50 text-orange-500" />
        <Card label="Vehicles without driver" value={t.vehicles_without_driver} tone="text-orange-500" Icon={CarFront} onClick={() => go("/vehicles", "driver=none")} tint="bg-orange-50 text-orange-500" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border bg-card p-5">
          <div className="mb-3 font-semibold">Fleet Status</div>
          <div className="flex items-center gap-6">
            <svg width="140" height="140" viewBox="0 0 140 140">
              <circle cx="70" cy="70" r={R} fill="none" stroke={total ? "#10B981" : "#E5E7EB"} strokeWidth="16" />
              {pct > 0 && <circle cx="70" cy="70" r={R} fill="none" stroke="#DC2626" strokeWidth="16" strokeDasharray={`${CIRC * pct} ${CIRC}`} transform="rotate(-90 70 70)" />}
              <text x="70" y="72" textAnchor="middle" fontSize="26" fontWeight="700" fill="currentColor">{total}</text>
              <text x="70" y="90" textAnchor="middle" fontSize="9" fill="currentColor" opacity="0.6">VEHICLES</text>
            </svg>
            <div className="space-y-2 text-sm">
              <div><span className="mr-2 inline-block h-2 w-2 rounded-full bg-red-600" />Rented <b className="ml-2">{t.rented || 0}</b></div>
              <div><span className="mr-2 inline-block h-2 w-2 rounded-full bg-emerald-500" />Available <b className="ml-2">{t.available || 0}</b></div>
            </div>
          </div>
        </div>
        <div className="rounded-xl border bg-card p-5 lg:col-span-2">
          <div className="mb-3 font-semibold">City-wise Drivers & Rent · {date}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            {rows.map((r) => (
              <div key={r.city} onClick={() => nav(`/drivers?city=${encodeURIComponent(r.city)}`)} className="cursor-pointer rounded-lg border p-4 transition hover:shadow-md">
                <div className="mb-3 font-semibold uppercase">{r.city}</div>
                <div className="grid grid-cols-5 gap-1">
                  <Stat v={r.vehicles} l="Vehicles" c="text-red-600" onClick={() => nav(`/vehicles?city=${encodeURIComponent(r.city)}`)} />
                  <Stat v={r.drivers} l="Onboarded" c="" />
                  <Stat v={r.paid} l="Paid" c="text-emerald-600" onClick={() => nav(`/history?city=${encodeURIComponent(r.city)}&date=${date}&status=approved`)} />
                  <Stat v={r.pending} l="Pending" c="text-orange-500" onClick={() => nav(`/history?city=${encodeURIComponent(r.city)}&date=${date}&status=pending`)} />
                  <Stat v={r.unpaid} l="Not paid" c="text-red-600" onClick={() => nav(`/drivers?city=${encodeURIComponent(r.city)}`)} />
                </div>
              </div>))}
          </div>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {[["Drivers without vehicle", "drivers_without_vehicle"], ["Vehicles without driver", "vehicles_without_driver"]].map(([title, k]) => (
          <div key={k} className="rounded-xl border bg-card p-5">
            <div className="mb-3 flex items-center justify-between font-semibold">{title}
              <span className="rounded-full bg-orange-100 px-2 text-sm text-orange-600">{t[k] || 0} pending</span></div>
            {rows.filter((r) => r[k] > 0).map((r) => (
              <div key={r.city} onClick={() => nav(`${k === "drivers_without_vehicle" ? "/drivers?vehicle=none" : "/vehicles?driver=none"}&city=${encodeURIComponent(r.city)}`)} className="mb-2 flex cursor-pointer justify-between rounded-lg border px-4 py-3 uppercase transition hover:shadow-md"><span>{r.city}</span><b className="text-orange-500">{r[k]}</b></div>))}
          </div>))}
      </div>
    </div>
  );
}
