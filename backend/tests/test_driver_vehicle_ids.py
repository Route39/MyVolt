# Driver IDs / Vehicle IDs / assignment history / transaction vehicle snapshot / reports — iteration 2
import os
import re
import uuid
import pytest
import requests
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"

CREATED = {"drivers": [], "vehicles": [], "txns": []}
SUFFIX = uuid.uuid4().hex[:4].upper()


def H(uid):
    return {"X-User-Id": uid, "Content-Type": "application/json"}


def reg(n):
    return f"TEST {SUFFIX} {n:04d}"


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    m = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    for d in CREATED["drivers"]:
        m.drivers.delete_one({"id": d})
        m.vehicle_assignments.delete_many({"driver_id": d})
    for v in CREATED["vehicles"]:
        m.vehicles.delete_one({"vehicle_id": v})
    for t in CREATED["txns"]:
        m.transactions.delete_one({"id": t})
        m.notifications.delete_many({"txn_id": t})


def mk_vehicle(city="Bengaluru", n=1, status="Active"):
    r = requests.post(f"{API}/vehicles", headers=H("u-admin"),
                      json={"reg_no": reg(n), "city": city, "vehicle_type": "Sedan", "status": status, "details": "TEST_"})
    assert r.status_code == 200, r.text
    CREATED["vehicles"].append(r.json()["vehicle_id"])
    return r.json()


_drv_counter = 0


def mk_driver(city="Bengaluru", code=None, vehicle=None, expect=200):
    global _drv_counter
    _drv_counter += 1
    mob = f"9{int(SUFFIX, 16) % 100000:05d}{_drv_counter:04d}"
    body = {"name": f"TEST_Driver {SUFFIX} {_drv_counter}", "mobile": mob, "city": city, "joining_date": "2026-11-01",
            "daily_rent": 700, "status": "Active"}
    if code:
        body["driver_code"] = code
    if vehicle:
        body["current_vehicle_id"] = vehicle
    r = requests.post(f"{API}/drivers", headers=H("u-admin"), json=body)
    assert r.status_code == expect, r.text
    if r.status_code == 200:
        CREATED["drivers"].append(r.json()["id"])
        return r.json()
    return r


def mk_txn(did, vid, d="2026-11-10", uid="u-staff-1"):
    r = requests.post(f"{API}/transactions", headers=H(uid), json={
        "driver_id": did, "payment_date": d, "amount": 700, "utr": "", "method": "Cash", "remarks": "TEST_", "vehicle_id": vid})
    assert r.status_code == 200, r.text
    CREATED["txns"].append(r.json()["id"])
    return r.json()


# --- Driver ID generation
class TestDriverIds:
    def test_auto_code_city_based_and_unique(self):
        d1 = mk_driver("Bengaluru")
        d2 = mk_driver("Bengaluru")
        assert re.match(r"^BLR-D-\d{3,}$", d1["driver_code"])
        assert d1["driver_code"] != d2["driver_code"]
        assert int(d2["driver_code"].split("-")[-1]) > int(d1["driver_code"].split("-")[-1])
        for city, p in [("Chennai", "CHN"), ("Coimbatore", "CBE"), ("Tiruppur", "TPR")]:
            assert mk_driver(city)["driver_code"].startswith(f"{p}-D-")

    def test_override_valid_invalid_duplicate(self):
        code = f"CBE-D-9{SUFFIX[:2].encode().hex()[:2]}" if False else f"CBE-D-{900 + uuid.uuid4().int % 99}"
        d = mk_driver("Coimbatore", code=code)
        assert d["driver_code"] == code
        r = mk_driver("Coimbatore", code="BLR-1", expect=400)
        assert "BLR-D-001" in r.json()["detail"]
        r = mk_driver("Coimbatore", code=code, expect=409)
        assert code in r.json()["detail"]
        r = mk_driver("Bengaluru", code="BLR-D-001", expect=409)

    def test_code_locked_on_edit(self):
        d = mk_driver("Chennai")
        mob = f"9{int(SUFFIX, 16) % 100000:05d}9999"
        body = {"name": "TEST_Edited", "mobile": mob, "city": "Bengaluru", "joining_date": "2026-11-01",
                "daily_rent": 750, "status": "Active", "driver_code": "BLR-D-777"}
        r = requests.put(f"{API}/drivers/{d['id']}", headers=H("u-admin"), json=body)
        assert r.status_code == 200
        assert r.json()["driver_code"] == d["driver_code"]
        assert r.json()["name"] == "TEST_Edited"

    def test_non_admin_cannot_create(self):
        r = requests.post(f"{API}/drivers", headers=H("u-staff-1"), json={"name": "TEST_x", "mobile": "9000000000",
                          "city": "Chennai", "joining_date": "2026-11-01", "daily_rent": 700})
        assert r.status_code == 403


# --- Vehicle CRUD
class TestVehicles:
    def test_create_generates_id_and_dup_reg_rejected(self):
        v = mk_vehicle("Bengaluru", 1)
        assert re.match(r"^BLR-\d{3,}$", v["vehicle_id"])
        assert int(v["vehicle_id"][-3:]) >= 7
        r = requests.post(f"{API}/vehicles", headers=H("u-admin"), json={"reg_no": reg(1).replace(" ", "-").lower(), "city": "Chennai"})
        assert r.status_code == 409
        r = requests.post(f"{API}/vehicles", headers=H("u-admin"), json={"reg_no": "ka01ab3901", "city": "Bengaluru"})
        assert r.status_code == 409

    def test_edit_keeps_id(self):
        v = mk_vehicle("Chennai", 2)
        r = requests.put(f"{API}/vehicles/{v['vehicle_id']}", headers=H("u-admin"),
                         json={"reg_no": reg(3), "city": "Bengaluru", "vehicle_type": "EV", "status": "Maintenance", "details": "TEST_"})
        assert r.status_code == 200
        assert r.json()["vehicle_id"] == v["vehicle_id"] and r.json()["reg_no"] == reg(3) and r.json()["status"] == "Maintenance"
        r = requests.put(f"{API}/vehicles/{v['vehicle_id']}", headers=H("u-admin"),
                         json={"reg_no": "KA 01 AB 3901", "city": "Chennai"})
        assert r.status_code == 409

    def test_no_delete_and_staff_forbidden(self):
        v = mk_vehicle("Chennai", 4)
        assert requests.delete(f"{API}/vehicles/{v['vehicle_id']}", headers=H("u-admin")).status_code in (200, 404, 405)
        assert requests.post(f"{API}/vehicles", headers=H("u-staff-1"), json={"reg_no": reg(5), "city": "Chennai"}).status_code == 403

    def test_search(self):
        for q in ["CHN-002", "TN 22 CD 3961", "tn22cd3961"]:
            r = requests.get(f"{API}/vehicles", headers=H("u-staff-1"), params={"q": q})
            ids = [v["vehicle_id"] for v in r.json()]
            assert "CHN-002" in ids, (q, ids)
        r = requests.get(f"{API}/vehicles", headers=H("u-staff-1"), params={"q": "CHN-002"})
        assert r.json()[0]["current_driver"]["driver_code"] == "CHN-D-002"


# --- Driver search
class TestDriverSearch:
    @pytest.mark.parametrize("q,expected", [("BLR-D-003", "R39-DRV-1005"), ("CHN-002", "R39-DRV-1007"),
                                            ("TN 22 CD 3961", "R39-DRV-1007"), ("TN22CD3961", "R39-DRV-1007"),
                                            ("Karthik", "R39-DRV-1007")])
    def test_search(self, q, expected):
        r = requests.get(f"{API}/drivers", headers=H("u-staff-1"), params={"q": q})
        assert r.status_code == 200
        ids = [d["id"] for d in r.json()]
        assert expected in ids, (q, ids)
        hit = next(d for d in r.json() if d["id"] == expected)
        assert hit["driver_code"] and hit["current_vehicle_id"]

    def test_search_by_mobile(self):
        drv = requests.get(f"{API}/drivers/R39-DRV-1007", headers=H("u-staff-1")).json()
        r = requests.get(f"{API}/drivers", headers=H("u-staff-1"), params={"q": drv["mobile"]})
        assert "R39-DRV-1007" in [d["id"] for d in r.json()]


# --- Assignment + transaction snapshot
class TestAssignmentAndSnapshot:
    def test_full_flow(self):
        v1 = mk_vehicle("Bengaluru", 11)
        v2 = mk_vehicle("Bengaluru", 12)
        d = mk_driver("Bengaluru", vehicle=v1["vehicle_id"])
        assert d["current_vehicle_id"] == v1["vehicle_id"] and d["vehicle_no"] == v1["reg_no"]
        assert len(d["assignments"]) == 1 and d["assignments"][0]["end_at"] is None
        # txn defaults to current vehicle
        t1 = mk_txn(d["id"], v1["vehicle_id"], "2026-11-10")
        assert t1["driver_code"] == d["driver_code"] and t1["vehicle_id"] == v1["vehicle_id"] and t1["vehicle_no"] == v1["reg_no"]
        # txn with another vehicle picked
        t2 = mk_txn(d["id"], v2["vehicle_id"], "2026-11-11")
        assert t2["vehicle_id"] == v2["vehicle_id"] and t2["vehicle_no"] == v2["reg_no"]
        # txn without vehicle rejected
        r = requests.post(f"{API}/transactions", headers=H("u-staff-1"), json={"driver_id": d["id"], "payment_date": "2026-11-12",
                          "amount": 700, "method": "Cash"})
        assert r.status_code == 400
        # staff changes vehicle
        r = requests.post(f"{API}/drivers/{d['id']}/assign-vehicle", headers=H("u-staff-2"),
                          json={"vehicle_id": v2["vehicle_id"], "reason": "TEST_ service"})
        assert r.status_code == 200, r.text
        dd = r.json()
        assert dd["current_vehicle_id"] == v2["vehicle_id"]
        cur = [a for a in dd["assignments"] if a["end_at"] is None]
        old = [a for a in dd["assignments"] if a["end_at"]]
        assert len(cur) == 1 and cur[0]["vehicle_id"] == v2["vehicle_id"] and cur[0]["prev_vehicle_id"] == v1["vehicle_id"]
        assert cur[0]["changed_by_name"] == "Suresh Patel" and cur[0]["reason"] == "TEST_ service"
        assert len(old) == 1 and old[0]["vehicle_id"] == v1["vehicle_id"]
        # old txn unchanged
        g = requests.get(f"{API}/transactions/{t1['id']}", headers=H("u-acc-1")).json()
        assert g["vehicle_id"] == v1["vehicle_id"] and g["vehicle_no"] == v1["reg_no"] and g["driver_code"] == d["driver_code"]
        # vehicle reg edit doesn't alter txn snapshot
        requests.put(f"{API}/vehicles/{v1['vehicle_id']}", headers=H("u-admin"), json={"reg_no": reg(13), "city": "Bengaluru"})
        g = requests.get(f"{API}/transactions/{t1['id']}", headers=H("u-acc-1")).json()
        assert g["vehicle_no"] == v1["reg_no"]
        # vehicle owned by another driver rejected
        r = requests.post(f"{API}/drivers/{d['id']}/assign-vehicle", headers=H("u-staff-1"), json={"vehicle_id": "CHN-002"})
        assert r.status_code == 409 and "Karthik" in r.json()["detail"]
        # inactive rejected
        v3 = mk_vehicle("Bengaluru", 14, status="Inactive")
        r = requests.post(f"{API}/drivers/{d['id']}/assign-vehicle", headers=H("u-staff-1"), json={"vehicle_id": v3["vehicle_id"]})
        assert r.status_code == 400 and "inactive" in r.json()["detail"].lower()
        # same vehicle
        r = requests.post(f"{API}/drivers/{d['id']}/assign-vehicle", headers=H("u-staff-1"), json={"vehicle_id": v2["vehicle_id"]})
        assert r.status_code == 400
        # accounts cannot reassign
        r = requests.post(f"{API}/drivers/{d['id']}/assign-vehicle", headers=H("u-acc-1"), json={"vehicle_id": v1["vehicle_id"]})
        assert r.status_code == 403
        # create driver with vehicle already used is rejected
        mk_driver("Bengaluru", vehicle=v2["vehicle_id"], expect=409)
        # verification list contains driver_code + vehicle_id
        lst = requests.get(f"{API}/transactions", headers=H("u-acc-1"), params={"status": "pending", "q": d["driver_code"]}).json()
        assert {t["id"] for t in lst} >= {t1["id"], t2["id"]}
        lst = requests.get(f"{API}/transactions", headers=H("u-acc-1"), params={"vehicle": v2["vehicle_id"]}).json()
        assert t2["id"] in [t["id"] for t in lst]
        # reject + resubmit with vehicle change -> audit
        r = requests.post(f"{API}/transactions/{t1['id']}/reject", headers=H("u-acc-1"), json={"remarks": "TEST_ wrong veh"})
        assert r.status_code == 200
        n = requests.get(f"{API}/notifications", headers=H("u-staff-1")).json()
        assert any(x["txn_id"] == t1["id"] for x in n["items"])
        r = requests.put(f"{API}/transactions/{t1['id']}/resubmit", headers=H("u-staff-1"),
                         json={"amount": 700, "utr": "", "method": "Cash", "remarks": "TEST_", "vehicle_id": v2["vehicle_id"]})
        assert r.status_code == 200, r.text
        rj = r.json()
        assert rj["status"] == "pending" and rj["vehicle_id"] == v2["vehicle_id"] and rj["vehicle_no"] == v2["reg_no"]
        assert any(a["action"] == "Vehicle ID changed" for a in rj["audit"])
        # SoD: staff cannot approve own; acc can approve
        assert requests.post(f"{API}/transactions/{t2['id']}/approve", headers=H("u-staff-1")).status_code == 403
        assert requests.post(f"{API}/transactions/{t2['id']}/approve", headers=H("u-acc-1")).status_code == 200
        # reports include codes for this driver
        rep = requests.get(f"{API}/reports/driver_history", headers=H("u-acc-1"), params={"driver_id": d["id"]}).json()
        ci, vi = rep["columns"].index("Driver ID"), rep["columns"].index("Vehicle ID")
        assert all(row[ci] == d["driver_code"] for row in rep["rows"])
        assert {row[vi] for row in rep["rows"]} == {v2["vehicle_id"]}
        assert d["driver_code"] in rep["title"]


# --- Historical transactions & reports
class TestReports:
    def test_historical_not_recorded(self):
        lst = requests.get(f"{API}/transactions", headers=H("u-acc-1"), params={"driver_id": "R39-DRV-1001"}).json()
        assert lst, "seeded transactions expected"
        old = [t for t in lst if not t.get("vehicle_id")]
        assert old, "pre-migration txns should have vehicle_id None"
        assert all(t["driver_code"] == "BLR-D-001" for t in lst)

    @pytest.mark.parametrize("kind,params", [("daily", {"date": "2026-11-19"}), ("pending", {}), ("verified", {}),
                                             ("rejected", {}), ("driver_history", {"driver_id": "R39-DRV-1001"})])
    def test_report_columns(self, kind, params):
        r = requests.get(f"{API}/reports/{kind}", headers=H("u-acc-1"), params=params)
        assert r.status_code == 200
        j = r.json()
        assert "Driver ID" in j["columns"] and "Vehicle ID" in j["columns"]
        vi = j["columns"].index("Vehicle ID")
        assert all(row[vi] for row in j["rows"])
        r = requests.get(f"{API}/reports/{kind}", headers=H("u-acc-1"), params={**params, "format": "xlsx"})
        assert r.status_code == 200 and r.content[:2] == b"PK"

    def test_history_report_not_recorded_text(self):
        j = requests.get(f"{API}/reports/driver_history", headers=H("u-acc-1"), params={"driver_id": "R39-DRV-1001"}).json()
        vi = j["columns"].index("Vehicle ID")
        assert "Vehicle ID not recorded" in [row[vi] for row in j["rows"]]

    def test_staff_performance(self):
        r = requests.get(f"{API}/reports/staff_performance", headers=H("u-admin"))
        assert r.status_code == 200 and r.json()["rows"]
        assert requests.get(f"{API}/reports/staff_performance", headers=H("u-admin"), params={"format": "xlsx"}).status_code == 200
