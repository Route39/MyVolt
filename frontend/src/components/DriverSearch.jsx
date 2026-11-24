import { useEffect, useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { api } from "@/lib/api";

export const DriverSearch = ({ value, onSelect, compact, placeholder = "Search driver by name, mobile, Driver ID, Vehicle or City", testId = "driver-search" }) => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [items, setItems] = useState([]);

  useEffect(() => {
    const t = setTimeout(() => {
      api.get("/drivers", { params: { q } }).then((r) => setItems(r.data)).catch(() => setItems([]));
    }, 180);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          data-testid={`${testId}-trigger`}
          className={`flex ${compact ? "h-9 bg-[#F1F5F9]/80 border-[#E2E8F0] hover:bg-white hover:border-[#CBD5E1]" : "h-11 bg-white border"} w-full items-center gap-2 rounded-lg border px-3 text-left text-[13px] transition-all focus:outline-none focus:ring-2 focus:ring-[#EF4444]/20`}
        >
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          {value ? (
            <span className="truncate">
              <span className="font-medium">{value.name}</span>
              <span className="text-muted-foreground"> · {value.driver_code} · {value.current_vehicle_id || "No vehicle"}</span>
            </span>
          ) : (
            <span className="truncate text-muted-foreground">{placeholder}</span>
          )}
          {compact ? (
            <kbd className="ml-auto hidden rounded border border-gray-200 bg-white/80 px-1.5 py-0.5 text-[10px] font-medium text-gray-400 sm:inline-block">⌘K</kbd>
          ) : (
            <ChevronsUpDown className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[300px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput data-testid={`${testId}-input`} placeholder="Name, mobile, Driver ID, Vehicle ID or reg. no.…" value={q} onValueChange={setQ} />
          <CommandList>
            <CommandEmpty>No drivers found.</CommandEmpty>
            <CommandGroup>
              {items.map((d) => (
                <CommandItem
                  key={d.id}
                  value={d.id}
                  data-testid={`${testId}-option-${d.id}`}
                  onSelect={() => {
                    onSelect(d);
                    setOpen(false);
                  }}
                  className="flex items-center gap-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{d.name}</div>
                    <div className="truncate font-mono text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">{d.driver_code}</span> · {d.current_vehicle_id || "No vehicle"}{d.vehicle_no ? ` (${d.vehicle_no})` : ""} · {d.mobile}
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">{d.city}</span>
                  {value?.id === d.id && <Check className="h-4 w-4 text-[var(--r39-green)]" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
