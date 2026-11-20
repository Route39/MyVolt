import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/kit";
import { useUser } from "@/context/UserContext";
import { api, errMsg } from "@/lib/api";
import { ROLE_LABEL } from "@/lib/format";

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
  const Row = ({ title, hint, children }) => (
    <div className="flex items-center justify-between gap-4 border-b py-3 last:border-0">
      <div><div className="text-[13px] font-semibold">{title}</div><div className="text-xs text-[#64748B]">{hint}</div></div>{children}
    </div>
  );
  return (
    <section className="r-card px-4 py-2" data-testid="rent-rules">
      <div className="r-label pt-2">Rent rules</div>
      <Row title="Allow future dates" hint="Staff can record advance rent for upcoming dates"><Switch checked={s.allow_future_dates} onCheckedChange={(v) => save({ ...s, allow_future_dates: v })} data-testid="rule-future-dates" /></Row>
      <Row title="Allow multiple payments per date" hint="Without this, extra payments must be marked as split"><Switch checked={s.allow_multiple_per_date} onCheckedChange={(v) => save({ ...s, allow_multiple_per_date: v })} data-testid="rule-multiple-per-date" /></Row>
      <Row title="Delayed entry threshold" hint="Entries submitted later than this count as delayed in staff reports">
        <div className="flex items-center gap-2 text-[13px]"><Input type="number" min="0" max="30" value={s.delayed_days} onChange={(e) => setS({ ...s, delayed_days: e.target.value })} onBlur={() => save(s)} className="h-8 w-16" data-testid="rule-delayed-days" />days</div>
      </Row>
    </section>
  );
};

export default function SettingsPage() {
  const { user, hasRole } = useUser();
  return (
    <div className="max-w-3xl space-y-4 fade-up">
      <PageHeader title="Settings" subtitle="Your profile and system rules" />
      <section className="r-card p-4" data-testid="profile-card">
        <div className="r-label mb-3">User profile</div>
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-full bg-[#101820] text-sm font-bold text-white">{user.name.split(" ").map((p) => p[0]).join("").slice(0, 2)}</div>
          <div>
            <div className="font-semibold">{user.name}</div>
            <div className="text-xs text-[#64748B]">{user.email} · {ROLE_LABEL[user.role]}</div>
          </div>
        </div>
        <p className="mt-3 text-xs text-[#64748B]">Login is disabled in this version. Switch the acting user from the menu in the top-right corner.</p>
      </section>
      {hasRole("admin") ? <RentRules /> : <p className="text-xs text-[#64748B]">Rent rules can be changed by an Admin.</p>}
    </div>
  );
}
