import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errMsg } from "@/lib/api";
import { fmtDateTime, getCityPrefix, getCityDisplayName } from "@/lib/format";

export const NOT_RECORDED = "Vehicle ID not recorded";

export const useVehicles = (open = true) => {
  const [vehicles, setVehicles] = useState([]);
  useEffect(() => {
    if (open) api.get("/vehicles").then((r) => setVehicles(r.data));
  }, [open]);
  return vehicles;
};

export const VehicleSelect = ({
  vehicles = [],
  value,
  onChange,
  testId,
  placeholder = "Select vehicle",
  allowNone = false,
  driver = null,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  // Determine driver city and prefix
  const driverCityPrefix = getCityPrefix(driver?.city) || getCityPrefix(driver?.driver_code);
  const cityDisplayName = getCityDisplayName(driver?.city || driver?.driver_code);

  // 1. Strict city filtering: only show vehicles matching driver's city prefix,
  // or currently assigned / selected vehicle so recorded data is never broken.
  const cityVehicles = vehicles.filter((v) => {
    if (value && v.vehicle_id === value) return true;
    if (driver?.current_vehicle_id && v.vehicle_id === driver.current_vehicle_id) return true;
    if (!driverCityPrefix) return true;
    const vPrefix = getCityPrefix(v.city) || getCityPrefix(v.vehicle_id);
    return vPrefix === driverCityPrefix;
  });

  // Current selected vehicle object
  const selected = vehicles.find((v) => v.vehicle_id === value) || (value ? { vehicle_id: value, reg_no: "" } : null);

  // When searching, match vehicle_id, reg_no, or vin
  const cleanQ = query.trim().toLowerCase().replace(/[\s-]/g, "");
  const filtered = cleanQ
    ? cityVehicles.filter((v) => {
        const idClean = (v.vehicle_id || "").toLowerCase().replace(/[\s-]/g, "");
        const regClean = (v.reg_no || "").toLowerCase().replace(/[\s-]/g, "");
        const vinClean = (v.vin || "").toLowerCase().replace(/[\s-]/g, "");
        return idClean.includes(cleanQ) || regClean.includes(cleanQ) || vinClean.includes(cleanQ);
      })
    : [];

  const handleSelect = (vid) => {
    onChange(vid);
    setOpen(false);
    setQuery("");
  };

  const handleClear = (e) => {
    e.stopPropagation();
    onChange(null);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={testId}
          className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-xs shadow-sm ring-offset-background transition-colors hover:border-[var(--r39-green)] focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 text-left"
        >
          {selected ? (
            <span className="truncate">
              <span className="font-mono font-semibold text-foreground">{selected.vehicle_id}</span>
              {selected.reg_no && <span className="font-mono text-muted-foreground"> · {selected.reg_no}</span>}
              {selected.city && (
                <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {selected.city}
                </span>
              )}
            </span>
          ) : (
            <span className="truncate text-muted-foreground">{placeholder}</span>
          )}
          <div className="flex items-center gap-1.5 shrink-0 ml-2">
            {value && (
              <span
                role="button"
                tabIndex={0}
                onClick={handleClear}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                title="Clear vehicle"
              >
                <X className="h-3.5 w-3.5" />
              </span>
            )}
            <ChevronsUpDown className="h-4 w-4 text-muted-foreground opacity-50" />
          </div>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[340px] p-0" align="start">
        <div className="flex items-center border-b px-3">
          <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <input
            data-testid={`${testId}-input`}
            className="flex h-10 w-full rounded-md bg-transparent py-2 text-xs outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            placeholder={`Type vehicle ID or reg. no. ${cityDisplayName ? `(${cityDisplayName})` : ""}…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="text-muted-foreground hover:text-foreground p-1"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="max-h-[260px] overflow-y-auto p-1 text-xs">
          {allowNone && (
            <button
              type="button"
              data-testid={`${testId}-option-none`}
              onClick={() => handleSelect(null)}
              className="flex w-full items-center justify-between rounded px-2.5 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent"
            >
              <span>No vehicle</span>
              {!value && <Check className="h-3.5 w-3.5 text-[var(--r39-green)]" />}
            </button>
          )}

          {!cleanQ ? (
            <div className="p-4 text-center text-xs text-muted-foreground">
              Type vehicle ID or registration number to search…
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-4 text-center text-xs text-muted-foreground">
              No matching vehicles found {cityDisplayName ? `in ${cityDisplayName}` : ""} {query ? `for "${query}"` : ""}.
            </div>
          ) : (
            filtered.map((v) => (
              <button
                key={v.vehicle_id}
                type="button"
                data-testid={`${testId}-option-${v.vehicle_id}`}
                onClick={() => handleSelect(v.vehicle_id)}
                className={`flex w-full items-center justify-between rounded-sm px-2.5 py-2 text-left text-xs transition-colors hover:bg-accent ${
                  value === v.vehicle_id ? "bg-accent/60 font-medium" : ""
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <span className="font-mono font-semibold text-foreground">{v.vehicle_id}</span>
                  <span className="font-mono text-muted-foreground">· {v.reg_no}</span>
                  {v.city && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {v.city}
                    </span>
                  )}
                  {v.status !== "Active" && (
                    <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                      {v.status}
                    </span>
                  )}
                  {v.current_driver && (
                    <span className="truncate text-xs text-muted-foreground">
                      · {v.current_driver.name}
                    </span>
                  )}
                </div>
                {value === v.vehicle_id && <Check className="h-3.5 w-3.5 text-[var(--r39-green)]" />}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export const VehicleAssignDialog = ({ open, onOpenChange, driver, onSaved }) => {
  const all = useVehicles(open);
  const [vid, setVid] = useState(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) { setVid(null); setReason(""); }
  }, [open]);
  const options = all.filter((v) => v.status !== "Inactive" && v.vehicle_id !== driver?.current_vehicle_id && (!v.current_driver || v.current_driver.id === driver?.id));
  const save = async () => {
    setBusy(true);
    try {
      await api.post(`/drivers/${driver.id}/assign-vehicle`, { vehicle_id: vid, reason });
      toast.success(vid ? `Vehicle changed to ${vid}` : "Vehicle unassigned");
      onOpenChange(false);
      onSaved?.();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]" data-testid="vehicle-assign-dialog">
        <DialogHeader>
          <DialogTitle>Change vehicle · {driver?.name}</DialogTitle>
          <DialogDescription>Current: {driver?.current_vehicle_id || "none"}{driver?.vehicle_no ? ` (${driver.vehicle_no})` : ""}. Past payments keep their recorded vehicle.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label className="text-xs">New vehicle (free vehicles only)</Label>
            <VehicleSelect vehicles={options} driver={driver} value={vid} onChange={setVid} testId="assign-vehicle-select" allowNone />
          </div>
          <div className="space-y-1"><Label className="text-xs">Reason (optional)</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Old vehicle sent for service" data-testid="assign-vehicle-reason" />
          </div>
        </div>
        <div className="flex flex-col-reverse gap-2 w425:flex-row w425:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy || (vid === null && !driver?.current_vehicle_id)} onClick={save} data-testid="assign-vehicle-save">Save change</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export const AssignmentHistory = ({ items }) => (
  <section>
    <h3 className="mb-2 text-sm font-semibold">Vehicle assignment history</h3>
    <div className="overflow-x-auto rounded-lg border bg-white">
      <table className="data-table w-full min-w-[720px] whitespace-nowrap" data-testid="assignment-history-table">
        <thead><tr><th>Vehicle ID</th><th>Registration</th><th>Start</th><th>End</th><th>Changed by</th><th>Reason</th></tr></thead>
        <tbody>
          {items.map((a) => (
            <tr key={a.id}>
              <td className="font-mono text-xs font-semibold">{a.vehicle_id}</td>
              <td className="font-mono text-xs">{a.reg_no}</td>
              <td>{fmtDateTime(a.start_at)}</td>
              <td>{a.end_at ? fmtDateTime(a.end_at) : <span className="text-[var(--r39-green-text)]">Current</span>}</td>
              <td>{a.changed_by_name}</td>
              <td className="max-w-[240px] truncate" title={a.reason}>{a.reason || "—"}</td>
            </tr>
          ))}
          {!items.length && <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">No vehicle assigned yet</td></tr>}
        </tbody>
      </table>
    </div>
  </section>
);
