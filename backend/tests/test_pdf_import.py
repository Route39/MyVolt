import io
import os
import re
import uuid
import pytest
import requests
from dotenv import load_dotenv
from openpyxl import Workbook
from pymongo import MongoClient
from reportlab.lib.pagesizes import landscape, A4
from reportlab.pdfgen import canvas
from reportlab.platypus import SimpleDocTemplate, Table

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"

SUFFIX = uuid.uuid4().hex[:4].upper()
CREATED = {"drivers": [], "vehicles": []}


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    m = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    for did in CREATED["drivers"]:
        m.drivers.delete_one({"id": did})
        m.vehicle_assignments.delete_many({"driver_id": did})
        m.audit_logs.delete_many({"entity_id": did})
    for vid in CREATED["vehicles"]:
        m.vehicles.delete_one({"vehicle_id": vid})
        m.audit_logs.delete_many({"entity_id": vid})
    m.audit_logs.delete_many({"action": "Bulk data imported", "ts": {"$gte": "2026-11-20"}})


def admin_headers():
    r = requests.post(f"{API}/auth/login", json={"email": "anita.admin@route39.in", "password": "route39@123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def build_table_pdf(reg1: str, reg2: str) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(A4))
    data = [
        ["Driver Name", "Mobile", "Vehicle No", "Vehicle Type", "City", "Daily Rent", "Joining Date", "Status"],
        [f"TEST_Import Alpha {SUFFIX}", "9845099001", reg1, "EV Auto", "Bengaluru", "₹850", "10/11/2026", "Active"],
        [f"TEST_Import Beta {SUFFIX}", "+91 9840099002", reg2, "EV Sedan", "Chennai", "900", "2026-11-12", "Active"],
    ]
    doc.build([Table(data)])
    return buf.getvalue()


def build_text_pdf(reg1: str) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    c.drawString(40, 760, "Route39 Old Platform Fleet Export")
    c.drawString(40, 720, f"TEST_Text Driver {SUFFIX}  +91 9876543210  {reg1}  Bengaluru  Rs. 850  2026-11-15")
    c.save()
    return buf.getvalue()


class TestPdfExcelCsvImport:
    def test_parse_table_pdf_and_commit(self):
        hdrs = admin_headers()
        reg1 = f"KA 09 ZZ {int(SUFFIX, 16) % 9000 + 1000}"
        reg2 = f"TN 09 ZZ {int(SUFFIX, 16) % 9000 + 1000}"
        pdf_bytes = build_table_pdf(reg1, reg2)

        r = requests.post(
            f"{API}/import/parse",
            headers=hdrs,
            files={"file": ("fleet_export.pdf", io.BytesIO(pdf_bytes), "application/pdf")},
        )
        assert r.status_code == 200, r.text
        parsed = r.json()
        assert parsed["detected_mode"] == "drivers_and_vehicles"
        assert parsed["total_rows"] == 2
        row1, row2 = parsed["rows"][0], parsed["rows"][1]
        assert row1["name"] == f"TEST_Import Alpha {SUFFIX}"
        assert row1["mobile"] == "9845099001"
        assert row1["reg_no"] == reg1
        assert row1["city"] == "Bengaluru"
        assert row1["daily_rent"] == 850.0
        assert row1["joining_date"] == "2026-11-10"

        assert row2["name"] == f"TEST_Import Beta {SUFFIX}"
        assert row2["mobile"] == "9840099002"
        assert row2["reg_no"] == reg2
        assert row2["city"] == "Chennai"
        assert row2["daily_rent"] == 900.0
        assert row2["joining_date"] == "2026-11-12"

        commit = requests.post(
            f"{API}/import/commit",
            headers=hdrs,
            json={"mode": "drivers_and_vehicles", "update_existing": True, "rows": parsed["rows"]},
        )
        assert commit.status_code == 200, commit.text
        res = commit.json()
        assert res["drivers_created"] == 2
        assert res["vehicles_created"] == 2
        assert res["assignments_created"] == 2
        assert res["errors"] == []

        drivers = requests.get(f"{API}/drivers", headers=hdrs, params={"q": SUFFIX}).json()
        assert len(drivers) == 2
        for d in drivers:
            CREATED["drivers"].append(d["id"])
            if d["current_vehicle_id"]:
                CREATED["vehicles"].append(d["current_vehicle_id"])
            if d["city"] == "Bengaluru":
                assert re.match(r"^BLR-D-\d{3,}$", d["driver_code"])
                assert re.match(r"^BLR-\d{3,}$", d["current_vehicle_id"])
            else:
                assert re.match(r"^CHN-D-\d{3,}$", d["driver_code"])
                assert re.match(r"^CHN-\d{3,}$", d["current_vehicle_id"])

    def test_parse_unstructured_text_pdf(self):
        hdrs = admin_headers()
        reg = f"KA 05 MN {int(SUFFIX, 16) % 9000 + 1000}"
        pdf_bytes = build_text_pdf(reg)
        r = requests.post(
            f"{API}/import/parse",
            headers=hdrs,
            files={"file": ("raw_text_export.pdf", io.BytesIO(pdf_bytes), "application/pdf")},
        )
        assert r.status_code == 200, r.text
        parsed = r.json()
        assert parsed["total_rows"] >= 1
        row = parsed["rows"][0]
        assert f"TEST_Text Driver {SUFFIX}" in row["name"]
        assert row["mobile"] == "9876543210"
        assert row["reg_no"] == reg
        assert row["city"] == "Bengaluru"
        assert row["daily_rent"] == 850.0
        assert row["joining_date"] == "2026-11-15"

    def test_parse_xlsx_and_csv(self):
        hdrs = admin_headers()

        wb = Workbook()
        ws = wb.active
        ws.append(["Driver Name", "Mobile", "Vehicle No", "City", "Daily Rent", "Joining Date"])
        ws.append([f"TEST_Xlsx {SUFFIX}", "9845011122", f"KA01XY{int(SUFFIX, 16) % 9000 + 1000}", "Bengaluru", 800, "2026-11-05"])
        xbuf = io.BytesIO()
        wb.save(xbuf)
        xr = requests.post(
            f"{API}/import/parse",
            headers=hdrs,
            files={"file": ("drivers.xlsx", io.BytesIO(xbuf.getvalue()), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )
        assert xr.status_code == 200, xr.text
        assert xr.json()["total_rows"] == 1
        assert xr.json()["rows"][0]["mobile"] == "9845011122"

        csv_bytes = (
            "Driver Name,Phone,Registration,City,Daily Rent\n"
            f"TEST_Csv {SUFFIX},9848011133,TS 09 AB 4455,Hyderabad,950\n"
        ).encode("utf-8")
        cr = requests.post(
            f"{API}/import/parse",
            headers=hdrs,
            files={"file": ("drivers.csv", io.BytesIO(csv_bytes), "text/csv")},
        )
        assert cr.status_code == 200, cr.text
        assert cr.json()["total_rows"] == 1
        assert cr.json()["rows"][0]["city"] == "Hyderabad"
        assert cr.json()["rows"][0]["reg_no"] == "TS 09 AB 4455"
