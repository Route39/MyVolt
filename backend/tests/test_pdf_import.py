import io
import os
import re
import time
import uuid
import pytest
import requests
from dotenv import load_dotenv
from openpyxl import Workbook, load_workbook
from PIL import Image, ImageDraw
from pymongo import MongoClient
from reportlab.lib.pagesizes import landscape, A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from reportlab.platypus import SimpleDocTemplate, Table

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"

SUFFIX = uuid.uuid4().hex[:4].upper()
CREATED = {"drivers": [], "vehicles": [], "txns": []}
IMG1_PATH = "/Users/admin/.gemini/antigravity/brain/fa4f0867-f97a-43ed-b41d-b534c4d6631f/.user_uploaded/media_1795185152159_0809fd1a.png"
IMG2_PATH = "/Users/admin/.gemini/antigravity/brain/fa4f0867-f97a-43ed-b41d-b534c4d6631f/.user_uploaded/media_1795185162152_00546b4e.png"


def _cleanup_test_records():
    m = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    for tid in CREATED["txns"]:
        m.transactions.delete_one({"id": tid})
        m.notifications.delete_many({"txn_id": tid})
        m.audit_logs.delete_many({"entity_id": tid})
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
            m.transactions.delete_many({"driver_id": d["id"]})
            m.drivers.delete_one({"id": d["id"]})
            m.vehicle_assignments.delete_many({"driver_id": d["id"]})
            m.audit_logs.delete_many({"driver_id": d["id"]})
    for name_rx in [re.compile(r"^Ravi_"), re.compile(r"^TEST_")]:
        drvs = list(m.drivers.find({"name": name_rx}, {"_id": 0, "id": 1, "current_vehicle_id": 1}))
        if drvs:
            dids = [d["id"] for d in drvs]
            m.transactions.delete_many({"driver_id": {"$in": dids}})
            m.vehicle_assignments.delete_many({"driver_id": {"$in": dids}})
            m.audit_logs.delete_many({"driver_id": {"$in": dids}})
            m.drivers.delete_many({"id": {"$in": dids}})
    for rk in ["TUP001HJJHJJHJ", "141KA51AJ2624", "150KA05AM1234"]:
        v = m.vehicles.find_one({"reg_key": rk})
        if v:
            m.vehicles.delete_one({"vehicle_id": v["vehicle_id"]})
            m.audit_logs.delete_many({"entity_id": v["vehicle_id"]})
    m.vehicles.delete_many({"reg_no": re.compile(r"^(TEST_|B[0-9]{3} - TN66Z|141 - KA51|150 - KA05|TUP001)")})
    m.vehicles.delete_many({"vin": re.compile(r"^(MBX0007BULK|MBX0007EF2B)")})
    m.drivers.delete_many({"mobile": {"$in": ["9845099001", "9840099002", "9876543210", "9845099887", "7904800475"]}})
    m.drivers.delete_many({"mobile": re.compile(r"^91[0-9]{8}$")})
    m.audit_logs.delete_many({"action": "Bulk data imported", "ts": {"$gte": "2026-11-20"}})


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    _cleanup_test_records()
    yield
    _cleanup_test_records()


def login_headers(mobile: str, password: str = "route39@123"):
    r = requests.post(f"{API}/auth/login", json={"mobile": mobile, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def admin_headers():
    return login_headers("9845000001")


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
        assert row1["city"] in ("Bengaluru", "Bangalore")
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
            if d["city"] in ("Bengaluru", "Bangalore"):
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
        assert row["city"] in ("Bengaluru", "Bangalore")
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
        assert drv_rows[3] == ("DRIVER ID", "DRIVER NAME", "PHONE NUMBER", "CITY", "JOINING DATE", "RENT")
        assert all(r[3] in ("Bengaluru", "Bangalore") for r in drv_rows[4:] if r[0])

        veh_exp = requests.get(f"{API}/vehicles", headers=hdrs, params={"format": "xlsx", "city": "Chennai"})
        assert veh_exp.status_code == 200, veh_exp.text
        assert veh_exp.headers["content-type"].startswith(xlsx_mime)
        assert veh_exp.content[:2] == b"PK"
        wb_veh = load_workbook(io.BytesIO(veh_exp.content))
        veh_rows = list(wb_veh.active.iter_rows(values_only=True))
        assert len(veh_rows) >= 5
        assert all(r[3] == "Chennai" for r in veh_rows[4:] if r[0])

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
        assert "package" not in row
        assert "Package" not in row["details"]
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
        assert "package" not in d
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
        assert v0["city"] in ("Bengaluru", "Bangalore")
        assert v0["vin"] == "MBX0007EF2B266083"
        assert v0["rental_ends"] == ""

        assert v1["reg_no"] == "150 - KA05AM1234"
        assert v1["rental_status"] == "rented"
        assert v1["name"] == ravi_name
        assert v1["city"] in ("Bengaluru", "Bangalore")
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

    def test_image1_actual_png_ocr_import(self):
        hdrs = admin_headers()
        if os.path.exists(IMG1_PATH):
            with open(IMG1_PATH, "rb") as f:
                img_bytes = f.read()
        else:
            im = Image.new("RGB", (1024, 181), "white")
            draw = ImageDraw.Draw(im)
            draw.text((28, 22), "Driver        ID           Phone        Vehicle       Package       City        Joining", fill="black")
            draw.text((852, 46), "Date", fill="black")
            draw.text((28, 95), "varshini      R39D-        7904800475   TUP001-       Silver        Tiruppur    2026-10-03", fill="black")
            draw.text((130, 120), "TUP001                    hjjhjjhj      Package", fill="black")
            b = io.BytesIO()
            im.save(b, format="PNG")
            img_bytes = b.getvalue()

        r = requests.post(
            f"{API}/import/parse",
            headers=hdrs,
            files={"file": ("image1.png", io.BytesIO(img_bytes), "image/png")},
        )
        assert r.status_code == 200, r.text
        parsed = r.json()
        assert parsed["ocr_used"] is True
        assert parsed["total_rows"] == 1
        row = parsed["rows"][0]
        assert row["name"] == "varshini"
        assert row["driver_code"] == "R39D-TUP001"
        assert row["mobile"] == "7904800475"
        assert row["reg_no"].startswith("TUP001 - ")
        assert "package" not in row
        assert "Package" not in row["details"]
        assert row["city"] == "Tiruppur"
        assert row["joining_date"] == "2026-10-03"
        assert row["has_joining_date"] is True

    def test_image2_actual_png_ocr_import_and_scanned_pdf(self):
        hdrs = admin_headers()
        if os.path.exists(IMG2_PATH):
            with open(IMG2_PATH, "rb") as f:
                img_bytes = f.read()
        else:
            im = Image.new("RGB", (1024, 224), "white")
            draw = ImageDraw.Draw(im)
            draw.text((18, 24), "Vehicle               Status     Driver        City        VIN                 Rental", fill="black")
            draw.text((855, 48), "Ends", fill="black")
            draw.text((16, 100), "141 - KA51AJ2624      available  Not           Bangalore   MBX0007EF2B266083   (blank)", fill="black")
            draw.text((340, 124), "Assigned", fill="black")
            draw.text((16, 176), "150 - KA05AM1234      rented     Ravi          Bangalore   MBX0007EF2B260000   2026-11-25", fill="black")
            b = io.BytesIO()
            im.save(b, format="PNG")
            img_bytes = b.getvalue()

        # 1. Direct PNG upload
        r_png = requests.post(
            f"{API}/import/parse",
            headers=hdrs,
            files={"file": ("image2.png", io.BytesIO(img_bytes), "image/png")},
        )
        assert r_png.status_code == 200, r_png.text
        parsed_png = r_png.json()

        # 2. Image-only scanned PDF containing the same image
        im2 = Image.open(io.BytesIO(img_bytes))
        pdf_buf = io.BytesIO()
        c = canvas.Canvas(pdf_buf, pagesize=(im2.width, im2.height))
        c.drawImage(ImageReader(io.BytesIO(img_bytes)), 0, 0, width=im2.width, height=im2.height)
        c.save()
        r_pdf = requests.post(
            f"{API}/import/parse",
            headers=hdrs,
            files={"file": ("image2_scanned.pdf", io.BytesIO(pdf_buf.getvalue()), "application/pdf")},
        )
        assert r_pdf.status_code == 200, r_pdf.text
        parsed_pdf = r_pdf.json()

        for parsed in (parsed_png, parsed_pdf):
            assert parsed["ocr_used"] is True
            assert parsed["total_rows"] == 2
            v0, v1 = parsed["rows"][0], parsed["rows"][1]
            assert v0["reg_no"] == "141 - KA51AJ2624"
            assert v0["rental_status"] == "available"
            assert v0["name"] == ""
            assert v0["city"] in ("Bengaluru", "Bangalore")
            assert v0["vin"] == "MBX0007EF2B266083"
            assert v0["rental_ends"] == ""
            assert v0["has_daily_rent"] is False
            assert v0["has_joining_date"] is False

            assert v1["reg_no"] == "150 - KA05AM1234"
            assert v1["rental_status"] == "rented"
            assert v1["name"] == "Ravi"
            assert v1["city"] in ("Bengaluru", "Bangalore")
            assert v1["vin"] == "MBX0007EF2B260000"
            assert v1["rental_ends"] == "2026-11-25"
            assert v1["has_daily_rent"] is False
            assert v1["has_joining_date"] is False

    def test_full_platform_end_to_end_with_imported_image1_and_image2_data(self):
        _cleanup_test_records()
        hdrs = admin_headers()
        staff_hdrs = login_headers("9845000004")
        acc_hdrs = login_headers("9845000002")
        ravi_e2e = f"Ravi_E2E_{SUFFIX}"

        # Commit Image 1 + Image 2 rows cleanly
        commit_rows = [
            {
                "name": "varshini",
                "driver_code": "R39D-TUP001",
                "mobile": "7904800475",
                "reg_no": "TUP001 - hjjhjjhj",
                "city": "Tiruppur",
                "joining_date": "2026-10-03",
                "daily_rent": 800,
                "status": "Active",
                "has_daily_rent": True,
                "has_joining_date": True,
            },
            {
                "name": "",
                "reg_no": "141 - KA51AJ2624",
                "city": "Bengaluru",
                "vin": "MBX0007EF2B266083",
                "rental_ends": "",
                "rental_status": "available",
                "status": "Active",
                "has_daily_rent": False,
                "has_joining_date": False,
            },
            {
                "name": ravi_e2e,
                "mobile": "9845099887",
                "reg_no": "150 - KA05AM1234",
                "city": "Bengaluru",
                "vin": "MBX0007EF2B260000",
                "rental_ends": "2026-11-25",
                "rental_status": "rented",
                "joining_date": "2026-10-15",
                "daily_rent": 950,
                "status": "Active",
                "has_daily_rent": True,
                "has_joining_date": True,
            },
        ]
        cr = requests.post(
            f"{API}/import/commit",
            headers=hdrs,
            json={"mode": "drivers_and_vehicles", "update_existing": True, "rows": commit_rows},
        )
        assert cr.status_code == 200, cr.text
        cres = cr.json()
        assert cres["errors"] == []

        # 1. Drivers endpoint + filter by city & name
        drvs = requests.get(f"{API}/drivers", headers=hdrs, params={"city": "Tiruppur", "q": "varshini"}).json()
        assert len(drvs) == 1
        varshini = drvs[0]
        CREATED["drivers"].append(varshini["id"])
        if varshini.get("current_vehicle_id"):
            CREATED["vehicles"].append(varshini["current_vehicle_id"])
        assert varshini["driver_code"] == "R39D-TUP001"
        assert "package" not in varshini
        assert varshini["vehicle_no"] == "TUP001 - hjjhjjhj"
        assert varshini["daily_rent"] == 800

        # 2. Vehicles endpoint + status/driver search + XLSX filtered export
        avail = requests.get(
            f"{API}/vehicles", headers=hdrs, params={"status": "available", "q": "MBX0007EF2B266083"}
        ).json()
        assert len(avail) == 1 and avail[0]["reg_no"] == "141 - KA51AJ2624"
        CREATED["vehicles"].append(avail[0]["vehicle_id"])

        by_driver_q = requests.get(f"{API}/vehicles", headers=hdrs, params={"q": "varshini"}).json()
        assert any(v["reg_no"] == "TUP001 - hjjhjjhj" for v in by_driver_q)

        avail_xlsx = requests.get(f"{API}/vehicles", headers=hdrs, params={"status": "available", "format": "xlsx"})
        assert avail_xlsx.status_code == 200 and avail_xlsx.content[:2] == b"PK"
        wb_avail = load_workbook(io.BytesIO(avail_xlsx.content))
        assert list(wb_avail.active.iter_rows(values_only=True))[3] == ("VEHICLE ID", "VEHICLE NUMBER", "VIN NUMBER", "CITY")
        avail_rows = [r for r in list(wb_avail.active.iter_rows(values_only=True))[4:] if r and r[0]]
        assert avail_rows and any("141" in str(r[0]) or "KA51" in str(r[1]) for r in avail_rows)

        # Track Ravi E2E driver + vehicle for cleanup
        ravi_drv = requests.get(f"{API}/drivers", headers=hdrs, params={"q": ravi_e2e}).json()[0]
        CREATED["drivers"].append(ravi_drv["id"])
        if ravi_drv.get("current_vehicle_id"):
            CREATED["vehicles"].append(ravi_drv["current_vehicle_id"])

        # 3. Non-destructive re-import from Image 2 (has_daily_rent=False, has_joining_date=False) preserves 950 and 2026-10-15
        reimp = requests.post(
            f"{API}/import/commit",
            headers=hdrs,
            json={
                "mode": "vehicles",
                "update_existing": True,
                "rows": [
                    {
                        "name": ravi_e2e,
                        "reg_no": "150 - KA05AM1234",
                        "city": "Bengaluru",
                        "vin": "MBX0007EF2B260000",
                        "rental_ends": "2026-11-30",
                        "rental_status": "rented",
                        "daily_rent": 700,
                        "joining_date": "",
                        "status": "Active",
                        "has_daily_rent": False,
                        "has_joining_date": False,
                    }
                ],
            },
        )
        assert reimp.status_code == 200, reimp.text
        ravi_after = requests.get(f"{API}/drivers/{ravi_drv['id']}", headers=hdrs).json()
        assert ravi_after["daily_rent"] == 950
        assert ravi_after["joining_date"] == "2026-10-15"
        assert ravi_after["current_vehicle"]["rental_ends"] == "2026-11-30"

        # 4. Re-importing 150 - KA05AM1234 as available / Not Assigned unassigns driver
        unassign_res = requests.post(
            f"{API}/import/commit",
            headers=hdrs,
            json={
                "mode": "vehicles",
                "update_existing": True,
                "rows": [
                    {
                        "name": "Not Assigned",
                        "reg_no": "150 - KA05AM1234",
                        "city": "Bengaluru",
                        "vin": "MBX0007EF2B260000",
                        "rental_ends": "(blank)",
                        "rental_status": "available",
                        "status": "Active",
                        "has_daily_rent": False,
                        "has_joining_date": False,
                    }
                ],
            },
        )
        assert unassign_res.status_code == 200, unassign_res.text
        veh_150 = requests.get(f"{API}/vehicles", headers=hdrs, params={"q": "KA05AM1234"}).json()[0]
        assert veh_150["current_driver"] is None
        assert veh_150["rental_status"] == "available"
        assert veh_150["rental_ends"] == ""

        # 5. Overview includes Tiruppur in by_city
        ov = requests.get(f"{API}/overview", headers=hdrs).json()
        tup_ov = next((c for c in ov.get("by_city", []) if c["city"] == "Tiruppur"), None)
        assert tup_ov is not None
        assert tup_ov["active_drivers"] >= 1
        assert tup_ov["vehicles_rented"] >= 1

        # 6. Board + Calendar for varshini
        board_before = requests.get(f"{API}/board", headers=hdrs, params={"city": "Tiruppur"}).json()
        today_str = board_before["date"]
        v_board = next(x for x in board_before["rows"] if x["id"] == varshini["id"])
        assert "package" not in v_board
        assert v_board["expected"] == 800

        y_now, m_now = int(today_str[:4]), int(today_str[5:7])
        cal = requests.get(
            f"{API}/drivers/{varshini['id']}/calendar",
            headers=staff_hdrs,
            params={"year": y_now, "month": m_now},
        ).json()
        assert "package" not in cal["driver"]
        assert cal["driver"]["current_vehicle"]["reg_no"] == "TUP001 - hjjhjjhj"
        assert len(cal["days"]) >= 28

        # 7. Full Payment -> Accounts Approval -> Ledger -> Reports -> Board verification lifecycle
        tx_r = requests.post(
            f"{API}/transactions",
            headers=staff_hdrs,
            json={
                "driver_id": varshini["id"],
                "payment_date": today_str,
                "amount": 800,
                "utr": "",
                "method": "Cash",
                "remarks": "E2E imported Image1 payment",
                "vehicle_id": varshini["current_vehicle_id"],
            },
        )
        assert tx_r.status_code == 200, tx_r.text
        txn = tx_r.json()
        CREATED["txns"].append(txn["id"])

        appr = requests.post(f"{API}/transactions/{txn['id']}/approve", headers=acc_hdrs)
        assert appr.status_code == 200, appr.text
        assert appr.json()["status"] == "approved"

        detail = requests.get(f"{API}/transactions/{txn['id']}", headers=hdrs).json()
        assert detail["status"] == "approved"
        assert "package" not in detail["driver"]

        daily_rep = requests.get(f"{API}/reports/daily", headers=hdrs, params={"date": today_str, "city": "Tiruppur"}).json()
        assert any(row[0] == txn["id"] for row in daily_rep["rows"])

        ver_rep = requests.get(f"{API}/reports/verified", headers=hdrs, params={"city": "Tiruppur"}).json()
        assert any(row[0] == txn["id"] for row in ver_rep["rows"])

        board_after = requests.get(f"{API}/board", headers=hdrs, params={"date": today_str, "city": "Tiruppur"}).json()
        v_after = next(x for x in board_after["rows"] if x["id"] == varshini["id"])
        assert v_after["status"] == "verified"
        assert v_after["outstanding"] == 0

    def test_bulk_import_350_rows_fast_and_unassigned_vehicle_ignored(self):
        hdrs = admin_headers()
        bulk_tag = f"BULK{SUFFIX}"
        cities = ["Coimbatore", "Bengaluru", "Tiruppur", "Chennai"]
        packages = ["Economy Package", "Commission Package", "Salary Package", "Silver Package"]
        lines = ["Driver,ID,Phone,Vehicle,Package,City,Joining Date,VIN,Daily Rent,Status"]
        for i in range(350):
            city = cities[i % len(cities)]
            pkg = packages[i % len(packages)]
            code = f"R39D-{bulk_tag}{i:03d}"
            mob = f"9{int(SUFFIX, 16) % 1000:03d}{i:06d}"
            if i < 340:
                veh = f"B{i:03d} - TN66Z{1000 + i}"
                vin = f"MBX0007{bulk_tag}{i:04d}"
            else:
                veh = "UNASSIGNED" if i % 2 == 0 else "Not Assigned"
                vin = ""
            lines.append(
                f"TEST_{bulk_tag}_{i},{code},{mob},{veh},{pkg},{city},10/11/2026,{vin},750,Active"
            )
        csv_bytes = "\n".join(lines).encode("utf-8")

        try:
            pr = requests.post(
                f"{API}/import/parse",
                headers=hdrs,
                files={"file": ("drivers-all-cities.csv", io.BytesIO(csv_bytes), "text/csv")},
            )
            assert pr.status_code == 200, pr.text
            parsed = pr.json()
            assert parsed["total_rows"] == 350
            assert all("package" not in r for r in parsed["rows"])
            assert all(r["reg_no"] == "" for r in parsed["rows"][340:])

            t0 = time.monotonic()
            cr = requests.post(
                f"{API}/import/commit",
                headers=hdrs,
                json={"mode": "drivers_and_vehicles", "update_existing": True, "rows": parsed["rows"]},
            )
            elapsed1 = time.monotonic() - t0
            assert cr.status_code == 200, cr.text
            res1 = cr.json()
            assert res1["drivers_created"] == 350
            assert res1["vehicles_created"] == 340
            assert res1["assignments_created"] == 340
            assert res1["errors"] == []
            assert elapsed1 < 15.0, f"Initial 350-row bulk commit took {elapsed1:.2f}s"

            # Verify zero fake UNASSIGNED vehicles exist
            bad_vehs = requests.get(f"{API}/vehicles", headers=hdrs, params={"q": "UNASSIGNED"}).json()
            assert not any("UNASSIGN" in (v.get("reg_no") or "").upper() for v in bad_vehs)

            # Re-import same 350 rows to verify bulk updates work fast without duplicate key errors
            t1 = time.monotonic()
            cr2 = requests.post(
                f"{API}/import/commit",
                headers=hdrs,
                json={"mode": "drivers_and_vehicles", "update_existing": True, "rows": parsed["rows"]},
            )
            elapsed2 = time.monotonic() - t1
            assert cr2.status_code == 200, cr2.text
            res2 = cr2.json()
            assert res2["drivers_updated"] == 350
            assert res2["vehicles_updated"] == 340
            assert res2["errors"] == []
            assert elapsed2 < 15.0, f"Update 350-row bulk commit took {elapsed2:.2f}s"
        finally:
            m = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
            drvs = list(m.drivers.find({"driver_code": {"$regex": f"^R39D-{bulk_tag}"}}, {"_id": 0, "id": 1, "current_vehicle_id": 1}))
            dids = [d["id"] for d in drvs]
            vehs = list(m.vehicles.find({"vin": {"$regex": f"^MBX0007{bulk_tag}"}}, {"_id": 0, "vehicle_id": 1}))
            vids = [v["vehicle_id"] for v in vehs]
            if dids:
                m.vehicle_assignments.delete_many({"driver_id": {"$in": dids}})
                m.drivers.delete_many({"id": {"$in": dids}})
                m.audit_logs.delete_many({"entity_id": {"$in": dids}})
            if vids:
                m.vehicles.delete_many({"vehicle_id": {"$in": vids}})
                m.audit_logs.delete_many({"entity_id": {"$in": vids}})

    def test_drivers_only_mode_preserves_vehicle_no_without_creating_vehicles(self):
        hdrs = admin_headers()
        tpl_d = requests.get(f"{API}/import/template", headers=hdrs, params={"mode": "drivers"})
        assert tpl_d.status_code == 200, tpl_d.text
        wb_d = load_workbook(io.BytesIO(tpl_d.content))
        assert [c.value for c in wb_d.active[1]] == ["DRIVER ID", "DRIVER NAME", "PHONE NUMBER", "CITY", "JOINING DATE", "RENT"]

        tpl_v = requests.get(f"{API}/import/template", headers=hdrs, params={"mode": "vehicles"})
        assert tpl_v.status_code == 200, tpl_v.text
        wb_v = load_workbook(io.BytesIO(tpl_v.content))
        assert [c.value for c in wb_v.active[1]] == ["VEHICLE ID", "VEHICLE NUMBER", "VIN NUMBER", "CITY"]

        code = f"R39D-DRVONLY{SUFFIX}"
        veh_tag = f"TESTDRVONLY{SUFFIX}"
        created_did = None
        try:
            cr = requests.post(
                f"{API}/import/commit",
                headers=hdrs,
                json={
                    "mode": "drivers",
                    "update_existing": True,
                    "rows": [
                        {
                            "name": f"varshini_{SUFFIX}",
                            "driver_code": code,
                            "mobile": f"79048{int(SUFFIX, 16) % 100000:05d}",
                            "reg_no": f"TUP001 - {veh_tag}",
                            "city": "Tiruppur",
                            "joining_date": "2026-10-03",
                            "daily_rent": 700,
                            "status": "Active",
                            "has_daily_rent": True,
                            "has_joining_date": True,
                        }
                    ],
                },
            )
            assert cr.status_code == 200, cr.text
            res = cr.json()
            assert res["drivers_created"] == 1
            assert res["vehicles_created"] == 0
            assert res["vehicles_updated"] == 0
            assert res["errors"] == []

            drvs = requests.get(f"{API}/drivers", headers=hdrs, params={"q": code}).json()
            assert len(drvs) == 1
            d = drvs[0]
            created_did = d["id"]
            assert d["vehicle_no"] == f"TUP001 - {veh_tag}"
            assert "package" not in d
            assert d["city"] == "Tiruppur"
            assert d["joining_date"] == "2026-10-03"

            vehs = requests.get(f"{API}/vehicles", headers=hdrs, params={"q": veh_tag}).json()
            assert vehs == []
        finally:
            if created_did:
                m = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
                m.drivers.delete_one({"id": created_did})
                m.audit_logs.delete_many({"entity_id": created_did})
