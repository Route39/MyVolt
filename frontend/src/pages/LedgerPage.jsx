import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { X, Download, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DriverSearch } from "@/components/DriverSearch";
import { TransactionsTable, ALL_COLS } from "@/components/TransactionsTable";
import { TxnFilters, EMPTY_FILTERS, toParams } from "@/components/TxnFilters";
import { PageHeader, Pager } from "@/components/kit";
import { api, downloadBlob } from "@/lib/api";
import { todayIso } from "@/lib/format";

const SIZE = 25;

export default function HistoryPage() {
  const nav = useNavigate();
  const [driver, setDriver] = useState(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState({ key: "submitted_at", dir: "desc" });
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const params = { ...toParams(filters), q, driver_id: driver?.id, sort: sort.key, dir: sort.dir };
  const key = JSON.stringify(params);

  useEffect(() => { setPage(1); }, [key]);
  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => {
      api.get("/transactions", { params: { ...params, page, page_size: SIZE } }).then((r) => setData(r.data)).finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, page]);

  const exportXlsx = async () => {
    setExporting(true);
    try {
      const r = await api.get("/transactions", { params: { ...params, format: "xlsx" }, responseType: "blob" });
      downloadBlob(r.data, `route39_ledger_${todayIso()}.xlsx`);
    } catch {
      toast.error("Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4 fade-up">
      <PageHeader title="Payment Ledger" subtitle="Every rent payment with its recorded driver, vehicle, UTR and verification trail"
        actions={<Button variant="outline" className="h-9" onClick={exportXlsx} disabled={exporting} data-testid="ledger-export">{exporting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}Export Excel</Button>} />
      <div className="r-card space-y-2 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-[300px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-[#94A3B8]" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search UTR, Txn ID, driver, vehicle…" className="h-9 pl-8" data-testid="ledger-search" />
            {loading && <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-[#94A3B8]" />}
          </div>
          <div className="w-full sm:w-[340px]"><DriverSearch compact value={driver} onSelect={setDriver} placeholder="All drivers" testId="history-driver-search" /></div>
          {driver && <Button variant="ghost" size="icon" onClick={() => setDriver(null)} data-testid="history-clear-driver"><X className="h-4 w-4" /></Button>}
          <span className="ml-auto text-xs text-[#64748B]" data-testid="history-count">{data.total} transactions</span>
        </div>
        <TxnFilters value={filters} onChange={setFilters} showStatus range />
      </div>
      <TransactionsTable rows={data.items} cols={ALL_COLS} testId="history-table" sort={sort} onSort={setSort} loading={loading}
        onRowClick={(t) => nav(`/transactions/${t.id}`)} footer={<Pager page={page} pageSize={SIZE} total={data.total} onPage={setPage} testId="ledger-pager" />} />
    </div>
  );
}
