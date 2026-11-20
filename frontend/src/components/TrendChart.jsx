import { useEffect, useRef, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { inr } from "@/lib/format";

const short = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

export const TrendChart = ({ series, height = 240 }) => {
  const ref = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const { width, height: h } = el.getBoundingClientRect();
      setReady(width > 0 && h > 0);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} className="w-full min-w-0" style={{ height }} data-testid="trend-chart">
      {ready && series?.length > 0 && (
        <ResponsiveContainer width="100%" height={height} minWidth={0}>
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
      )}
    </div>
  );
};
