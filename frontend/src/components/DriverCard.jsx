import { ArrowLeftRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmtDate, inr } from "@/lib/format";

const Field = ({ label, value, mono, testId }) => (
  <div className="min-w-0">
    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
    <div data-testid={testId} className={`truncate text-sm font-medium ${mono ? "font-mono" : ""}`}>{value}</div>
  </div>
);

const statusCls = { Active: "st-verified", Suspended: "st-rejected", Inactive: "st-none" };

export const DriverCard = ({ driver, onChangeVehicle }) => (
  <section data-testid="driver-info-card" className="r-card p-4 fade-up">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 data-testid="driver-card-name" className="truncate text-lg font-semibold tracking-tight">{driver.name}</h2>
        <div className="font-mono text-xs font-semibold text-[var(--r39-green-text)]" data-testid="driver-card-code">{driver.driver_code}</div>
      </div>
      <span className={`${statusCls[driver.status] || "st-none"} st-pill rounded-full px-2 py-0.5 text-[11px] font-medium`} data-testid="driver-card-status">
        {driver.status}
      </span>
    </div>
    <div className="mt-3 flex items-center gap-3 rounded-md border border-[#E5E7EB] bg-[#F8FAFB] px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Current vehicle</div>
        <div className="font-mono text-sm">
          <div className="font-semibold" data-testid="driver-card-vehicle-id">{driver.current_vehicle_id || "None assigned"}</div>
          {driver.vehicle_no && <div className="break-all text-xs text-muted-foreground" data-testid="driver-card-vehicle">{driver.vehicle_no}</div>}
        </div>
      </div>
      {onChangeVehicle && (
        <Button size="sm" variant="outline" onClick={onChangeVehicle} data-testid="driver-change-vehicle-button">
          <ArrowLeftRight className="mr-1.5 h-3.5 w-3.5" />Change
        </Button>
      )}
    </div>
    <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
      <Field label="Mobile" value={driver.mobile} mono testId="driver-card-mobile" />
      <Field label="City" value={driver.city} testId="driver-card-city" />
      <Field label="Daily rent" value={inr(driver.daily_rent)} testId="driver-card-rent" />
      <Field label="Joining date" value={fmtDate(driver.joining_date)} testId="driver-card-joining" />
      <Field label="Vehicle handover" value={fmtDate(driver.handover_date)} testId="driver-card-handover" />
      <Field label="Rent starts" value={fmtDate(driver.rent_start_date)} testId="driver-card-rent-start" />
      <Field label="Rent-free days" value={(driver.rent_free_dates || []).length} testId="driver-card-rent-free" />
    </div>
  </section>
);
