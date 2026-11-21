import { useEffect, useState } from "react";
import { toast } from "sonner";
import { KeyRound, Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    <div className="flex items-center justify-between gap-3 border-b py-3 last:border-0 sm:gap-4 [&>*:last-child]:shrink-0">
      <div><div className="text-[13px] font-semibold">{title}</div><div className="text-xs text-[#64748B]">{hint}</div></div>{children}
    </div>
  );
  return (
    <section className="r-card px-3 py-2 sm:px-4" data-testid="rent-rules">
      <div className="r-label pt-2">Rent rules</div>
      <Row title="Allow future dates" hint="Staff can record advance rent for upcoming dates"><Switch checked={s.allow_future_dates} onCheckedChange={(v) => save({ ...s, allow_future_dates: v })} data-testid="rule-future-dates" /></Row>
      <Row title="Allow multiple payments per date" hint="Without this, extra payments must be marked as split"><Switch checked={s.allow_multiple_per_date} onCheckedChange={(v) => save({ ...s, allow_multiple_per_date: v })} data-testid="rule-multiple-per-date" /></Row>
      <Row title="Delayed entry threshold" hint="Entries submitted later than this count as delayed in staff reports">
        <div className="flex items-center gap-2 text-[13px]"><Input type="number" min="0" max="30" value={s.delayed_days} onChange={(e) => setS({ ...s, delayed_days: e.target.value })} onBlur={() => save(s)} className="h-8 w-16" data-testid="rule-delayed-days" />days</div>
      </Row>
    </section>
  );
};

const ChangePasswordCard = () => {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (newPassword.length < 4) {
      toast.error("New password must be at least 4 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("New passwords do not match");
      return;
    }
    setBusy(true);
    try {
      await api.post("/auth/change-password", {
        current_password: currentPassword,
        new_password: newPassword,
      });
      toast.success("Password updated successfully");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="r-card p-3 sm:p-4" data-testid="change-password-card">
      <div className="mb-3 flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-[#B91C1C]" />
        <div className="r-label">Change password</div>
      </div>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-xs">Current password</Label>
          <Input
            type="password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Current password"
            data-testid="current-password-input"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">New password</Label>
          <Input
            type="password"
            required
            minLength={4}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Min 4 characters"
            data-testid="new-password-input"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Confirm new password</Label>
          <Input
            type="password"
            required
            minLength={4}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Repeat new password"
            data-testid="confirm-password-input"
          />
        </div>
        <div className="sm:col-span-3 flex justify-end">
          <Button type="submit" className="w-full sm:w-auto" disabled={busy} data-testid="change-password-submit">
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Update Password
          </Button>
        </div>
      </form>
    </section>
  );
};

export default function SettingsPage() {
  const { user, hasRole, logout } = useUser();
  const handleLogout = async () => {
    await logout();
    toast.success("Logged out");
  };
  return (
    <div className="max-w-3xl space-y-4 fade-up">
      <PageHeader title="Settings" subtitle="Your profile, password, and system rules" />
      <section className="r-card p-3 sm:p-4" data-testid="profile-card">
        <div className="r-label mb-3">Active session</div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-full bg-[#101820] text-sm font-bold text-white">{user.name.split(" ").map((p) => p[0]).join("").slice(0, 2)}</div>
            <div>
              <div className="font-semibold">{user.name}</div>
              <div className="text-xs text-[#64748B]">{user.mobile || user.email} · {ROLE_LABEL[user.role]}</div>
            </div>
          </div>
          <Button variant="outline" size="sm" className="w-full w425:w-auto" onClick={handleLogout} data-testid="settings-logout-button">
            <LogOut className="mr-1.5 h-4 w-4" />
            Logout
          </Button>
        </div>
      </section>
      <ChangePasswordCard />
      {hasRole("admin") ? <RentRules /> : <p className="text-xs text-[#64748B]">Rent rules can be changed by an Admin.</p>}
    </div>
  );
}
