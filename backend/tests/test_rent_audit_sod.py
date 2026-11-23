# Route39 Rent Audit - segregation-of-duties edge cases (admin correction / resubmit then self-approve)
import io
import os
import uuid
from datetime import datetime, timedelta, timezone

import requests

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"
TODAY = datetime.now(timezone(timedelta(hours=5, minutes=30))).date()
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc0f01f0005000201"
    "e2b1d6a90000000049454e44ae426082")


def h(uid):
    return {"X-User-Id": uid}


def upload():
    return requests.post(f"{API}/upload", headers=h("u-staff-1"),
                         files={"file": ("s.png", io.BytesIO(PNG), "image/png")}).json()["file_id"]


def _driver():
    mob = f"98{uuid.uuid4().int % 100000000:08d}"
    body = {"name": f"TEST_SOD {uuid.uuid4().hex[:4]}", "mobile": mob, "vehicle_no": "KA 98 SD 0002",
            "city": "TestCity", "joining_date": (TODAY - timedelta(days=5)).isoformat(), "daily_rent": 500}
    return requests.post(f"{API}/drivers", headers=h("u-admin"), json=body).json()


def test_admin_correction_then_self_approve_blocked():
    d = _driver()
    t = requests.post(f"{API}/transactions", headers=h("u-staff-1"), json={
        "driver_id": d["id"], "payment_date": (TODAY - timedelta(days=1)).isoformat(), "amount": 500,
        "utr": f"TESTSOD{uuid.uuid4().hex[:8]}", "method": "UPI", "file_id": upload(), "vehicle_id": "CHN-001"}).json()
    assert requests.post(f"{API}/transactions/{t['id']}/approve", headers=h("u-acc-1")).status_code == 200
    c = requests.put(f"{API}/transactions/{t['id']}/correct", headers=h("u-admin"), json={
        "amount": 900, "utr": t["utr"], "method": "UPI", "remarks": "", "reason": "TEST correction"})
    assert c.status_code == 200 and c.json()["status"] == "pending"
    # admin changed the amount, so admin should NOT be able to verify their own change
    r = requests.post(f"{API}/transactions/{t['id']}/approve", headers=h("u-admin"))
    assert r.status_code == 403, f"admin approved own correction: {r.status_code}"


def test_accounts_utr_edit_then_approve_allowed():
    d = _driver()
    t = requests.post(f"{API}/transactions", headers=h("u-staff-1"), json={
        "driver_id": d["id"], "payment_date": (TODAY - timedelta(days=1)).isoformat(), "amount": 500,
        "utr": f"TESTSOD{uuid.uuid4().hex[:8]}", "method": "UPI", "file_id": upload(), "vehicle_id": "CHN-001"}).json()
    assert t["status"] == "pending"

    # Accounts edits the UTR (correcting a typo from the screenshot)
    new_utr = f"FIXED{uuid.uuid4().hex[:8].upper()}"
    edit_res = requests.put(f"{API}/transactions/{t['id']}/utr", headers=h("u-acc-1"), json={
        "utr": new_utr, "reason": "Corrected from payment screenshot"
    })
    assert edit_res.status_code == 200
    assert edit_res.json()["utr"] == new_utr

    # Accounts approves the transaction - MUST be allowed (not blocked by self-approval check)
    appr_res = requests.post(f"{API}/transactions/{t['id']}/approve", headers=h("u-acc-1"))
    assert appr_res.status_code == 200, f"accounts blocked from approving after UTR edit: {appr_res.text}"
    assert appr_res.json()["status"] == "approved"
    assert appr_res.json()["verified_by"] == "u-acc-1"

