import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";
import { DateField } from "@/components/kit";

export const EMPTY_FILTERS = { driver_name: "", vehicle: "", utr: "", payment_date: "", date_from: "", date_to: "", city: "all", staff_id: "all", status: "all" };

export const toParams = (f) =>
  Object.fromEntries(Object.entries(f).filter(([, v]) => v && v !== "all"));

export const TxnFilters = ({ value, onChange, showStatus, range }) => {
  const [staff, setStaff] = useState([]);
  const [cities, setCities] = useState([]);
  useEffect(() => {
    api.get("/users/staff").then((r) => setStaff(r.data));
    api.get("/drivers").then((r) => setCities([...new Set(r.data.map((d) => d.city))].sort()));
  }, []);
  const set = (k) => (v) => onChange({ ...value, [k]: v?.target ? v.target.value : v ?? "" });
  const dirty = Object.entries(value).some(([k, v]) => v !== EMPTY_FILTERS[k]);
  return (
    <div className="grid grid-cols-1 gap-2 w375:grid-cols-2 md:grid-cols-4 w1600:grid-cols-7" data-testid="txn-filters">
      <Input placeholder="Driver name" value={value.driver_name} onChange={set("driver_name")} className="h-9" data-testid="filter-driver-name" />
      <Input placeholder="Vehicle ID / reg. no." value={value.vehicle} onChange={set("vehicle")} className="h-9" data-testid="filter-vehicle" />
      <Input placeholder="UTR" value={value.utr} onChange={set("utr")} className="h-9 font-mono" data-testid="filter-utr" />
      {range ? (
        <div className="col-span-1 flex gap-2 w375:col-span-2 md:col-span-1">
          <DateField value={value.date_from} onChange={set("date_from")} placeholder="From" testId="filter-date-from" className="flex-1" />
          <DateField value={value.date_to} onChange={set("date_to")} placeholder="To" testId="filter-date-to" className="flex-1" />
        </div>
      ) : (
        <DateField value={value.payment_date} onChange={set("payment_date")} placeholder="Payment date" testId="filter-payment-date" />
      )}
      <Select value={value.city} onValueChange={set("city")}>
        <SelectTrigger className="h-9" data-testid="filter-city"><SelectValue placeholder="City" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All cities</SelectItem>
          {cities.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={value.staff_id} onValueChange={set("staff_id")}>
        <SelectTrigger className="h-9" data-testid="filter-staff"><SelectValue placeholder="Staff" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All staff</SelectItem>
          {staff.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <div className="flex gap-2">
        {showStatus && (
          <Select value={value.status} onValueChange={set("status")}>
            <SelectTrigger className="h-9" data-testid="filter-status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Verified</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
        )}
        {dirty && (
          <Button variant="ghost" size="sm" className="h-9" onClick={() => onChange(EMPTY_FILTERS)} data-testid="filter-clear">
            <X className="mr-1 h-4 w-4" />Clear
          </Button>
        )}
      </div>
    </div>
  );
};
