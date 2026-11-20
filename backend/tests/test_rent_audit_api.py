# Route39 Rent Audit - backend regression tests (roles, transactions lifecycle, calendar, reports, audit)
import io
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
IST = timezone(timedelta(hours=5, minutes=30))
TODAY = datetime.now(IST).date()

# 1x1 PNG
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc0f01f0005000201"
    "e2b1d6a90000000049454e44ae426082")


def h(uid):
    return {"X-User-Id": uid}


def utr():
    return f"TESTUTR{uuid.uuid4().hex[:10].upper()}"


def upload(uid="u-staff-1"):
    r = requests.post(f"{API}/upload", headers=h(uid), files={"file": ("shot.png", io.BytesIO(PNG), "image/png")})
    assert r.status_code == 200, r.text
    return r.json()["file_id"]


@pytest.fixture(scope="module")
def test_driver():
    """A TEST_ driver whose rent started 15 days ago (no delete endpoint exists -> stays in DB)."""
    body = {"name": f"TEST_Driver {uuid.uuid4().hex[:4]}", "mobile": "9000000001", "vehicle_no": "ka 99 zz 0001",
            "city": "TestCity", "joining_date": (TODAY - timedelta(days=15)).isoformat(), "daily_rent": 500}
    r = requests.post(f"{API}/drivers", headers=h("u-admin"), json=body)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["id"].startswith("R39-DRV-")
    assert d["vehicle_no"] == "KA 99 ZZ 0001"
    assert d["rent_start_date"] == body["joining_date"]
    return d


def make_txn(driver, day_offset, uid="u-staff-1", amount=500, **kw):
    body = {"driver_id": driver["id"], "payment_date": (TODAY - timedelta(days=day_offset)).isoformat(),
            "amount": amount, "utr": utr(), "method": "UPI", "file_id": upload(uid if uid != "u-acc-1" else "u-staff-1"),
            **kw}
    return requests.post(f"{API}/transactions", headers=h(uid), json=body), body


# ---- auth / basics ----
class TestBasics:
    def test_root_and_switcher(self):
        assert requests.get(f"{API}/").status_code == 200
        ids = {u["id"] for u in requests.get(f"{API}/users/switcher").json()}
        assert {"u-admin", "u-staff-1", "u-acc-1"} <= ids

    def test_missing_and_bad_header(self):
        assert requests.get(f"{API}/me").status_code == 401
        assert requests.get(f"{API}/me", headers=h("nope")).status_code == 401
        assert requests.get(f"{API}/me", headers=h("u-acc-1")).json()["role"] == "accounts"

    def test_driver_search(self):
        for q in ["Karthik", "9840012307", "TN22CD", "tn 22 cd 3961", "R39-DRV-1007"]:
            r = requests.get(f"{API}/drivers", params={"q": q}, headers=h("u-staff-1"))
            assert any(d["id"] == "R39-DRV-1007" for d in r.json()), q


# ---- calendar ----
class TestCalendar:
    def test_calendar_disabled_dates(self, test_driver):
        r = requests.get(f"{API}/drivers/{test_driver['id']}/calendar", headers=h("u-staff-1"),
                         params={"year": TODAY.year, "month": TODAY.month})
        assert r.status_code == 200
        days = {d["date"]: d for d in r.json()["days"]}
        rs = test_driver["rent_start_date"]
        for ds, d in days.items():
            if ds < rs:
                assert d["disabled"] and d["reason"] == "Before rent start date"
            elif ds > TODAY.isoformat():
                assert d["disabled"] and d["reason"] == "Future date"
            else:
                assert not d["disabled"]

    def test_calendar_invalid_month(self, test_driver):
        r = requests.get(f"{API}/drivers/{test_driver['id']}/calendar", headers=h("u-staff-1"),
                         params={"year": 2026, "month": 13})
        assert r.status_code in (400, 422), f"invalid month returns {r.status_code}"


# ---- transaction lifecycle ----
class TestTransactions:
    def test_upload_rejects_non_image(self):
        r = requests.post(f"{API}/upload", headers=h("u-staff-1"), files={"file": ("a.pdf", b"%PDF", "application/pdf")})
        assert r.status_code == 400

    def test_upload_forbidden_for_accounts(self):
        r = requests.post(f"{API}/upload", headers=h("u-acc-1"), files={"file": ("s.png", PNG, "image/png")})
        assert r.status_code == 403

    def test_file_served(self):
        fid = upload()
        r = requests.get(f"{API}/files/{fid}", headers=h("u-acc-1"))
        assert r.status_code == 200 and r.content == PNG and r.headers["content-type"] == "image/png"

    def test_future_and_before_start_blocked(self, test_driver):
        r, _ = make_txn(test_driver, -1)
        assert r.status_code == 400 and "Future" in r.json()["detail"]
        r, _ = make_txn(test_driver, 20)
        assert r.status_code == 400

    def test_missing_screenshot_and_short_utr(self, test_driver):
        body = {"driver_id": test_driver["id"], "payment_date": (TODAY - timedelta(days=14)).isoformat(),
                "amount": 500, "utr": "12", "method": "UPI"}
        assert requests.post(f"{API}/transactions", headers=h("u-staff-1"), json=body).status_code == 400
        body["utr"] = utr()
        assert requests.post(f"{API}/transactions", headers=h("u-staff-1"), json=body).status_code == 400

    def test_accounts_cannot_submit(self, test_driver):
        body = {"driver_id": test_driver["id"], "payment_date": TODAY.isoformat(), "amount": 500, "utr": "",
                "method": "Cash"}
        assert requests.post(f"{API}/transactions", headers=h("u-acc-1"), json=body).status_code == 403

    def test_submit_approve_flow(self, test_driver):
        r, body = make_txn(test_driver, 1)
        assert r.status_code == 200, r.text
        t = r.json()
        assert t["status"] == "pending" and t["utr"] == body["utr"] and t["submitted_by"] == "u-staff-1"
        # duplicate same date (no split)
        r2, _ = make_txn(test_driver, 1)
        assert r2.status_code == 409
        # duplicate UTR on another date
        body2 = {**body, "payment_date": (TODAY - timedelta(days=2)).isoformat(), "file_id": upload()}
        assert requests.post(f"{API}/transactions", headers=h("u-staff-1"), json=body2).status_code == 409
        # calendar pending
        cal = requests.get(f"{API}/drivers/{test_driver['id']}/calendar", headers=h("u-staff-1"),
                           params={"year": (TODAY - timedelta(days=1)).year, "month": (TODAY - timedelta(days=1)).month}).json()
        day = next(d for d in cal["days"] if d["date"] == body["payment_date"])
        assert day["status"] == "pending"
        # staff cannot approve
        assert requests.post(f"{API}/transactions/{t['id']}/approve", headers=h("u-staff-2")).status_code == 403
        # accounts approves
        a = requests.post(f"{API}/transactions/{t['id']}/approve", headers=h("u-acc-1"))
        assert a.status_code == 200 and a.json()["status"] == "approved" and a.json()["verified_by"] == "u-acc-1"
        # second approve -> 400
        assert requests.post(f"{API}/transactions/{t['id']}/approve", headers=h("u-acc-2")).status_code == 400
        cal = requests.get(f"{API}/drivers/{test_driver['id']}/calendar", headers=h("u-staff-1"),
                           params={"year": (TODAY - timedelta(days=1)).year, "month": (TODAY - timedelta(days=1)).month}).json()
        assert next(d for d in cal["days"] if d["date"] == body["payment_date"])["status"] == "verified"
        # split payment allowed on same date
        r3, _ = make_txn(test_driver, 1, amount=100, is_split=True)
        assert r3.status_code == 200 and r3.json()["is_split"] is True

    def test_partial_status(self, test_driver):
        r, body = make_txn(test_driver, 3, amount=200)
        assert r.status_code == 200
        requests.post(f"{API}/transactions/{r.json()['id']}/approve", headers=h("u-acc-2"))
        d = TODAY - timedelta(days=3)
        cal = requests.get(f"{API}/drivers/{test_driver['id']}/calendar", headers=h("u-staff-1"),
                           params={"year": d.year, "month": d.month}).json()
        assert next(x for x in cal["days"] if x["date"] == d.isoformat())["status"] == "partial"

    def test_reject_notify_resubmit(self, test_driver):
        r, body = make_txn(test_driver, 4)
        tid = r.json()["id"]
        assert requests.post(f"{API}/transactions/{tid}/reject", headers=h("u-acc-1"), json={"remarks": ""}).status_code == 422
        rj = requests.post(f"{API}/transactions/{tid}/reject", headers=h("u-acc-1"), json={"remarks": "TEST wrong UTR"})
        assert rj.status_code == 200 and rj.json()["status"] == "rejected" and rj.json()["rejection_reason"] == "TEST wrong UTR"
        n = requests.get(f"{API}/notifications", headers=h("u-staff-1")).json()
        assert any(x["txn_id"] == tid and not x["read"] for x in n["items"])
        # new non-split entry on rejected date blocked
        r2, _ = make_txn(test_driver, 4)
        assert r2.status_code == 409
        # other staff cannot resubmit
        edit = {"amount": 550, "utr": utr(), "method": "UPI", "file_id": upload(), "remarks": "fixed"}
        assert requests.put(f"{API}/transactions/{tid}/resubmit", headers=h("u-staff-2"), json=edit).status_code == 403
        rs = requests.put(f"{API}/transactions/{tid}/resubmit", headers=h("u-staff-1"), json=edit)
        assert rs.status_code == 200
        t = rs.json()
        assert t["status"] == "pending" and t["amount"] == 550 and t["utr"] == edit["utr"] and t["version"] == 2
        actions = {a["action"] for a in t["audit"]}
        assert {"Amount changed", "UTR changed", "Screenshot replaced", "Transaction resubmitted"} <= actions

    def test_self_approval_blocked(self, test_driver):
        r, _ = make_txn(test_driver, 5, uid="u-admin")
        assert r.status_code == 200
        tid = r.json()["id"]
        assert requests.post(f"{API}/transactions/{tid}/approve", headers=h("u-admin")).status_code == 403
        assert requests.post(f"{API}/transactions/{tid}/reject", headers=h("u-admin"), json={"remarks": "x self"}).status_code == 403

    def test_filters(self, test_driver):
        r = requests.get(f"{API}/transactions", headers=h("u-acc-1"),
                         params={"status": "all", "driver_name": "TEST_Driver", "city": "TestCity"}).json()
        assert len(r) >= 3 and all(t["city"] == "TestCity" for t in r)
        r = requests.get(f"{API}/transactions", headers=h("u-acc-1"), params={"status": "rejected", "staff_id": "u-staff-1"}).json()
        assert all(t["status"] == "rejected" and t["submitted_by"] == "u-staff-1" for t in r)


# ---- admin / reports / audit ----
class TestAdmin:
    def test_staff_forbidden_admin_apis(self):
        assert requests.get(f"{API}/users", headers=h("u-staff-1")).status_code == 403
        assert requests.get(f"{API}/audit-logs", headers=h("u-acc-1")).status_code == 403
        assert requests.get(f"{API}/reports/daily", headers=h("u-staff-1")).status_code == 403

    def test_user_create_update(self):
        email = f"test_{uuid.uuid4().hex[:6]}@example.com"
        r = requests.post(f"{API}/users", headers=h("u-admin"), json={"name": "TEST_User", "email": email, "role": "staff"})
        assert r.status_code == 200
        uid = r.json()["id"]
        assert requests.post(f"{API}/users", headers=h("u-admin"), json={"name": "TEST_User", "email": email, "role": "staff"}).status_code == 409
        u = requests.put(f"{API}/users/{uid}", headers=h("u-admin"), json={"name": "TEST_User2", "email": email, "role": "staff", "active": False})
        assert u.status_code == 200 and u.json()["active"] is False
        assert requests.get(f"{API}/me", headers=h(uid)).status_code == 401

    def test_driver_edit_and_adjustment(self, test_driver):
        body = {k: test_driver[k] for k in ["name", "mobile", "vehicle_no", "city", "joining_date", "handover_date",
                                              "rent_start_date", "status"]}
        body.update({"daily_rent": 600, "rent_free_dates": [TODAY.isoformat()]})
        r = requests.put(f"{API}/drivers/{test_driver['id']}", headers=h("u-admin"), json=body)
        assert r.status_code == 200 and r.json()["daily_rent"] == 600
        a = requests.post(f"{API}/drivers/{test_driver['id']}/adjustments", headers=h("u-admin"),
                          json={"date": (TODAY - timedelta(days=6)).isoformat(), "amount": 100, "reason": "TEST adj"})
        assert a.status_code == 200 and len(a.json()["adjustments"]) == 1

    @pytest.mark.parametrize("kind", ["daily", "pending", "verified", "rejected", "driver_history", "staff_performance"])
    def test_reports(self, kind, test_driver):
        p = {"driver_id": test_driver["id"]} if kind == "driver_history" else {}
        r = requests.get(f"{API}/reports/{kind}", headers=h("u-acc-1"), params=p)
        assert r.status_code == 200, r.text
        assert r.json()["columns"]
        x = requests.get(f"{API}/reports/{kind}", headers=h("u-admin"), params={**p, "format": "xlsx"})
        assert x.status_code == 200 and x.content[:2] == b"PK"

    def test_audit_logs(self, test_driver):
        r = requests.get(f"{API}/audit-logs", headers=h("u-admin"), params={"q": test_driver["id"]})
        assert r.status_code == 200
        acts = {a["action"] for a in r.json()}
        assert "Driver created" in acts and "Transaction submitted" in acts
