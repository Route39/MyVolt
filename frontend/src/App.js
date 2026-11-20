import "@/App.css";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Loader2, Lock } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { UserProvider, useUser } from "@/context/UserContext";
import { Shell as AppShell } from "@/components/Shell";
import CalendarPage from "@/pages/CalendarPage";
import VerificationPage from "@/pages/VerificationPage";
import TransactionDetailPage from "@/pages/TransactionDetailPage";
import HistoryPage from "@/pages/LedgerPage";
import OverviewPage from "@/pages/OverviewPage";
import AllDriversPage from "@/pages/AllDriversPage";
import SettingsPage from "@/pages/SettingsPage";
import HelpPage from "@/pages/HelpPage";
import ReportsPage from "@/pages/ReportsPage";
import DriversPage from "@/pages/DriversPage";
import StaffPage from "@/pages/StaffPage";
import VehiclesPage from "@/pages/VehiclesPage";

const Guard = ({ roles, children }) => {
  const { hasRole } = useUser();
  if (hasRole(...roles)) return children;
  return (
    <div className="grid min-h-[50vh] place-items-center text-center" data-testid="no-access">
      <div>
        <Lock className="mx-auto h-6 w-6 text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">Your role does not have access to this page.</p>
      </div>
    </div>
  );
};

const Shell = () => {
  const { user } = useUser();
  if (!user) return <div className="grid min-h-screen place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  return (
    <Routes key={user.id}>
      <Route element={<AppShell />}>
        <Route path="/" element={<Navigate to={{ accounts: "/verification", staff: "/board", admin: "/overview" }[user.role]} replace />} />
        <Route path="/overview" element={<OverviewPage />} />
        <Route path="/board" element={<AllDriversPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/help" element={<HelpPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/verification" element={<Guard roles={["accounts", "admin"]}><VerificationPage /></Guard>} />
        <Route path="/transactions/:id" element={<TransactionDetailPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/reports" element={<Guard roles={["accounts", "admin"]}><ReportsPage /></Guard>} />
        <Route path="/drivers" element={<Guard roles={["admin"]}><DriversPage /></Guard>} />
        <Route path="/vehicles" element={<Guard roles={["admin"]}><VehiclesPage /></Guard>} />
        <Route path="/staff" element={<Guard roles={["admin"]}><StaffPage /></Guard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
};

export default function App() {
  return (
    <BrowserRouter>
      <UserProvider>
        <Shell />
        <Toaster position="top-right" richColors />
      </UserProvider>
    </BrowserRouter>
  );
}
