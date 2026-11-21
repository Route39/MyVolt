import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TransactionsTable, VERIFY_COLS } from "@/components/TransactionsTable";
import { TxnFilters, EMPTY_FILTERS, toParams } from "@/components/TxnFilters";
import { PageHeader, StatCard, Pager } from "@/components/kit";
import { api } from "@/lib/api";
import { inr } from "@/lib/format";

const Stat = ({ label, value, cls, testId }) => <StatCard label={label} value={value} tone={cls} testId={testId} />;
const SIZE = 25;

export default function VerificationPage() {
  const nav = useNavigate();
  const [tab, setTab] = useState("pending");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [rows, setRows] = useState({ items: [], total: 0 });
  const [sum, setSum] = useState(null);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState({ key: "submitted_at", dir: "asc" });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/accounts/summary").then((r) => setSum(r.data));
  }, []);
  useEffect(() => { setPage(1); }, [filters, tab, sort]);

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => {
      api.get("/transactions", { params: { ...toParams(filters), status: tab, page, page_size: SIZE, sort: sort.key, dir: sort.dir } })
        .then((r) => setRows(r.data)).finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(t);
  }, [filters, tab, page, sort]);

  return (
    <div className="space-y-4 fade-up">
      <PageHeader title="Accounts Verification" subtitle="Check each screenshot against its UTR before approving. Only approved payments count as collected." />
      {sum && (
        <div className="grid grid-cols-1 gap-3 w375:grid-cols-2 lg:grid-cols-4">
          <Stat label="Pending verification" value={sum.pending_count} cls="st-pending" testId="summary-pending-count" />
          <Stat label="Verified today" value={sum.approved_today} cls="st-verified" testId="summary-approved-today" />
          <Stat label="Rejected today" value={sum.rejected_today} cls="st-rejected" testId="summary-rejected-today" />
          <Stat label="Amount pending" value={inr(sum.pending_amount)} cls="st-pending" testId="summary-pending-amount" />
        </div>
      )}
      <div className="r-card space-y-3 p-3">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto w-full flex-wrap justify-start sm:w-auto" data-testid="verification-tabs">
          <TabsTrigger value="pending" data-testid="tab-pending">Pending</TabsTrigger>
          <TabsTrigger value="approved" data-testid="tab-approved">Approved</TabsTrigger>
          <TabsTrigger value="rejected" data-testid="tab-rejected">Rejected</TabsTrigger>
          <TabsTrigger value="all" data-testid="tab-all">All Transactions</TabsTrigger>
        </TabsList>
      </Tabs>
      <TxnFilters value={filters} onChange={setFilters} />
      </div>
      <TransactionsTable rows={rows.items} cols={tab === "rejected" ? [...VERIFY_COLS, "reason"] : VERIFY_COLS} testId="verification-table"
        sort={sort} onSort={setSort} loading={loading}
        footer={<Pager page={page} pageSize={SIZE} total={rows.total} onPage={setPage} testId="verification-pager" />}
        empty={tab === "pending" ? "No payments waiting for verification" : "No transactions found"}
        onRowClick={(t) => nav(`/transactions/${t.id}`)} />
    </div>
  );
}
