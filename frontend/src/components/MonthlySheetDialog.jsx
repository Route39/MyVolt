import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, RefreshCw, Trash2, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DriverSearch } from "@/components/DriverSearch";
import { api, downloadBlob, errMsg } from "@/lib/api";
import { FLEET_CITIES, inr, normalizeCity } from "@/lib/format";

const ACTIONS = [
  ["paid", "Paid"],
  ["not_paid", "Not Paid"],
  ["week_off", "Week Off"],
  ["ev_issue_no_ride", "EV Issue (No Ride)"],
  ["ev_issue_replacement", "EV Issue (Replacement Given)"],
  ["other_issue", "Other Issue"],
];

const METHODS = ["UPI", "Bank Transfer", "Cash"];

export const MonthlySheetDialog = ({
  open,
  onOpenChange,
  defaultScope = "driver",
  defaultDriver = null,
  defaultCity = "Coimbatore",
  defaultMonth,
  onApplied,
}) => {
  const curYm = new Date().toISOString().slice(0, 7);
  const [scope, setScope] = useState(defaultScope);
  const [driver, setDriver] = useState(defaultDriver);
  const [city, setCity] = useState(defaultCity || "Coimbatore");
  const [month, setMonth] = useState(defaultMonth || curYm);
  const [groupBy, setGroupBy] = useState("date");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const [downloading, setDownloading] = useState(false);
  const [loadingInline, setLoadingInline] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [validating, setValidating] = useState(false);
  const [committing, setCommitting] = useState(false);

  const [filename, setFilename] = useState("");
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [filterTab, setFilterTab] = useState("all");
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!open) return;
    setScope(defaultScope || (defaultDriver ? "driver" : "city"));
    setDriver(defaultDriver || null);
    setCity(defaultCity && defaultCity !== "all" ? normalizeCity(defaultCity) : "Coimbatore");
    setMonth(defaultMonth || curYm);
    setDateFrom("");
    setDateTo("");
    setStatusFilter("all");
    setFilename("");
    setRows([]);
    setSummary(null);
    setFilterTab("all");
    setResult(null);
  }, [open, defaultScope, defaultDriver, defaultCity, defaultMonth, curYm]);

  const [yr, mo] = useMemo(() => {
    const [y, m] = (month || curYm).split("-").map(Number);
    return [y || new Date().getFullYear(), m || new Date().getMonth() + 1];
  }, [month, curYm]);

  const downloadSheet = async () => {
    if (scope === "driver" && !driver?.id) {
      toast.error("Please select a driver first");
      return;
    }
    setDownloading(true);
    try {
      const params = {
        scope,
        year: yr,
        month: mo,
        group_by: scope === "driver" ? "date" : groupBy,
        status_filter: statusFilter,
      };
      if (scope === "driver") params.driver_id = driver.id;
      else params.city = city;
      if (scope === "city" && dateFrom) params.date_from = dateFrom;
      if (scope === "city" && dateTo) params.date_to = dateTo;

      const r = await api.get("/calendar-sheet/export", { params, responseType: "blob" });
      const tag = scope === "driver" ? (driver.driver_code || driver.id) : (city === "all" ? "all_cities" : city);
      downloadBlob(r.data, `myvolt_rent_${tag}_${month}.xlsx`.toLowerCase());
      toast.success("Monthly rent Excel downloaded — fill ACTION/UTR and upload back here");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setDownloading(false);
    }
  };

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true);
    setResult(null);
    setFilename(file.name);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (scope === "driver" && driver?.id) fd.append("driver_id", driver.id);
      const { data } = await api.post("/calendar-sheet/parse", fd, { timeout: 120000 });
      setRows(data.rows || []);
      setSummary(data.summary || null);
      const errCount = data.summary?.errors || 0;
      const rdyCount = data.summary?.ready || 0;
      setFilterTab(errCount > 0 && rdyCount === 0 ? "error" : "all");
      toast.success(`Scanned ${data.summary?.total_rows || 0} row(s): ${rdyCount} ready, ${errCount} error(s)`);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setParsing(false);
      e.target.value = "";
    }
  };

  const loadInlineRows = async () => {
    if (scope === "driver" && !driver?.id) {
      toast.error("Please select a driver first");
      return;
    }
    setLoadingInline(true);
    setResult(null);
    try {
      const params = {
        scope,
        year: yr,
        month: mo,
        group_by: scope === "driver" ? "date" : groupBy,
        status_filter: statusFilter,
      };
      if (scope === "driver") params.driver_id = driver.id;
      else params.city = city;
      if (scope === "city" && dateFrom) params.date_from = dateFrom;
      if (scope === "city" && dateTo) params.date_to = dateTo;
      const { data } = await api.get("/calendar-sheet/preview-rows", { params });
      setFilename(data.label || "Inline Monthly Sheet");
      setRows(data.rows || []);
      setSummary(data.summary || null);
      setFilterTab("all");
      toast.success(`Loaded ${data.rows?.length || 0} row(s) — fill actions/UTRs and click Re-check`);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setLoadingInline(false);
    }
  };

  const revalidate = async (nextRows = rows) => {
    setValidating(true);
    try {
      const { data } = await api.post("/calendar-sheet/validate", { rows: nextRows });
      setRows(data.rows || []);
      setSummary(data.summary || null);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setValidating(false);
    }
  };

  const updateRow = (idx, key, val) => {
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== idx) return r;
        const next = { ...r, [key]: val };
        if (key === "action") {
          if ((val === "paid" || val === "ev_issue_replacement") && (!next.amount || Number(next.amount) <= 0) && next.daily_rent) {
            next.amount = next.daily_rent;
          }
          if (val === "ev_issue_replacement" && !next.remarks) {
            next.remarks = "EV Issue · Replacement vehicle given";
          }
        }
        return next;
      })
    );
  };

  const removeRow = (idx) => {
    const next = rows.filter((_, i) => i !== idx);
    setRows(next);
    if (next.length) revalidate(next);
    else setSummary(null);
  };

  const commit = async () => {
    setCommitting(true);
    try {
      const { data } = await api.post("/calendar-sheet/commit", { rows }, { timeout: 120000 });
      setResult(data);
      const parts = [];
      if (data.payments_created) parts.push(`${data.payments_created} payment(s)`);
      if (data.week_offs_marked) parts.push(`${data.week_offs_marked} week off(s)`);
      if (data.ev_issues_marked) parts.push(`${data.ev_issues_marked} EV issue(s)`);
      if (data.other_issues_marked) parts.push(`${data.other_issues_marked} other issue(s)`);
      toast.success(parts.length ? `Updated: ${parts.join(" · ")}` : "No new entries applied");
      onApplied?.();
      if (!data.errors?.length) {
        onOpenChange(false);
      }
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setCommitting(false);
    }
  };

  const visibleRows = useMemo(() => {
    if (filterTab === "all") return rows.map((r, i) => ({ ...r, _idx: i }));
    return rows.map((r, i) => ({ ...r, _idx: i })).filter((r) => r.state === filterTab);
  }, [rows, filterTab]);

  const readyCount = rows.filter((r) => r.state === "ready").length;
  const errCount = rows.filter((r) => r.state === "error").length;
  const skipCount = rows.filter((r) => r.state === "skipped").length;

  return (
    <Dialog open={open} onOpenChange={(o) => !committing && onOpenChange(o)}>
      <DialogContent className="flex max-h-[94vh] w-[calc(100%-16px)] max-w-[1280px] flex-col overflow-y-auto md:overflow-hidden" data-testid="monthly-sheet-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <FileSpreadsheet className="h-5 w-5 text-[#047857]" />
            Monthly Rent Excel — Download, Fill &amp; Upload
          </DialogTitle>
          <DialogDescription>
            Export a single driver&apos;s month or an entire city&apos;s fleet (e.g., Coimbatore), fill Paid/UTR, Week Off (max 3/month), or EV/Other Issues in Excel, and upload back to update the Rent Calendar.
          </DialogDescription>
        </DialogHeader>

        {/* Scope Tabs */}
        <div className="grid grid-cols-2 gap-2 rounded-lg border bg-[#F8FAFB] p-1.5 sm:w-[380px]">
          <button
            type="button"
            data-testid="ms-tab-driver"
            onClick={() => setScope("driver")}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              scope === "driver" ? "bg-[#DC2626] text-white shadow-sm" : "text-[#475569] hover:bg-white"
            }`}
          >
            Single Driver · Month
          </button>
          <button
            type="button"
            data-testid="ms-tab-city"
            onClick={() => setScope("city")}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              scope === "city" ? "bg-[#DC2626] text-white shadow-sm" : "text-[#475569] hover:bg-white"
            }`}
          >
            City-Wise · Month
          </button>
        </div>

        {/* Step 1 & 2 Controls */}
        <div className="grid gap-3 rounded-lg border border-dashed border-[#CBD5E1] bg-[#F8FAFB] p-3 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="grid gap-2.5 sm:grid-cols-2 md:grid-cols-4">
            {scope === "driver" ? (
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Driver</Label>
                <DriverSearch compact value={driver} onSelect={setDriver} placeholder="Search driver name, ID, phone…" testId="ms-driver-search" />
              </div>
            ) : (
              <>
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">City</Label>
                  <Select value={city} onValueChange={setCity}>
                    <SelectTrigger className="h-9 bg-white text-xs" data-testid="ms-city-select"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Cities</SelectItem>
                      {FLEET_CITIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Sort / Group By</Label>
                  <Select value={groupBy} onValueChange={setGroupBy}>
                    <SelectTrigger className="h-9 bg-white text-xs" data-testid="ms-groupby-select"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="date">By Date (After Join → End)</SelectItem>
                      <SelectItem value="driver">By Driver (After Join → End)</SelectItem>
                      <SelectItem value="joining_date">By Joining Date</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            <div className="space-y-1">
              <Label htmlFor="ms-month-input" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Month</Label>
              <Input id="ms-month-input" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="h-9 bg-white text-xs" data-testid="ms-month-input" />
            </div>

            <div className="space-y-1">
              <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Filter Rows</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-9 bg-white text-xs" data-testid="ms-status-filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Days</SelectItem>
                  <SelectItem value="not_paid">Not Paid Only</SelectItem>
                  <SelectItem value="paid">Paid / Verified Only</SelectItem>
                  <SelectItem value="issues">Pending &amp; Issues Only</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {scope === "city" && (
              <>
                <div className="space-y-1">
                  <Label htmlFor="ms-date-from" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">From date (optional)</Label>
                  <Input id="ms-date-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 bg-white text-xs" data-testid="ms-date-from" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ms-date-to" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">To date (optional)</Label>
                  <Input id="ms-date-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 bg-white text-xs" data-testid="ms-date-to" />
                </div>
              </>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="h-9 bg-white text-xs font-semibold" disabled={loadingInline} onClick={loadInlineRows} data-testid="ms-load-inline-btn">
              {loadingInline ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-1.5 h-4 w-4 text-[#B91C1C]" />}
              Fill Directly Here
            </Button>
            <Button type="button" variant="outline" className="h-9 bg-white text-xs font-semibold" disabled={downloading} onClick={downloadSheet} data-testid="ms-download-btn">
              {downloading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4 text-[#047857]" />}
              1. Download Excel (.xlsx)
            </Button>
            <label className="inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-[#DC2626] px-3.5 text-xs font-semibold text-white transition-colors hover:bg-[#B91C1C]">
              {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              <span>{parsing ? "Reading..." : "2. Upload Filled Excel"}</span>
              <input type="file" accept=".xlsx,.xlsm,.csv" onChange={handleUpload} disabled={parsing} className="hidden" data-testid="ms-file-input" />
            </label>
          </div>
          <p className="text-[11px] text-muted-foreground lg:col-span-2">
            Joining dates and earlier dates are excluded automatically — entries run from the day after each driver&apos;s joining date through month end.
          </p>
        </div>

        {/* Validation / Result Banners */}
        {result && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900" data-testid="ms-result-banner">
            <div className="flex items-center gap-1.5 font-semibold">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              Applied: {result.payments_created} payment(s) · {result.week_offs_marked} week off(s) · {result.ev_issues_marked} EV issue(s) · {result.other_issues_marked} other issue(s)
            </div>
            {result.errors?.length > 0 && (
              <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-red-700">
                {result.errors.map((err, i) => <li key={i}>{err}</li>)}
              </ul>
            )}
          </div>
        )}

        {summary && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-white px-3 py-2 text-xs" data-testid="ms-summary-bar">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 font-semibold text-[#17212B]">{filename}</span>
              {[
                ["all", `All (${rows.length})`, "bg-slate-100 text-slate-700"],
                ["ready", `Ready (${readyCount})`, "bg-emerald-50 text-emerald-700 border-emerald-200"],
                ["skipped", `Skipped (${skipCount})`, "bg-slate-50 text-slate-600 border-slate-200"],
                ["error", `Errors (${errCount})`, "bg-red-50 text-red-700 border-red-200"],
              ].map(([k, lbl, cls]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setFilterTab(k)}
                  data-testid={`ms-filter-${k}`}
                  className={`rounded-full border px-2.5 py-0.5 font-semibold transition-all ${cls} ${filterTab === k ? "ring-2 ring-slate-400" : "opacity-80 hover:opacity-100"}`}
                >
                  {lbl}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>Pay: <b>{summary.ready_payments}</b> · WO: <b>{summary.ready_week_offs}</b> · EV: <b>{summary.ready_ev_issues}</b> · Other: <b>{summary.ready_other_issues}</b></span>
              <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={validating || !rows.length} onClick={() => revalidate(rows)} data-testid="ms-revalidate-btn">
                {validating ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
                Re-check
              </Button>
            </div>
          </div>
        )}

        {errCount > 0 && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-900" data-testid="ms-error-banner">
            <div className="flex items-center gap-1.5 font-semibold text-red-800">
              <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
              {errCount} issue(s) found — fix inline or in Excel before applying (duplicate UTRs are blocked across all cities):
            </div>
            <ul className="mt-1.5 max-h-24 list-disc space-y-0.5 overflow-y-auto pl-5 text-red-700">
              {rows.filter((r) => r.state === "error").map((r, i) => (
                <li key={`${r.row_num}-${i}`}>
                  <b>Row {r.row_num}</b> ({r.date} · {r.driver_name || r.driver_code}): {r.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Preview & Inline Edit Table */}
        <div className="min-h-[220px] flex-1 overflow-auto rounded-md border bg-white">
          {visibleRows.length > 0 ? (
            <table className="data-table w-full whitespace-nowrap" data-testid="ms-preview-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Date</th>
                  <th>Driver</th>
                  <th>Action</th>
                  <th>Amount (₹)</th>
                  <th>UTR / Ref</th>
                  <th>Method</th>
                  <th>Vehicle ID</th>
                  <th>Remarks / Reason</th>
                  <th>Validation</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => {
                  const i = r._idx;
                  const rowCls = r.state === "error" ? "bg-red-50/60" : r.state === "ready" ? "bg-emerald-50/40" : "opacity-70";
                  return (
                    <tr key={`${r.row_num}-${i}`} className={rowCls} data-testid={`ms-row-${i}`}>
                      <td className="font-mono text-xs text-muted-foreground">{r.row_num}</td>
                      <td>
                        <Input type="date" value={r.date || ""} onChange={(e) => updateRow(i, "date", e.target.value)} className="h-8 w-[126px] font-mono text-xs" />
                      </td>
                      <td>
                        <div className="text-xs font-medium">{r.driver_name || "—"}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">
                          {r.driver_code}{r.joining_date ? ` · Joined ${r.joining_date}` : ""}
                        </div>
                      </td>
                      <td>
                        <Select value={r.action || "none"} onValueChange={(v) => updateRow(i, "action", v === "none" ? "" : v)}>
                          <SelectTrigger className="h-8 w-[180px] bg-white text-xs" data-testid={`ms-row-action-${i}`}><SelectValue placeholder="Skip" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">(Skip / No Action)</SelectItem>
                            {ACTIONS.map(([k, lbl]) => <SelectItem key={k} value={k}>{lbl}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </td>
                      <td>
                        <Input
                          type="number"
                          value={r.amount ?? ""}
                          disabled={!["paid", "ev_issue_replacement"].includes(r.action)}
                          onChange={(e) => updateRow(i, "amount", e.target.value)}
                          className="h-8 w-[82px] text-xs"
                          data-testid={`ms-row-amount-${i}`}
                        />
                      </td>
                      <td>
                        <Input
                          value={r.utr || ""}
                          disabled={!["paid", "ev_issue_replacement"].includes(r.action)}
                          onChange={(e) => updateRow(i, "utr", e.target.value.toUpperCase())}
                          placeholder="UTR"
                          className="h-8 w-[140px] font-mono text-xs"
                          data-testid={`ms-row-utr-${i}`}
                        />
                      </td>
                      <td>
                        <Select
                          value={r.method || "UPI"}
                          disabled={!["paid", "ev_issue_replacement"].includes(r.action)}
                          onValueChange={(v) => updateRow(i, "method", v)}
                        >
                          <SelectTrigger className="h-8 w-[115px] bg-white text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>{METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                        </Select>
                      </td>
                      <td>
                        <Input
                          value={r.vehicle_id || ""}
                          disabled={!["paid", "ev_issue_replacement"].includes(r.action)}
                          onChange={(e) => updateRow(i, "vehicle_id", e.target.value.toUpperCase())}
                          placeholder="Vehicle ID"
                          className="h-8 w-[105px] font-mono text-xs"
                        />
                      </td>
                      <td>
                        <Input
                          value={r.remarks || ""}
                          onChange={(e) => updateRow(i, "remarks", e.target.value)}
                          placeholder="Remarks / reason"
                          className="h-8 w-[180px] text-xs"
                          data-testid={`ms-row-remarks-${i}`}
                        />
                      </td>
                      <td className="text-xs">
                        {r.state === "error" ? (
                          <span className="inline-flex items-center gap-1 font-medium text-red-700"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />{r.message}</span>
                        ) : r.state === "ready" ? (
                          <span className="inline-flex items-center gap-1 font-medium text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5 shrink-0" />{r.message}</span>
                        ) : (
                          <span className="text-muted-foreground">{r.message}</span>
                        )}
                      </td>
                      <td>
                        <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-red-600" onClick={() => removeRow(i)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="grid h-full min-h-[200px] place-items-center p-6 text-center text-xs text-muted-foreground">
              <div>
                <FileSpreadsheet className="mx-auto mb-2 h-8 w-8 text-[#94A3B8]" />
                <div className="font-medium text-[#334155]">Step 1: Download the Monthly Excel for a Driver or City</div>
                <div className="mt-1">Step 2: Fill Paid / UTR, Week Off (max 3/month), EV Issue, or Other Issue in Excel, then upload it here to update the Rent Calendar.</div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="text-xs text-muted-foreground">
            {rows.length > 0 && (
              <span>
                {readyCount} ready to apply · {skipCount} skipped · {errCount} error(s)
                {summary?.ready_payments > 0 ? ` · Total ${inr(rows.filter((r) => r.state === "ready" && ["paid", "ev_issue_replacement"].includes(r.action)).reduce((s, r) => s + Number(r.amount || 0), 0))}` : ""}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={committing}>Close</Button>
            <Button type="button" disabled={committing || readyCount === 0} onClick={commit} data-testid="ms-commit-btn">
              {committing && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Apply {readyCount} Valid {readyCount === 1 ? "Entry" : "Entries"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
