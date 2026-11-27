import csv
import io
import re
from datetime import date, datetime, timedelta
from typing import Any, Callable, Optional

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation


HEADERS = [
    "DATE",
    "DAY",
    "DRIVER ID",
    "DRIVER NAME",
    "CITY",
    "DAILY RENT",
    "CURRENT STATUS",
    "ACTION",
    "AMOUNT",
    "UTR / REF NO.",
    "METHOD",
    "VEHICLE ID",
    "REMARKS / REASON",
]

ACTION_LABELS = {
    "paid": "Paid",
    "not_paid": "Not Paid",
    "week_off": "Week Off",
    "ev_issue_no_ride": "EV Issue (No Ride)",
    "ev_issue_replacement": "EV Issue (Replacement Given)",
    "other_issue": "Other Issue",
}

STATUS_FILLS = {
    "Not Paid": ("FEF2F2", "B91C1C"),
    "Verified": ("ECFDF5", "047857"),
    "Pending Verification": ("FEFCE8", "A16207"),
    "Partial": ("FFF7ED", "C2410C"),
    "Rejected": ("FFF1F2", "9F1239"),
    "Joined (No Rent)": ("F1F5F9", "475569"),
    "Week Off": ("F5F3FF", "6D28D9"),
    "EV Issue (No Ride)": ("EFF6FF", "1D4ED8"),
    "Other Issue": ("F8FAFC", "334155"),
    "Rent Free": ("F8FAFC", "64748B"),
    "Before Start": ("F4F6F8", "94A3B8"),
    "Future": ("F4F6F8", "94A3B8"),
}

THIN_BORDER = Border(
    left=Side(style="thin", color="E5E7EB"),
    right=Side(style="thin", color="E5E7EB"),
    top=Side(style="thin", color="E5E7EB"),
    bottom=Side(style="thin", color="E5E7EB"),
)


def normalize_action(raw: Any) -> str:
    s = re.sub(r"\s+", " ", str(raw or "").strip().lower())
    if not s or s in ("(skip / no action)", "skip", "no action"):
        return ""
    if s in ("paid", "payment", "rent", "yes", "collect", "collected"):
        return "paid"
    if s in ("not paid", "not_paid", "not-paid", "unpaid", "no payment"):
        return "not_paid"
    if s in ("week off", "weekoff", "week_off", "week-off", "wo", "off", "weekly off"):
        return "week_off"
    if s in (
        "ev issue (no ride)",
        "ev issue no ride",
        "ev_issue_no_ride",
        "ev issue",
        "ev_issue",
        "vehicle issue",
        "no ride",
        "ev issue - no ride",
    ):
        return "ev_issue_no_ride"
    if s in (
        "ev issue (replacement given)",
        "ev issue replacement given",
        "ev issue replacement",
        "ev_issue_replacement",
        "replacement",
        "replacement given",
        "replacement vehicle",
    ):
        return "ev_issue_replacement"
    if s in ("other issue", "other_issue", "other-issue", "other", "issue"):
        return "other_issue"
    return s


def parse_cell_date(val: Any) -> Optional[str]:
    if val is None or val == "":
        return None
    if isinstance(val, datetime):
        return val.date().isoformat()
    if isinstance(val, date):
        return val.isoformat()
    s = str(val).strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%Y/%m/%d", "%d %b %Y", "%d %B %Y"):
        try:
            return datetime.strptime(s[:20], fmt).date().isoformat()
        except ValueError:
            pass
    try:
        return date.fromisoformat(s[:10]).isoformat()
    except ValueError:
        return None


def _clean_utr_cell(val: Any) -> str:
    if val is None:
        return ""
    if isinstance(val, float) and val.is_integer():
        return str(int(val))
    if isinstance(val, int):
        return str(val)
    return str(val).strip().upper()


def _day_status_snapshot(drv: dict, ds: str, d_obj: date, day_txns: list[dict], today_dt: date, allow_future: bool, rent_start_fn: Callable[[dict], str]):
    rs = rent_start_fn(drv) or ""
    joining_str = drv.get("joining_date") or ""
    is_joining = bool(joining_str and ds == joining_str)
    active = [t for t in day_txns if t.get("status") != "rejected"]
    approved = sum(float(t.get("amount") or 0) for t in active if t.get("status") == "approved")
    ds_info = (drv.get("day_statuses") or {}).get(ds)
    free = set(drv.get("rent_free_dates") or [])

    if is_joining:
        status_label = "Joined (No Rent)" if not active else ("Verified" if approved else "Pending Verification")
    elif rs and ds < rs:
        status_label = "Before Start"
    elif any(t.get("status") == "pending" for t in active):
        status_label = "Pending Verification"
    elif approved > 0:
        status_label = "Verified" if approved >= float(drv.get("daily_rent") or 0) else "Partial"
    elif day_txns:
        status_label = "Rejected"
    elif ds_info and ds_info.get("no_ride"):
        status_label = ACTION_LABELS.get(
            "ev_issue_no_ride" if ds_info.get("type") == "ev_issue" else ds_info.get("type"),
            "Rent Free",
        )
    elif ds in free:
        status_label = "Rent Free"
    elif d_obj > today_dt and not allow_future:
        status_label = "Future"
    else:
        status_label = "Not Paid"

    action_val, amount_val, utr_val, method_val, remarks_val = "", None, "", "", ""
    veh_val = drv.get("current_vehicle_id") or ""
    if active:
        last_t = active[-1]
        action_val = (
            ACTION_LABELS["ev_issue_replacement"]
            if (ds_info and ds_info.get("type") == "ev_issue" and ds_info.get("replacement_given"))
            else ACTION_LABELS["paid"]
        )
        amount_val = round(sum(float(t.get("amount") or 0) for t in active), 2)
        utr_val = last_t.get("utr") or ""
        method_val = last_t.get("method") or "UPI"
        veh_val = last_t.get("vehicle_id") or veh_val
        remarks_val = last_t.get("remarks") or ""
    elif ds_info and ds_info.get("no_ride"):
        key = "ev_issue_no_ride" if ds_info.get("type") == "ev_issue" else ds_info.get("type")
        action_val = ACTION_LABELS.get(key, "")
        amount_val = 0
        remarks_val = ds_info.get("reason") or ""

    return status_label, action_val, amount_val, utr_val, method_val, veh_val, remarks_val


def matches_status_filter(st_label: str, status_filter: str = "all", only_unpaid: bool = False) -> bool:
    eff = "not_paid" if (only_unpaid and status_filter == "all") else status_filter
    if eff == "not_paid":
        return st_label in ("Not Paid", "Partial", "Rejected")
    if eff == "paid":
        return st_label in ("Verified", "Pending Verification")
    if eff == "issues":
        return st_label in ("Pending Verification", "Partial", "Rejected", "Week Off", "EV Issue (No Ride)", "Other Issue")
    return True


def effective_rent_start(drv: dict, rent_start_fn: Callable[[dict], str]) -> Optional[date]:
    join_raw = (drv.get("joining_date") or "").strip()
    rs_raw = (rent_start_fn(drv) or "").strip()
    join_next = (date.fromisoformat(join_raw[:10]) + timedelta(days=1)) if join_raw else None
    rs_dt = date.fromisoformat(rs_raw[:10]) if rs_raw else None
    if join_next and rs_dt:
        return max(join_next, rs_dt)
    return join_next or rs_dt


def build_driver_date_pairs(
    drivers: list[dict],
    date_list: list[date],
    group_by: str,
    rent_start_fn: Callable[[dict], str],
) -> tuple[list[dict], list[tuple[date, dict]]]:
    if group_by == "joining_date":
        sorted_drivers = sorted(
            drivers,
            key=lambda d: ((d.get("joining_date") or "9999-12-31"), (d.get("driver_code") or d.get("name") or "")),
        )
    else:
        sorted_drivers = sorted(drivers, key=lambda d: (d.get("driver_code") or d.get("name") or ""))

    eff_starts = {d["id"]: effective_rent_start(d, rent_start_fn) for d in sorted_drivers}
    if group_by == "date":
        pairs = [
            (d_obj, drv)
            for d_obj in date_list
            for drv in sorted_drivers
            if eff_starts[drv["id"]] is None or d_obj >= eff_starts[drv["id"]]
        ]
    else:
        pairs = [
            (d_obj, drv)
            for drv in sorted_drivers
            for d_obj in date_list
            if eff_starts[drv["id"]] is None or d_obj >= eff_starts[drv["id"]]
        ]
    return sorted_drivers, pairs


def build_monthly_workbook(
    title: str,
    drivers: list[dict],
    txns_by_driver_date: dict[tuple[str, str], list[dict]],
    year: int,
    month: int,
    today_dt: date,
    allow_future: bool,
    rent_start_fn: Callable[[dict], str],
    expected_between_fn: Callable[[dict, date, date], float],
    summarize_fn: Callable[[dict, list[dict], date, date], dict],
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    group_by: str = "date",
    only_unpaid: bool = False,
    status_filter: str = "all",
    vehicles: Optional[list[dict]] = None,
) -> bytes:
    first = date(year, month, 1)
    last = date(year + (month == 12), month % 12 + 1, 1) - timedelta(days=1)
    d_start = first
    d_end = last
    if date_from:
        d_start = max(first, date.fromisoformat(date_from))
    if date_to:
        d_end = min(last, date.fromisoformat(date_to))
    if d_end < d_start:
        d_start, d_end = first, last

    wb = Workbook()
    ws = wb.active
    ws.title = "Rent Entries"

    last_col = get_column_letter(len(HEADERS))
    ws.merge_cells(f"A1:{last_col}1")
    ws["A1"] = title
    ws["A1"].font = Font(bold=True, size=13, color="FFFFFF")
    ws["A1"].fill = PatternFill("solid", fgColor="151F27")
    ws["A1"].alignment = Alignment(horizontal="left", vertical="center", indent=1)
    ws.row_dimensions[1].height = 28

    ws.merge_cells(f"A2:{last_col}2")
    ws["A2"] = (
        "Joining date & earlier dates are automatically excluded (rows start the day after joining through month end). "
        "Use dropdown arrows in ACTION (H), METHOD (K), and VEHICLE ID (L). "
        "Enter UTR (min 6 chars for UPI/Bank). Leave ACTION blank to skip."
    )
    ws["A2"].font = Font(size=10, color="92400E")
    ws["A2"].fill = PatternFill("solid", fgColor="FFFBEB")
    ws["A2"].alignment = Alignment(horizontal="left", vertical="center", indent=1, wrap_text=True)
    ws.row_dimensions[2].height = 24

    ws.append(HEADERS)
    ws.row_dimensions[3].height = 24
    ctx_fill = PatternFill("solid", fgColor="B91C1C")
    inp_fill = PatternFill("solid", fgColor="047857")
    hdr_font = Font(bold=True, size=10, color="FFFFFF")
    for idx in range(1, len(HEADERS) + 1):
        c = ws.cell(row=3, column=idx)
        c.fill = ctx_fill if idx <= 7 else inp_fill
        c.font = hdr_font
        c.alignment = Alignment(horizontal="center" if idx in (1, 2, 6, 9, 11) else "left", vertical="center")

    date_list = [d_start + timedelta(days=i) for i in range((d_end - d_start).days + 1)]
    sorted_drivers, pairs = build_driver_date_pairs(drivers, date_list, group_by, rent_start_fn)

    unpaid_counts: dict[str, int] = {}
    matched_driver_ids: set[str] = set()
    row_idx = 4
    input_side = Side(style="thin", color="A7F3D0")
    input_border = Border(left=input_side, right=input_side, top=input_side, bottom=input_side)
    input_fill = PatternFill("solid", fgColor="FFFDF5")
    for d_obj, drv in pairs:
        ds = d_obj.isoformat()
        day_txns = txns_by_driver_date.get((drv["id"], ds), [])
        st_label, act_v, amt_v, utr_v, meth_v, veh_v, rem_v = _day_status_snapshot(
            drv, ds, d_obj, day_txns, today_dt, allow_future, rent_start_fn
        )
        if st_label == "Not Paid":
            unpaid_counts[drv["id"]] = unpaid_counts.get(drv["id"], 0) + 1
        if not matches_status_filter(st_label, status_filter, only_unpaid):
            continue
        matched_driver_ids.add(drv["id"])

        ws.append([
            ds,
            d_obj.strftime("%a"),
            drv.get("driver_code") or drv["id"],
            drv.get("name") or "",
            drv.get("city") or "",
            float(drv.get("daily_rent") or 0),
            st_label,
            act_v,
            amt_v,
            utr_v,
            meth_v,
            veh_v,
            rem_v,
        ])
        ws.row_dimensions[row_idx].height = 22
        bg_hex, fg_hex = STATUS_FILLS.get(st_label, ("FFFFFF", "17212B"))
        status_fill = PatternFill("solid", fgColor=bg_hex)
        status_font = Font(bold=True, size=10, color=fg_hex)
        is_editable = st_label in ("Not Paid", "Partial", "Rejected")
        for col_i in range(1, len(HEADERS) + 1):
            cell = ws.cell(row=row_idx, column=col_i)
            cell.border = THIN_BORDER
            if col_i in (6, 9):
                cell.number_format = "₹#,##0"
            if col_i == 7:
                cell.fill = status_fill
                cell.font = status_font
            elif col_i <= 6:
                cell.fill = PatternFill("solid", fgColor="F8FAFB")
                cell.font = Font(size=10, color="334155")
            else:
                cell.font = Font(size=10, color="111827")
                if is_editable:
                    cell.fill = input_fill
                    cell.border = input_border
        row_idx += 1

    last_data_row = max(4, row_idx - 1)
    veh_ids = sorted({
        v_id for v_id in (
            [(v.get("vehicle_id") or "").strip().upper() for v in (vehicles or [])]
            + [(d.get("current_vehicle_id") or "").strip().upper() for d in drivers]
        ) if v_id
    })

    # Populate Sheet 3 (Instructions) before adding DataValidation range formulas
    ws3 = wb.create_sheet("Instructions")
    ws3.append(["ACTION Value", "Rent Charged", "Required Fields", "Notes", "", "METHOD Options", "", "VEHICLE ID Options"])
    for c in ws3[1]:
        c.fill = PatternFill("solid", fgColor="B91C1C")
        c.font = Font(bold=True, color="FFFFFF")
    guide = [
        ["Paid", "Yes (daily rent)", "UTR / Ref No. (unless Cash), Method, Vehicle ID", "Submits payment for Accounts Verification"],
        ["Not Paid", "Yes (unchanged)", "None", "Leaves date as Not Paid (skipped on upload)"],
        ["Week Off", "₹0 (Waived)", "Optional Remarks", "Max 3 Week Off days allowed per driver per month"],
        ["EV Issue (No Ride)", "₹0 (Waived)", "Optional Remarks", "Closes date as EV Issue (Driver did not ride)"],
        ["EV Issue (Replacement Given)", "Yes (daily rent)", "UTR / Ref No. (unless Cash), Replacement Vehicle ID", "Logs EV issue + submits payment for verification"],
        ["Other Issue", "₹0 (Waived)", "Remarks / Reason (min 2 chars)", "Closes date as Other Issue with ₹0 rent"],
    ]
    methods_list = ["UPI", "Bank Transfer", "Cash"]
    max_ref_rows = max(len(guide), len(methods_list), len(veh_ids))
    for i in range(max_ref_rows):
        g = guide[i] if i < len(guide) else ["", "", "", ""]
        m_val = methods_list[i] if i < len(methods_list) else ""
        v_val = veh_ids[i] if i < len(veh_ids) else ""
        ws3.append([g[0], g[1], g[2], g[3], "", m_val, "", v_val])
    for col in ws3.columns:
        ws3.column_dimensions[col[0].column_letter].width = max(14, min(52, max(len(str(c.value or "")) for c in col) + 4))

    dv_end_row = max(4, row_idx - 1) + 50
    action_csv = ",".join(ACTION_LABELS.values())
    dv_action = DataValidation(
        type="list",
        formula1=f'"{action_csv}"',
        allow_blank=True,
        showInputMessage=True,
        showErrorMessage=True,
        promptTitle="Select Action",
        prompt="Pick Paid, Not Paid, Week Off (max 3/mo), EV Issue (No Ride), EV Issue (Replacement Given), or Other Issue",
        errorStyle="warning",
        errorTitle="Invalid Action",
        error="Please select a valid Action from the dropdown list.",
    )
    dv_method = DataValidation(
        type="list",
        formula1='"UPI,Bank Transfer,Cash"',
        allow_blank=True,
        showInputMessage=True,
        showErrorMessage=True,
        promptTitle="Payment Method",
        prompt="Pick UPI, Bank Transfer, or Cash",
    )
    ws.add_data_validation(dv_action)
    ws.add_data_validation(dv_method)
    dv_action.add(f"H4:H{dv_end_row}")
    dv_method.add(f"K4:K{dv_end_row}")
    if veh_ids:
        veh_csv = ",".join(veh_ids)
        veh_formula = f'"{veh_csv}"' if len(veh_csv) <= 250 else f"=Instructions!$H$2:$H${1 + len(veh_ids)}"
        dv_veh = DataValidation(
            type="list",
            formula1=veh_formula,
            allow_blank=True,
            showInputMessage=True,
            showErrorMessage=True,
            promptTitle="Vehicle ID",
            prompt="Select a Vehicle ID from the fleet list",
        )
        ws.add_data_validation(dv_veh)
        dv_veh.add(f"L4:L{dv_end_row}")

    ws.freeze_panes = "A4"
    last_col = get_column_letter(len(HEADERS))
    af_end_row = max(3, row_idx - 1)
    ws.auto_filter.ref = f"A3:{last_col}{af_end_row}"
    widths = [12, 6, 14, 22, 13, 12, 20, 28, 11, 20, 15, 15, 30]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w

    # Sheet 2: Summary (reorder after Rent Entries by moving index to 1)
    ws2 = wb.create_sheet("Summary", 1)
    sum_headers = [
        "Driver ID", "Driver Name", "City", "Joining Date", "Vehicle ID", "Daily Rent (₹)",
        "Expected MTD (₹)", "Verified (₹)", "Pending (₹)", "Outstanding (₹)",
        "Week Offs Used (of 3)", "Not Paid Days",
    ]
    ws2.append(sum_headers)
    for col_i in range(1, len(sum_headers) + 1):
        c = ws2.cell(row=1, column=col_i)
        c.fill = PatternFill("solid", fgColor="151F27")
        c.font = Font(bold=True, size=10, color="FFFFFF")

    ym_prefix = f"{year:04d}-{month:02d}"
    summary_drivers = [d for d in sorted_drivers if d["id"] in matched_driver_ids]
    tot_exp = tot_ver = tot_pen = tot_out = tot_wo = tot_np = 0.0
    sum_row_idx = 2
    zebra_fill = PatternFill("solid", fgColor="F8FAFB")
    out_font = Font(bold=True, size=10, color="B91C1C")
    for drv in summary_drivers:
        drv_txns = [t for (did, _), ts in txns_by_driver_date.items() if did == drv["id"] for t in ts]
        sm = summarize_fn(drv, drv_txns, first, last)
        wo = sum(1 for k, v in (drv.get("day_statuses") or {}).items() if k.startswith(ym_prefix) and v.get("type") == "week_off")
        np_days = unpaid_counts.get(drv["id"], 0)
        tot_exp += sm["expected"]
        tot_ver += sm["verified"]
        tot_pen += sm["pending"]
        tot_out += sm["outstanding"]
        tot_wo += wo
        tot_np += np_days
        ws2.append([
            drv.get("driver_code") or drv["id"],
            drv.get("name") or "",
            drv.get("city") or "",
            drv.get("joining_date") or "",
            drv.get("current_vehicle_id") or "",
            float(drv.get("daily_rent") or 0),
            round(sm["expected"], 2),
            round(sm["verified"], 2),
            round(sm["pending"], 2),
            round(sm["outstanding"], 2),
            f"{wo}/3",
            np_days,
        ])
        for col_i in range(1, 13):
            cell = ws2.cell(row=sum_row_idx, column=col_i)
            cell.border = THIN_BORDER
            if col_i in (6, 7, 8, 9, 10):
                cell.number_format = "₹#,##0"
            if sum_row_idx % 2 == 1:
                cell.fill = zebra_fill
            if col_i == 10 and sm["outstanding"] > 0:
                cell.font = out_font
            elif col_i == 12 and np_days > 0:
                cell.font = out_font
        sum_row_idx += 1
    ws2.append([
        "TOTAL", f"{len(summary_drivers)} drivers", "", "", "", "",
        round(tot_exp, 2), round(tot_ver, 2), round(tot_pen, 2), round(tot_out, 2),
        int(tot_wo), int(tot_np),
    ])
    for col_i in range(1, len(sum_headers) + 1):
        c = ws2.cell(row=ws2.max_row, column=col_i)
        c.font = Font(bold=True)
        c.border = THIN_BORDER
        if col_i in (7, 8, 9, 10):
            c.number_format = "₹#,##0"
    for col in ws2.columns:
        ws2.column_dimensions[col[0].column_letter].width = max(13, min(30, max(len(str(c.value or "")) for c in col) + 3))

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def extract_sheet_rows(file_bytes: bytes, filename: str) -> list[dict]:
    ext = (filename or "").rsplit(".", 1)[-1].lower() if "." in (filename or "") else ""
    raw_table: list[list[Any]] = []
    if ext == "csv":
        text = file_bytes.decode("utf-8-sig", errors="replace")
        raw_table = list(csv.reader(io.StringIO(text)))
    else:
        wb = load_workbook(io.BytesIO(file_bytes), data_only=True)
        ws = wb["Rent Entries"] if "Rent Entries" in wb.sheetnames else wb.active
        raw_table = [list(row) for row in ws.iter_rows(values_only=True)]

    header_idx = None
    col_map: dict[str, int] = {}
    for idx, row in enumerate(raw_table[:15]):
        norm_cells = [re.sub(r"\s+", " ", str(c or "").strip().upper()) for c in row]
        if "DATE" in norm_cells and ("ACTION" in norm_cells or "DRIVER ID" in norm_cells):
            header_idx = idx
            for c_i, name in enumerate(norm_cells):
                if name:
                    col_map[name] = c_i
            break
    if header_idx is None:
        raise ValueError("Could not find DATE / ACTION header columns in the uploaded sheet. Please use the exported Monthly Excel template.")

    def get_col(row: list[Any], *aliases: str) -> Any:
        for a in aliases:
            if a in col_map and col_map[a] < len(row):
                return row[col_map[a]]
        return None

    out = []
    for r_i, row in enumerate(raw_table[header_idx + 1:], start=header_idx + 2):
        if not any(c is not None and str(c).strip() != "" for c in row):
            continue
        ds = parse_cell_date(get_col(row, "DATE"))
        d_code = str(get_col(row, "DRIVER ID", "DRIVER CODE") or "").strip().upper()
        d_name = str(get_col(row, "DRIVER NAME", "DRIVER") or "").strip()
        act_raw = str(get_col(row, "ACTION") or "").strip()
        amt_raw = get_col(row, "AMOUNT", "PAYMENT AMOUNT")
        utr_raw = _clean_utr_cell(get_col(row, "UTR / REF NO.", "UTR", "TRANSACTION REF"))
        meth_raw = str(get_col(row, "METHOD", "PAYMENT METHOD") or "").strip()
        veh_raw = str(get_col(row, "VEHICLE ID", "VEHICLE", "REPLACEMENT VEHICLE ID") or "").strip().upper()
        rem_raw = str(get_col(row, "REMARKS / REASON", "REMARKS", "REASON") or "").strip()
        out.append({
            "row_num": r_i,
            "date": ds or str(get_col(row, "DATE") or "").strip(),
            "driver_code": d_code,
            "driver_name": d_name,
            "action_raw": act_raw,
            "amount_raw": amt_raw,
            "utr": utr_raw,
            "method": meth_raw,
            "vehicle_id": veh_raw,
            "remarks": rem_raw,
        })
    return out
