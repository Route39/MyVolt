import csv
import io
import re
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Tuple

from openpyxl import load_workbook
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
    ),
    "driver_code": (
        "driver id",
        "driver code",
        "driver_code",
        "driver_id",
        "emp id",
        "employee id",
        "driver no",
        "code",
    ),
    "city": ("city", "location", "branch", "hub", "center", "region", "zone"),
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
    ),
    "vehicle_type": ("vehicle type", "type", "model", "category", "segment", "ev type", "vehicle model"),
    "details": ("details", "make", "description", "notes", "remarks", "vehicle details"),
    "status": ("status", "state", "active", "driver status", "vehicle status"),
}

REG_RX = re.compile(r"\b([A-Z]{2})[\s-]*(\d{1,2})[\s-]*([A-Z]{1,3})[\s-]*(\d{3,4})\b", re.IGNORECASE)
MOBILE_RX = re.compile(r"(?:\+?91[\s-]*)?\b([6-9]\d{9})\b")
DRIVER_CODE_RX = re.compile(r"\b([A-Z]{3}-D-\d{3,})\b", re.IGNORECASE)
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


def clean_reg_no(val: Any) -> str:
    s = re.sub(r"\s+", " ", str(val or "").strip().upper())
    if not s:
        return ""
    m = REG_RX.search(s)
    if m:
        return f"{m.group(1).upper()} {m.group(2)} {m.group(3).upper()} {m.group(4)}"
    return s


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


def _match_header_col(header_text: str) -> Optional[str]:
    norm = _norm_header(header_text)
    if not norm or norm in ("s no", "sl no", "sr no", "serial", "no", "sno"):
        return None
    if norm == "vehicle id":
        return None
    for field, aliases in HEADER_ALIASES.items():
        if norm in aliases:
            return field
    for field, aliases in HEADER_ALIASES.items():
        for alias in aliases:
            if len(alias) >= 4 and alias in norm:
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
        "reg_no": "",
        "vehicle_type": "",
        "status": "Active",
        "details": "",
    }


def _row_from_mapping(cells: List[Any], col_map: Dict[int, str], today_str: str) -> Optional[Dict[str, Any]]:
    raw: Dict[str, Any] = {}
    for idx, field in col_map.items():
        if idx < len(cells):
            raw[field] = cells[idx]
    name = re.sub(r"\s+", " ", str(raw.get("name") or "").strip())
    reg_no = clean_reg_no(raw.get("reg_no"))
    mobile = clean_mobile(raw.get("mobile"))
    if not name and not reg_no and not mobile:
        return None
    if name.lower() in ("total", "grand total", "summary", "driver name", "name"):
        return None
    if reg_no and reg_no.lower() in ("vehicle no", "reg no", "registration"):
        return None

    item = _empty_row(today_str)
    item["name"] = name
    item["mobile"] = mobile
    item["city"] = clean_city(raw.get("city"), default="Bengaluru")
    item["daily_rent"] = clean_rent(raw.get("daily_rent"), default=700.0)
    joining = clean_date(raw.get("joining_date"), today_str)
    item["joining_date"] = joining
    item["handover_date"] = clean_date(raw.get("handover_date"), joining) if raw.get("handover_date") else ""
    item["rent_start_date"] = clean_date(raw.get("rent_start_date"), joining) if raw.get("rent_start_date") else ""
    code_raw = str(raw.get("driver_code") or "").strip().upper()
    item["driver_code"] = code_raw if re.match(r"^[A-Z]{3}-D-\d{3,}$", code_raw) else ""
    item["reg_no"] = reg_no
    item["vehicle_type"] = str(raw.get("vehicle_type") or "").strip()
    item["status"] = clean_status(raw.get("status"), kind="driver" if name else "vehicle")
    item["details"] = str(raw.get("details") or "").strip()
    return item


def _parse_table_rows(rows: List[List[Any]], today_str: str, fallback_map: Optional[Dict[int, str]] = None):
    cleaned = [[c for c in (r or [])] for r in rows if any(str(c or "").strip() for c in (r or []))]
    if not cleaned:
        return [], fallback_map

    col_map: Optional[Dict[int, str]] = None
    start_idx = 0
    for i, r in enumerate(cleaned[:6]):
        cand = _build_col_map(r)
        if len(cand) >= 2:
            col_map = cand
            start_idx = i + 1
            break

    if not col_map and fallback_map and len(cleaned[0]) >= max(fallback_map.keys(), default=0) + 1:
        col_map = fallback_map
        start_idx = 0

    if not col_map:
        return [], fallback_map

    parsed: List[Dict[str, Any]] = []
    for r in cleaned[start_idx:]:
        # Skip repeated header rows across page breaks
        if len(_build_col_map(r)) >= 2 and _build_col_map(r) == col_map:
            continue
        item = _row_from_mapping(r, col_map, today_str)
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


def _extract_coord_rows(page) -> List[List[Tuple[float, str]]]:
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

    rows: List[List[Tuple[float, str]]] = []
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
        rows.append([(x, txt) for x, _, txt, _ in merged])
    return rows


def _align_coord_table(
    coord_rows: List[List[Tuple[float, str]]], prev_col_xs: Optional[List[float]] = None
) -> Tuple[List[List[str]], Optional[List[float]]]:
    if not coord_rows:
        return [], prev_col_xs

    col_xs = prev_col_xs
    header_idx = None
    for idx, row in enumerate(coord_rows[:8]):
        cand = _build_col_map([txt for _, txt in row])
        if len(cand) >= 2:
            col_xs = [x for x, _ in row]
            header_idx = idx
            break

    if not col_xs:
        return [[txt for _, txt in r] for r in coord_rows], None

    aligned: List[List[str]] = []
    for idx, row in enumerate(coord_rows):
        if header_idx is not None and idx < header_idx:
            continue
        if len(row) == len(col_xs):
            aligned.append([txt for _, txt in row])
            continue
        cells = [""] * len(col_xs)
        for x, txt in row:
            best_j = 0
            best_dist = abs(x - col_xs[0])
            for j, cx in enumerate(col_xs):
                if j + 1 < len(col_xs):
                    mid = (cx + col_xs[j + 1]) / 2.0
                    if x < mid and x >= cx - 18.0:
                        best_j = j
                        break
                dist = abs(x - cx)
                if dist < best_dist:
                    best_dist = dist
                    best_j = j
                if j + 1 == len(col_xs) and x >= (col_xs[j - 1] + cx) / 2.0:
                    best_j = j
            cells[best_j] = f"{cells[best_j]} {txt}".strip() if cells[best_j] else txt
        aligned.append(cells)
    return aligned, col_xs


def parse_pdf(data: bytes, today_str: str) -> Dict[str, Any]:
    rows: List[Dict[str, Any]] = []
    text_chunks: List[str] = []
    last_col_map: Optional[Dict[int, str]] = None
    last_col_xs: Optional[List[float]] = None

    reader = PdfReader(io.BytesIO(data))
    for page in reader.pages:
        page_rows: List[Dict[str, Any]] = []
        coord_rows = _extract_coord_rows(page)
        aligned_table, last_col_xs = _align_coord_table(coord_rows, last_col_xs)
        if aligned_table:
            parsed, last_col_map = _parse_table_rows(aligned_table, today_str, last_col_map)
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

    raw_text = "\n".join(text_chunks)
    rows = _dedupe_rows(rows)
    return {
        "detected_mode": _detect_mode(rows),
        "total_rows": len(rows),
        "rows": rows,
        "raw_text_preview": raw_text.strip()[:1500],
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
    }


def parse_import_file(filename: str, data: bytes, today_str: str) -> Dict[str, Any]:
    ext = (filename or "").rsplit(".", 1)[-1].lower() if "." in (filename or "") else ""
    if ext == "pdf":
        res = parse_pdf(data, today_str)
    elif ext in ("xlsx", "xlsm"):
        res = parse_xlsx(data, today_str)
    elif ext == "csv":
        res = parse_csv(data, today_str)
    else:
        raise ValueError("Unsupported file type. Upload a PDF, XLSX, or CSV file.")
    res["filename"] = filename
    return res
