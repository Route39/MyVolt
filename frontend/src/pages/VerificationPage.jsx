import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, X } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TransactionsTable, VERIFY_COLS } from "@/components/TransactionsTable";
import { TxnFilters, EMPTY_FILTERS, toParams } from "@/components/TxnFilters";
import { PageHeader, StatCard, Pager } from "@/components/kit";
import { api } from "@/lib/api";
import { fmtDate, inr, MONTHS } from "@/lib/format";

const Stat = ({ label, value, cls, testId }) => <StatCard label={label} value={value} tone={cls} testId={testId} />;
const SIZE = 25;
const KEY = "verification_state";

const fmtPeriod = (p) => {
  if (!p) return "";
  if (p.length === 10) return fmtDate(p);
  if (p.length === 7) {
    const [y, m] = p.split("-");
    const mIdx = parseInt(m, 10) - 1;
    return `${MONTHS[mIdx] || m} ${y}`;
  }
  return p;
};

export default function VerificationPage() {
  const nav = useNavigate();
  const [tab, setTab] = useState("pending");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [month, setMonth] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState({ key: "submitted_at", dir: "asc" });
  const [dbLoaded, setDbLoaded] = useState(false);
  const [rows, setRows] = useState({ items: [], total: 0 });
  const [sum, setSum] = useState(null);
  const [psum, setPsum] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const base = { ...toParams(filters), ...(month && !filters.payment_date ? { month } : {}) };
  const baseKey = JSON.stringify(base);
  const period = filters.payment_date || month;

  // 1. Load persisted state from DB on mount
  useEffect(() => {
    let active = true;
    api.get(`/user/state/${KEY}`).then((r) => {
      if (!active) return;
      const v = r.data?.value;
      if (v && typeof v === "object") {
        if (v.tab) setTab(v.tab);
        if (v.filters) setFilters(v.filters);
        if (v.month !== undefined) setMonth(v.month);
        if (v.page) setPage(v.page);
        if (v.sort) setSort(v.sort);
      }
    }).catch(() => {}).finally(() => {
      if (active) setDbLoaded(true);
    });
    return () => { active = false; };
  }, []);

  // 2. Persist state changes directly in DB
  useEffect(() => {
    if (!dbLoaded) return;
    const t = setTimeout(() => {
      api.put(`/user/state/${KEY}`, { value: { tab, filters, month, page, sort } }).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [dbLoaded, tab, filters, month, page, sort]);

  useEffect(() => { api.get("/accounts/summary").then((r) => setSum(r.data)); }, []);

  useEffect(() => {
    if (!period) { setPsum(null); return; }
    api.get("/transactions", { params: { ...base, summary: true } }).then((r) => setPsum(r.data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseKey]);

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => {
      api.get("/transactions", { params: { ...base, status: tab, page, page_size: SIZE, sort: sort.key, dir: sort.dir } })
        .then((r) => setRows(r.data)).finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseKey, tab, page, sort]);

  const onTab = (v) => { setTab(v); setPage(1); };
  const onSort = (v) => { setSort(v); setPage(1); };
  const onFilters = (f) => { if (f.payment_date) setMonth(""); setFilters(f); setPage(1); };
  const onMonth = (v) => { setMonth(v); if (v) setFilters((f) => ({ ...f, payment_date: "" })); setPage(1); };

  const download = async () => {
    setBusy(true);
    try {
      const r = await api.get("/transactions", { params: { ...base, status: tab, sort: sort.key, dir: sort.dir, format: "xlsx" }, responseType: "blob" });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement("a");
      a.href = url; a.download = `verification-${tab}-${period || "all"}.xlsx`; a.click();
      URL.revokeObjectURL(url);
    } finally { setBusy(false); }
  };

  const cell = (k) => `${psum?.[k]?.count ?? 0} · ${inr(psum?.[k]?.amount ?? 0)}`;
  const periodLabel = fmtPeriod(period);

  return (
    <div className="space-y-4 fade-up">
      <PageHeader title="Accounts Verification" subtitle="Check each screenshot against its UTR before approving. Only approved payments count as collected." />
      {psum ? (
        <div className="grid grid-cols-1 gap-3 w375:grid-cols-2 lg:grid-cols-4">
          <Stat label={`Approved · ${periodLabel}`} value={cell("approved")} cls="st-verified" testId="period-approved" />
          <Stat label={`Pending · ${periodLabel}`} value={cell("pending")} cls="st-pending" testId="period-pending" />
          <Stat label={`Rejected · ${periodLabel}`} value={cell("rejected")} cls="st-rejected" testId="period-rejected" />
          <Stat label={`Total · ${periodLabel}`} value={`${(psum?.approved?.count || 0) + (psum?.pending?.count || 0) + (psum?.rejected?.count || 0)} · ${inr((psum?.approved?.amount || 0) + (psum?.pending?.amount || 0) + (psum?.rejected?.amount || 0))}`} testId="period-total" />
        </div>
      ) : sum && (
        <div className="grid grid-cols-1 gap-3 w375:grid-cols-2 lg:grid-cols-4">
          <Stat label="Pending verification" value={sum.pending_count} cls="st-pending" testId="summary-pending-count" />
          <Stat label="Verified today" value={sum.approved_today} cls="st-verified" testId="summary-approved-today" />
          <Stat label="Rejected today" value={sum.rejected_today} cls="st-rejected" testId="summary-rejected-today" />
          <Stat label="Amount pending" value={inr(sum.pending_amount)} cls="st-pending" testId="summary-pending-amount" />
        </div>
      )}
      <div className="r-card space-y-3 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Tabs value={tab} onValueChange={onTab}>
            <TabsList className="h-auto flex-wrap justify-start" data-testid="verification-tabs">
              <TabsTrigger value="pending" data-testid="tab-pending">Pending</TabsTrigger>
              <TabsTrigger value="approved" data-testid="tab-approved">Approved</TabsTrigger>
              <TabsTrigger value="rejected" data-testid="tab-rejected">Rejected</TabsTrigger>
              <TabsTrigger value="all" data-testid="tab-all">All Transactions</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-2">
            <Input type="month" value={month} onChange={(e) => onMonth(e.target.value)} className="h-9 w-44" data-testid="filter-month" />
            {month && <Button variant="ghost" size="sm" className="h-9" onClick={() => onMonth("")}><X className="h-4 w-4" /></Button>}
            <Button size="sm" className="h-9" onClick={download} disabled={busy} data-testid="verification-download">
              <Download className="mr-1 h-4 w-4" />{busy ? "Downloading..." : "Download"}
            </Button>
          </div>
        </div>
        <TxnFilters value={filters} onChange={onFilters} />
      </div>
      <TransactionsTable rows={rows.items} cols={tab === "rejected" ? [...VERIFY_COLS, "reason"] : VERIFY_COLS} testId="verification-table"
        sort={sort} onSort={onSort} loading={loading}
        footer={<Pager page={page} pageSize={SIZE} total={rows.total} onPage={setPage} testId="verification-pager" />}
        empty={tab === "pending" ? "No payments waiting for verification" : "No transactions found"}
        onRowClick={(t) => nav(`/transactions/${t.id}`)} />
    </div>
  );
}
