import io
import os
import re
import uuid
import pytest
import requests
from dotenv import load_dotenv
from openpyxl import Workbook, load_workbook
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
    for code in ["R39D-TUP001"]:
        d = m.drivers.find_one({"driver_code": code})
        if d:
            m.drivers.delete_one({"id": d["id"]})
            m.vehicle_assignments.delete_many({"driver_id": d["id"]})
    for rk in ["TUP001HJJHJJHJ", "141KA51AJ2624", "150KA05AM1234"]:
        v = m.vehicles.find_one({"reg_key": rk})
        if v:
            m.vehicles.delete_one({"vehicle_id": v["vehicle_id"]})
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

    def test_template_and_exports(self):
        hdrs = admin_headers()
        xlsx_mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

        tpl = requests.get(f"{API}/import/template", headers=hdrs)
        assert tpl.status_code == 200, tpl.text
        assert tpl.headers["content-type"].startswith(xlsx_mime)
        assert tpl.content[:2] == b"PK"
        wb_tpl = load_workbook(io.BytesIO(tpl.content))
        assert wb_tpl.active.cell(1, 1).value == "Driver"

        drv_exp = requests.get(f"{API}/drivers", headers=hdrs, params={"format": "xlsx", "city": "Bengaluru"})
        assert drv_exp.status_code == 200, drv_exp.text
        assert drv_exp.headers["content-type"].startswith(xlsx_mime)
        assert drv_exp.content[:2] == b"PK"
        wb_drv = load_workbook(io.BytesIO(drv_exp.content))
        drv_rows = list(wb_drv.active.iter_rows(values_only=True))
        assert len(drv_rows) >= 5
        assert all(r[3] == "Bengaluru" for r in drv_rows[4:] if r[0])

        veh_exp = requests.get(f"{API}/vehicles", headers=hdrs, params={"format": "xlsx", "city": "Chennai"})
        assert veh_exp.status_code == 200, veh_exp.text
        assert veh_exp.headers["content-type"].startswith(xlsx_mime)
        assert veh_exp.content[:2] == b"PK"
        wb_veh = load_workbook(io.BytesIO(veh_exp.content))
        veh_rows = list(wb_veh.active.iter_rows(values_only=True))
        assert len(veh_rows) >= 5
        assert all(r[6] == "Chennai" for r in veh_rows[4:] if r[0])

    def test_roundtrip_excel_with_extra_columns_and_city_filter(self):
        hdrs = admin_headers()
        reg_cbe = f"TN 37 ZZ {int(SUFFIX, 16) % 9000 + 1000}"
        reg_unassigned = f"TN 38 ZZ {int(SUFFIX, 16) % 9000 + 1000}"

        wb = Workbook()
        ws = wb.active
        ws.append(["Old Fleet Platform Master Sheet"])
        ws.append([])
        ws.append(["Driver Name", "Phone", "City", "Vehicle Reg. No.", "Vehicle Type", "Daily Rent (₹)", "Joining Date", "Battery Pack", "Hub"])
        ws.append([f"TEST_Cbe {SUFFIX}", "9842201122", "Coimbatore", reg_cbe, "EV Auto", 880, "2026-11-10", "Lithium 7.2kWh", "Gandhipuram"])
        ws.append(["", "", "Coimbatore", reg_unassigned, "EV Van", 1250, "", "Lithium 10kWh", "RS Puram"])
        xbuf = io.BytesIO()
        wb.save(xbuf)

        pr = requests.post(
            f"{API}/import/parse",
            headers=hdrs,
            files={"file": ("old_fleet_master.xlsx", io.BytesIO(xbuf.getvalue()), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )
        assert pr.status_code == 200, pr.text
        parsed = pr.json()
        assert parsed["total_rows"] == 2
        r0, r1 = parsed["rows"][0], parsed["rows"][1]
        assert r0["name"] == f"TEST_Cbe {SUFFIX}"
        assert r0["city"] == "Coimbatore"
        assert r0["daily_rent"] == 880.0
        assert "Lithium 7.2kWh" in r0["details"]
        assert "Hub: Gandhipuram" in r0["details"]
        assert r1["reg_no"] == reg_unassigned
        assert r1["daily_rent"] == 1250.0
        assert "Lithium 10kWh" in r1["details"]
        assert "Hub: RS Puram" in r1["details"]

        cr = requests.post(
            f"{API}/import/commit",
            headers=hdrs,
            json={"mode": "drivers_and_vehicles", "update_existing": True, "rows": parsed["rows"]},
        )
        assert cr.status_code == 200, cr.text
        res = cr.json()
        assert res["drivers_created"] == 1
        assert res["vehicles_created"] == 2
        assert res["assignments_created"] == 1

        drvs = requests.get(f"{API}/drivers", headers=hdrs, params={"city": "Coimbatore", "q": SUFFIX}).json()
        assert len(drvs) == 1
        assert drvs[0]["city"] == "Coimbatore"
        CREATED["drivers"].append(drvs[0]["id"])

        vehs = requests.get(f"{API}/vehicles", headers=hdrs, params={"city": "Coimbatore", "q": "ZZ"}).json()
        matched_v = [v for v in vehs if v["reg_no"] in (reg_cbe, reg_unassigned)]
        assert len(matched_v) == 2
        for v in matched_v:
            CREATED["vehicles"].append(v["vehicle_id"])
            assert v["city"] == "Coimbatore"
            if v["reg_no"] == reg_unassigned:
                assert v["daily_rent"] == 1250.0
                assert "Hub: RS Puram" in v["details"]
            else:
                assert v["current_driver"]["name"] == f"TEST_Cbe {SUFFIX}"
                assert v["daily_rent"] == 880.0

    def test_image1_drivers_multiline_pdf_import(self):
        hdrs = admin_headers()
        buf = io.BytesIO()
        doc = SimpleDocTemplate(buf, pagesize=landscape(A4))
        data = [
            ["Driver", "ID", "Phone", "Vehicle", "Package", "City", "Joining Date"],
            ["varshini", "R39D-\nTUP001", "7904800475", "TUP001 -\nhjjhjjhj", "Silver\nPackage", "Tiruppur", "2026-10-03"],
        ]
        doc.build([Table(data)])
        pr = requests.post(
            f"{API}/import/parse",
            headers=hdrs,
            files={"file": ("image1_drivers.pdf", io.BytesIO(buf.getvalue()), "application/pdf")},
        )
        assert pr.status_code == 200, pr.text
        parsed = pr.json()
        assert parsed["total_rows"] == 1
        row = parsed["rows"][0]
        assert row["name"] == "varshini"
        assert row["driver_code"] == "R39D-TUP001"
        assert row["mobile"] == "7904800475"
        assert row["reg_no"] == "TUP001 - hjjhjjhj"
        assert row["package"] == "Silver Package"
        assert row["city"] == "Tiruppur"
        assert row["joining_date"] == "2026-10-03"

        cr = requests.post(
            f"{API}/import/commit",
            headers=hdrs,
            json={"mode": "drivers_and_vehicles", "update_existing": True, "rows": parsed["rows"]},
        )
        assert cr.status_code == 200, cr.text
        res = cr.json()
        assert res["drivers_created"] == 1
        assert res["vehicles_created"] == 1
        assert res["assignments_created"] == 1

        drvs = requests.get(f"{API}/drivers", headers=hdrs, params={"q": "R39D-TUP001"}).json()
        assert len(drvs) == 1
        d = drvs[0]
        CREATED["drivers"].append(d["id"])
        if d.get("current_vehicle_id"):
            CREATED["vehicles"].append(d["current_vehicle_id"])
        assert d["driver_code"] == "R39D-TUP001"
        assert d["name"] == "varshini"
        assert d["mobile"] == "7904800475"
        assert d["vehicle_no"] == "TUP001 - hjjhjjhj"
        assert d["package"] == "Silver Package"
        assert d["city"] == "Tiruppur"
        assert d["joining_date"] == "2026-10-03"

    def test_image2_vehicles_multiline_pdf_import(self):
        hdrs = admin_headers()
        ravi_name = f"Ravi_{SUFFIX}"
        buf = io.BytesIO()
        doc = SimpleDocTemplate(buf, pagesize=landscape(A4))
        data = [
            ["Vehicle", "Status", "Driver", "City", "VIN", "Rental Ends"],
            ["141 - KA51AJ2624", "available", "Not\nAssigned", "Bangalore", "MBX0007EF2B266083", "(blank)"],
            ["150 - KA05AM1234", "rented", ravi_name, "Bangalore", "MBX0007EF2B260000", "2026-11-25"],
        ]
        doc.build([Table(data)])
        pr = requests.post(
            f"{API}/import/parse",
            headers=hdrs,
            files={"file": ("image2_vehicles.pdf", io.BytesIO(buf.getvalue()), "application/pdf")},
        )
        assert pr.status_code == 200, pr.text
        parsed = pr.json()
        assert parsed["total_rows"] == 2
        v0, v1 = parsed["rows"][0], parsed["rows"][1]
        assert v0["reg_no"] == "141 - KA51AJ2624"
        assert v0["rental_status"] == "available"
        assert v0["name"] == ""
        assert v0["city"] == "Bengaluru"
        assert v0["vin"] == "MBX0007EF2B266083"
        assert v0["rental_ends"] == ""

        assert v1["reg_no"] == "150 - KA05AM1234"
        assert v1["rental_status"] == "rented"
        assert v1["name"] == ravi_name
        assert v1["city"] == "Bengaluru"
        assert v1["vin"] == "MBX0007EF2B260000"
        assert v1["rental_ends"] == "2026-11-25"

        cr = requests.post(
            f"{API}/import/commit",
            headers=hdrs,
            json={"mode": "vehicles", "update_existing": True, "rows": parsed["rows"]},
        )
        assert cr.status_code == 200, cr.text
        res = cr.json()
        assert res["vehicles_created"] == 2
        assert res["drivers_created"] == 1
        assert res["assignments_created"] == 1

        vehs = requests.get(f"{API}/vehicles", headers=hdrs, params={"q": "MBX0007EF2B"}).json()
        by_reg = {v["reg_no"]: v for v in vehs}
        assert "141 - KA51AJ2624" in by_reg and "150 - KA05AM1234" in by_reg
        av = by_reg["141 - KA51AJ2624"]
        rv = by_reg["150 - KA05AM1234"]
        CREATED["vehicles"].extend([av["vehicle_id"], rv["vehicle_id"]])
        CREATED["drivers"].append(rv["current_driver"]["id"])
        assert av["rental_status"] == "available"
        assert av["current_driver"] is None
        assert av["vin"] == "MBX0007EF2B266083"
        assert av["rental_ends"] == ""
        assert rv["rental_status"] == "rented"
        assert rv["vin"] == "MBX0007EF2B260000"
        assert rv["rental_ends"] == "2026-11-25"
        assert rv["current_driver"]["name"] == ravi_name
