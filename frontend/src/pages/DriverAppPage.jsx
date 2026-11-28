import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, X, MapPin, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useUser } from "@/context/UserContext";
import { api, errMsg } from "@/lib/api";
import { fmtDate, fmtDateTime, todayIso } from "@/lib/format";
import { PageHeader, DateStepper, EmptyState } from "@/components/kit";

const BACKEND = process.env.REACT_APP_BACKEND_URL || "";
const PILL = {
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-rose-50 text-rose-700 border-rose-200",
};
const tm = (iso) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—");

const WeekOffTab = () => {
  const [status, setStatus] = useState("pending");
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState("");
  const load = useCallback(() => {
    api.get("/week-off-requests", { params: { status } }).then((r) => setRows(r.data)).catch((e) => toast.error(errMsg(e)));
  }, [status]);
  useEffect(() => { load(); }, [load]);
  const act = async (r, what) => {
    setBusy(r.id + what);
    try {
      await api.post(`/week-off-requests/${r.id}/${what}`);
      toast.success(what === "approve" ? "Week-off approved" : "Week-off rejected");
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {["pending", "approved", "rejected", "all"].map((s) => (
          <Button key={s} size="sm" variant={status === s ? "default" : "outline"} onClick={() => setStatus(s)} className="capitalize" data-testid={`wo-filter-${s}`}>{s}</Button>
        ))}
        <Button size="sm" variant="ghost" onClick={load}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Refresh</Button>
      </div>
      {!rows.length ? <EmptyState title="No week-off requests" /> : (
        <div className="r-card overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-[#F8FAFC] text-left text-[11px] uppercase tracking-wide text-[#64748B]">
              <tr><th className="px-3 py-2">Driver</th><th className="px-3 py-2">City</th><th className="px-3 py-2">Dates</th><th className="px-3 py-2">Applied</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Action</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t" data-testid={`wo-row-${r.id}`}>
                  <td className="px-3 py-2"><div className="font-medium">{r.driver_name}</div><div className="font-mono text-[11px] text-[#64748B]">{r.driver_code}</div></td>
                  <td className="px-3 py-2">{r.city || "—"}</td>
                  <td className="px-3 py-2">{(r.dates || []).map(fmtDate).join(", ")}</td>
                  <td className="px-3 py-2 text-[#64748B]">{fmtDateTime(r.created_at)}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize ${PILL[r.status] || ""}`}>{r.status}</span>
                    {r.decided_by_name && <div className="mt-0.5 text-[11px] text-[#64748B]">by {r.decided_by_name}</div>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {r.status === "pending" && (
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" className="h-8 bg-emerald-600 hover:bg-emerald-700" disabled={!!busy} onClick={() => act(r, "approve")} data-testid={`wo-approve-${r.id}`}><Check className="mr-1 h-3.5 w-3.5" />Approve</Button>
                        <Button size="sm" variant="outline" className="h-8 border-rose-300 text-rose-700" disabled={!!busy} onClick={() => act(r, "reject")} data-testid={`wo-reject-${r.id}`}><X className="mr-1 h-3.5 w-3.5" />Reject</Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const AttendanceTab = () => {
  const [day, setDay] = useState(todayIso());
  const [rows, setRows] = useState([]);
  const [photo, setPhoto] = useState(null);
  const load = useCallback(() => {
    api.get("/driver-attendance", { params: { date: day } }).then((r) => setRows(r.data)).catch((e) => toast.error(errMsg(e)));
  }, [day]);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <DateStepper value={day} onChange={setDay} />
        <span className="text-[13px] text-[#64748B]">{rows.length} checked in</span>
      </div>
      {!rows.length ? <EmptyState title="No driver checked in on this day" /> : (
        <div className="r-card overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-[#F8FAFC] text-left text-[11px] uppercase tracking-wide text-[#64748B]">
              <tr><th className="px-3 py-2">Selfie</th><th className="px-3 py-2">Driver</th><th className="px-3 py-2">City</th><th className="px-3 py-2">In</th><th className="px-3 py-2">Out</th><th className="px-3 py-2">Hours</th><th className="px-3 py-2">Location</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t" data-testid={`att-row-${r.id}`}>
                  <td className="px-3 py-2">
                    <img src={`${BACKEND}${r.selfie_url}`} alt="selfie" className="h-10 w-10 cursor-pointer rounded-md object-cover" onClick={() => setPhoto(r)} />
                  </td>
                  <td className="px-3 py-2"><div className="font-medium">{r.driver_name}</div><div className="font-mono text-[11px] text-[#64748B]">{r.driver_code} · {r.driver_phone}</div></td>
                  <td className="px-3 py-2">{r.city || "—"}</td>
                  <td className="px-3 py-2">{tm(r.check_in)}</td>
                  <td className="px-3 py-2">{tm(r.check_out)}</td>
                  <td className="px-3 py-2">{r.check_out ? `${r.hours} h` : <span className="text-emerald-700">Working</span>}</td>
                  <td className="max-w-[320px] px-3 py-2">
                    {r.check_in_lat != null && (
                      <a href={`https://www.google.com/maps?q=${r.check_in_lat},${r.check_in_lng}`} target="_blank" rel="noreferrer" className="inline-flex items-start gap-1 text-[12px] text-[#2563EB] hover:underline">
                        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="line-clamp-2">{r.check_in_address || `${r.check_in_lat}, ${r.check_in_lng}`}</span>
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={!!photo} onOpenChange={(o) => !o && setPhoto(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader><DialogTitle>{photo?.driver_name} · {photo && fmtDate(photo.date)}</DialogTitle></DialogHeader>
          {photo && <img src={`${BACKEND}${photo.selfie_url}`} alt="selfie" className="w-full rounded-md" />}
        </DialogContent>
      </Dialog>
    </div>
  );
};

const ConfirmDialog = ({ open, title, text, action, onCancel, onConfirm }) => (
  <AlertDialog open={open} onOpenChange={(o) => !o && onCancel()}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{text}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction className="bg-red-600 text-white hover:bg-red-700" onClick={onConfirm}>{action}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);


const DeletionTab = () => {
  const { hasRole } = useUser();
  const [rows, setRows] = useState([]);
  const [confirm, setConfirm] = useState(null);
  const load = useCallback(() => {
    api.get("/account-deletion-requests").then((r) => setRows(r.data)).catch((e) => toast.error(errMsg(e)));
  }, []);
  useEffect(() => { load(); }, [load]);
  const run = async () => {
    const { row, kind } = confirm;
    setConfirm(null);
    try {
      if (kind === "reject") await api.post(`/drivers/${row.id}/account-deletion/reject`);
      else await api.delete(`/drivers/${row.id}`);
      toast.success(kind === "reject" ? "Request rejected" : "Driver deleted");
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <div className="space-y-3">
      {!rows.length ? <EmptyState title="No account deletion requests" /> : (
        <div className="r-card overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-[#F8FAFC] text-left text-[11px] uppercase tracking-wide text-[#64748B]">
              <tr><th className="px-3 py-2">Driver</th><th className="px-3 py-2">Mobile</th><th className="px-3 py-2">City</th><th className="px-3 py-2">Requested</th><th className="px-3 py-2 text-right">Action</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2"><div className="font-medium">{r.name}</div><div className="font-mono text-[11px] text-[#64748B]">{r.driver_code}</div></td>
                  <td className="px-3 py-2">{r.mobile}</td>
                  <td className="px-3 py-2">{r.city || "—"}</td>
                  <td className="px-3 py-2 text-[#64748B]">{fmtDateTime(r.requested_at)}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" variant="outline" className="h-8" onClick={() => setConfirm({ row: r, kind: "reject" })}>Reject request</Button>
                      {hasRole("admin") && (
                        <Button size="sm" variant="outline" className="h-8 border-rose-300 text-rose-700" onClick={() => setConfirm({ row: r, kind: "delete" })}><Trash2 className="mr-1 h-3.5 w-3.5" />Delete driver</Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog open={!!confirm}
        title={confirm?.kind === "delete" ? "Delete this driver?" : "Reject this request?"}
        action={confirm?.kind === "delete" ? "Delete driver" : "Reject"}
        text={confirm ? (confirm.kind === "delete"
          ? `${confirm.row.name} (${confirm.row.driver_code}) and all their payments will be permanently deleted.`
          : `${confirm.row.name}'s account stays active and the request is cleared.`) : ""}
        onCancel={() => setConfirm(null)} onConfirm={run} />
    </div>
  );
};

export default function DriverAppPage() {
  return (
    <div>
      <PageHeader title="Driver App" subtitle="Week-off, attendance and account deletion requests" />
      <Tabs defaultValue="weekoff">
        <TabsList className="mb-3">
          <TabsTrigger value="weekoff" data-testid="tab-weekoff">Week-off Requests</TabsTrigger>
          <TabsTrigger value="attendance" data-testid="tab-attendance">Attendance</TabsTrigger>
          <TabsTrigger value="deletion" data-testid="tab-deletion">Deletion Requests</TabsTrigger>
        </TabsList>
        <TabsContent value="weekoff"><WeekOffTab /></TabsContent>
        <TabsContent value="attendance"><AttendanceTab /></TabsContent>
        <TabsContent value="deletion"><DeletionTab /></TabsContent>
      </Tabs>
    </div>
  );
}
