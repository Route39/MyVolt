import requests

BASE = "http://localhost:8001/api"


def test_user_state_crud():
    # Login as Accounts
    r_acc = requests.post(f"{BASE}/auth/login", json={"mobile": "9845000002", "password": "route39@123"}).json()
    acc_h = {"Authorization": f"Bearer {r_acc['token']}"}

    # Login as Admin
    r_adm = requests.post(f"{BASE}/auth/login", json={"mobile": "9845000001", "password": "route39@123"}).json()
    adm_h = {"Authorization": f"Bearer {r_adm['token']}"}

    # 1. Accounts sets verification_state in DB
    test_state = {
        "tab": "approved",
        "month": "2026-11",
        "page": 2,
        "filters": {"city": "Bangalore", "driver_name": "Aarif"},
        "sort": {"key": "payment_date", "dir": "desc"}
    }
    set_res = requests.put(f"{BASE}/user/state/verification_state", headers=acc_h, json={"value": test_state})
    assert set_res.status_code == 200
    assert set_res.json()["ok"] is True
    assert set_res.json()["value"]["tab"] == "approved"

    # 2. Accounts retrieves verification_state from DB
    get_res = requests.get(f"{BASE}/user/state/verification_state", headers=acc_h)
    assert get_res.status_code == 200
    assert get_res.json()["value"] == test_state

    # 3. Admin retrieves verification_state -> MUST NOT see Accounts state (isolation)
    get_adm = requests.get(f"{BASE}/user/state/verification_state", headers=adm_h)
    assert get_adm.status_code == 200
    assert get_adm.json()["value"] != test_state

    # 4. Accounts deletes verification_state
    del_res = requests.delete(f"{BASE}/user/state/verification_state", headers=acc_h)
    assert del_res.status_code == 200
    get_empty = requests.get(f"{BASE}/user/state/verification_state", headers=acc_h)
    assert get_empty.status_code == 200
    assert get_empty.json()["value"] == {}
