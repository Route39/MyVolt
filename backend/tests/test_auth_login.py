import os
import uuid
import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"
CREATED_USERS = []


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    m = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    for uid in CREATED_USERS:
        m.users.delete_one({"id": uid})
        m.audit_logs.delete_many({"entity_id": uid})


class TestAuthLogin:
    def test_login_valid_and_me_bearer(self):
        r = requests.post(f"{API}/auth/login", json={"mobile": "9845000001", "password": "route39@123"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("token")
        assert data["user"]["id"] == "u-admin"
        assert data["user"]["mobile"] == "9845000001"
        assert data["user"]["role"] == "admin"
        assert "password_hash" not in data["user"]

        r_prefix = requests.post(f"{API}/auth/login", json={"mobile": "+91 9845000001", "password": "route39@123"})
        assert r_prefix.status_code == 200, r_prefix.text
        assert r_prefix.json()["user"]["id"] == "u-admin"

        me = requests.get(f"{API}/me", headers={"Authorization": f"Bearer {data['token']}"})
        assert me.status_code == 200, me.text
        assert me.json()["id"] == "u-admin"
        assert me.json()["mobile"] == "9845000001"
        assert "password_hash" not in me.json()

    def test_login_invalid_credentials(self):
        r = requests.post(f"{API}/auth/login", json={"mobile": "9845000001", "password": "wrong-password"})
        assert r.status_code == 401
        r2 = requests.post(f"{API}/auth/login", json={"mobile": "9999999999", "password": "route39@123"})
        assert r2.status_code == 401
        r_short = requests.post(f"{API}/auth/login", json={"mobile": "12345", "password": "route39@123"})
        assert r_short.status_code == 401
        r3 = requests.get(f"{API}/me", headers={"Authorization": "Bearer invalid.token.here"})
        assert r3.status_code == 401

    def test_change_password_and_restore(self):
        login = requests.post(f"{API}/auth/login", json={"mobile": "9845000004", "password": "route39@123"})
        assert login.status_code == 200, login.text
        token = login.json()["token"]
        headers = {"Authorization": f"Bearer {token}"}

        bad = requests.post(
            f"{API}/auth/change-password",
            headers=headers,
            json={"current_password": "wrong", "new_password": "4321"},
        )
        assert bad.status_code == 400

        ok = requests.post(
            f"{API}/auth/change-password",
            headers=headers,
            json={"current_password": "route39@123", "new_password": "4321"},
        )
        assert ok.status_code == 200, ok.text

        try:
            old_login = requests.post(f"{API}/auth/login", json={"mobile": "9845000004", "password": "route39@123"})
            assert old_login.status_code == 401

            new_login = requests.post(f"{API}/auth/login", json={"mobile": "9845000004", "password": "4321"})
            assert new_login.status_code == 200, new_login.text
            assert new_login.json()["user"]["id"] == "u-staff-1"
        finally:
            restore = requests.post(
                f"{API}/auth/change-password",
                headers=headers,
                json={"current_password": "4321", "new_password": "route39@123"},
            )
            assert restore.status_code == 200, restore.text

    def test_admin_create_custom_password_and_deactivated_user_blocked(self):
        admin_tok = requests.post(
            f"{API}/auth/login", json={"mobile": "9845000001", "password": "route39@123"}
        ).json()["token"]
        admin_h = {"Authorization": f"Bearer {admin_tok}"}

        mob = f"97{str(uuid.uuid4().int % 100000000).zfill(8)}"
        created = requests.post(
            f"{API}/users",
            headers=admin_h,
            json={"name": "TEST_Auth User", "mobile": mob, "role": "staff", "active": True, "password": "myvolt99"},
        )
        assert created.status_code == 200, created.text
        u = created.json()
        CREATED_USERS.append(u["id"])
        assert u["mobile"] == mob
        assert "password_hash" not in u and "password" not in u

        users_list = requests.get(f"{API}/users", headers=admin_h).json()
        assert all("password_hash" not in row for row in users_list)
        assert any(row["id"] == u["id"] and row["mobile"] == mob for row in users_list)

        u_login = requests.post(f"{API}/auth/login", json={"mobile": mob, "password": "myvolt99"})
        assert u_login.status_code == 200, u_login.text
        assert u_login.json()["user"]["id"] == u["id"]

        pw_updated = requests.put(
            f"{API}/users/{u['id']}",
            headers=admin_h,
            json={"name": "TEST_Auth User", "mobile": mob, "role": "staff", "active": True, "password": "pass2026"},
        )
        assert pw_updated.status_code == 200, pw_updated.text
        assert requests.post(f"{API}/auth/login", json={"mobile": mob, "password": "pass2026"}).status_code == 200

        deactivated = requests.put(
            f"{API}/users/{u['id']}",
            headers=admin_h,
            json={"name": "TEST_Auth User", "mobile": mob, "role": "staff", "active": False},
        )
        assert deactivated.status_code == 200, deactivated.text

        blocked = requests.post(f"{API}/auth/login", json={"mobile": mob, "password": "pass2026"})
        assert blocked.status_code == 403

        logout = requests.post(f"{API}/auth/logout", headers=admin_h)
        assert logout.status_code == 200 and logout.json()["ok"] is True

    def test_all_seeded_accounts_login_and_role_access(self):
        accounts = [
            ("9845000001", "u-admin", "admin"),
            ("9845000002", "u-acc-1", "accounts"),
            ("9845000003", "u-acc-2", "accounts"),
            ("9845000004", "u-staff-1", "staff"),
            ("9845000005", "u-staff-2", "staff"),
            ("9845000006", "u-staff-3", "staff"),
        ]
        for mobile, uid, role in accounts:
            r = requests.post(f"{API}/auth/login", json={"mobile": mobile, "password": "route39@123"})
            assert r.status_code == 200, (mobile, r.text)
            data = r.json()
            assert data["user"]["id"] == uid
            assert data["user"]["mobile"] == mobile
            assert data["user"]["role"] == role
            hdrs = {"Authorization": f"Bearer {data['token']}"}

            assert requests.get(f"{API}/me", headers=hdrs).status_code == 200
            assert requests.get(f"{API}/overview", headers=hdrs).status_code == 200
            assert requests.get(f"{API}/board", headers=hdrs).status_code == 200

            if role == "admin":
                assert requests.get(f"{API}/users", headers=hdrs).status_code == 200
                assert requests.get(f"{API}/reports/pending", headers=hdrs).status_code == 200
            elif role == "accounts":
                assert requests.get(f"{API}/reports/pending", headers=hdrs).status_code == 200
                assert requests.get(f"{API}/users", headers=hdrs).status_code == 403
            elif role == "staff":
                assert requests.get(f"{API}/reports/pending", headers=hdrs).status_code == 403
                assert requests.get(f"{API}/users", headers=hdrs).status_code == 403
