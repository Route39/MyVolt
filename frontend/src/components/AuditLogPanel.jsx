import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";

export const AuditLogPanel = () => {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState([]);
  useEffect(() => {
    const t = setTimeout(() => api.get("/audit-logs", { params: { q } }).then((r) => setRows(r.data)), 200);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="space-y-3">
      <Input placeholder="Search by user, transaction/driver ID or value" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 max-w-md" data-testid="audit-search" />
      <div className="max-h-[70vh] overflow-auto rounded-lg border">
        <table className="data-table w-full" data-testid="audit-table">
          <thead className="sticky top-0"><tr><th>Date & time</th><th>User</th><th>Action</th><th>Record</th><th>Previous value</th><th>New value</th></tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td>{fmtDateTime(a.ts)}</td>
                <td>{a.user_name}</td>
                <td className="font-medium">{a.action}</td>
                <td className="font-mono text-xs">{a.entity_id}</td>
                <td className="max-w-[220px] truncate text-muted-foreground" title={a.prev}>{a.prev || "—"}</td>
                <td className="max-w-[260px] truncate" title={a.new}>{a.new || "—"}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">No audit records</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};
