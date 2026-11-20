import csv
import io
import json
import os
import re
import shutil
import subprocess
import tempfile
from datetime import date, datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from openpyxl import load_workbook
from PIL import Image
from pypdf import PdfReader

CITY_ALIASES = {
    "bangalore": "Bengaluru",
    "blr": "Bengaluru",
    "bengaluru": "Bengaluru",
    "madras": "Chennai",
    "chn": "Chennai",
    "chennai": "Chennai",
    "hyd": "Hyderabad",
    "hyderabad": "Hyderabad",
    "cbe": "Coimbatore",
    "coimbatore": "Coimbatore",
    "tirupur": "Tiruppur",
    "tiruppur": "Tiruppur",
    "tpr": "Tiruppur",
    "mumbai": "Mumbai",
    "delhi": "Delhi",
    "new delhi": "Delhi",
    "pune": "Pune",
    "kochi": "Kochi",
    "mysore": "Mysuru",
    "mysuru": "Mysuru",
}

KNOWN_CITIES = (
    "Bengaluru",
    "Bangalore",
    "Chennai",
    "Hyderabad",
    "Coimbatore",
    "Tiruppur",
    "Tirupur",
    "Mumbai",
    "Delhi",
    "Pune",
    "Kochi",
    "Mysuru",
    "Mysore",
    "Jaipur",
    "Ahmedabad",
    "Kolkata",
)

HEADER_ALIASES = {
    "name": (
        "name",
        "driver name",
        "driver",
        "driver_name",
        "full name",
        "operator",
        "employee name",
        "pilot name",
        "captain name",
        "pilot",
        "captain",
        "cust name",
        "customer",
        "customer name",
        "party",
        "party name",
        "person",
        "assigned driver",
        "driver full name",
        "emp name",
    ),
    "mobile": (
        "mobile",
        "phone",
        "contact",
        "mobile no",
        "mobile number",
        "phone no",
        "phone number",
        "cell",
        "contact no",
        "contact number",
        "mob",
        "ph",
        "tel",
        "telephone",
        "whatsapp",
        "whatsapp no",
        "driver mobile",
        "driver phone",
        "number",
    ),
    "driver_code": (
        "id",
        "driver id",
        "driver code",
        "driver_code",
        "driver_id",
        "emp id",
        "employee id",
        "driver no",
        "code",
        "drv id",
        "d id",
        "pilot id",
    ),
    "package": (
        "package",
        "plan",
        "subscription",
        "rental package",
        "scheme",
        "tier",
        "pack",
    ),
    "vin": (
        "vin",
        "chassis",
        "chassis no",
        "chassis number",
        "vin no",
        "vin number",
        "frame no",
    ),
    "rental_ends": (
        "rental ends",
        "rental end",
        "rent ends",
        "lease ends",
        "contract ends",
        "expiry",
        "end date",
        "rental",
        "valid till",
    ),
    "city": (
        "city",
        "location",
        "branch",
        "hub",
        "center",
        "region",
        "zone",
        "area",
        "state",
        "station",
        "depot",
        "town",
        "place",
        "site",
        "operating city",
    ),
    "daily_rent": (
        "daily rent",
        "rent",
        "daily_rent",
        "rent amount",
        "rate",
        "per day",
        "tariff",
        "daily rate",
        "rent per day",
        "amount",
        "rent (₹)",
        "daily rent (₹)",
        "collection",
        "expected rent",
        "price",
        "fee",
        "charge",
        "rental",
        "day amount",
        "vehicle rent",
        "rent/day",
        "rent day",
    ),
    "joining_date": (
        "joining date",
        "joining",
        "join date",
        "doj",
        "start date",
        "date of joining",
        "onboarded",
        "onboarding date",
        "date",
        "allotment date",
        "assigned date",
        "entry date",
        "created date",
        "from date",
    ),
    "handover_date": ("handover date", "handover", "vehicle handover"),
    "rent_start_date": ("rent start date", "rent start", "billing start", "rent starts"),
    "reg_no": (
        "vehicle no",
        "reg no",
        "registration",
        "registration no",
        "registration number",
        "vehicle",
        "vehicle number",
        "reg_no",
        "reg number",
        "plate",
        "number plate",
        "assigned vehicle",
        "vehicle reg",
        "vehicle reg no",
        "vehicle reg. no.",
        "veh no",
        "v no",
        "v.no",
        "cab no",
        "car no",
        "auto no",
        "bike no",
        "scooter no",
        "ev no",
        "rc no",
        "rc number",
        "gaadi no",
        "chasis no",
    ),
    "vehicle_type": (
        "vehicle type",
        "type",
        "model",
        "category",
        "segment",
        "ev type",
        "vehicle model",
        "make",
        "brand",
        "variant",
        "vehicle make",
        "sub type",
    ),
    "details": (
        "details",
        "description",
        "notes",
        "remarks",
        "vehicle details",
        "remark",
        "comment",
        "comments",
        "info",
        "extra",
        "specification",
        "battery",
        "owner",
    ),
    "status": ("status", "state", "active", "driver status", "vehicle status"),
}

REG_RX = re.compile(r"\b([A-Z]{2})[\s-]*(\d{1,2})[\s-]*([A-Z]{1,3})[\s-]*(\d{3,4})\b", re.IGNORECASE)
MOBILE_RX = re.compile(r"(?:\+?91[\s-]*)?\b([6-9]\d{9})\b")
DRIVER_CODE_RX = re.compile(r"\b([A-Z0-9]{2,10}-[A-Z0-9-]{2,15})\b", re.IGNORECASE)
DATE_RX = re.compile(
    r"\b(\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})\b",
    re.IGNORECASE,
)
CURRENCY_RENT_RX = re.compile(r"(?:₹|Rs\.?|INR)\s*(\d[\d,]*(?:\.\d+)?)", re.IGNORECASE)
PLAIN_RENT_RX = re.compile(r"\b([2-9]\d{2}|[1-4]\d{3})\b")
CITY_RX = re.compile(r"\b(" + "|".join(KNOWN_CITIES) + r")\b", re.IGNORECASE)
STATUS_RX = re.compile(r"\b(Active|Inactive|Suspended|Maintenance)\b", re.IGNORECASE)

DATE_FORMATS = (
    "%Y-%m-%d",
    "%d/%m/%Y",
    "%d-%m-%Y",
    "%d.%m.%Y",
    "%Y/%m/%d",
    "%d %b %Y",
    "%d %B %Y",
    "%d-%b-%Y",
    "%d-%B-%Y",
    "%d/%b/%Y",
    "%d/%m/%y",
    "%d-%m-%y",
    "%d %b %y",
    "%m/%d/%Y",
)


def _norm_header(h: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(h or "").lower()).strip()


def clean_mobile(val: Any) -> str:
    if val is None:
        return ""
    s = str(val).strip()
    if s.endswith(".0"):
        s = s[:-2]
    digits = re.sub(r"\D", "", s)
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    return digits


def clean_date(val: Any, fallback_iso: str) -> str:
    if isinstance(val, datetime):
        return val.date().isoformat()
    if isinstance(val, date):
        return val.isoformat()
    s = str(val or "").strip()
    if not s:
        return fallback_iso
    s_clean = re.sub(r"\s+", " ", s)
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(s_clean, fmt).date().isoformat()
        except ValueError:
            continue
    return fallback_iso


def clean_rent(val: Any, default: float = 700.0) -> float:
    if isinstance(val, (int, float)) and not isinstance(val, bool):
        return float(val) if val > 0 else default
    s = str(val or "").replace(",", "").strip()
    if not s:
        return default
    m = re.search(r"\d+(?:\.\d+)?", s)
    if not m:
        return default
    num = float(m.group(0))
    return num if num > 0 else default


def _is_blank(val: Any) -> bool:
    return re.sub(r"\s+", " ", str(val or "").strip().lower()) in (
        "",
        "(blank)",
        "blank",
        "null",
        "none",
        "n/a",
        "na",
        "-",
        "—",
    )


def _is_unassigned_driver(val: Any) -> bool:
    if _is_blank(val):
        return True
    return re.sub(r"\s+", " ", str(val or "").strip().lower()) in (
        "not assigned",
        "unassigned",
        "no driver",
        "available",
        "free",
        "vacant",
        "spare",
    )


def clean_reg_no(val: Any) -> str:
    if _is_blank(val):
        return ""
    s = re.sub(r"\s+", " ", str(val or "").strip())
    if "-" in s:
        parts = [p.strip() for p in s.split("-", 1)]
        left = parts[0].upper() if re.match(r"^[A-Za-z0-9 ]+$", parts[0]) else parts[0]
        right = parts[1]
        if re.match(r"^[A-Za-z]{2}\d{1,2}[A-Za-z]{1,3}\d{3,4}$", right):
            right = right.upper()
        return f"{left} - {right}".strip(" -")
    s_up = s.upper()
    m = REG_RX.search(s_up)
    if m:
        return f"{m.group(1).upper()} {m.group(2)} {m.group(3).upper()} {m.group(4)}"
    return s_up


def clean_city(val: Any, default: str = "Bengaluru") -> str:
    s = str(val or "").strip()
    if not s:
        return default
    return CITY_ALIASES.get(s.lower(), s.title())


def clean_status(val: Any, kind: str = "driver") -> str:
    s = str(val or "").strip().lower()
    if s in ("inactive", "disabled", "left", "terminated", "closed", "no", "false", "0"):
        return "Inactive"
    if kind == "driver" and s in ("suspended", "hold", "blocked"):
        return "Suspended"
    if kind == "vehicle" and s in ("maintenance", "service", "repair", "workshop"):
        return "Maintenance"
    return "Active"


SKIP_HEADERS = ("s no", "sl no", "sr no", "serial", "serial number", "no", "sno", "vehicle id")


def _match_header_col(header_text: str) -> Optional[str]:
    norm = _norm_header(header_text)
    if not norm or norm in SKIP_HEADERS:
        return None
    for field, aliases in HEADER_ALIASES.items():
        if norm in aliases or str(header_text or "").strip().lower() in aliases:
            return field
    for field, aliases in HEADER_ALIASES.items():
        for alias in aliases:
            if len(alias) >= 5 and alias not in ("number", "amount", "status", "details") and alias in norm:
                return field
    return None


def _build_col_map(row: List[Any]) -> Dict[int, str]:
    mapping: Dict[int, str] = {}
    used_fields = set()
    for idx, cell in enumerate(row):
        field = _match_header_col(cell)
        if field and field not in used_fields:
            mapping[idx] = field
            used_fields.add(field)
    return mapping


def _empty_row(today_str: str) -> Dict[str, Any]:
    return {
        "name": "",
        "mobile": "",
        "city": "Bengaluru",
        "daily_rent": 700.0,
        "joining_date": today_str,
        "handover_date": "",
        "rent_start_date": "",
        "driver_code": "",
        "package": "",
        "reg_no": "",
        "vehicle_type": "",
        "vin": "",
        "rental_ends": "",
        "rental_status": "",
        "status": "Active",
        "details": "",
        "has_daily_rent": False,
        "has_joining_date": False,
    }


def _format_extra_val(val: Any) -> str:
    if val is None:
        return ""
    if isinstance(val, datetime):
        return val.date().isoformat()
    if isinstance(val, date):
        return val.isoformat()
    s = str(val).strip()
    if s.endswith(".0") and s[:-2].isdigit():
        return s[:-2]
    return re.sub(r"\s+", " ", s)


def _row_from_mapping(
    cells: List[Any],
    col_map: Dict[int, str],
    today_str: str,
    extra_cols: Optional[Dict[int, str]] = None,
) -> Optional[Dict[str, Any]]:
    raw: Dict[str, Any] = {}
    for idx, field in col_map.items():
        if idx < len(cells):
            raw[field] = cells[idx]
    name = re.sub(r"\s+", " ", str(raw.get("name") or "").strip())
    if _is_unassigned_driver(name):
        name = ""
    reg_no = clean_reg_no(raw.get("reg_no"))
    mobile = clean_mobile(raw.get("mobile"))
    if not name and not reg_no and not mobile:
        return None
    if name.lower() in ("total", "grand total", "summary", "driver name", "name", "driver"):
        return None
    if reg_no and reg_no.lower() in ("vehicle no", "reg no", "registration", "vehicle"):
        return None

    item = _empty_row(today_str)
    item["name"] = name
    item["mobile"] = mobile
    item["city"] = clean_city(raw.get("city"), default="Bengaluru")
    item["has_daily_rent"] = not _is_blank(raw.get("daily_rent"))
    item["has_joining_date"] = not _is_blank(raw.get("joining_date"))
    item["daily_rent"] = clean_rent(raw.get("daily_rent"), default=700.0)
    joining = clean_date(raw.get("joining_date"), today_str) if item["has_joining_date"] else (today_str if name else "")
    item["joining_date"] = joining
    item["handover_date"] = clean_date(raw.get("handover_date"), joining) if not _is_blank(raw.get("handover_date")) else ""
    item["rent_start_date"] = clean_date(raw.get("rent_start_date"), joining) if not _is_blank(raw.get("rent_start_date")) else ""
    code_raw = re.sub(r"\s*-\s*", "-", str(raw.get("driver_code") or "").strip().upper())
    item["driver_code"] = code_raw if re.match(r"^[A-Z0-9]{2,10}-[A-Z0-9-]{2,15}$", code_raw) else ""
    item["package"] = "" if _is_blank(raw.get("package")) else re.sub(r"\s+", " ", str(raw.get("package")).strip())
    item["reg_no"] = reg_no
    item["vehicle_type"] = "" if _is_blank(raw.get("vehicle_type")) else str(raw.get("vehicle_type")).strip()
    item["vin"] = "" if _is_blank(raw.get("vin")) else re.sub(r"\s+", "", str(raw.get("vin")).strip().upper())
    raw_re = raw.get("rental_ends")
    item["rental_ends"] = "" if _is_blank(raw_re) else clean_date(raw_re, str(raw_re).strip())
    raw_st = str(raw.get("status") or "").strip()
    if raw_st.lower() in ("available", "rented"):
        item["rental_status"] = raw_st.lower()
        item["status"] = "Active"
    else:
        item["status"] = clean_status(raw_st, kind="driver" if name else "vehicle")
        item["rental_status"] = "rented" if name else "available"
    details_parts = []
    base_details = "" if _is_blank(raw.get("details")) else str(raw.get("details")).strip()
    if base_details:
        details_parts.append(base_details)
    if extra_cols:
        for idx, hdr in extra_cols.items():
            if idx < len(cells) and not _is_blank(cells[idx]):
                val_s = _format_extra_val(cells[idx])
                if val_s:
                    details_parts.append(f"{hdr}: {val_s}")
    item["details"] = " · ".join(details_parts)
    return item


def _infer_col_map_from_data(sample_rows: List[List[Any]]) -> Tuple[Dict[int, str], int]:
    if not sample_rows:
        return {}, 0
    # Skip row 0 if it looks like an unrecognized header row (all short non-numeric strings without reg/mobile/date)
    start_idx = 0
    first_row = [str(c or "").strip() for c in sample_rows[0] if str(c or "").strip()]
    if first_row and all(
        not REG_RX.search(c) and not MOBILE_RX.search(c) and not DATE_RX.search(c) and not re.search(r"^\d+$", c)
        for c in first_row
    ):
        if len(sample_rows) > 1:
            start_idx = 1

    data_rows = sample_rows[start_idx:]
    if not data_rows:
        return {}, 0

    max_cols = max(len(r) for r in data_rows)
    col_map: Dict[int, str] = {}
    used_fields = set()

    for col_idx in range(max_cols):
        vals = [r[col_idx] for r in data_rows if col_idx < len(r) and str(r[col_idx] or "").strip()]
        if not vals:
            continue
        strs = [str(v).strip() for v in vals]
        n = len(vals)
        if "reg_no" not in used_fields and sum(1 for s in strs if REG_RX.search(s)) >= max(1, n // 2):
            col_map[col_idx] = "reg_no"
            used_fields.add("reg_no")
        elif "mobile" not in used_fields and sum(1 for s in strs if MOBILE_RX.search(clean_mobile(s))) >= max(1, n // 2):
            col_map[col_idx] = "mobile"
            used_fields.add("mobile")
        elif "city" not in used_fields and sum(1 for s in strs if CITY_RX.search(s)) >= max(1, n // 2):
            col_map[col_idx] = "city"
            used_fields.add("city")
        elif "joining_date" not in used_fields and sum(
            1 for v, s in zip(vals, strs) if isinstance(v, (datetime, date)) or DATE_RX.search(s)
        ) >= max(1, n // 2):
            col_map[col_idx] = "joining_date"
            used_fields.add("joining_date")
        elif "status" not in used_fields and sum(
            1 for s in strs if s.lower() in ("active", "inactive", "suspended", "maintenance")
        ) >= max(1, n // 2):
            col_map[col_idx] = "status"
            used_fields.add("status")
        elif "daily_rent" not in used_fields and sum(
            1
            for v, s in zip(vals, strs)
            if (isinstance(v, (int, float)) and not isinstance(v, bool) and 100 <= float(v) <= 25000)
            or (re.match(r"^(?:₹|Rs\.?|INR)?\s*\d[\d,]*(?:\.\d+)?$", s, re.I) and 100 <= clean_rent(s, 0) <= 25000)
        ) >= max(1, n // 2):
            col_map[col_idx] = "daily_rent"
            used_fields.add("daily_rent")

    if not (used_fields & {"reg_no", "mobile", "city", "joining_date", "daily_rent"}):
        return {}, 0

    for col_idx in range(max_cols):
        if col_idx in col_map:
            continue
        strs = [str(r[col_idx]).strip() for r in data_rows if col_idx < len(r) and str(r[col_idx] or "").strip()]
        if not strs:
            continue
        # Skip pure serial-number columns (1, 2, 3...)
        if all(s.isdigit() and int(s) < 500 for s in strs):
            continue
        if "name" not in used_fields and any(re.search(r"[A-Za-z]{2,}", s) for s in strs):
            col_map[col_idx] = "name"
            used_fields.add("name")
        elif "vehicle_type" not in used_fields and any(re.search(r"[A-Za-z]{2,}", s) for s in strs):
            col_map[col_idx] = "vehicle_type"
            used_fields.add("vehicle_type")

    return col_map, start_idx


HEADER_CONT_WORDS = {"date", "ends", "end", "no", "id", "name", "number", "start", "code", "type", "rent"}


def _merge_cell_text(prev: str, cont: str) -> str:
    p = str(prev or "").strip()
    c = str(cont or "").strip()
    if not p:
        return c
    if not c:
        return p
    if p.endswith(" -"):
        return f"{p} {c}"
    if p.endswith("-"):
        return f"{p}{c}"
    return f"{p} {c}"


def _merge_wrapped_data_rows(rows: List[List[Any]], row_ys: Optional[List[float]] = None) -> List[List[Any]]:
    merged: List[List[Any]] = []
    last_src_idx: Optional[int] = None
    pending_prefix: Optional[List[str]] = None

    for idx, raw_r in enumerate(rows):
        r = [c for c in raw_r]
        non_empty = [j for j, c in enumerate(r) if str(c or "").strip()]
        is_sparse = len(r) >= 2 and 1 <= len(non_empty) <= max(3, len(r) // 2) and not str(r[0] or "").strip()

        if not is_sparse:
            if pending_prefix is not None:
                while len(r) < len(pending_prefix):
                    r.append("")
                for j, pval in enumerate(pending_prefix):
                    if str(pval or "").strip():
                        r[j] = _merge_cell_text(pval, r[j])
                pending_prefix = None
            merged.append(r)
            last_src_idx = idx
            continue

        has_trailing_dash = any(str(r[j] or "").strip().endswith("-") for j in non_empty)
        prev_has_trailing_dash = bool(
            merged and any(j < len(merged[-1]) and str(merged[-1][j] or "").strip().endswith("-") for j in non_empty)
        )

        attach_next = False
        if not merged or has_trailing_dash:
            attach_next = True
        elif prev_has_trailing_dash:
            attach_next = False
        elif row_ys is not None and last_src_idx is not None and idx + 1 < len(row_ys):
            d_prev = abs(row_ys[last_src_idx] - row_ys[idx])
            d_next = abs(row_ys[idx] - row_ys[idx + 1])
            if d_next + 1.5 < d_prev:
                attach_next = True

        if attach_next:
            if pending_prefix is None:
                pending_prefix = [""] * len(r)
            while len(pending_prefix) < len(r):
                pending_prefix.append("")
            for j in non_empty:
                pending_prefix[j] = _merge_cell_text(pending_prefix[j], r[j])
        else:
            prev = merged[-1]
            while len(prev) < len(r):
                prev.append("")
            for j in non_empty:
                prev[j] = _merge_cell_text(prev[j], r[j])
            last_src_idx = idx

    if pending_prefix is not None and any(str(c or "").strip() for c in pending_prefix):
        merged.append(pending_prefix)
    return merged


def _parse_table_rows(
    rows: List[List[Any]],
    today_str: str,
    fallback_map: Optional[Dict[int, str]] = None,
    row_ys: Optional[List[float]] = None,
):
    indexed = [
        (i, [c for c in (r or [])])
        for i, r in enumerate(rows)
        if any(str(c or "").strip() for c in (r or []))
    ]
    if not indexed:
        return [], fallback_map
    cleaned = [r for _, r in indexed]
    cleaned_ys = [row_ys[i] for i, _ in indexed] if row_ys and len(row_ys) == len(rows) else None

    col_map: Optional[Dict[int, str]] = None
    extra_cols: Dict[int, str] = {}
    start_idx = 0
    for i, r in enumerate(cleaned[:15]):
        cand = _build_col_map(r)
        if len(cand) >= 2:
            header_row = [str(c or "").strip() for c in r]
            if i > 0:
                prv = cleaned[i - 1]
                prv_non_empty = [(idx, str(c or "").strip()) for idx, c in enumerate(prv) if str(c or "").strip()]
                if 1 <= len(prv_non_empty) <= 3 and all(
                    re.match(r"^[A-Za-z][A-Za-z /()._-]{0,20}$", w) and not REG_RX.search(w) for _, w in prv_non_empty
                ):
                    while len(header_row) < len(prv):
                        header_row.append("")
                    for idx, w in prv_non_empty:
                        header_row[idx] = f"{w} {header_row[idx]}".strip()
                    cand = _build_col_map(header_row)
            next_start = i + 1
            if i + 1 < len(cleaned):
                nxt = cleaned[i + 1]
                nxt_non_empty = [(idx, str(c or "").strip()) for idx, c in enumerate(nxt) if str(c or "").strip()]
                if 1 <= len(nxt_non_empty) <= 2 and all(
                    w.lower() in HEADER_CONT_WORDS for _, w in nxt_non_empty
                ):
                    while len(header_row) < len(nxt):
                        header_row.append("")
                    for idx, w in nxt_non_empty:
                        header_row[idx] = f"{header_row[idx]} {w}".strip()
                    cand = _build_col_map(header_row)
                    next_start = i + 2
            col_map = cand
            start_idx = next_start
            for idx, hdr_raw in enumerate(header_row):
                hdr = re.sub(r"\s+", " ", hdr_raw.strip())
                if idx not in col_map and hdr and _norm_header(hdr) not in SKIP_HEADERS:
                    extra_cols[idx] = hdr
            break

    if not col_map and fallback_map and len(cleaned[0]) >= max(fallback_map.keys(), default=0) + 1:
        col_map = fallback_map
        start_idx = 0

    if not col_map:
        inferred, inf_start = _infer_col_map_from_data(cleaned[:10])
        if len(inferred) >= 2:
            col_map = inferred
            start_idx = inf_start

    if not col_map:
        return [], fallback_map

    data_ys = cleaned_ys[start_idx:] if cleaned_ys else None
    data_rows = _merge_wrapped_data_rows(cleaned[start_idx:], row_ys=data_ys)
    parsed: List[Dict[str, Any]] = []
    for r in data_rows:
        # Skip repeated header rows across page breaks
        if len(_build_col_map(r)) >= 2 and _build_col_map(r) == col_map:
            continue
        item = _row_from_mapping(r, col_map, today_str, extra_cols=extra_cols)
        if item:
            parsed.append(item)
    return parsed, col_map


def _parse_kv_blocks(text: str, today_str: str) -> List[Dict[str, Any]]:
    records: List[Dict[str, Any]] = []
    current: Dict[str, Any] = {}
    for line in text.splitlines():
        s = line.strip()
        if not s:
            if current.get("name") or current.get("reg_no") or current.get("mobile"):
                records.append(current)
                current = {}
            continue
        m = re.match(r"^([A-Za-z0-9 _./-]{2,28})\s*[:\-]\s*(.+)$", s)
        if not m:
            continue
        key, val = m.group(1).strip(), m.group(2).strip()
        field = _match_header_col(key)
        if not field:
            continue
        if field in current and field in ("name", "reg_no"):
            records.append(current)
            current = {}
        current[field] = val
    if current.get("name") or current.get("reg_no") or current.get("mobile"):
        records.append(current)

    out: List[Dict[str, Any]] = []
    for raw in records:
        if len(raw) < 2 and not (raw.get("name") and raw.get("mobile")) and not raw.get("reg_no"):
            continue
        item = _empty_row(today_str)
        item["name"] = re.sub(r"\s+", " ", str(raw.get("name") or "").strip())
        item["mobile"] = clean_mobile(raw.get("mobile"))
        item["city"] = clean_city(raw.get("city"), default="Bengaluru")
        item["daily_rent"] = clean_rent(raw.get("daily_rent"), default=700.0)
        item["joining_date"] = clean_date(raw.get("joining_date"), today_str)
        item["reg_no"] = clean_reg_no(raw.get("reg_no"))
        item["vehicle_type"] = str(raw.get("vehicle_type") or "").strip()
        item["status"] = clean_status(raw.get("status"), kind="driver" if item["name"] else "vehicle")
        item["details"] = str(raw.get("details") or "").strip()
        code_raw = str(raw.get("driver_code") or "").strip().upper()
        item["driver_code"] = code_raw if re.match(r"^[A-Z]{3}-D-\d{3,}$", code_raw) else ""
        if item["name"] or item["reg_no"]:
            out.append(item)
    return out


def _parse_text_lines(text: str, today_str: str) -> List[Dict[str, Any]]:
    # 1. Try space-separated multi-column text table first (common in layout PDFs)
    lines = [ln for ln in text.splitlines() if ln.strip()]
    split_rows = [re.split(r"\s{2,}|\t|\|", ln.strip()) for ln in lines]
    table_parsed, _ = _parse_table_rows(split_rows, today_str)
    if table_parsed:
        return table_parsed

    # 2. Try key-value blocks
    kv_parsed = _parse_kv_blocks(text, today_str)
    if kv_parsed:
        return kv_parsed

    # 3. Heuristic line-by-line regex extraction
    results: List[Dict[str, Any]] = []
    for raw_line in lines:
        line = raw_line.strip()
        if not line or re.match(r"^(page\s+\d+|total\b|generated\b|route39\b)", line, re.IGNORECASE):
            continue
        reg_m = REG_RX.search(line)
        mob_m = MOBILE_RX.search(line)
        if not reg_m and not mob_m:
            continue

        item = _empty_row(today_str)
        work = line
        if reg_m:
            item["reg_no"] = clean_reg_no(reg_m.group(0))
            work = work.replace(reg_m.group(0), " ")
        if mob_m:
            item["mobile"] = mob_m.group(1)
            work = work.replace(mob_m.group(0), " ")

        code_m = DRIVER_CODE_RX.search(work)
        if code_m:
            item["driver_code"] = code_m.group(1).upper()
            work = work.replace(code_m.group(0), " ")

        date_m = DATE_RX.search(work)
        if date_m:
            item["joining_date"] = clean_date(date_m.group(0), today_str)
            work = work.replace(date_m.group(0), " ")

        city_m = CITY_RX.search(work)
        if city_m:
            item["city"] = clean_city(city_m.group(1))
            work = work.replace(city_m.group(0), " ")

        status_m = STATUS_RX.search(work)
        if status_m:
            item["status"] = clean_status(status_m.group(1))
            work = work.replace(status_m.group(0), " ")

        rent_m = CURRENCY_RENT_RX.search(work) or PLAIN_RENT_RX.search(work)
        if rent_m:
            item["daily_rent"] = clean_rent(rent_m.group(1), default=700.0)
            work = work.replace(rent_m.group(0), " ")

        # Strip serial numbers, punctuation, currency leftovers to isolate driver name
        work = re.sub(r"^\s*\d+[.)]?\s+", "", work)
        work = re.sub(r"[₹|,;/\-]+", " ", work)
        work = re.sub(r"\b\d+\b", " ", work)
        name = re.sub(r"\s+", " ", work).strip()
        if len(name) >= 2:
            item["name"] = name

        if item["name"] or item["reg_no"]:
            results.append(item)
    return results


def _detect_mode(rows: List[Dict[str, Any]]) -> str:
    has_names = any(r.get("name") or r.get("mobile") for r in rows)
    has_regs = any(r.get("reg_no") for r in rows)
    if has_names and has_regs:
        return "drivers_and_vehicles"
    if has_regs and not has_names:
        return "vehicles"
    if has_names and not has_regs:
        return "drivers"
    return "drivers_and_vehicles"


def _dedupe_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = set()
    out = []
    for r in rows:
        key = (r.get("name", "").lower(), r.get("mobile", ""), r.get("reg_no", ""))
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
    return out


def _est_width(txt: str, fs: float) -> float:
    w = 0.0
    for ch in txt:
        if ch in "iljtfrI1|.,:;'\"!()[]{}- ":
            w += 0.30
        elif ch in "MWmw@#%&":
            w += 0.72
        elif ch.isupper() or ch == "_":
            w += 0.58
        else:
            w += 0.48
    return w * max(fs, 6.0)


def _extract_coord_rows_with_y(page) -> List[Tuple[float, List[Tuple[float, str]]]]:
    fragments: List[Tuple[float, float, float, str, bool]] = []

    def visitor(text, cm, tm, font_dict, font_size):
        if not text or not text.strip():
            return
        tx, ty = tm[4], tm[5]
        x = cm[0] * tx + cm[2] * ty + cm[4]
        y = cm[1] * tx + cm[3] * ty + cm[5]
        fs = float(font_size or 10.0)
        ended_nl = text.endswith("\n") or text.endswith("\r")
        fragments.append((float(y), float(x), fs, text.strip(), ended_nl))

    page.extract_text(visitor_text=visitor)
    if not fragments:
        return []

    fragments.sort(key=lambda f: (-f[0], f[1]))
    y_groups: List[List[Tuple[float, float, float, str, bool]]] = []
    for frag in fragments:
        if not y_groups or abs(frag[0] - y_groups[-1][0][0]) > 3.5:
            y_groups.append([frag])
        else:
            y_groups[-1].append(frag)

    rows: List[Tuple[float, List[Tuple[float, str]]]] = []
    for grp in y_groups:
        grp.sort(key=lambda f: f[1])
        merged: List[Tuple[float, float, str, bool]] = []
        for _, x, fs, txt, ended_nl in grp:
            if not merged:
                merged.append((x, fs, txt, ended_nl))
                continue
            px, pfs, ptxt, p_nl = merged[-1]
            est_end = px + _est_width(ptxt, pfs)
            # Always merge overlapping/stacked glyphs (e.g. currency symbol + digits at same x)
            same_spot = abs(x - px) < 2.0
            close_inline = (not p_nl) and (x - est_end < max(2.5, pfs * 0.28))
            if same_spot or close_inline:
                sep = " " if (not same_spot and x - est_end > 1.2) else ""
                merged[-1] = (px, pfs, f"{ptxt}{sep}{txt}", ended_nl)
            else:
                merged.append((x, fs, txt, ended_nl))
        rows.append((grp[0][0], [(x, txt) for x, _, txt, _ in merged]))
    return rows


def _extract_coord_rows(page) -> List[List[Tuple[float, str]]]:
    return [r for _, r in _extract_coord_rows_with_y(page)]


def _align_coord_table_with_y(
    coord_rows_y: List[Tuple[float, List[Tuple[float, str]]]],
    prev_col_xs: Optional[List[float]] = None,
    x_scale_h: float = 12.0,
    header_probe_rows: Optional[List[List[Tuple[float, str]]]] = None,
) -> Tuple[List[List[str]], List[float], Optional[List[float]]]:
    if not coord_rows_y:
        return [], [], prev_col_xs

    col_xs = prev_col_xs
    header_idx = None
    probe_list = header_probe_rows if header_probe_rows is not None else [r for _, r in coord_rows_y]
    for idx, row in enumerate(probe_list[:15]):
        cand = _build_col_map([txt for _, txt in row])
        if len(cand) >= 2:
            col_xs = [x for x, _ in row]
            header_idx = idx
            break

    if not col_xs:
        return [[txt for _, txt in r] for _, r in coord_rows_y], [y for y, _ in coord_rows_y], None

    keep_from = header_idx if header_idx is not None else 0
    if header_idx is not None and header_idx > 0:
        prev_row = probe_list[header_idx - 1]
        if 1 <= len(prev_row) <= 3 and all(
            re.match(r"^[A-Za-z][A-Za-z /()._-]{0,20}$", txt) and not REG_RX.search(txt) for _, txt in prev_row
        ):
            keep_from = header_idx - 1

    tol_left = max(18.0, x_scale_h * 0.9)

    aligned: List[List[str]] = []
    aligned_ys: List[float] = []
    for idx, (y, row) in enumerate(coord_rows_y):
        if idx < keep_from:
            continue
        if idx == header_idx and len(probe_list[idx]) == len(col_xs):
            aligned.append([txt for _, txt in probe_list[idx]])
            aligned_ys.append(y)
            continue
        if len(row) == len(col_xs):
            all_in_slot = True
            for j, (x, _) in enumerate(row):
                cx = col_xs[j]
                if j + 1 < len(col_xs):
                    tol_n = min(tol_left, (col_xs[j + 1] - cx) * 0.45)
                    limit = col_xs[j + 1] - tol_n
                else:
                    limit = float("inf")
                if not ((cx - tol_left) <= x < limit):
                    all_in_slot = False
                    break
            if all_in_slot:
                aligned.append([txt for _, txt in row])
                aligned_ys.append(y)
                continue
        cells = [""] * len(col_xs)
        for x, txt in row:
            matched_j = None
            for j, cx in enumerate(col_xs):
                if j + 1 < len(col_xs):
                    tol_n = min(tol_left, (col_xs[j + 1] - cx) * 0.45)
                    if (cx - tol_left) <= x < (col_xs[j + 1] - tol_n):
                        matched_j = j
                        break
            if matched_j is None:
                matched_j = min(range(len(col_xs)), key=lambda j: abs(x - col_xs[j]))
            cells[matched_j] = _merge_cell_text(cells[matched_j], txt)
        aligned.append(cells)
        aligned_ys.append(y)
    return aligned, aligned_ys, col_xs


OCR_SCRIPT_PATH = Path(__file__).parent / "ocr_vision.js"


def _run_vision_ocr(mode: str, data: bytes, suffix: str) -> List[Dict[str, Any]]:
    osascript_bin = shutil.which("osascript")
    if not osascript_bin or not OCR_SCRIPT_PATH.exists():
        raise ValueError(
            "Image OCR requires macOS Vision or tesseract; please upload an Excel (.xlsx), CSV, or text-based PDF."
        )
    payload = data
    out_suffix = suffix
    if mode == "image":
        try:
            with Image.open(io.BytesIO(data)) as im:
                if im.width < 800:
                    resized = im.resize((im.width * 2, im.height * 2), Image.LANCZOS)
                    buf = io.BytesIO()
                    resized.save(buf, format="PNG")
                    payload = buf.getvalue()
                    out_suffix = ".png"
        except Exception:
            pass
    fd, tmp_path = tempfile.mkstemp(suffix=out_suffix)
    try:
        os.write(fd, payload)
        os.close(fd)
        proc = subprocess.run(
            [osascript_bin, "-l", "JavaScript", str(OCR_SCRIPT_PATH), mode, tmp_path],
            capture_output=True,
            text=True,
            timeout=45,
        )
        if proc.returncode != 0:
            raise ValueError(f"OCR engine failed: {(proc.stderr or proc.stdout or '').strip()}")
        return json.loads(proc.stdout or "[]")
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def _ocr_page_to_rows(
    tokens: List[Dict[str, Any]],
    today_str: str,
    last_col_map: Optional[Dict[int, str]],
    last_col_xs: Optional[List[float]],
) -> Tuple[List[Dict[str, Any]], Optional[Dict[int, str]], Optional[List[float]], str]:
    if not tokens:
        return [], last_col_map, last_col_xs, ""

    heights = sorted(float(t["h"]) for t in tokens if float(t.get("h") or 0) > 0)
    median_h = heights[len(heights) // 2] if heights else 20.0
    enriched = []
    for t in tokens:
        x = float(t["x"])
        y = float(t["y"])
        w = float(t["w"])
        h = float(t["h"])
        cy = y + h / 2.0
        enriched.append((cy, x, w, str(t["text"])))

    enriched.sort(key=lambda item: (-item[0], item[1]))
    y_tol = max(6.0, median_h * 0.45)
    y_groups: List[List[Tuple[float, float, float, str]]] = []
    for item in enriched:
        if not y_groups or abs(item[0] - y_groups[-1][0][0]) > y_tol:
            y_groups.append([item])
        else:
            y_groups[-1].append(item)

    coord_rows_y: List[Tuple[float, List[Tuple[float, str]]]] = []
    header_probe_rows: List[List[Tuple[float, str]]] = []
    raw_lines: List[str] = []
    merge_gap = max(10.0, median_h * 0.65)

    for grp in y_groups:
        grp.sort(key=lambda item: item[1])
        avg_cy = sum(it[0] for it in grp) / len(grp)
        coord_rows_y.append((avg_cy, [(x, txt) for _, x, _, txt in grp]))

        probe: List[Tuple[float, float, str]] = []
        line_chunks: List[str] = []
        for _, x, w, txt in grp:
            if probe and (x - probe[-1][1]) <= merge_gap:
                px, _, ptxt = probe[-1]
                probe[-1] = (px, max(probe[-1][1], x + w), f"{ptxt} {txt}")
                line_chunks[-1] = f"{line_chunks[-1]} {txt}"
            else:
                probe.append((x, x + w, txt))
                line_chunks.append(txt)
        header_probe_rows.append([(px, ptxt) for px, _, ptxt in probe])
        raw_lines.append("  ".join(line_chunks))

    raw_text = "\n".join(raw_lines)
    aligned_table, aligned_ys, new_col_xs = _align_coord_table_with_y(
        coord_rows_y,
        prev_col_xs=last_col_xs,
        x_scale_h=median_h,
        header_probe_rows=header_probe_rows,
    )
    page_rows: List[Dict[str, Any]] = []
    new_col_map = last_col_map
    if aligned_table:
        page_rows, new_col_map = _parse_table_rows(aligned_table, today_str, last_col_map, row_ys=aligned_ys)
    if not page_rows and raw_text.strip():
        page_rows = _parse_text_lines(raw_text, today_str)
    return page_rows, new_col_map, new_col_xs, raw_text


def parse_image(data: bytes, ext: str, today_str: str) -> Dict[str, Any]:
    pages = _run_vision_ocr("image", data, f".{ext}")
    rows: List[Dict[str, Any]] = []
    raw_chunks: List[str] = []
    last_col_map: Optional[Dict[int, str]] = None
    last_col_xs: Optional[List[float]] = None
    for page in pages:
        page_rows, last_col_map, last_col_xs, raw_txt = _ocr_page_to_rows(
            page.get("tokens") or [], today_str, last_col_map, last_col_xs
        )
        rows.extend(page_rows)
        if raw_txt.strip():
            raw_chunks.append(raw_txt)
    rows = _dedupe_rows(rows)
    return {
        "detected_mode": _detect_mode(rows),
        "total_rows": len(rows),
        "rows": rows,
        "raw_text_preview": "\n".join(raw_chunks).strip()[:1500],
        "ocr_used": True,
    }


def parse_pdf(data: bytes, today_str: str) -> Dict[str, Any]:
    rows: List[Dict[str, Any]] = []
    text_chunks: List[str] = []
    last_col_map: Optional[Dict[int, str]] = None
    last_col_xs: Optional[List[float]] = None

    reader = PdfReader(io.BytesIO(data))
    for page in reader.pages:
        page_rows: List[Dict[str, Any]] = []
        coord_rows_y = _extract_coord_rows_with_y(page)
        aligned_table, aligned_ys, last_col_xs = _align_coord_table_with_y(coord_rows_y, last_col_xs)
        if aligned_table:
            parsed, last_col_map = _parse_table_rows(aligned_table, today_str, last_col_map, row_ys=aligned_ys)
            page_rows.extend(parsed)

        layout_txt = ""
        try:
            layout_txt = page.extract_text(extraction_mode="layout") or ""
        except Exception:
            layout_txt = ""
        plain_txt = page.extract_text() or ""
        txt = layout_txt if layout_txt.strip() else plain_txt
        if txt.strip():
            text_chunks.append(txt)

        if not page_rows and txt.strip():
            page_rows.extend(_parse_text_lines(txt, today_str))
        rows.extend(page_rows)

    ocr_used = False
    if not rows and shutil.which("osascript") and OCR_SCRIPT_PATH.exists():
        ocr_pages = _run_vision_ocr("pdf", data, ".pdf")
        ocr_col_map: Optional[Dict[int, str]] = None
        ocr_col_xs: Optional[List[float]] = None
        for op in ocr_pages:
            page_rows, ocr_col_map, ocr_col_xs, raw_txt = _ocr_page_to_rows(
                op.get("tokens") or [], today_str, ocr_col_map, ocr_col_xs
            )
            rows.extend(page_rows)
            if raw_txt.strip():
                text_chunks.append(raw_txt)
        ocr_used = True

    raw_text = "\n".join(text_chunks)
    rows = _dedupe_rows(rows)
    return {
        "detected_mode": _detect_mode(rows),
        "total_rows": len(rows),
        "rows": rows,
        "raw_text_preview": raw_text.strip()[:1500],
        "ocr_used": ocr_used,
    }


def parse_xlsx(data: bytes, today_str: str) -> Dict[str, Any]:
    wb = load_workbook(io.BytesIO(data), data_only=True)
    rows: List[Dict[str, Any]] = []
    preview_lines: List[str] = []
    for ws in wb.worksheets:
        sheet_rows = [[c for c in r] for r in ws.iter_rows(values_only=True)]
        parsed, _ = _parse_table_rows(sheet_rows, today_str)
        rows.extend(parsed)
        for r in sheet_rows[:12]:
            preview_lines.append(" | ".join(str(c or "") for c in r))
    rows = _dedupe_rows(rows)
    return {
        "detected_mode": _detect_mode(rows),
        "total_rows": len(rows),
        "rows": rows,
        "raw_text_preview": "\n".join(preview_lines)[:1500],
        "ocr_used": False,
    }


def parse_csv(data: bytes, today_str: str) -> Dict[str, Any]:
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = data.decode("latin-1")
    reader = csv.reader(io.StringIO(text))
    all_rows = list(reader)
    rows, _ = _parse_table_rows(all_rows, today_str)
    if not rows:
        rows = _parse_text_lines(text, today_str)
    rows = _dedupe_rows(rows)
    return {
        "detected_mode": _detect_mode(rows),
        "total_rows": len(rows),
        "rows": rows,
        "raw_text_preview": text[:1500],
        "ocr_used": False,
    }


def parse_import_file(filename: str, data: bytes, today_str: str) -> Dict[str, Any]:
    ext = (filename or "").rsplit(".", 1)[-1].lower() if "." in (filename or "") else ""
    if ext == "pdf":
        res = parse_pdf(data, today_str)
    elif ext in ("xlsx", "xlsm"):
        res = parse_xlsx(data, today_str)
    elif ext == "csv":
        res = parse_csv(data, today_str)
    elif ext in ("png", "jpg", "jpeg", "webp"):
        res = parse_image(data, ext, today_str)
    else:
        raise ValueError("Unsupported file type. Upload an Excel (.xlsx), PDF, CSV, or screenshot image (PNG/JPG/WEBP).")
    res["filename"] = filename
    return res
