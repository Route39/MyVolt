const pad = (n) => String(n).padStart(2, "0");

export const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayIso = () => isoDate(new Date());

export const inr = (v) => `₹${Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

export const fmtDate = (iso) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export const fmtDateTime = (ts) =>
  ts
    ? new Date(ts).toLocaleString("en-GB", {
        day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata",
      })
    : "—";

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const STATUS = {
  none: { label: "No entry", cls: "st-none" },
  pending: { label: "Pending Verification", short: "Pending", cls: "st-pending" },
  verified: { label: "Verified", cls: "st-verified" },
  approved: { label: "Verified", cls: "st-verified" },
  rejected: { label: "Rejected", cls: "st-rejected" },
  partial: { label: "Partial", cls: "st-partial" },
  unpaid: { label: "Unpaid", cls: "st-unpaid" },
  inactive: { label: "Inactive", cls: "st-inactive" },
  not_started: { label: "Not started", cls: "st-not_started" },
  rent_free: { label: "Rent free", cls: "st-rent_free" },
};

export const ROLE_LABEL = { staff: "Staff", accounts: "Accounts", admin: "Admin" };

export const FLEET_CITIES = ["Chennai", "Bangalore", "Coimbatore", "Tiruppur"];
export const normalizeCity = (c) => (c === "Bengaluru" ? "Bangalore" : c || "Bangalore");
