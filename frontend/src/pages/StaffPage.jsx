import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUser } from "@/context/UserContext";
import { api, errMsg } from "@/lib/api";
import { ROLE_LABEL } from "@/lib/format";
import { PageHeader, Pager, usePaged } from "@/components/kit";

const EMPTY = { name: "", email: "", role: "staff", active: true };

const UserDialog = ({ open, onOpenChange, user, onSaved }) => {
  const [f, setF] = useState(EMPTY);
  useEffect(() => {
    if (open) setF(user ? { name: user.name, email: user.email, role: user.role, active: user.active } : EMPTY);
  }, [open, user]);
  const save = async (e) => {
    e.preventDefault();
    try {
      if (user) await api.put(`/users/${user.id}`, f);
      else await api.post("/users", f);
      toast.success(user ? "User updated" : "User added");
      onOpenChange(false);
      onSaved();
    } catch (e2) {
      toast.error(errMsg(e2));
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]" data-testid="user-form-dialog">
        <DialogHeader><DialogTitle>{user ? "Edit user" : "Add user"}</DialogTitle><DialogDescription>Staff enter payments; Accounts verify them.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="space-y-3">
          <div className="space-y-1"><Label className="text-xs">Name</Label><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="user-form-name" /></div>
          <div className="space-y-1"><Label className="text-xs">Email</Label><Input type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} data-testid="user-form-email" /></div>
          <div className="space-y-1"><Label className="text-xs">Role</Label>
            <Select value={f.role} onValueChange={(v) => setF({ ...f, role: v })}>
              <SelectTrigger data-testid="user-form-role"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(ROLE_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm"><Switch checked={f.active} onCheckedChange={(v) => setF({ ...f, active: v })} data-testid="user-form-active" />Active</label>
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" data-testid="user-form-save">Save</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default function StaffPage() {
  const { reloadUsers } = useUser();
  const [rows, setRows] = useState([]);
  const [edit, setEdit] = useState(undefined);
  const load = useCallback(() => api.get("/users").then((r) => setRows(r.data)), []);
  useEffect(() => { load(); }, [load]);
  const [role, setRole] = useState("all");
  const [q, setQ] = useState("");
  const filtered = rows.filter((u) => (role === "all" || u.role === role) && `${u.name} ${u.email}`.toLowerCase().includes(q.toLowerCase()));
  const paged = usePaged(filtered, 25, [role, q]);
  return (
    <div className="space-y-4 fade-up">
      <PageHeader title="Staff Management" subtitle="Staff enter payments, Accounts verify them, Admins manage everything"
        actions={<Button onClick={() => setEdit(null)} data-testid="add-user-button"><Plus className="mr-1.5 h-4 w-4" />Add user</Button>} />
      <div className="r-card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <Input placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 max-w-xs" data-testid="users-search" />
        <Select value={role} onValueChange={setRole}><SelectTrigger className="h-9 w-[150px]" data-testid="users-filter-role"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All roles</SelectItem>{Object.entries(ROLE_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select>
      </div>
      <div className="overflow-x-auto">
        <table className="data-table w-full" data-testid="users-table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {paged.slice.map((u) => (
              <tr key={u.id} data-testid={`user-row-${u.id}`}>
                <td className="font-medium">{u.name}</td>
                <td>{u.email}</td>
                <td>{ROLE_LABEL[u.role]}</td>
                <td><span className={`${u.active ? "st-verified" : "st-none"} st-pill rounded-full px-2 py-0.5 text-[11px]`}>{u.active ? "Active" : "Inactive"}</span></td>
                <td className="text-right"><Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEdit(u)} data-testid={`user-edit-${u.id}`}><Pencil className="h-4 w-4" /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={paged.page} pageSize={paged.size} total={paged.total} onPage={paged.setPage} testId="users-pager" />
      </div>
      <UserDialog open={edit !== undefined} onOpenChange={(o) => !o && setEdit(undefined)} user={edit} onSaved={() => { load(); reloadUsers(); }} />
    </div>
  );
}
