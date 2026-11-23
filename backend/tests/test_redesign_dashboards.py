# Iteration 3 — redesign: /api/board, /api/overview, paginated/sorted/xlsx /api/transactions, reports city filter, core payment flow regression
import io
import os
import uuid
import pytest
import requests
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"
KARTHIK = "R39-DRV-1007"  # designated driver for payment-entry tests (vehicle CHN-002)
CREATED = {"txns": [], "files": []}
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
PNG = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c20000000049454e44ae426082")


def H(uid):
    return {"X-User-Id": uid}


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    m = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    for t in CREATED["txns"]:
        m.transactions.delete_one({"id": t})
        m.notifications.delete_many({"txn_id": t})
        m.audit_logs.delete_many({"entity_id": t})
    for f in CREATED["files"]:
        m.files.delete_one({"id": f})


# ---- board ----
class TestBoard:
    def test_board_shape_and_kpis(self):
        r = requests.get(f"{API}/board", headers=H("u-staff-1"), params={"date": "2026-11-20"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["date"] == "2026-11-20"
        for k in ["eligible", "paid", "partial", "unpaid", "pending", "rejected", "expected", "verified", "outstanding"]:
            assert k in d["kpis"]
        rows_all = requests.get(f"{API}/board", headers=H("u-staff-1"), params={"date": "2026-11-20", "page_size": 200}).json()["rows"]
        el = [x for x in rows_all if x["eligible"]]
        assert d["kpis"]["eligible"] == len(el)
        assert abs(d["kpis"]["expected"] - sum(x["expected"] for x in el)) < 0.01
        assert d["kpis"]["unpaid"] == sum(1 for x in rows_all if x["status"] == "unpaid")
        assert d["total"] == len(rows_all)

    def test_board_date_changes_and_invalid(self):
        a = requests.get(f"{API}/board", headers=H("u-admin"), params={"date": "2026-11-19"}).json()
        assert a["date"] == "2026-11-19"
        r = requests.get(f"{API}/board", headers=H("u-admin"), params={"date": "bad"})
        assert r.status_code == 400

    def test_board_filters_sort_pagination(self):
        r = requests.get(f"{API}/board", headers=H("u-admin"), params={"date": "2026-11-20", "city": "Chennai"}).json()
        assert all(x["city"] == "Chennai" for x in r["rows"])
        r = requests.get(f"{API}/board", headers=H("u-admin"), params={"date": "2026-11-20", "q": "Karthik"}).json()
        assert any(x["id"] == KARTHIK for x in r["rows"])
        r = requests.get(f"{API}/board", headers=H("u-admin"), params={"date": "2026-11-20", "status": "unpaid"}).json()
        assert all(x["status"] == "unpaid" for x in r["rows"])
        r = requests.get(f"{API}/board", headers=H("u-admin"), params={"date": "2026-11-20", "sort": "daily_rent", "dir": "desc"}).json()
        rents = [x["daily_rent"] for x in r["rows"]]
        assert rents == sorted(rents, reverse=True)
        r = requests.get(f"{API}/board", headers=H("u-admin"), params={"date": "2026-11-20", "page": 2, "page_size": 3}).json()
        assert r["page"] == 2 and len(r["rows"]) <= 3
        r = requests.get(f"{API}/board", headers=H("u-admin"), params={"date": "2026-11-20", "active": "inactive"}).json()
        assert all(x["driver_status"] != "Active" for x in r["rows"])

    def test_board_xlsx(self):
        r = requests.get(f"{API}/board", headers=H("u-admin"), params={"date": "2026-11-20", "format": "xlsx"})
        assert r.status_code == 200
        assert r.headers["content-type"].startswith(XLSX)
        assert r.content[:2] == b"PK"

    def test_board_requires_user(self):
        assert requests.get(f"{API}/board").status_code in (401, 403)


# ---- overview ----
class TestOverview:
    def test_overview(self):
        r = requests.get(f"{API}/overview", headers=H("u-admin"))
        assert r.status_code == 200, r.text
        d = r.json()
        assert len(d["series"]) == 14
        assert d["series"][-1]["date"] in ("2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23", "2026-11-24")
        m = d["month"]
        assert m["outstanding"] == max(m["expected"] - m["verified"], 0)
        pend = requests.get(f"{API}/accounts/summary", headers=H("u-acc-1")).json()["pending_count"]
        assert d["counts"]["pending_txns"] == pend


# ---- transactions ledger ----
class TestLedger:
    def test_list_mode_backcompat(self):
        r = requests.get(f"{API}/transactions", headers=H("u-admin"))
        assert r.status_code == 200 and isinstance(r.json(), list)

    def test_paged(self):
        r = requests.get(f"{API}/transactions", headers=H("u-admin"), params={"page": 1, "page_size": 5}).json()
        assert set(r) == {"items", "total"} and len(r["items"]) <= 5
        assert r["total"] >= len(r["items"])
        r2 = requests.get(f"{API}/transactions", headers=H("u-admin"), params={"page": 2, "page_size": 5}).json()
        ids1, ids2 = {t["id"] for t in r["items"]}, {t["id"] for t in r2["items"]}
        assert not ids1 & ids2

    def test_sort_amount(self):
        r = requests.get(f"{API}/transactions", headers=H("u-admin"), params={"page": 1, "page_size": 50, "sort": "amount", "dir": "asc"}).json()
        a = [t["amount"] for t in r["items"]]
        assert a == sorted(a)

    def test_date_range_and_status(self):
        r = requests.get(f"{API}/transactions", headers=H("u-admin"),
                         params={"page": 1, "page_size": 200, "date_from": "2026-11-10", "date_to": "2026-11-15", "status": "approved"}).json()
        assert all("2026-11-10" <= t["payment_date"] <= "2026-11-15" and t["status"] == "approved" for t in r["items"])

    def test_q_search(self):
        any_t = requests.get(f"{API}/transactions", headers=H("u-admin"), params={"page": 1, "page_size": 1}).json()["items"][0]
        r = requests.get(f"{API}/transactions", headers=H("u-admin"), params={"page": 1, "q": any_t["utr"]}).json()
        assert any(t["id"] == any_t["id"] for t in r["items"])

    def test_xlsx(self):
        r = requests.get(f"{API}/transactions", headers=H("u-staff-1"), params={"format": "xlsx", "status": "pending"})
        assert r.status_code == 200 and r.headers["content-type"].startswith(XLSX)


# ---- reports ----
class TestReports:
    @pytest.mark.parametrize("kind", ["daily", "pending", "verified", "rejected", "staff_performance"])
    def test_report_kinds(self, kind):
        r = requests.get(f"{API}/reports/{kind}", headers=H("u-acc-1"))
        assert r.status_code == 200, r.text
        assert "columns" in r.json() and "rows" in r.json()

    def test_city_filter(self):
        r = requests.get(f"{API}/reports/verified", headers=H("u-acc-1"), params={"city": "Chennai"}).json()
        ci = r["columns"].index("City")
        assert all(row[ci] == "Chennai" for row in r["rows"])

    def test_driver_history_and_export(self):
        r = requests.get(f"{API}/reports/driver_history", headers=H("u-admin"), params={"driver_id": KARTHIK})
        assert r.status_code == 200
        r = requests.get(f"{API}/reports/pending", headers=H("u-admin"), params={"format": "xlsx"})
        assert r.status_code == 200 and r.content[:2] == b"PK"

    def test_staff_forbidden(self):
        assert requests.get(f"{API}/reports/pending", headers=H("u-staff-1")).status_code == 403


# ---- core flow regression: staff submit -> accounts approve/reject -> resubmit ----
class TestCoreFlow:
    def _upload(self):
        r = requests.post(f"{API}/upload", headers=H("u-staff-1"), files={"file": ("TEST_shot.png", io.BytesIO(PNG), "image/png")})
        assert r.status_code == 200, r.text
        CREATED["files"].append(r.json()["file_id"])
        return r.json()["file_id"]

    def _submit(self, day):
        fid = self._upload()
        r = requests.post(f"{API}/transactions", headers=H("u-staff-1"), json={
            "driver_id": KARTHIK, "payment_date": day, "amount": 650, "utr": f"TEST{uuid.uuid4().hex[:8].upper()}",
            "method": "UPI", "file_id": fid, "remarks": "TEST_ iteration3", "vehicle_id": "CHN-002"})
        assert r.status_code == 200, r.text
        CREATED["txns"].append(r.json()["id"])
        return r.json()

    def test_approve_flow_reflects_on_board(self):
        t = self._submit("2026-11-12")
        b = requests.get(f"{API}/board", headers=H("u-admin"), params={"date": "2026-11-12", "q": "Karthik"}).json()
        row = next(x for x in b["rows"] if x["id"] == KARTHIK)
        assert row["status"] == "pending" and row["submitted"] == 650
        assert requests.post(f"{API}/transactions/{t['id']}/approve", headers=H("u-staff-1")).status_code == 403
        r = requests.post(f"{API}/transactions/{t['id']}/approve", headers=H("u-acc-1"))
        assert r.status_code == 200 and r.json()["status"] == "approved"
        b = requests.get(f"{API}/board", headers=H("u-admin"), params={"date": "2026-11-12", "q": "Karthik"}).json()
        row = next(x for x in b["rows"] if x["id"] == KARTHIK)
        assert row["status"] == "verified" and row["outstanding"] == 0
        cal = requests.get(f"{API}/drivers/{KARTHIK}/calendar", headers=H("u-staff-1"), params={"year": 2026, "month": 11})
        assert cal.status_code == 200, cal.text

    def test_reject_notify_resubmit(self):
        t = self._submit("2026-11-13")
        assert requests.post(f"{API}/transactions/{t['id']}/reject", headers=H("u-acc-1"), json={"remarks": ""}).status_code == 422
        r = requests.post(f"{API}/transactions/{t['id']}/reject", headers=H("u-acc-1"), json={"remarks": "TEST_ UTR mismatch"})
        assert r.status_code == 200 and r.json()["status"] == "rejected"
        n = requests.get(f"{API}/notifications", headers=H("u-staff-1")).json()
        assert any(x["txn_id"] == t["id"] for x in n["items"])
        r = requests.put(f"{API}/transactions/{t['id']}/resubmit", headers=H("u-staff-1"),
                         json={"amount": 650, "utr": t["utr"], "method": "UPI", "remarks": "TEST_ fixed", "vehicle_id": "CHN-002"})
        assert r.status_code == 200 and r.json()["status"] == "pending"
        detail = requests.get(f"{API}/transactions/{t['id']}", headers=H("u-acc-1")).json()
        assert len(detail["audit"]) >= 3
