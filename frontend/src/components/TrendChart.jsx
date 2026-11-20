import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { inr } from "@/lib/format";

const short = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

export const TrendChart = ({ series, height = 240 }) => (
  <div style={{ height }} data-testid="trend-chart">
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#EEF0F3" vertical={false} />
        <XAxis dataKey="date" tickFormatter={short} tick={{ fontSize: 11, fill: "#64748B" }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)} tick={{ fontSize: 11, fill: "#64748B" }} axisLine={false} tickLine={false} width={40} />
        <Tooltip formatter={(v, n) => [inr(v), n]} labelFormatter={short} contentStyle={{ fontSize: 12, borderRadius: 6, borderColor: "#E5E7EB" }} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="verified" name="Verified" stackId="a" fill="#16A34A" radius={[0, 0, 0, 0]} maxBarSize={28} />
        <Bar dataKey="pending" name="Pending" stackId="a" fill="#F59E0B" radius={[3, 3, 0, 0]} maxBarSize={28} />
        <Line dataKey="expected" name="Expected" stroke="#101820" strokeDasharray="4 3" strokeWidth={1.5} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  </div>
);
