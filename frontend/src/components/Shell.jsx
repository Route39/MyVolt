import { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { LayoutDashboard, Users, CalendarDays, ShieldCheck, BookText, BarChart3, IdCard, Car, UserCog, Settings, LifeBuoy, Menu, PanelLeftClose, PanelLeftOpen, Zap, LogOut } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "@/components/NotificationBell";
import { DriverSearch } from "@/components/DriverSearch";
import { useUser } from "@/context/UserContext";
import { ROLE_LABEL } from "@/lib/format";

const ALL = ["staff", "accounts", "admin"];
const SECTIONS = [
  { title: "Main", items: [
    { to: "/overview", label: "Overview", icon: LayoutDashboard, roles: ALL, id: "overview" },
    { to: "/board", label: "All Drivers", icon: Users, roles: ALL, id: "board" },
    { to: "/calendar", label: "Rent Calendar", icon: CalendarDays, roles: ALL, id: "calendar" },
    { to: "/verification", label: "Accounts Verification", icon: ShieldCheck, roles: ["accounts", "admin"], id: "verification" },
    { to: "/history", label: "Payment Ledger", icon: BookText, roles: ALL, id: "history" },
    { to: "/reports", label: "Reports & Analytics", icon: BarChart3, roles: ["accounts", "admin"], id: "reports" },
  ] },
  { title: "Operations", items: [
    { to: "/drivers", label: "Driver Management", icon: IdCard, roles: ["admin"], id: "drivers" },
    { to: "/vehicles", label: "Vehicle Management", icon: Car, roles: ["admin"], id: "vehicles" },
    { to: "/staff", label: "Staff Management", icon: UserCog, roles: ["admin"], id: "staff" },
  ] },
];
const BOTTOM = [
  { to: "/settings", label: "Settings", icon: Settings, roles: ALL, id: "settings" },
  { to: "/help", label: "Help", icon: LifeBuoy, roles: ALL, id: "help" },
];
const TITLES = { "/transactions": "Transaction Review" };

const initials = (n) => n.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();

const Brand = ({ collapsed }) => (
  <div className="flex h-14 items-center gap-2.5 px-3">
    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[#22C55E] text-[#101820] shadow-sm">
      <Zap className="h-4 w-4 fill-current" />
    </div>
    {!collapsed && (
      <div className="min-w-0 leading-tight">
        <div className="flex items-center gap-1.5 font-display text-[14px] font-extrabold tracking-[0.08em] text-white">
          <span>MYVOLT</span>
          <span className="rounded bg-[#22C55E]/20 px-1 py-0.5 text-[9px] font-bold text-[#22C55E]">EV</span>
        </div>
        <div className="truncate text-[10px] font-medium uppercase tracking-[0.12em] text-[#7C8A97]">Route39 Fleet & Rent</div>
      </div>
    )}
  </div>
);

const Item = ({ item, collapsed, onNavigate }) => {
  const Icon = item.icon;
  return (
    <NavLink to={item.to} onClick={onNavigate} data-testid={`nav-${item.id}`} title={collapsed ? item.label : undefined}
      className={({ isActive }) => `group relative flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] font-medium transition-colors ${isActive ? "bg-[#22C55E]/[0.12] text-white" : "text-[#A3B0BC] hover:bg-white/[0.05] hover:text-white"} ${collapsed ? "justify-center" : ""}`}>
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r bg-[#22C55E]" />}
          <Icon className={`h-[17px] w-[17px] shrink-0 ${isActive ? "text-[#22C55E]" : ""}`} />
          {!collapsed && <span className="truncate">{item.label}</span>}
        </>
      )}
    </NavLink>
  );
};

const SideNav = ({ collapsed, onNavigate }) => {
  const { user, hasRole, logout } = useUser();
  const handleLogout = async () => {
    if (onNavigate) onNavigate();
    await logout();
    toast.success("Signed out");
  };
  return (
    <div className="flex h-full flex-col bg-[#151F27]">
      <Brand collapsed={collapsed} />
      <nav className="flex-1 space-y-5 overflow-y-auto px-2.5 pt-3">
        {SECTIONS.map((s) => {
          const items = s.items.filter((i) => hasRole(...i.roles));
          if (!items.length) return null;
          return (
            <div key={s.title}>
              {!collapsed && <div className="mb-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#5D6B78]">{s.title}</div>}
              <div className="space-y-0.5">{items.map((i) => <Item key={i.to} item={i} collapsed={collapsed} onNavigate={onNavigate} />)}</div>
            </div>
          );
        })}
      </nav>
      <div className="space-y-0.5 border-t border-white/[0.06] px-2.5 py-3">
        {BOTTOM.map((i) => <Item key={i.to} item={i} collapsed={collapsed} onNavigate={onNavigate} />)}
        <div className={`mt-2 flex items-center gap-2 rounded-md bg-white/[0.04] px-2.5 py-2 ${collapsed ? "justify-center" : ""}`} data-testid="sidebar-user-profile">
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#22C55E]/20 text-[11px] font-bold text-[#22C55E]">{initials(user.name)}</div>
          {!collapsed && (
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-[12.5px] font-semibold text-white">{user.name}</div>
              <div className="text-[11px] text-[#7C8A97]">{ROLE_LABEL[user.role]}</div>
            </div>
          )}
          {!collapsed && (
            <button
              type="button"
              onClick={handleLogout}
              title="Sign out"
              className="rounded p-1 text-[#7C8A97] transition-colors hover:bg-white/[0.08] hover:text-white"
              data-testid="sidebar-logout-button"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const UserSwitcher = () => {
  const { users, user, switchUser } = useUser();
  return (
    <Select value={user.id} onValueChange={switchUser}>
      <SelectTrigger className="h-9 w-auto min-w-[170px] gap-2 border-[#E5E7EB] bg-white" data-testid="user-switcher">
        <SelectValue>
          <span className="flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-[#101820] text-[10px] font-bold text-white">{initials(user.name)}</span>
            <span className="hidden truncate text-[13px] font-semibold sm:inline">{user.name}</span>
            <span className="rounded bg-[#F0FDF4] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#15803D]" data-testid="role-badge">{ROLE_LABEL[user.role]}</span>
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="end">
        {["staff", "accounts", "admin"].map((r) => (
          <SelectGroup key={r}>
            <SelectLabel className="text-[10px] uppercase tracking-wider text-[#64748B]">{ROLE_LABEL[r]}</SelectLabel>
            {users.filter((u) => u.role === r).map((u) => <SelectItem key={u.id} value={u.id} data-testid={`user-option-${u.id}`}>{u.name}</SelectItem>)}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
};

export const Shell = () => {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(localStorage.getItem("r39_nav") === "1");
  const { logout } = useUser();
  const { pathname } = useLocation();
  const nav = useNavigate();
  const all = [...SECTIONS.flatMap((s) => s.items), ...BOTTOM];
  const title = all.find((n) => pathname.startsWith(n.to))?.label || TITLES[`/${pathname.split("/")[1]}`] || "";
  const toggle = () => { localStorage.setItem("r39_nav", collapsed ? "0" : "1"); setCollapsed(!collapsed); };
  const handleLogout = async () => {
    await logout();
    toast.success("Signed out");
  };
  return (
    <div className="min-h-screen bg-[#F4F6F8]">
      <aside className={`fixed inset-y-0 left-0 z-40 hidden transition-[width] duration-200 lg:block ${collapsed ? "w-[68px]" : "w-[236px]"}`} data-testid="sidebar">
        <SideNav collapsed={collapsed} />
      </aside>
      <div className={`transition-[padding] duration-200 ${collapsed ? "lg:pl-[68px]" : "lg:pl-[236px]"}`}>
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-[#E5E7EB] bg-white/95 px-3 backdrop-blur sm:px-5">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild><Button variant="ghost" size="icon" className="lg:hidden" data-testid="mobile-menu-button"><Menu className="h-5 w-5" /></Button></SheetTrigger>
            <SheetContent side="left" className="w-[248px] border-0 p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <SideNav collapsed={false} onNavigate={() => setOpen(false)} />
            </SheetContent>
          </Sheet>
          <Button variant="ghost" size="icon" className="hidden h-8 w-8 text-[#64748B] lg:inline-flex" onClick={toggle} data-testid="sidebar-collapse-button">
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
          <div className="hidden truncate text-[13px] font-semibold text-[#17212B] sm:block" data-testid="page-title">{title}</div>
          <div className="ml-auto hidden w-[300px] md:block">
            <DriverSearch compact value={null} onSelect={(d) => nav(`/calendar?driver=${d.id}`)} placeholder="Search drivers…" testId="global-search" />
          </div>
          <div className="ml-auto flex items-center gap-1.5 md:ml-2">
            <NotificationBell />
            <UserSwitcher />
            <Button variant="ghost" size="icon" className="h-9 w-9 text-[#64748B] hover:text-[#17212B]" onClick={handleLogout} title="Sign out" data-testid="logout-button">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </header>
        <main className="mx-auto max-w-[1520px] px-3 py-5 sm:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
