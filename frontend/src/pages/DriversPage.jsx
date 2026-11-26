import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Plus, CalendarDays, Pencil, SlidersHorizontal, ArrowLeftRight, FileUp, Download, Loader2, MapPin, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DriverFormDialog, AdjustmentsDialog } from "@/components/DriverDialogs";
import { VehicleAssignDialog } from "@/components/Vehicles";
import { ImportDialog } from "@/components/ImportDialog";
import { api, downloadBlob, errMsg } from "@/lib/api";
import { inr, todayIso, FLEET_CITIES } from "@/lib/format";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader, Pager, StatCard, SortTh, usePaged } from "@/components/kit";

export default function DriversPage() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState([]);
  const [edit, setEdit] = useState(undefined);
  const [adj, setAdj] = useState(null);
  const [veh, setVeh] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState("all");
  const [city, setCity] = useState(() => new URLSearchParams(window.location.search).get("city") || "all");
  const noVeh = new URLSearchParams(window.location.search).get("vehicle") === "none";
  const [sort, setSort] = useState({ key: "driver_code", dir: "asc" });

  const cities = useMemo(() => {
    const set = new Set([...FLEET_CITIES, ...rows.map((d) => d.city).filter(Boolean)]);
    return [...set].sort();
  }, [rows]);
  const filtered = useMemo(
    () => rows.filter((d) => (status === "all" || d.status === status) && (city === "all" || d.city === city) && (!noVeh || !d.current_vehicle_id)),
    [rows, status, city, noVeh]
  );
  const sorted = useMemo(() => {
    const list = [...filtered];
    const naturalCompare = (aStr, bStr) => {
      return (aStr || "").localeCompare(bStr || "", undefined, { numeric: true, sensitivity: "base" });
    };
    list.sort((a, b) => {
      let res = 0;
      if (sort.key === "driver_code") {
        res = naturalCompare(a.driver_code, b.driver_code);
      } else if (sort.key === "name") {
        res = (a.name || "").localeCompare(b.name || "");
      } else if (sort.key === "mobile") {
        res = (a.mobile || "").localeCompare(b.mobile || "");
      } else if (sort.key === "city") {
        res = (a.city || "").localeCompare(b.city || "");
      } else if (sort.key === "joining_date") {
        res = (a.joining_date || "").localeCompare(b.joining_date || "");
      } else if (sort.key === "daily_rent") {
        res = (Number(a.daily_rent) || 0) - (Number(b.daily_rent) || 0);
      }
      return sort.dir === "desc" ? -res : res;
    });
    return list;
  }, [filtered, sort.key, sort.dir]);

  const paged = usePaged(sorted, 25, [q, status, city, sort.key, sort.dir]);

  const cityStats = useMemo(() => {
    const map = {};
    rows.forEach((d) => {
      const c = d.city || "Other";
      if (!map[c]) map[c] = { city: c, count: 0, rentTotal: 0 };
      map[c].count += 1;
      map[c].rentTotal += Number(d.daily_rent || 0);
    });
    return Object.values(map).sort((a, b) => a.city.localeCompare(b.city));
  }, [rows]);

  const totalRent = useMemo(() => filtered.reduce((acc, d) => acc + Number(d.daily_rent || 0), 0), [filtered]);
  const activeCount = useMemo(() => filtered.filter((d) => d.status === "Active").length, [filtered]);
  const assignedCount = useMemo(() => filtered.filter((d) => !!d.current_vehicle_id).length, [filtered]);

  const load = useCallback(() => api.get("/drivers", { params: { q } }).then((r) => setRows(r.data)), [q]);
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  const exportXlsx = async () => {
    setExporting(true);
    try {
      const params = { q };
      if (city !== "all") params.city = city;
      if (status !== "all") params.status = status;
      params.format = "xlsx";
      const r = await api.get("/drivers", { params, responseType: "blob" });
      downloadBlob(r.data, `myvolt_drivers_${todayIso()}.xlsx`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4 fade-up">
      <PageHeader
        title="Driver Management"
        subtitle={`${rows.length} drivers · Driver IDs are permanent`}
        actions={
          <div className="flex w-full flex-wrap gap-2 sm:w-auto [&>button]:flex-1 sm:[&>button]:flex-none">
            <Button variant="outline" onClick={exportXlsx} disabled={exporting} data-testid="export-drivers-button">
              {exporting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
              Export Excel
            </Button>
            <Button variant="outline" onClick={() => setImportOpen(true)} data-testid="import-drivers-button">
              <FileUp className="mr-1.5 h-4 w-4" />
              <span className="hidden w425:inline">Import Excel / PDF / Image</span><span className="w425:hidden">Import</span>
            </Button>
            <Button onClick={() => setEdit(null)} data-testid="add-driver-button">
              <Plus className="mr-1.5 h-4 w-4" />
              Add driver
            </Button>
          </div>
        }
      />

      <section className="space-y-2.5" data-testid="drivers-summary-bar">
        <div className="grid grid-cols-1 gap-3 w375:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Showing drivers" value={filtered.length} hint={city === "all" ? "All cities" : city} testId="drivers-kpi-total" />
          <StatCard label="Active drivers" value={activeCount} tone="st-verified" testId="drivers-kpi-active" />
          <StatCard label="Assigned vehicles" value={assignedCount} tone="st-partial" testId="drivers-kpi-assigned" />
          <StatCard label="Total daily rent" value={inr(totalRent)} tone="st-verified" hint="Expected daily fleet rent" testId="drivers-kpi-rent" />
        </div>
        {cityStats.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto whitespace-nowrap pb-1 [&>*]:shrink-0 md:flex-wrap md:overflow-visible" data-testid="drivers-city-pills">
            <span className="inline-flex items-center gap-1 pr-1 text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">
              <MapPin className="h-3 w-3" /> Cities:
            </span>
            <button
              type="button"
              onClick={() => setCity("all")}
              data-testid="drivers-city-pill-all"
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                city === "all" ? "border-[#B91C1C] bg-[#FEF2F2] text-[#B91C1C]" : "border-[#E5E7EB] bg-white text-[#475569] hover:bg-[#F8FAFB]"
              }`}
            >
              All ({rows.length})
            </button>
            {cityStats.map((cs) => (
              <button
                key={cs.city}
                type="button"
                onClick={() => setCity(city === cs.city ? "all" : cs.city)}
                data-testid={`drivers-city-pill-${cs.city}`}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  city === cs.city ? "border-[#B91C1C] bg-[#FEF2F2] text-[#B91C1C]" : "border-[#E5E7EB] bg-white text-[#475569] hover:bg-[#F8FAFB]"
                }`}
              >
                {cs.city} · {cs.count} · {inr(cs.rentTotal)}
              </button>
            ))}
          </div>
        )}
      </section>

      <div className="r-card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <Input placeholder="Search Driver ID, Name, Phone, City…" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 w-full sm:max-w-sm" data-testid="drivers-search" />
          <Select value={city} onValueChange={setCity}>
            <SelectTrigger className="h-9 w-full w425:w-[calc(50%-4px)] sm:w-[160px]" data-testid="drivers-filter-city">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All cities</SelectItem>
              {cities.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table w-full min-w-[900px] whitespace-nowrap" data-testid="drivers-table">
            <thead>
              <tr>
                <SortTh label="DRIVER ID" k="driver_code" sort={sort} onSort={setSort} />
                <SortTh label="DRIVER NAME" k="name" sort={sort} onSort={setSort} />
                <SortTh label="PHONE NUMBER" k="mobile" sort={sort} onSort={setSort} />
                <SortTh label="CITY" k="city" sort={sort} onSort={setSort} />
                <SortTh label="JOINING DATE" k="joining_date" sort={sort} onSort={setSort} />
                <SortTh label="RENT" k="daily_rent" sort={sort} onSort={setSort} />
                <th></th>
              </tr>
            </thead>
            <tbody>
              {paged.slice.map((d) => (
                <tr key={d.id} data-testid={`driver-row-${d.id}`} onClick={() => setEdit(d)} className="cursor-pointer">
                  <td className="font-mono text-xs font-semibold">{d.driver_code}</td>
                  <td className="font-medium">{d.name}</td>
                  <td className="font-mono text-xs">{d.mobile}</td>
                  <td>{d.city}</td>
                  <td className="font-mono text-xs">{d.joining_date || "—"}</td>
                  <td className="font-semibold">{inr(d.daily_rent)}</td>
                  <td className="whitespace-nowrap text-right">
                    <Button size="icon" variant="ghost" className="h-8 w-8" title="Open calendar" onClick={(e) => { e.stopPropagation(); nav(`/calendar?driver=${d.id}`); }} data-testid={`driver-calendar-${d.id}`}>
                      <CalendarDays className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8" title="Change vehicle" onClick={(e) => { e.stopPropagation(); setVeh(d); }} data-testid={`driver-vehicle-${d.id}`}>
                      <ArrowLeftRight className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8" title="Adjustments" onClick={(e) => { e.stopPropagation(); setAdj(d); }} data-testid={`driver-adjust-${d.id}`}>
                      <SlidersHorizontal className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8" title="Edit" onClick={(e) => { e.stopPropagation(); setEdit(d); }} data-testid={`driver-edit-${d.id}`}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-[#94A3B8] hover:text-[#DC2626]" title="Delete driver" onClick={(e) => { e.stopPropagation(); setToDelete(d); }} data-testid={`driver-delete-${d.id}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
              {!paged.slice.length && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted-foreground">No drivers found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pager page={paged.page} pageSize={paged.size} total={paged.total} onPage={paged.setPage} testId="drivers-pager" />
      </div>
      <DriverFormDialog open={edit !== undefined} onOpenChange={(o) => !o && setEdit(undefined)} driver={edit} onSaved={load} />
      <AdjustmentsDialog open={!!adj} onOpenChange={(o) => !o && setAdj(null)} driver={adj} onSaved={load} />
      <VehicleAssignDialog open={!!veh} onOpenChange={(o) => !o && setVeh(null)} driver={veh} onSaved={load} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} defaultMode="drivers" onImported={load} />
      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent data-testid="driver-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Driver</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete driver <span className="font-semibold text-foreground">{toDelete?.name}</span> ({toDelete?.driver_code})? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[#DC2626] hover:bg-[#B91C1C]"
              onClick={async () => {
                try {
                  await api.delete(`/drivers/${toDelete.id}`);
                  toast.success(`Driver ${toDelete.name} deleted`);
                  setToDelete(null);
                  load();
                } catch (e) {
                  toast.error(errMsg(e));
                }
              }}
              data-testid="confirm-driver-delete"
            >
              Delete driver
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
