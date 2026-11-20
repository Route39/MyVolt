import { useState } from "react";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2, Lock, Mail, ShieldCheck, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUser } from "@/context/UserContext";
import { errMsg } from "@/lib/api";
import { ROLE_LABEL } from "@/lib/format";

const FALLBACK_USERS = [
  { id: "u-admin", name: "Anita Rao", email: "anita.admin@route39.in", role: "admin" },
  { id: "u-acc-1", name: "Priya Sharma", email: "priya.accounts@route39.in", role: "accounts" },
  { id: "u-staff-1", name: "Ravi Kumar", email: "ravi.staff@route39.in", role: "staff" },
];

const ROLE_BADGE = {
  admin: "bg-[#101820] text-white",
  accounts: "bg-[#EFF6FF] text-[#1D4ED8]",
  staff: "bg-[#F0FDF4] text-[#15803D]",
};

const FEATURES = [
  ["Role-Based Access Control", "Dedicated views and permissions for Staff, Accounts, and Admin teams."],
  ["Segregation-of-Duties Verification", "Independent accounts verification with screenshot audit and rejection notices."],
  ["Real-Time Collection Ledger", "Track expected vs verified rent, vehicle snapshots, and Excel reports."],
];

export default function LoginPage() {
  const { users, login } = useUser();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const demoList = users.length ? users : FALLBACK_USERS;

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const u = await login(email, password);
      toast.success(`Welcome back, ${u.name}`);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const quickSignIn = async (u) => {
    setError("");
    setEmail(u.email);
    setPassword("route39@123");
    setBusy(true);
    try {
      const logged = await login(u.email, "route39@123");
      toast.success(`Signed in as ${logged.name}`);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F4F6F8] lg:grid lg:grid-cols-12">
      <section className="relative flex flex-col justify-between bg-[#101820] px-6 py-8 text-white sm:px-10 lg:col-span-5 lg:px-12 lg:py-12">
        <div>
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-[#22C55E] text-[#101820] shadow-sm">
              <Zap className="h-5 w-5 fill-current" />
            </div>
            <div>
              <div className="flex items-center gap-2 font-display text-[17px] font-extrabold tracking-[0.08em]">
                <span>MYVOLT</span>
                <span className="rounded bg-[#22C55E]/20 px-1.5 py-0.5 text-[10px] font-bold text-[#22C55E]">EV</span>
              </div>
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#7C8A97]">Route39 Mobility Pvt Ltd</div>
            </div>
          </div>

          <div className="mt-10 lg:mt-16">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-[#22C55E]/30 bg-[#22C55E]/10 px-3 py-1 text-[11px] font-semibold text-[#22C55E]">
              <ShieldCheck className="h-3.5 w-3.5" />
              Enterprise Fleet Portal
            </div>
            <h1 className="mt-4 font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
              EV Fleet Finance &amp; Rent Operations
            </h1>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-[#94A3B8]">
              Sign in with your Route39 account to record driver rent collections, inspect UTR screenshots, and manage fleet assignments.
            </p>
          </div>

          <div className="mt-8 space-y-4">
            {FEATURES.map(([title, desc]) => (
              <div key={title} className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#22C55E]" />
                <div>
                  <div className="text-[13px] font-semibold text-white">{title}</div>
                  <div className="text-xs text-[#94A3B8]">{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-10 border-t border-white/10 pt-5 text-xs text-[#7C8A97]">
          © {new Date().getFullYear()} Route39 Mobility Pvt Ltd — MyVolt Operations
        </div>
      </section>

      <section className="flex items-center justify-center px-4 py-8 sm:px-8 lg:col-span-7 lg:py-12">
        <div className="w-full max-w-[460px] space-y-5 fade-up">
          <div className="r-card p-6 sm:p-7">
            <div className="mb-5">
              <h2 className="font-display text-xl font-bold text-[#101820]">Sign in to MyVolt</h2>
              <p className="mt-1 text-xs text-[#64748B]">Enter your work email and password to continue</p>
            </div>

            {error && (
              <div
                className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700"
                role="alert"
                data-testid="login-error"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={submit} className="space-y-4" data-testid="login-form">
              <div className="space-y-1.5">
                <Label htmlFor="login-email" className="text-xs font-semibold text-[#17212B]">Work Email</Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#94A3B8]" />
                  <Input
                    id="login-email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="name@route39.in"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-9 pl-9"
                    data-testid="login-email"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="login-password" className="text-xs font-semibold text-[#17212B]">Password</Label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#94A3B8]" />
                  <Input
                    id="login-password"
                    type={showPw ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-9 pl-9 pr-9"
                    data-testid="login-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-2.5 top-2 text-[#64748B] hover:text-[#17212B]"
                    aria-label={showPw ? "Hide password" : "Show password"}
                    data-testid="login-password-toggle"
                  >
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                disabled={busy}
                className="h-9 w-full bg-[#16A34A] font-semibold text-white hover:bg-[#15803D]"
                data-testid="login-submit"
              >
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Sign In
              </Button>
            </form>
          </div>

          <div className="r-card p-5" data-testid="demo-accounts">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="r-label">Quick Demo Accounts</div>
                <p className="mt-0.5 text-xs text-[#64748B]">Click an account to sign in immediately</p>
              </div>
              <span className="rounded bg-[#F1F5F9] px-2 py-1 font-mono text-[11px] font-medium text-[#334155]">
                Password: route39@123
              </span>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {demoList.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  disabled={busy}
                  onClick={() => quickSignIn(u)}
                  data-testid={`demo-user-${u.id}`}
                  className="flex items-center justify-between gap-2 rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-left transition-colors hover:border-[#22C55E] hover:bg-[#F0FDF4]/40 disabled:opacity-60"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-[#17212B]">{u.name}</div>
                    <div className="truncate text-[11px] text-[#64748B]">{u.email || u.id}</div>
                  </div>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${ROLE_BADGE[u.role] || "bg-slate-100 text-slate-700"}`}>
                    {ROLE_LABEL[u.role] || u.role}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
