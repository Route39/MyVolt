import { PageHeader } from "@/components/kit";
import { CalendarLegend } from "@/components/RentCalendar";

const STEPS = [
  ["Staff", "Open Rent Calendar, search the driver, click the date, enter amount, UTR and vehicle, upload the screenshot and submit. The date turns amber (pending)."],
  ["Accounts", "Open Accounts Verification, open a pending payment, check the screenshot against the UTR, then approve or reject with a reason."],
  ["Rejected payments", "The staff member gets a notification and uses Correct & Resubmit on the red date. It goes back to Accounts."],
  ["Vehicles", "Use Change on the driver card when a driver switches vehicles. Old payments keep the vehicle recorded at entry."],
  ["Corrections", "Approved payments can only be changed by an Admin with a reason. Every change is in the audit log."],
];

export default function HelpPage() {
  return (
    <div className="max-w-3xl space-y-4 fade-up">
      <PageHeader title="Help" subtitle="How the MyVolt Route39 fleet rent workflow works" />
      <section className="r-card divide-y" data-testid="help-steps">
        {STEPS.map(([t, d], i) => (
          <div key={t} className="flex gap-3 p-3 sm:p-4">
            <div className="fig grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#FEF2F2] text-xs text-[#B91C1C]">{i + 1}</div>
            <div><div className="text-[13px] font-semibold">{t}</div><div className="text-[13px] text-[#64748B]">{d}</div></div>
          </div>
        ))}
      </section>
      <section className="r-card p-4"><div className="r-label mb-3">Calendar status colours</div><CalendarLegend /></section>
    </div>
  );
}
