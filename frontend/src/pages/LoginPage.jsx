import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2, Lock, Phone, ShieldCheck, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUser } from "@/context/UserContext";
import { errMsg } from "@/lib/api";

const FEATURES = [
  ["Role-Based Access Control", "Dedicated views and permissions for Staff, Accounts, and Admin teams."],
  ["Segregation-of-Duties Verification", "Independent accounts verification with screenshot audit and rejection notices."],
  ["Real-Time Collection Ledger", "Track expected vs verified rent, vehicle snapshots, and Excel reports."],
];

export default function LoginPage() {
  const { login } = useUser();
  const navigate = useNavigate();
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    const cleaned = mobile.trim();
    if (cleaned.length !== 10) {
      setError("Enter a valid 10-digit mobile number");
      return;
    }
    setBusy(true);
    try {
      const u = await login(cleaned, password);
      toast.success(`Welcome back, ${u.name}`);
      navigate("/", { replace: true });
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

      <section className="flex items-center justify-center px-4 py-10 sm:px-8 lg:col-span-7 lg:py-12">
        <div className="w-full max-w-[440px] space-y-4 fade-up">
          <div className="r-card p-6 sm:p-8 shadow-sm">
            <div className="mb-6">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#15803D]">MyVolt Portal</div>
              <h2 className="mt-1 font-display text-2xl font-bold text-[#101820]">Sign in to your account</h2>
              <p className="mt-1 text-xs text-[#64748B]">Enter your registered mobile number and password to continue</p>
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
                <Label htmlFor="login-mobile" className="text-xs font-semibold text-[#17212B]">Mobile Number</Label>
                <div className="relative">
                  <Phone className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#94A3B8]" />
                  <Input
                    id="login-mobile"
                    type="tel"
                    inputMode="numeric"
                    required
                    maxLength={10}
                    pattern="\d{10}"
                    autoComplete="tel"
                    placeholder="Enter 10-digit mobile number"
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").slice(0, 10))}
                    className="h-10 pl-9 font-mono"
                    data-testid="login-mobile"
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
                    className="h-10 pl-9 pr-9"
                    data-testid="login-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-2.5 top-2.5 text-[#64748B] hover:text-[#17212B]"
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
                className="h-10 w-full bg-[#16A34A] font-semibold text-white hover:bg-[#15803D]"
                data-testid="login-submit"
              >
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Sign In
              </Button>
            </form>

            <p className="mt-5 border-t border-[#E5E7EB] pt-4 text-center text-xs text-[#64748B]">
              Contact your Route39 administrator if you need account access or a password reset.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
