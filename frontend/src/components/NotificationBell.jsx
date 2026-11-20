import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";

export const NotificationBell = () => {
  const [data, setData] = useState({ items: [], unread: 0 });
  const [open, setOpen] = useState(false);
  const nav = useNavigate();

  const load = useCallback(() => {
    api.get("/notifications").then((r) => setData(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const openItem = async (n) => {
    await api.post(`/notifications/${n.id}/read`);
    setOpen(false);
    load();
    nav(`/calendar?driver=${n.driver_id}&month=${n.payment_date.slice(0, 7)}`);
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) load(); }}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-9 w-9" data-testid="notification-bell">
          <Bell className="h-4 w-4" />
          {data.unread > 0 && (
            <span data-testid="notification-unread-count" className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-[oklch(0.56_0.19_25)] px-1 text-[10px] font-semibold text-white">
              {data.unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] p-0" data-testid="notification-panel">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          {data.unread > 0 && (
            <button className="text-xs text-[var(--r39-green-text)] hover:underline" data-testid="notification-read-all"
              onClick={async () => { await api.post("/notifications/read-all"); load(); }}>Mark all read</button>
          )}
        </div>
        <div className="max-h-[360px] overflow-y-auto">
          {data.items.map((n) => (
            <button key={n.id} onClick={() => openItem(n)} data-testid={`notification-item-${n.id}`}
              className={`block w-full border-b px-3 py-2.5 text-left text-[13px] transition-colors hover:bg-muted ${n.read ? "text-muted-foreground" : ""}`}>
              <div className="flex gap-2">
                {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[oklch(0.56_0.19_25)]" />}
                <div>
                  <div>{n.message}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">{fmtDateTime(n.created_at)}</div>
                </div>
              </div>
            </button>
          ))}
          {!data.items.length && <div className="p-6 text-center text-sm text-muted-foreground">No notifications</div>}
        </div>
      </PopoverContent>
    </Popover>
  );
};
