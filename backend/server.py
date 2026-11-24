import asyncio
import io
import os
import re
import uuid
import logging
from contextlib import suppress
from datetime import datetime, timezone, timedelta, date, time
from pathlib import Path
from typing import Any, Optional, List, Literal

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from fastapi import FastAPI, APIRouter, Query, Header, HTTPException, UploadFile, File, Depends, Response
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING, DESCENDING, IndexModel, ReturnDocument, UpdateOne
from pydantic import BaseModel, Field
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
import bcrypt
import jwt

import storage
import importer
from seed import seed, USERS as SEED_USERS

client = AsyncIOMotorClient(os.environ.get('MONGO_URL', 'mongodb://localhost:27017'))
db = client[os.environ.get('DB_NAME', 'myvolt_db')]
APP_NAME = os.environ.get('APP_NAME', 'myvolt')
IST = timezone(timedelta(hours=5, minutes=30))
logger = logging.getLogger(__name__)

INDEXES: dict[str, list[IndexModel]] = {
    "users": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("mobile", ASCENDING)], name="mobile", unique=True,
                   partialFilterExpression={"mobile": {"$type": "string", "$gt": ""}}),
    ],
    "drivers": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("driver_code", ASCENDING)], name="driver_code", unique=True,
                   partialFilterExpression={"driver_code": {"$type": "string"}}),
        IndexModel([("mobile", ASCENDING)], name="mobile", unique=True,
                   partialFilterExpression={"mobile": {"$type": "string", "$gt": ""}}),
        IndexModel([("current_vehicle_id", ASCENDING)], name="current_vehicle", unique=True,
                   partialFilterExpression={"current_vehicle_id": {"$type": "string"}}),
        IndexModel([("city", ASCENDING)], name="driver_city"),
        IndexModel([("status", ASCENDING)], name="driver_status"),
        IndexModel([("city", ASCENDING), ("status", ASCENDING)], name="driver_city_status"),
        IndexModel([("name", ASCENDING)], name="driver_name"),
    ],
    "transactions": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("driver_id", ASCENDING), ("payment_date", ASCENDING)], name="driver_date"),
        IndexModel([("status", ASCENDING), ("submitted_at", DESCENDING)], name="status_submitted"),
        IndexModel([("utr", ASCENDING)], name="utr"),
        IndexModel([("payment_date", ASCENDING)], name="payment_date"),
        IndexModel([("city", ASCENDING)], name="txn_city"),
        IndexModel([("city", ASCENDING), ("payment_date", ASCENDING)], name="txn_city_date"),
        IndexModel([("status", ASCENDING), ("payment_date", ASCENDING)], name="txn_status_date"),
        IndexModel([("vehicle_id", ASCENDING)], name="txn_vehicle_id"),
        IndexModel([("driver_code", ASCENDING)], name="txn_driver_code"),
    ],
    "audit_logs": [IndexModel([("ts", DESCENDING)], name="ts"), IndexModel([("entity_id", ASCENDING)], name="entity")],
    "notifications": [IndexModel([("user_id", ASCENDING), ("created_at", DESCENDING)], name="user_created")],
    "files": [IndexModel([("id", ASCENDING)], name="id", unique=True)],
    "vehicles": [
        IndexModel([("vehicle_id", ASCENDING)], name="vehicle_id", unique=True),
        IndexModel([("reg_key", ASCENDING)], name="reg_key", unique=True),
        IndexModel([("vin", ASCENDING)], name="vin", unique=True,
                   partialFilterExpression={"vin": {"$type": "string", "$gt": ""}}),
        IndexModel([("city", ASCENDING)], name="veh_city"),
        IndexModel([("status", ASCENDING)], name="veh_status"),
        IndexModel([("city", ASCENDING), ("status", ASCENDING)], name="veh_city_status"),
    ],
    "vehicle_assignments": [IndexModel([("driver_id", ASCENDING), ("start_at", DESCENDING)], name="driver_start"),
                            IndexModel([("vehicle_id", ASCENDING)], name="vehicle")],
    "counters": [IndexModel([("id", ASCENDING)], name="id", unique=True)],
}


async def ensure_indexes() -> None:
    for collection, models in INDEXES.items():
        for model in models:
            try:
                await db[collection].create_indexes([model])
            except Exception as exc:
                logger.error("ensure_indexes(%s.%s): %s", collection, model.document["name"], exc)


app = FastAPI()
api = APIRouter(prefix="/api")
P = {"_id": 0}
USER_P = {"_id": 0, "password_hash": 0}
JWT_SECRET = os.environ.get("JWT_SECRET", "route39-myvolt-jwt-secret-key-2026")
JWT_ALG = "HS256"
DEFAULT_PASSWORD = os.environ.get("DEFAULT_USER_PASSWORD", "route39@123")


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_token(user: dict) -> str:
    return jwt.encode(
        {
            "sub": user["id"],
            "mobile": user.get("mobile", ""),
            "email": user.get("email", ""),
            "role": user["role"],
            "exp": datetime.now(timezone.utc) + timedelta(days=7),
        },
        JWT_SECRET,
        algorithm=JWT_ALG,
    )


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def today_ist() -> date:
    return datetime.now(IST).date()


def ist_day_start_utc(d: date) -> str:
    return datetime.combine(d, time(0), IST).astimezone(timezone.utc).isoformat()


def inr(v):
    return f"₹{v:,.0f}"


# ---------- auth (JWT bearer + role switcher header fallback) ----------
async def current_user(authorization: Optional[str] = Header(None), x_user_id: Optional[str] = Header(None)):
    uid = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
            uid = payload.get("sub")
        except Exception:
            raise HTTPException(401, "Invalid or expired session. Please sign in again.")
    elif x_user_id:
        uid = x_user_id
    if not uid:
        raise HTTPException(401, "Select a user or sign in to continue")
    u = await db.users.find_one({"id": uid, "active": True}, USER_P)
    if not u:
        raise HTTPException(401, "Unknown or inactive user")
    return u


def require(*roles):
    async def dep(user=Depends(current_user)):
        if user["role"] not in roles:
            raise HTTPException(403, "You do not have permission for this action")
        return user
    return dep


async def audit(user, action, entity, entity_id, prev=None, new=None, driver_id=None):
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()), "user_id": user["id"], "user_name": user["name"], "user_role": user["role"],
        "action": action, "entity": entity, "entity_id": entity_id, "driver_id": driver_id,
        "prev": None if prev is None else str(prev), "new": None if new is None else str(new), "ts": now_iso()})


async def get_settings():
    s = await db.settings.find_one({"id": "global"}, P)
    return s or {"id": "global", "allow_future_dates": False, "allow_multiple_per_date": False, "delayed_days": 1}


# ---------- models ----------
class LoginIn(BaseModel):
    mobile: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    password: str


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=4)


class UserIn(BaseModel):
    name: str = Field(min_length=2)
    mobile: str = ""
    email: str = ""
    role: Literal["staff", "accounts", "admin"]
    active: bool = True
    password: Optional[str] = None


class SettingsIn(BaseModel):
    allow_future_dates: bool
    allow_multiple_per_date: bool
    delayed_days: int = Field(ge=0, le=30)


class DriverIn(BaseModel):
    name: str = Field(min_length=2)
    mobile: str = Field(min_length=10, max_length=10)
    city: str = Field(min_length=2)
    joining_date: str
    handover_date: Optional[str] = None
    rent_start_date: Optional[str] = None
    daily_rent: float = Field(gt=0)
    status: Literal["Active", "Inactive", "Suspended"] = "Active"
    rent_free_dates: List[str] = []


class DriverCreate(DriverIn):
    driver_code: Optional[str] = None
    current_vehicle_id: Optional[str] = None
    vehicle_no: Optional[str] = ""


class VehicleIn(BaseModel):
    vehicle_id: Optional[str] = None
    reg_no: str = Field(min_length=4)
    city: str = Field(min_length=2)
    vehicle_type: str = ""
    vin: str = ""
    rental_ends: str = ""
    rental_status: str = ""
    status: Literal["Active", "Inactive", "Maintenance"] = "Active"
    details: str = ""


class AssignIn(BaseModel):
    vehicle_id: Optional[str] = None
    reason: str = ""


class AdjustmentIn(BaseModel):
    date: str
    amount: float = Field(gt=0)
    reason: str = Field(min_length=3)


class TxnIn(BaseModel):
    driver_id: str
    payment_date: str
    amount: float = Field(gt=0)
    utr: str = ""
    method: Literal["UPI", "Bank Transfer", "Cash"]
    file_id: Optional[str] = None
    remarks: str = ""
    is_split: bool = False
    vehicle_id: Optional[str] = None


class TxnEdit(BaseModel):
    amount: float = Field(gt=0)
    utr: str = ""
    method: Literal["UPI", "Bank Transfer", "Cash"]
    file_id: Optional[str] = None
    remarks: str = ""
    reason: str = ""
    vehicle_id: Optional[str] = None


class RejectIn(BaseModel):
    remarks: str = Field(min_length=3)


class UtrUpdateIn(BaseModel):
    utr: str = Field(min_length=3)
    reason: Optional[str] = "Corrected by Accounts"


class ImportRowIn(BaseModel):
    vehicle_id: Optional[str] = None
    name: str = ""
    mobile: str = ""
    city: str = "Bangalore"
    daily_rent: float = 700.0
    joining_date: str = ""
    handover_date: Optional[str] = None
    rent_start_date: Optional[str] = None
    driver_code: Optional[str] = None
    reg_no: str = ""
    vehicle_type: str = ""
    vin: str = ""
    rental_ends: str = ""
    rental_status: str = ""
    status: str = "Active"
    details: str = ""
    has_daily_rent: Optional[bool] = None
    has_joining_date: Optional[bool] = None


class ImportCommitIn(BaseModel):
    mode: Literal["drivers_and_vehicles", "drivers", "vehicles"] = "drivers_and_vehicles"
    update_existing: bool = True
    rows: List[ImportRowIn]


# ---------- users & settings ----------
@api.get("/")
async def root():
    return {"message": "Route39 MyVolt Fleet API", "app": "MyVolt", "version": "1.0.0"}


def clean_user_mobile(raw: str) -> str:
    s = (raw or "").strip()
    if not s:
        return ""
    digits = importer.clean_mobile(s)
    if len(digits) != 10:
        raise HTTPException(400, "Enter a valid 10-digit mobile number")
    return digits


@api.post("/auth/login")
async def login(body: LoginIn):
    raw_mobile = (body.mobile or body.phone or "").strip()
    if raw_mobile:
        mob = importer.clean_mobile(raw_mobile)
        if len(mob) != 10:
            raise HTTPException(401, "Invalid mobile number or password")
        u = await db.users.find_one({"mobile": mob}, P)
    elif (body.email or "").strip():
        u = await db.users.find_one({"email": body.email.strip().lower()}, P)
    else:
        raise HTTPException(400, "Enter your mobile number and password")
    if not u:
        raise HTTPException(401, "Invalid mobile number or password")
    if not u.get("active", True):
        raise HTTPException(403, "This account is inactive. Contact an administrator.")
    if not u.get("password_hash"):
        u["password_hash"] = hash_password(DEFAULT_PASSWORD)
        await db.users.update_one({"id": u["id"]}, {"$set": {"password_hash": u["password_hash"]}})
    if not verify_password(body.password, u["password_hash"]):
        raise HTTPException(401, "Invalid mobile number or password")
    await audit(u, "User signed in", "user", u["id"], None, u.get("mobile") or u.get("email") or u["id"])
    clean_user = {k: v for k, v in u.items() if k != "password_hash"}
    return {"token": create_token(u), "user": clean_user}


@api.post("/auth/logout")
async def logout(user=Depends(current_user)):
    await audit(user, "User signed out", "user", user["id"], None, user.get("mobile") or user.get("email") or user["id"])
    return {"ok": True}


@api.post("/auth/change-password")
async def change_password(body: ChangePasswordIn, user=Depends(current_user)):
    full = await db.users.find_one({"id": user["id"]}, P)
    current_hash = (full or {}).get("password_hash") or hash_password(DEFAULT_PASSWORD)
    if not verify_password(body.current_password, current_hash):
        raise HTTPException(400, "Current password is incorrect")
    await db.users.update_one({"id": user["id"]}, {"$set": {"password_hash": hash_password(body.new_password)}})
    await audit(user, "Password changed", "user", user["id"], None, "Password updated")
    return {"ok": True, "message": "Password updated successfully"}


@api.get("/users/switcher")
async def users_switcher():
    return await db.users.find({"active": True}, {"_id": 0, "id": 1, "name": 1, "mobile": 1, "email": 1, "role": 1}).sort("role", 1).to_list(200)


@api.get("/me")
async def me(user=Depends(current_user)):
    return user


@api.get("/users")
async def list_users(user=Depends(require("admin"))):
    return await db.users.find({}, USER_P).sort("name", 1).to_list(500)


@api.get("/users/staff")
async def list_staff(user=Depends(current_user)):
    return await db.users.find({"role": {"$in": ["staff", "admin"]}}, {"_id": 0, "id": 1, "name": 1}).to_list(500)


@api.post("/users")
async def create_user(body: UserIn, user=Depends(require("admin"))):
    mobile = clean_user_mobile(body.mobile)
    if mobile and await db.users.find_one({"mobile": mobile}):
        raise HTTPException(409, "A user with this mobile number already exists")
    email = (body.email or "").strip().lower()
    if email and await db.users.find_one({"email": email}):
        raise HTTPException(409, "A user with this email already exists")
    raw_pw = (body.password or "").strip()
    if raw_pw and len(raw_pw) < 4:
        raise HTTPException(400, "Password must be at least 4 characters")
    data = body.model_dump(exclude={"password"})
    doc = {
        "id": f"u-{uuid.uuid4().hex[:8]}",
        **data,
        "mobile": mobile,
        "email": email,
        "password_hash": hash_password(raw_pw or DEFAULT_PASSWORD),
        "created_at": now_iso(),
    }
    await db.users.insert_one(doc)
    await audit(user, "User created", "user", doc["id"], None, f"{doc['name']} · {mobile} ({doc['role']})")
    doc.pop("_id", None)
    doc.pop("password_hash", None)
    return doc


@api.put("/users/{uid}")
async def update_user(uid: str, body: UserIn, user=Depends(require("admin"))):
    old = await db.users.find_one({"id": uid}, USER_P)
    if not old:
        raise HTTPException(404, "User not found")
    if uid == user["id"] and (not body.active or body.role != "admin"):
        raise HTTPException(400, "You cannot deactivate or demote yourself")
    mobile = clean_user_mobile(body.mobile)
    if mobile != old.get("mobile") and await db.users.find_one({"mobile": mobile, "id": {"$ne": uid}}):
        raise HTTPException(409, "A user with this mobile number already exists")
    email = (body.email or "").strip().lower()
    if email and email != old.get("email") and await db.users.find_one({"email": email, "id": {"$ne": uid}}):
        raise HTTPException(409, "A user with this email already exists")
    raw_pw = (body.password or "").strip()
    if raw_pw and len(raw_pw) < 4:
        raise HTTPException(400, "Password must be at least 4 characters")
    new = {**body.model_dump(exclude={"password"}), "mobile": mobile, "email": email}
    update_set = dict(new)
    if raw_pw:
        update_set["password_hash"] = hash_password(raw_pw)
    await db.users.update_one({"id": uid}, {"$set": update_set})
    for k in ["name", "mobile", "email", "role", "active"]:
        if old.get(k) != new[k]:
            await audit(user, "User information changed", "user", uid, f"{k}: {old.get(k)}", f"{k}: {new[k]}")
    if raw_pw:
        await audit(user, "User password reset", "user", uid, None, "Password reset by admin")
    return await db.users.find_one({"id": uid}, USER_P)


@api.get("/settings")
async def read_settings(user=Depends(current_user)):
    return await get_settings()


@api.put("/settings")
async def write_settings(body: SettingsIn, user=Depends(require("admin"))):
    old = await get_settings()
    await db.settings.update_one({"id": "global"}, {"$set": {"id": "global", **body.model_dump()}}, upsert=True)
    for k, v in body.model_dump().items():
        if old.get(k) != v:
            await audit(user, "Rent rule changed", "settings", "global", f"{k}: {old.get(k)}", f"{k}: {v}")
    return await get_settings()


# ---------- drivers ----------
def rent_start(d):
    return d.get("rent_start_date") or d.get("handover_date") or d["joining_date"]


def expected_between(drv, start: date, end: date) -> float:
    # Rent starts on the day after joining date (joining day has 0 rent)
    join_dt = date.fromisoformat(drv["joining_date"]) if drv.get("joining_date") else None
    join_next = (join_dt + timedelta(days=1)) if join_dt else None
    rs_dt = date.fromisoformat(rent_start(drv))
    base_start = max(rs_dt, join_next) if join_next else rs_dt

    s = max(start, base_start)
    if end < s:
        return 0.0
    free = set(drv.get("rent_free_dates") or [])
    if drv.get("joining_date"):
        free.add(drv["joining_date"])
    days = sum(1 for i in range((end - s).days + 1) if (s + timedelta(days=i)).isoformat() not in free)
    adj = sum(a["amount"] for a in drv.get("adjustments") or [] if s.isoformat() <= a["date"] <= end.isoformat())
    return max(days * drv["daily_rent"] - adj, 0.0)


def summarize(drv, txns, start: date, end: date):
    end = min(end, today_ist())
    s, e = start.isoformat(), end.isoformat()
    join_str = drv.get("joining_date") or s
    inrange = [t for t in txns if min(join_str, s) <= t["payment_date"] <= e]
    verified = sum(t["amount"] for t in inrange if t["status"] == "approved")
    pending = sum(t["amount"] for t in inrange if t["status"] == "pending")
    expected = expected_between(drv, start, end)
    return {"expected": expected, "submitted": verified + pending, "verified": verified, "pending": pending,
            "rejected_count": sum(1 for t in inrange if t["status"] == "rejected"),
            "outstanding": max(expected - verified, 0.0),
            "start_date": s}


def natural_sort_key(s: Any) -> list:
    if s is None:
        return []
    s = str(s).strip()
    return [int(text) if text.isdigit() else text.lower() for text in re.split(r"(\d+)", s)]


async def get_driver_or_404(did):
    d = await db.drivers.find_one({"id": did}, P)
    if not d:
        raise HTTPException(404, "Driver not found")
    return d


@api.get("/drivers")
async def list_drivers(q: str = "", city: str = "", status: str = "", sort: str = "driver_code", order: str = "asc", format: str = "json", user=Depends(current_user)):
    f = driver_filter(q)
    if city and city != "all":
        f["city"] = city_query_filter(city)
    if status and status != "all":
        f["status"] = status
    drivers = await db.drivers.find(f, P).to_list(20000)
    rev = (order.lower() == "desc")
    if sort == "name":
        drivers.sort(key=lambda d: (d.get("name") or "").lower(), reverse=rev)
    elif sort == "created_at":
        drivers.sort(key=lambda d: d.get("created_at") or "", reverse=rev)
    elif sort == "joining_date":
        drivers.sort(key=lambda d: d.get("joining_date") or "", reverse=rev)
    elif sort in ("rent", "daily_rent"):
        drivers.sort(key=lambda d: float(d.get("daily_rent") or 0), reverse=rev)
    elif sort == "mobile":
        drivers.sort(key=lambda d: d.get("mobile") or "", reverse=rev)
    elif sort == "city":
        drivers.sort(key=lambda d: (d.get("city") or "").lower(), reverse=rev)
    else:
        drivers.sort(key=lambda d: natural_sort_key(d.get("driver_code") or d.get("id") or ""), reverse=rev)
    if format == "xlsx":
        headers = ["DRIVER ID", "DRIVER NAME", "PHONE NUMBER", "CITY", "JOINING DATE", "RENT"]
        rows = [
            [
                d.get("driver_code"),
                d.get("name"),
                d.get("mobile"),
                d.get("city"),
                d.get("joining_date"),
                d.get("daily_rent"),
            ]
            for d in drivers
        ]
        return await xlsx_response(
            "drivers",
            "Drivers Master",
            headers,
            rows,
            user,
        )
    return drivers


async def enrich_driver(drv):
    drv["current_vehicle"] = (await db.vehicles.find_one({"vehicle_id": drv["current_vehicle_id"]}, P)
                              if drv.get("current_vehicle_id") else None)
    drv["assignments"] = await db.vehicle_assignments.find({"driver_id": drv["id"]}, P).sort("start_at", -1).to_list(200)
    return drv


@api.get("/drivers/{did}")
async def get_driver(did: str, user=Depends(current_user)):
    drv = await get_driver_or_404(did)
    txns = await db.transactions.find({"driver_id": did}, P).to_list(5000)
    drv["summary"] = summarize(drv, txns, date.fromisoformat(rent_start(drv)), today_ist())
    return await enrich_driver(drv)


DRIVER_CODE_RX = re.compile(r"^[A-Z0-9]{2,12}-[A-Z0-9-]{1,20}$")
STD_DRIVER_CODE_RX = re.compile(r"^[A-Z]{2,5}-D-\d{3,}$")


@api.post("/drivers")
async def create_driver(body: DriverCreate, user=Depends(require("admin"))):
    last = await db.drivers.find({}, {"_id": 0, "id": 1}).to_list(20000)
    nums = [int(d["id"].split("-")[-1]) for d in last if d["id"].split("-")[-1].isdigit()]
    ctr = await db.counters.find_one_and_update({"id": "driver_id_seq"}, {"$inc": {"seq": 1}}, upsert=True, return_document=ReturnDocument.AFTER)
    next_num = max(max(nums) if nums else 1000, int(ctr.get("seq", 1000))) + 1
    data = body.model_dump(exclude={"driver_code", "current_vehicle_id"})
    data["handover_date"] = data["handover_date"] or data["joining_date"]
    data["rent_start_date"] = data["rent_start_date"] or data["handover_date"]
    
    # Strictly enforce 100% unique mobile number
    mobile = importer.clean_mobile(data.get("mobile"))
    if not mobile or len(mobile) != 10:
        raise HTTPException(400, "Mobile number must be exactly 10 digits")
    data["mobile"] = mobile
    existing_mob = await db.drivers.find_one({"mobile": mobile})
    if existing_mob:
        raise HTTPException(409, f"A driver with mobile number {mobile} already exists ({existing_mob.get('name')})")

    if body.current_vehicle_id:
        await check_assignable(body.current_vehicle_id, None)
    code = (body.driver_code or "").strip().upper()
    if code:
        if not STD_DRIVER_CODE_RX.match(code):
            raise HTTPException(400, "Driver ID must look like BLR-D-001")
        if await db.drivers.find_one({"driver_code": code}):
            raise HTTPException(409, f"Driver ID {code} is already used")
    else:
        code = await next_code("driver", city_prefix(data["city"]))
    stored_veh_no = (body.vehicle_no or "").strip().upper() if body.vehicle_no else ""
    doc = {"id": f"R39-DRV-{next_num}", "driver_code": code, **data, "vehicle_no": stored_veh_no,
           "current_vehicle_id": None, "adjustments": [], "created_at": now_iso()}
    await db.drivers.insert_one(doc)
    doc.pop("_id", None)
    await audit(user, "Driver created", "driver", doc["id"], None,
                f"{code} · {doc['name']} · {inr(doc['daily_rent'])}/day{' · ID override' if body.driver_code else ''}", doc["id"])
    if body.current_vehicle_id:
        await assign_vehicle(doc, body.current_vehicle_id, user, "Initial assignment")
    return await get_driver(doc["id"], user)


@api.put("/drivers/{did}")
async def update_driver(did: str, body: DriverIn, user=Depends(require("admin"))):
    old = await get_driver_or_404(did)
    new = body.model_dump()
    new["handover_date"] = new["handover_date"] or new["joining_date"]
    new["rent_start_date"] = new["rent_start_date"] or new["handover_date"]

    # Strictly enforce 100% unique mobile number on update
    if "mobile" in new:
        mobile = importer.clean_mobile(new.get("mobile"))
        if not mobile or len(mobile) != 10:
            raise HTTPException(400, "Mobile number must be exactly 10 digits")
        new["mobile"] = mobile
        existing_mob = await db.drivers.find_one({"mobile": mobile, "id": {"$ne": did}})
        if existing_mob:
            raise HTTPException(409, f"Mobile number {mobile} is already used by driver {existing_mob.get('name')} ({existing_mob.get('driver_code')})")

    await db.drivers.update_one({"id": did}, {"$set": new})
    for k, v in new.items():
        if old.get(k) != v:
            action = "Rental amount changed" if k == "daily_rent" else "Driver information changed"
            await audit(user, action, "driver", did, f"{k}: {old.get(k)}", f"{k}: {v}", did)
    return await get_driver(did, user)


@api.delete("/drivers/{did}")
async def delete_driver(did: str, user=Depends(require("admin"))):
    drv = await get_driver_or_404(did)
    ts = now_iso()
    vid = drv.get("current_vehicle_id")
    if vid:
        await db.vehicles.update_one({"vehicle_id": vid}, {"$set": {"rental_status": "available"}})
    await db.vehicle_assignments.update_many({"driver_id": did, "end_at": None}, {"$set": {"end_at": ts, "ended_by_name": user["name"]}})
    await db.drivers.delete_one({"id": did})
    await db.transactions.delete_many({"driver_id": did})
    await db.notifications.delete_many({"driver_id": did})
    await audit(user, "Driver deleted", "driver", did, drv.get("name"), f"{drv.get('driver_code')} · {drv.get('name')}", did)
    return {"message": f"Driver {drv.get('name')} deleted", "id": did}


# ---------- vehicles & assignments ----------
CITY_PREFIX = {"bengaluru": "BLR", "bangalore": "BLR", "chennai": "CHN", "coimbatore": "CBE",
               "tiruppur": "TPR", "tirupur": "TPR", "hyderabad": "HYD"}


def city_prefix(city):
    return CITY_PREFIX.get(city.strip().lower()) or (re.sub(r"[^A-Z]", "", city.upper())[:3] or "GEN")


def city_query_filter(city: str):
    c = (city or "").strip()
    if not c or c.lower() == "all":
        return None
    cl = c.lower()
    if cl in ("bengaluru", "bangalore", "blr"):
        return {"$in": ["Bengaluru", "Bangalore"]}
    if cl in ("tirupur", "tiruppur"):
        return {"$in": ["Tiruppur", "Tirupur"]}
    if cl in ("chennai", "madras", "chn"):
        return {"$in": ["Chennai", "Madras"]}
    if cl in ("coimbatore", "cbe"):
        return {"$in": ["Coimbatore"]}
    return c


def reg_key(reg):
    return re.sub(r"[^A-Z0-9]", "", reg.upper())


async def next_code(kind, prefix):
    while True:
        c = await db.counters.find_one_and_update({"id": f"{kind}:{prefix}"}, {"$inc": {"seq": 1}}, upsert=True,
                                                  return_document=ReturnDocument.AFTER)
        if kind == "driver":
            code = f"{prefix}-D-{c['seq']:03d}"
            if not await db.drivers.find_one({"driver_code": code}):
                return code
        else:
            code = f"{prefix}-{c['seq']:03d}"
            if not await db.vehicles.find_one({"vehicle_id": code}):
                return code


async def insert_vehicle(reg_no, city, vehicle_type="", status="Active", details="", vin="", rental_ends="", rental_status="", vehicle_id=None):
    rk = reg_key(reg_no)
    if not rk:
        raise HTTPException(400, "Registration number is required")
    if await db.vehicles.find_one({"reg_key": rk}):
        raise HTTPException(409, f"A vehicle with registration {reg_no.upper()} already exists")
    vin_clean = vin.strip().upper() if vin else ""
    if vin_clean and vin_clean not in ("", "—", "(BLANK)"):
        existing_vin = await db.vehicles.find_one({"vin": vin_clean})
        if existing_vin:
            raise HTTPException(409, f"A vehicle with VIN {vin_clean} already exists ({existing_vin.get('reg_no')})")
    stored_reg = reg_no.strip() if " - " in reg_no else reg_no.strip().upper()
    vid = (vehicle_id or "").strip()
    if vid:
        if await db.vehicles.find_one({"vehicle_id": vid}):
            raise HTTPException(409, f"A vehicle with ID {vid} already exists")
    else:
        vid = await next_code("vehicle", city_prefix(city))
    doc = {
        "vehicle_id": vid,
        "reg_no": stored_reg,
        "reg_key": rk,
        "city": city.strip(),
        "vehicle_type": vehicle_type,
        "vin": vin_clean,
        "rental_ends": rental_ends.strip(),
        "rental_status": rental_status or "available",
        "status": status,
        "details": details,
        "created_at": now_iso(),
    }
    await db.vehicles.insert_one(doc)
    doc.pop("_id", None)
    return doc


async def check_assignable(vehicle_id, driver_id):
    veh = await db.vehicles.find_one({"vehicle_id": vehicle_id}, P)
    if not veh:
        raise HTTPException(404, f"Vehicle {vehicle_id} not found")
    if veh["status"] == "Inactive":
        raise HTTPException(400, f"Vehicle {vehicle_id} is inactive")
    other = await db.drivers.find_one({"current_vehicle_id": vehicle_id, "id": {"$ne": driver_id}}, P)
    if other:
        raise HTTPException(409, f"{vehicle_id} is currently assigned to {other['name']} ({other.get('driver_code')}). "
                                 "Change that driver's vehicle first.")
    return veh


async def assign_vehicle(drv, vehicle_id, user, reason):
    prev = drv.get("current_vehicle_id")
    if vehicle_id == prev:
        raise HTTPException(400, "This vehicle is already assigned to the driver")
    veh = await check_assignable(vehicle_id, drv["id"]) if vehicle_id else None
    ts = now_iso()
    await db.vehicle_assignments.update_many({"driver_id": drv["id"], "end_at": None},
                                             {"$set": {"end_at": ts, "ended_by_name": user["name"]}})
    if veh:
        await db.vehicle_assignments.insert_one({
            "id": str(uuid.uuid4()), "driver_id": drv["id"], "vehicle_id": veh["vehicle_id"], "reg_no": veh["reg_no"],
            "prev_vehicle_id": prev, "start_at": ts, "end_at": None, "changed_by": user["id"],
            "changed_by_name": user["name"], "reason": reason.strip()})
    await db.drivers.update_one({"id": drv["id"]}, {"$set": {"current_vehicle_id": vehicle_id,
                                                         "vehicle_no": veh["reg_no"] if veh else ""}})
    await audit(user, "Vehicle assignment changed", "driver", drv["id"], prev or "none",
                f"{vehicle_id or 'none'}{' · ' + reason.strip() if reason.strip() else ''}", drv["id"])


@api.post("/drivers/{did}/assign-vehicle")
async def assign_vehicle_route(did: str, body: AssignIn, user=Depends(require("staff", "admin"))):
    drv = await get_driver_or_404(did)
    await assign_vehicle(drv, (body.vehicle_id or "").strip().upper() or None, user, body.reason)
    return await get_driver(did, user)


@api.get("/vehicles")
async def list_vehicles(q: str = "", city: str = "", status: str = "", assignment: str = "", sort: str = "vehicle_id", order: str = "asc", format: str = "json", user=Depends(current_user)):
    f = {}
    if q.strip():
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        matched_drvs = await db.drivers.find(
            {"current_vehicle_id": {"$ne": None}, "$or": [{"name": rx}, {"driver_code": rx}, {"mobile": rx}]},
            {"_id": 0, "current_vehicle_id": 1},
        ).to_list(500)
        matched_vids = [d["current_vehicle_id"] for d in matched_drvs if d.get("current_vehicle_id")]
        ors = [
            {"vehicle_id": rx},
            {"reg_no": rx},
            {"reg_key": {"$regex": re.escape(reg_key(q)) or ".", "$options": "i"}},
            {"city": rx},
            {"vehicle_type": rx},
            {"vin": rx},
            {"details": rx},
        ]
        if matched_vids:
            ors.append({"vehicle_id": {"$in": matched_vids}})
        f = {"$or": ors}
    if city and city != "all":
        f["city"] = city_query_filter(city)
    if status and status not in ("all", "available", "rented"):
        f["status"] = status
    vehicles = await db.vehicles.find(f, P).to_list(20000)
    drivers = await db.drivers.find(
        {"current_vehicle_id": {"$ne": None}},
        {"_id": 0, "id": 1, "name": 1, "driver_code": 1, "mobile": 1, "daily_rent": 1, "current_vehicle_id": 1},
    ).to_list(20000)
    by_vid = {d["current_vehicle_id"]: d for d in drivers}
    for v in vehicles:
        v["current_driver"] = by_vid.get(v["vehicle_id"])
        v["daily_rent"] = (v["current_driver"] or {}).get("daily_rent") or v.get("daily_rent") or 0
        v["rental_status"] = "rented" if v.get("current_driver") else (v.get("rental_status") or "available")
    if status == "available":
        vehicles = [v for v in vehicles if v.get("status") == "Active" and not v.get("current_driver") and v.get("rental_status") == "available"]
    elif status == "rented":
        vehicles = [v for v in vehicles if v.get("status") == "Active" and (v.get("current_driver") or v.get("rental_status") == "rented")]
    if assignment == "assigned":
        vehicles = [v for v in vehicles if v.get("current_driver")]
    elif assignment == "unassigned":
        vehicles = [v for v in vehicles if not v.get("current_driver")]
    rev = (order.lower() == "desc")
    if sort == "reg_no":
        vehicles.sort(key=lambda v: (v.get("reg_no") or "").lower(), reverse=rev)
    elif sort == "vin":
        vehicles.sort(key=lambda v: (v.get("vin") or "").lower(), reverse=rev)
    elif sort == "city":
        vehicles.sort(key=lambda v: (v.get("city") or "").lower(), reverse=rev)
    elif sort == "created_at":
        vehicles.sort(key=lambda v: v.get("created_at") or "", reverse=rev)
    else:
        vehicles.sort(key=lambda v: natural_sort_key(v.get("vehicle_id") or ""), reverse=rev)
    if format == "xlsx":
        rows = [
            [
                v.get("vehicle_id"),
                v.get("reg_no"),
                v.get("vin") or "",
                v.get("city"),
            ]
            for v in vehicles
        ]
        return await xlsx_response(
            "vehicles",
            "Vehicles Master",
            ["VEHICLE ID", "VEHICLE NUMBER", "VIN NUMBER", "CITY"],
            rows,
            user,
        )
    return vehicles


@api.post("/vehicles")
async def create_vehicle(body: VehicleIn, user=Depends(require("admin"))):
    doc = await insert_vehicle(
        body.reg_no,
        body.city,
        body.vehicle_type,
        body.status,
        body.details,
        body.vin,
        body.rental_ends,
        body.rental_status,
        body.vehicle_id,
    )
    await audit(user, "Vehicle created", "vehicle", doc["vehicle_id"], None, f"{doc['reg_no']} · {doc['city']}")
    return doc


@api.put("/vehicles/{vid}")
async def update_vehicle(vid: str, body: VehicleIn, user=Depends(require("admin"))):
    old = await db.vehicles.find_one({"vehicle_id": vid}, P)
    if not old:
        raise HTTPException(404, "Vehicle not found")
    stored_reg = body.reg_no.strip() if " - " in body.reg_no else body.reg_no.strip().upper()
    dump = body.model_dump()
    if not dump.get("vehicle_id"):
        dump["vehicle_id"] = vid
    new = {
        **dump,
        "reg_no": stored_reg,
        "reg_key": reg_key(stored_reg),
        "vin": (body.vin or "").strip().upper(),
        "rental_ends": (body.rental_ends or "").strip(),
    }
    if new["reg_key"] != old["reg_key"] and await db.vehicles.find_one({"reg_key": new["reg_key"], "vehicle_id": {"$ne": vid}}):
        raise HTTPException(409, f"A vehicle with registration {new['reg_no']} already exists")
    if new["vin"] and new["vin"] not in ("", "—", "(BLANK)"):
        other_vin = await db.vehicles.find_one({"vin": new["vin"], "vehicle_id": {"$ne": vid}})
        if other_vin:
            raise HTTPException(409, f"A vehicle with VIN {new['vin']} already exists ({other_vin.get('reg_no')})")
    if new["status"] == "Inactive" and old["status"] != "Inactive":
        holder = await db.drivers.find_one({"current_vehicle_id": vid}, P)
        if holder:
            raise HTTPException(409, f"{vid} is assigned to {holder['name']} ({holder.get('driver_code')}). Change that driver's vehicle before marking it inactive.")
    await db.vehicles.update_one({"vehicle_id": vid}, {"$set": new})
    for k in ["reg_no", "city", "vehicle_type", "vin", "rental_ends", "status", "details"]:
        if old.get(k) != new[k]:
            await audit(user, "Vehicle information changed", "vehicle", vid, f"{k}: {old.get(k)}", f"{k}: {new[k]}")
    if new["reg_no"] != old["reg_no"]:
        await db.drivers.update_many({"current_vehicle_id": vid}, {"$set": {"vehicle_no": new["reg_no"]}})
    return await db.vehicles.find_one({"vehicle_id": vid}, P)


@api.delete("/vehicles/{vid}")
async def delete_vehicle(vid: str, user=Depends(require("admin"))):
    veh = await db.vehicles.find_one({"vehicle_id": vid}, P)
    if not veh:
        raise HTTPException(404, "Vehicle not found")
    ts = now_iso()
    await db.vehicle_assignments.update_many({"vehicle_id": vid, "end_at": None}, {"$set": {"end_at": ts}})
    await db.drivers.update_many({"current_vehicle_id": vid}, {"$set": {"current_vehicle_id": None, "vehicle_no": ""}})
    await db.vehicles.delete_one({"vehicle_id": vid})
    await audit(user, "Vehicle deleted", "vehicle", vid, veh.get("reg_no"), f"{veh.get('vehicle_id')} · {veh.get('reg_no')}")
    return {"message": f"Vehicle {vid} deleted", "vehicle_id": vid}


@api.get("/import/template")
async def import_template(mode: str = "drivers_and_vehicles", user=Depends(require("admin"))):
    wb = Workbook()
    ws = wb.active
    if mode == "drivers":
        ws.title = "Drivers Template"
        cols = ["DRIVER ID", "DRIVER NAME", "PHONE NUMBER", "CITY", "JOINING DATE", "RENT"]
        ws.append(cols)
        ws.append(["R39D-TUP001", "varshini", "7904800475", "Tiruppur", "2026-10-03", 800])
        fname = "myvolt_drivers_template.xlsx"
    elif mode == "vehicles":
        ws.title = "Vehicles Template"
        cols = ["VEHICLE ID", "VEHICLE NUMBER", "VIN NUMBER", "CITY"]
        ws.append(cols)
        ws.append(["141", "KA51AJ2624", "MBX0007EF2B266083", "Bangalore"])
        fname = "myvolt_vehicles_template.xlsx"
    else:
        ws.title = "Import Template"
        cols = ["Driver", "ID", "Phone", "Vehicle", "City", "Joining Date", "VIN", "Rental Ends", "Daily Rent (₹)", "Status"]
        ws.append(cols)
        ws.append(["varshini", "R39D-TUP001", "7904800475", "TUP001 - hjjhjjhj", "Tiruppur", "2026-10-03", "MBX0007EF2B260000", "2026-11-25", 800, "Active"])
        ws.append(["Not Assigned", "", "", "141 - KA51AJ2624", "Bangalore", "", "MBX0007EF2B266083", "(blank)", 850, "available"])
        fname = "myvolt_import_template.xlsx"
    for c in ws[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="DC2626")
    for col in ws.columns:
        ws.column_dimensions[col[0].column_letter].width = max(14, min(32, max(len(str(c.value or "")) for c in col) + 3))
    buf = io.BytesIO()
    wb.save(buf)
    return Response(
        buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@api.post("/import/parse")
async def import_parse(file: UploadFile = File(...), user=Depends(require("admin"))):
    filename = file.filename or "upload.pdf"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ("pdf", "xlsx", "xlsm", "csv", "png", "jpg", "jpeg", "webp"):
        raise HTTPException(400, "Only PDF, Excel (.xlsx), CSV, or image (PNG/JPG/WEBP) files are supported")
    data = await file.read()
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(400, "Import file must be under 20 MB")
    try:
        return await asyncio.to_thread(importer.parse_import_file, filename, data, today_ist().isoformat())
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        logger.error("import_parse failed: %s", exc)
        raise HTTPException(400, f"Could not read file: {exc}")


@api.post("/import/commit")
async def import_commit(body: ImportCommitIn, user=Depends(require("admin"))):
    today_str = today_ist().isoformat()
    ts = now_iso()

    all_vehicles = await db.vehicles.find({}, P).to_list(50000)
    veh_by_rk = {v["reg_key"]: v for v in all_vehicles if v.get("reg_key")}
    veh_by_id = {v["vehicle_id"]: v for v in all_vehicles if v.get("vehicle_id")}
    veh_by_vin = {v["vin"].strip().upper(): v for v in all_vehicles if v.get("vin") and v.get("vin").strip().upper() not in ("", "—", "(BLANK)", "(blank)")}

    all_drivers = await db.drivers.find({}, P).to_list(50000)
    drv_by_id = {d["id"]: d for d in all_drivers if d.get("id")}
    drv_by_code = {d["driver_code"]: d for d in all_drivers if d.get("driver_code")}
    drv_by_mob = {d["mobile"]: d for d in all_drivers if d.get("mobile") and len(d.get("mobile", "")) == 10}
    drv_by_name_mob = {}
    drv_by_name_exact = {}
    holder_by_vid = {}
    nums = []
    for d in all_drivers:
        if not d.get("id"):
            continue
        if d["id"].split("-")[-1].isdigit():
            nums.append(int(d["id"].split("-")[-1]))
        nm = (d.get("name") or "").strip().lower()
        mob = d.get("mobile") or ""
        if nm:
            drv_by_name_mob.setdefault((nm, mob), d)
            drv_by_name_exact.setdefault(nm, d)
        if d.get("current_vehicle_id"):
            holder_by_vid[d["current_vehicle_id"]] = d
    next_drv_num = (max(nums) if nums else 1000) + 1

    all_counters = await db.counters.find({"id": {"$exists": True}}, P).to_list(5000)
    counter_seq = {c["id"]: int(c.get("seq", 0)) for c in all_counters if c.get("id")}
    dirty_counters = set()

    def alloc_code(kind: str, prefix: str) -> str:
        key = f"{kind}:{prefix}"
        seq = counter_seq.get(key, 0)
        while True:
            seq += 1
            if kind == "driver":
                code = f"{prefix}-D-{seq:03d}"
                if code not in drv_by_code:
                    counter_seq[key] = seq
                    dirty_counters.add(key)
                    return code
            else:
                code = f"{prefix}-{seq:03d}"
                if code not in veh_by_id:
                    counter_seq[key] = seq
                    dirty_counters.add(key)
                    return code

    new_vehicles_by_id = {}
    veh_patch_by_id = {}
    new_drivers_by_id = {}
    drv_patch_by_id = {}
    unassign_driver_ids = set()
    close_assign_driver_ids = set()
    new_assignments = []
    last_batch_assign_by_drv = {}

    drivers_created = 0
    drivers_updated = 0
    vehicles_created = 0
    vehicles_updated = 0
    assignments_created = 0
    errors: List[str] = []

    def link_driver_to_vehicle(target_drv: dict, target_veh: dict) -> bool:
        nonlocal assignments_created
        if not target_veh or target_veh.get("status") == "Inactive":
            return False
        vid_ = target_veh["vehicle_id"]
        if target_drv.get("current_vehicle_id") == vid_:
            return False
        other = holder_by_vid.get(vid_)
        if other and other["id"] != target_drv["id"]:
            return False
        did_ = target_drv["id"]
        prev_vid = target_drv.get("current_vehicle_id")
        if prev_vid:
            if (holder_by_vid.get(prev_vid) or {}).get("id") == did_:
                holder_by_vid.pop(prev_vid, None)
            if did_ not in new_drivers_by_id:
                close_assign_driver_ids.add(did_)
                unassign_driver_ids.add(did_)
        if did_ in last_batch_assign_by_drv:
            last_batch_assign_by_drv[did_]["end_at"] = ts

        target_drv["current_vehicle_id"] = vid_
        target_drv["vehicle_no"] = target_veh["reg_no"]
        holder_by_vid[vid_] = target_drv
        if did_ not in new_drivers_by_id:
            drv_patch_by_id.setdefault(did_, {}).update(
                {"current_vehicle_id": vid_, "vehicle_no": target_veh["reg_no"]}
            )
        target_veh["rental_status"] = "rented"
        if vid_ not in new_vehicles_by_id:
            veh_patch_by_id.setdefault(vid_, {})["rental_status"] = "rented"

        asgn = {
            "id": str(uuid.uuid4()),
            "driver_id": did_,
            "vehicle_id": vid_,
            "reg_no": target_veh["reg_no"],
            "prev_vehicle_id": prev_vid,
            "start_at": ts,
            "end_at": None,
            "changed_by": user["id"],
            "changed_by_name": user["name"],
            "reason": "Imported from file",
        }
        new_assignments.append(asgn)
        last_batch_assign_by_drv[did_] = asgn
        assignments_created += 1
        return True

    for idx, row in enumerate(body.rows):
        try:
            city = importer.clean_city(row.city, default="Bangalore")
            veh_doc = None
            reg_clean = importer.clean_reg_no(row.reg_no)
            raw_name = re.sub(r"\s+", " ", (row.name or "").strip())
            if importer._is_unassigned_driver(raw_name):
                raw_name = ""
            vin_clean = "" if importer._is_blank(row.vin) else re.sub(r"\s+", "", row.vin.strip().upper())
            rental_ends_clean = "" if importer._is_blank(row.rental_ends) else importer.clean_date(row.rental_ends, row.rental_ends.strip())
            raw_rental_st = (row.rental_status or "").strip().lower()
            if not raw_rental_st and (row.status or "").strip().lower() in ("available", "rented"):
                raw_rental_st = row.status.strip().lower()
            rental_status_clean = raw_rental_st if raw_rental_st in ("available", "rented") else ("rented" if raw_name else "available")

            if body.mode in ("vehicles", "drivers_and_vehicles") and reg_clean:
                rk = reg_key(reg_clean)
                veh_doc = veh_by_rk.get(rk)
                if not veh_doc and vin_clean:
                    veh_doc = veh_by_vin.get(vin_clean)
                veh_status = importer.clean_status(row.status, kind="vehicle")
                veh_rent = max(float(row.daily_rent or 0), 0.0)
                if not veh_doc:
                    vid = (row.vehicle_id or "").strip()
                    if not vid or vid in veh_by_id:
                        vid = alloc_code("vehicle", city_prefix(city))
                    stored_reg = reg_clean.strip() if " - " in reg_clean else reg_clean.strip().upper()
                    veh_doc = {
                        "vehicle_id": vid,
                        "reg_no": stored_reg,
                        "reg_key": rk,
                        "city": city.strip(),
                        "vehicle_type": row.vehicle_type.strip(),
                        "vin": vin_clean,
                        "rental_ends": rental_ends_clean,
                        "rental_status": rental_status_clean or "available",
                        "status": veh_status,
                        "details": row.details.strip(),
                        "created_at": ts,
                    }
                    if veh_rent > 0:
                        veh_doc["daily_rent"] = veh_rent
                    veh_by_rk[rk] = veh_doc
                    veh_by_id[vid] = veh_doc
                    if vin_clean:
                        veh_by_vin[vin_clean] = veh_doc
                    new_vehicles_by_id[vid] = veh_doc
                    vehicles_created += 1
                elif body.update_existing:
                    vid = veh_doc["vehicle_id"]
                    upd_v = {"city": city, "rental_status": rental_status_clean}
                    if row.vehicle_type.strip():
                        upd_v["vehicle_type"] = row.vehicle_type.strip()
                    if row.details.strip():
                        upd_v["details"] = row.details.strip()
                    if vin_clean:
                        upd_v["vin"] = vin_clean
                    if rental_ends_clean or importer._is_blank(row.rental_ends):
                        upd_v["rental_ends"] = rental_ends_clean
                    if row.has_daily_rent is not False and veh_rent > 0:
                        upd_v["daily_rent"] = veh_rent
                    veh_doc.update(upd_v)
                    if vid not in new_vehicles_by_id:
                        veh_patch_by_id.setdefault(vid, {}).update(upd_v)
                    if raw_name == "" and rental_status_clean == "available":
                        holder = holder_by_vid.pop(vid, None)
                        if holder:
                            hid = holder["id"]
                            holder["current_vehicle_id"] = None
                            holder["vehicle_no"] = ""
                            if hid not in new_drivers_by_id:
                                unassign_driver_ids.add(hid)
                                close_assign_driver_ids.add(hid)
                                drv_patch_by_id.setdefault(hid, {}).update({"current_vehicle_id": None, "vehicle_no": ""})
                            if hid in last_batch_assign_by_drv:
                                last_batch_assign_by_drv.pop(hid)["end_at"] = ts
                    vehicles_updated += 1

                if body.mode == "vehicles" and not raw_name and rental_status_clean == "rented" and veh_doc and not holder_by_vid.get(veh_doc["vehicle_id"]):
                    unassigned_reg_matches = [
                        d for d in drv_by_id.values()
                        if not d.get("current_vehicle_id") and d.get("vehicle_no") and reg_key(d["vehicle_no"]) == rk
                    ]
                    if len(unassigned_reg_matches) == 1:
                        link_driver_to_vehicle(unassigned_reg_matches[0], veh_doc)

            if raw_name and body.mode in ("drivers", "drivers_and_vehicles", "vehicles"):
                name = raw_name
                mobile_raw = importer.clean_mobile(row.mobile)
                has_mobile = bool(mobile_raw and len(mobile_raw) >= 10)
                if len(mobile_raw) > 10:
                    mobile = mobile_raw[-10:]
                elif len(mobile_raw) == 10:
                    mobile = mobile_raw
                else:
                    mobile = ""

                joining = importer.clean_date(row.joining_date, today_str)
                handover = importer.clean_date(row.handover_date, joining) if (row.handover_date or "").strip() else joining
                rent_start_dt = importer.clean_date(row.rent_start_date, handover) if (row.rent_start_date or "").strip() else handover
                daily_rent = max(float(row.daily_rent or 700.0), 1.0)
                drv_status = importer.clean_status(row.status, kind="driver")

                code_in = re.sub(r"\s*-\s*", "-", (row.driver_code or "").strip().upper())
                drv_doc = None
                if code_in and DRIVER_CODE_RX.match(code_in):
                    drv_doc = drv_by_code.get(code_in)
                if not drv_doc and has_mobile:
                    drv_doc = drv_by_mob.get(mobile)
                if not drv_doc and has_mobile:
                    drv_doc = drv_by_name_mob.get((name.lower(), mobile))
                if not drv_doc and not has_mobile:
                    drv_doc = drv_by_name_exact.get(name.lower())
                    if not drv_doc:
                        rx_pref = re.compile(rf"^{re.escape(name)}(\s|$)", re.IGNORECASE)
                        prefix_matches = [d for d in drv_by_id.values() if rx_pref.match(d.get("name") or "")]
                        if len(prefix_matches) == 1:
                            drv_doc = prefix_matches[0]

                if veh_doc is None and body.mode == "drivers" and reg_clean:
                    veh_doc = veh_by_rk.get(reg_key(reg_clean))

                if not drv_doc:
                    if code_in and DRIVER_CODE_RX.match(code_in) and code_in not in drv_by_code:
                        code = code_in
                    else:
                        code = alloc_code("driver", city_prefix(city))
                    drv_id = f"R39-DRV-{next_drv_num}"
                    next_drv_num += 1
                    stored_drv_veh_no = reg_clean if (body.mode == "drivers" and reg_clean) else ""
                    drv_doc = {
                        "id": drv_id,
                        "driver_code": code,
                        "name": name,
                        "mobile": mobile,
                        "city": city,
                        "joining_date": joining,
                        "handover_date": handover,
                        "rent_start_date": rent_start_dt,
                        "daily_rent": daily_rent,
                        "status": drv_status,
                        "rent_free_dates": [],
                        "vehicle_no": stored_drv_veh_no,
                        "current_vehicle_id": None,
                        "adjustments": [],
                        "created_at": ts,
                    }
                    drv_by_id[drv_id] = drv_doc
                    drv_by_code[code] = drv_doc
                    if has_mobile:
                        drv_by_mob[mobile] = drv_doc
                    drv_by_name_mob.setdefault((name.lower(), mobile), drv_doc)
                    drv_by_name_exact.setdefault(name.lower(), drv_doc)
                    new_drivers_by_id[drv_id] = drv_doc
                    drivers_created += 1
                elif body.update_existing:
                    did = drv_doc["id"]
                    upd_d = {"city": city, "status": drv_status}
                    if row.has_daily_rent is not False:
                        upd_d["daily_rent"] = daily_rent
                    if row.has_joining_date is not False and (row.joining_date or "").strip():
                        upd_d["joining_date"] = joining
                        upd_d["handover_date"] = handover
                        upd_d["rent_start_date"] = rent_start_dt
                    if has_mobile:
                        upd_d["mobile"] = mobile
                        drv_by_mob[mobile] = drv_doc
                        drv_by_name_mob[(drv_doc.get("name", "").strip().lower(), mobile)] = drv_doc
                    if body.mode == "drivers" and not veh_doc and not drv_doc.get("current_vehicle_id"):
                        if reg_clean:
                            upd_d["vehicle_no"] = reg_clean
                    drv_doc.update(upd_d)
                    if did not in new_drivers_by_id:
                        drv_patch_by_id.setdefault(did, {}).update(upd_d)
                    drivers_updated += 1

                if veh_doc:
                    link_driver_to_vehicle(drv_doc, veh_doc)
        except HTTPException as exc:
            errors.append(f"Row {idx + 1} ({row.name or row.reg_no}): {exc.detail}")
        except Exception as exc:
            errors.append(f"Row {idx + 1} ({row.name or row.reg_no}): {exc}")

    if dirty_counters:
        await db.counters.bulk_write(
            [UpdateOne({"id": k}, {"$set": {"seq": counter_seq[k]}}, upsert=True) for k in dirty_counters],
            ordered=False,
        )
    if new_vehicles_by_id:
        await db.vehicles.insert_many(list(new_vehicles_by_id.values()), ordered=False)
    if veh_patch_by_id:
        await db.vehicles.bulk_write(
            [UpdateOne({"vehicle_id": vid}, {"$set": p}) for vid, p in veh_patch_by_id.items()],
            ordered=False,
        )
    unassign_existing = [did for did in unassign_driver_ids if did not in new_drivers_by_id]
    if unassign_existing:
        await db.drivers.bulk_write(
            [UpdateOne({"id": did}, {"$set": {"current_vehicle_id": None, "vehicle_no": ""}}) for did in unassign_existing],
            ordered=False,
        )
    if new_drivers_by_id:
        await db.drivers.insert_many(list(new_drivers_by_id.values()), ordered=False)
    if drv_patch_by_id:
        await db.drivers.bulk_write(
            [UpdateOne({"id": did}, {"$set": p}) for did, p in drv_patch_by_id.items()],
            ordered=False,
        )
    if close_assign_driver_ids:
        await db.vehicle_assignments.update_many(
            {"driver_id": {"$in": list(close_assign_driver_ids)}, "end_at": None},
            {"$set": {"end_at": ts, "ended_by_name": user["name"]}},
        )
    if new_assignments:
        await db.vehicle_assignments.insert_many(new_assignments, ordered=False)

    await audit(
        user,
        "Bulk data imported",
        "import",
        body.mode,
        None,
        f"Drivers +{drivers_created}/~{drivers_updated} · Vehicles +{vehicles_created}/~{vehicles_updated} · Assigned {assignments_created}",
    )
    return {
        "drivers_created": drivers_created,
        "drivers_updated": drivers_updated,
        "vehicles_created": vehicles_created,
        "vehicles_updated": vehicles_updated,
        "assignments_created": assignments_created,
        "errors": errors,
    }


async def migrate_ids():
    drivers = await db.drivers.find({}, P).sort("id", 1).to_list(10000)
    for d in drivers:
        if not d.get("driver_code"):
            d["driver_code"] = await next_code("driver", city_prefix(d["city"]))
            await db.drivers.update_one({"id": d["id"]}, {"$set": {"driver_code": d["driver_code"]}})
        if "current_vehicle_id" not in d:
            vid = None
            if d.get("vehicle_no"):
                veh = await db.vehicles.find_one({"reg_key": reg_key(d["vehicle_no"])}, P)
                veh = veh or await insert_vehicle(d["vehicle_no"], d["city"])
                vid = veh["vehicle_id"]
                start = d.get("handover_date") or d["joining_date"]
                await db.vehicle_assignments.insert_one({
                    "id": str(uuid.uuid4()), "driver_id": d["id"], "vehicle_id": vid, "reg_no": veh["reg_no"],
                    "prev_vehicle_id": None, "start_at": f"{start}T00:00:00+05:30", "end_at": None, "changed_by": None,
                    "changed_by_name": "System migration", "reason": "Migrated from existing driver record"})
            await db.drivers.update_one({"id": d["id"]}, {"$set": {"current_vehicle_id": vid}})
        await db.transactions.update_many({"driver_id": d["id"], "driver_code": {"$exists": False}},
                                          {"$set": {"driver_code": d["driver_code"]}})
    await db.transactions.update_many({"vehicle_id": {"$exists": False}}, {"$set": {"vehicle_id": None}})


@api.post("/drivers/{did}/adjustments")
async def add_adjustment(did: str, body: AdjustmentIn, user=Depends(require("admin"))):
    await get_driver_or_404(did)
    adj = {"id": str(uuid.uuid4()), **body.model_dump(), "by": user["name"], "at": now_iso()}
    await db.drivers.update_one({"id": did}, {"$push": {"adjustments": adj}})
    await audit(user, "Rental adjustment approved", "driver", did, None, f"{body.date}: -{inr(body.amount)} ({body.reason})", did)
    return await get_driver(did, user)


@api.get("/drivers/{did}/calendar")
async def driver_calendar(did: str, year: int = Query(ge=2000, le=2100), month: int = Query(ge=1, le=12),
                          user=Depends(current_user)):
    drv = await get_driver_or_404(did)
    settings = await get_settings()
    first = date(year, month, 1)
    last = (date(year + (month == 12), month % 12 + 1, 1) - timedelta(days=1))
    txns = await db.transactions.find({"driver_id": did}, P).sort("submitted_at", 1).to_list(5000)
    by_date = {}
    for t in txns:
        by_date.setdefault(t["payment_date"], []).append(t)
    rs, today = rent_start(drv), today_ist()
    free = set(drv.get("rent_free_dates") or [])
    adj_dates = {a["date"] for a in drv.get("adjustments") or []}

    joining_date_str = drv.get("joining_date")
    joining_dt = date.fromisoformat(joining_date_str) if joining_date_str else None
    # Rent charging starts strictly on the next day after joining date
    rent_calc_start = (joining_dt + timedelta(days=1)) if joining_dt else date.fromisoformat(rs)
    rent_calc_start_str = rent_calc_start.isoformat()

    days = []
    for i in range(last.day):
        d = first + timedelta(days=i)
        ds = d.isoformat()
        is_joining = bool(joining_date_str and ds == joining_date_str)
        day_txns = by_date.get(ds, [])
        active = [t for t in day_txns if t["status"] != "rejected"]
        approved = sum(t["amount"] for t in active if t["status"] == "approved")

        if is_joining:
            # Joining date: NO rent charged, displays green
            status = "joining" if not active else ("verified" if approved else "pending")
        elif any(t["status"] == "pending" for t in active):
            status = "pending"
        elif approved:
            status = "verified" if approved >= drv["daily_rent"] else "partial"
        elif day_txns:
            status = "rejected"
        else:
            status = "none"

        disabled, reason = False, None
        if ds < rs:
            disabled, reason = True, "Before rent start date"
        elif d > today and not settings["allow_future_dates"] and not day_txns:
            disabled, reason = True, "Future date"
        days.append({
            "date": ds, "status": status, "disabled": disabled, "reason": reason,
            "is_joining": is_joining,
            "rent_free": is_joining or (ds in free), "adjusted": ds in adj_dates,
            "amount": sum(t["amount"] for t in active) if active else (day_txns[-1]["amount"] if day_txns else 0),
            "txns": [{k: t.get(k) for k in ["id", "amount", "status", "utr", "method", "is_split", "submitted_by_name",
                                            "rejection_reason", "submitted_by", "vehicle_id", "vehicle_no"]} for t in day_txns],
        })
    await enrich_driver(drv)
    return {"driver": {k: v for k, v in drv.items() if k != "adjustments"}, "settings": settings, "days": days,
            "rent_calc_start": rent_calc_start_str,
            "month_summary": summarize(drv, txns, first, last),
            "overall_summary": summarize(drv, txns, rent_calc_start, today)}


# ---------- files ----------
ALLOWED = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}


@api.post("/upload")
async def upload(file: UploadFile = File(...), user=Depends(require("staff", "admin"))):
    ext = (file.filename or "").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else ""
    if ext not in ALLOWED:
        raise HTTPException(400, "Only JPG, JPEG, PNG or WEBP images are allowed")
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(400, "Screenshot must be under 10 MB")
    path = f"{APP_NAME}/screenshots/{user['id']}/{uuid.uuid4()}.{ext}"
    try:
        res = await asyncio.to_thread(storage.put_object, path, data, ALLOWED[ext])
    except Exception as e:
        logger.error("upload failed: %s", e)
        raise HTTPException(502, "Screenshot upload failed, please try again")
    fid = str(uuid.uuid4())
    await db.files.insert_one({"id": fid, "storage_path": res["path"], "content_type": ALLOWED[ext],
                               "original_filename": file.filename, "size": len(data), "uploaded_by": user["id"],
                               "is_deleted": False, "created_at": now_iso()})
    return {"file_id": fid, "filename": file.filename}


@api.get("/files/{fid}")
async def get_file(fid: str, user=Depends(current_user)):
    rec = await db.files.find_one({"id": fid, "is_deleted": False}, P)
    if not rec:
        raise HTTPException(404, "File not found")
    data, _ = await asyncio.to_thread(storage.get_object, rec["storage_path"])
    return Response(content=data, media_type=rec["content_type"],
                    headers={"Content-Disposition": f'inline; filename="{rec.get("original_filename") or "screenshot"}"'})

                    # ---------- payment screenshot scan (offline OCR: checks it is a payment receipt + reads the UTR) ----------
import tempfile
import threading as _threading

_PAY_OCR_ENGINE = None
_PAY_OCR_LOCK = _threading.Lock()

# label groups in priority order: the bank-side reference (UTR / UPI Ref) is preferred over app-side IDs
_PAY_LABELS = [
    r"UTR(?:\s*(?:No|Number))?",
    r"UPI\s*(?:Ref(?:erence)?(?:\s*(?:No|ID|Number))?|transaction\s*ID)",
    r"Ref(?:erence)?\s*(?:No|ID|Number)",
    r"(?:Transaction|Txn)\s*(?:ID|No|Number)",
    r"Payment\s*(?:ID|No|Number)",
]
_PAY_VAL = r"([A-Za-z0-9][A-Za-z0-9\-]{7,39})"
# words that normally appear on a payment receipt; a real receipt matches several of them
_PAY_WORDS = [
    r"paid", r"payment", r"success(?:ful(?:ly)?)?", r"completed", r"transaction", r"\btxn\b", r"\bUPI\b", r"\bUTR\b",
    r"\bref(?:erence)?\b", r"debited", r"credited", r"transferred", r"\bsent\b", r"beneficiary", r"\bbank\b",
    r"google\s*pay|gpay|phonepe|paytm|bhim|amazon\s*pay|\bcred\b", r"\bfrom\b", r"\bto\b",
]


def _read_payment_text(lines):
    """Text logic: do the OCR lines look like a payment receipt, and what is the UTR / transaction ref?"""
    text = "\n".join(lines)
    txn = None
    for g in _PAY_LABELS:                                     # 1) value written after a known label
        for m in re.finditer(g + r"\.?\s*[:#\-]?\s*\n?\s*" + _PAY_VAL, text, re.I):
            if re.search(r"\d{4,}", m.group(1)) or len(m.group(1)) >= 10:
                txn = m.group(1)
                break
        if txn:
            break
    if not txn:                                               # 2) standalone 12-digit UPI ref, 3) PhonePe-style id
        m = re.search(r"(?<!\d)(\d{12})(?!\d)", text) or re.search(r"\b(T\d{15,25})\b", text)
        txn = m.group(1) if m else None
    hits = sum(1 for w in _PAY_WORDS if re.search(w, text, re.I))
    has_amount = bool(re.search(r"(?:₹|Rs\.?|INR|\?)\s*\d", text, re.I)) or any(
        re.fullmatch(r"\s*[^\w\s]?\s*\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?\s*", ln) for ln in lines)
    is_payment = bool((txn and hits >= 2) or (has_amount and hits >= 4))
    return {"is_payment": is_payment, "utr": txn.upper() if (is_payment and txn) else None}


def _scan_payment_screenshot_sync(data, ext):
    global _PAY_OCR_ENGINE
    # 1. Native macOS Vision OCR via importer
    try:
        pages = importer._run_vision_ocr("image", data, "." + ext)
        tokens = []
        for p in pages:
            tokens.extend(p.get("tokens") or [])
        if tokens:
            tokens_sorted = sorted(tokens, key=lambda t: (t.get("bbox", [0, 0])[1], t.get("bbox", [0, 0])[0]))
            lines = [t["text"] for t in tokens_sorted if t.get("text")]
            if lines:
                return _read_payment_text(lines)
    except Exception as e:
        logger.debug("Native Vision OCR failed: %s", e)

    # 2. RapidOCR fallback
    fd, tmp = tempfile.mkstemp(suffix="." + ext)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        with _PAY_OCR_LOCK:                                   # one scan at a time; the model loads once, on first use
            if _PAY_OCR_ENGINE is None:
                import importlib
                rapid_mod = importlib.import_module("rapidocr_onnxruntime")
                _PAY_OCR_ENGINE = getattr(rapid_mod, "RapidOCR")()
            res, _ = _PAY_OCR_ENGINE(tmp)
        lines = [r[1] for r in sorted(res or [], key=lambda r: r[0][0][1])]      # top-to-bottom
        return _read_payment_text(lines)
    except Exception as e:
        logger.debug("RapidOCR failed: %s", e)
    finally:
        with suppress(OSError):
            os.remove(tmp)
    return {"is_payment": False, "utr": None}


class ScanIn(BaseModel):
    file_id: str


@api.post("/upload/scan")
async def scan_uploaded_screenshot(body: ScanIn, user=Depends(require("staff", "admin"))):
    rec = await db.files.find_one({"id": body.file_id, "is_deleted": False}, P)
    if not rec:
        raise HTTPException(400, "Screenshot not found, please upload again")
    ext = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}.get(rec.get("content_type"), "jpg")
    try:
        data, _ = await asyncio.to_thread(storage.get_object, rec["storage_path"])
        res = await asyncio.wait_for(asyncio.to_thread(_scan_payment_screenshot_sync, data, ext), timeout=90)
    except Exception as e:                                    # scanner missing / crashed: never block the payment form
        logger.warning("Payment screenshot scan failed: %s", e)
        return {"scanned": False, "is_payment": None, "utr": None}
    return {"scanned": True, **res}


# ---------- transactions ----------
async def get_txn_or_404(tid):
    t = await db.transactions.find_one({"id": tid}, P)
    if not t:
        raise HTTPException(404, "Transaction not found")
    return t


async def validate_payment(method, utr, file_id, exclude_id=None):
    utr = utr.strip().upper()
    if method != "Cash":
        if len(utr) < 6:
            raise HTTPException(400, "Enter a valid UTR / transaction reference (min 6 characters)")
        dup = await db.transactions.find_one({"utr": utr, "status": {"$ne": "rejected"}, "id": {"$ne": exclude_id}}, P)
        if dup:
            raise HTTPException(409, f"This UTR is already used in {dup['id']} ({dup['driver_name']}, {dup['payment_date']})")
    if file_id and not await db.files.find_one({"id": file_id, "is_deleted": False}):
        raise HTTPException(400, "Screenshot not found, please upload again")
    return utr or f"CASH-{uuid.uuid4().hex[:6].upper()}"


@api.post("/transactions")
async def create_txn(body: TxnIn, user=Depends(require("staff", "admin"))):
    drv = await get_driver_or_404(body.driver_id)
    settings = await get_settings()
    try:
        pd = date.fromisoformat(body.payment_date)
    except ValueError:
        raise HTTPException(400, "Invalid payment date")
    if body.payment_date < rent_start(drv):
        raise HTTPException(400, "Payment date is before the driver's rent start date")
    if pd > today_ist() and not settings["allow_future_dates"]:
        raise HTTPException(400, "Future dates are not enabled")
    existing = await db.transactions.find({"driver_id": drv["id"], "payment_date": body.payment_date}, P).to_list(50)
    active = [t for t in existing if t["status"] != "rejected"]
    if active and not body.is_split and not settings["allow_multiple_per_date"]:
        raise HTTPException(409, "A payment already exists for this driver and date. Mark it as a split payment to add another.")
    if not active and existing and not body.is_split:
        raise HTTPException(409, "A rejected payment exists for this date. Use 'Correct & Resubmit' instead.")
    utr = await validate_payment(body.method, body.utr, body.file_id)
    if not body.vehicle_id:
        raise HTTPException(400, "Select the Vehicle ID used for this payment")
    veh = await db.vehicles.find_one({"vehicle_id": body.vehicle_id}, P)
    if not veh:
        raise HTTPException(400, f"Vehicle {body.vehicle_id} not found")
    count = await db.transactions.count_documents({})
    txn = {
        "id": f"TXN-{100001 + count + uuid.uuid4().int % 1000}", "driver_id": drv["id"], "driver_name": drv["name"],
        "driver_code": drv.get("driver_code"), "vehicle_id": veh["vehicle_id"], "vehicle_no": veh["reg_no"],
        "city": drv["city"], "payment_date": body.payment_date,
        "amount": body.amount, "utr": utr, "method": body.method, "file_id": body.file_id,
        "remarks": body.remarks.strip(), "is_split": body.is_split, "status": "pending",
        "submitted_by": user["id"], "submitted_by_name": user["name"], "submitted_at": now_iso(),
        "verified_by": None, "verified_by_name": None, "verified_at": None, "rejection_reason": None,
        "rejection_history": [], "corrections": [], "version": 1,
    }
    while await db.transactions.find_one({"id": txn["id"]}):
        txn["id"] = f"TXN-{uuid.uuid4().hex[:6].upper()}"
    await db.transactions.insert_one(txn)
    await audit(user, "Transaction submitted", "transaction", txn["id"], None,
                f"{inr(body.amount)} · UTR {utr} · {body.method} · {veh['vehicle_id']}{' · split' if body.is_split else ''}", drv["id"])
    txn.pop("_id", None)
    return txn


@api.get("/transactions")
async def list_txns(status: Optional[str] = None, driver_id: Optional[str] = None, q: str = "",
                    driver_name: str = "", vehicle: str = "", utr: str = "", payment_date: str = "",
                    city: str = "", staff_id: str = "", date_from: str = "", date_to: str = "", month: str = "", summary: bool = False,
                    page: Optional[int] = Query(None, ge=1), page_size: int = Query(25, ge=1, le=200),
                    sort: str = "submitted_at", dir: str = "desc", format: str = "json", user=Depends(current_user)):
    f = {}
    if status and status != "all":
        f["status"] = status
    if driver_id:
        f["driver_id"] = driver_id
    for field, val in [("utr", utr)]:
        if val.strip():
            f[field] = {"$regex": re.escape(val.strip()), "$options": "i"}
    if city and city != "all":
        cq = city_query_filter(city)
        if isinstance(cq, dict):
            f["city"] = cq
        else:
            f["city"] = {"$regex": re.escape(city.strip()), "$options": "i"}
    ands = []
    if driver_name.strip():
        nrx = {"$regex": re.escape(driver_name.strip()), "$options": "i"}
        ands.append({"$or": [{"driver_name": nrx}, {"driver_code": nrx}, {"driver_id": nrx}]})
    if vehicle.strip():
        vrx = {"$regex": re.escape(vehicle.strip()), "$options": "i"}
        ands.append({"$or": [{"vehicle_no": vrx}, {"vehicle_id": vrx}]})
    if payment_date:
        f["payment_date"] = payment_date
    elif month:
        f["payment_date"] = {"$regex": "^" + re.escape(month.strip())}
    elif date_from or date_to:
        f["payment_date"] = {k: v for k, v in [("$gte", date_from), ("$lte", date_to)] if v}
    if staff_id and staff_id != "all":
        f["submitted_by"] = staff_id
    if q.strip():
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        ands.append({"$or": [{"driver_name": rx}, {"driver_id": rx}, {"driver_code": rx}, {"vehicle_no": rx},
                             {"vehicle_id": rx}, {"utr": rx}, {"id": rx}]})
    if ands:
        f["$and"] = ands
    if summary:
        f.pop("status", None)
        out = {k: {"count": 0, "amount": 0} for k in ("pending", "approved", "rejected")}
        async for g in db.transactions.aggregate([{"$match": f}, {"$group": {"_id": "$status", "count": {"$sum": 1}, "amount": {"$sum": "$amount"}}}]):
            if g["_id"] in out:
                out[g["_id"]] = {"count": g["count"], "amount": g["amount"]}
        return out
    sort_key = sort if sort in {"submitted_at", "payment_date", "amount", "driver_name", "status", "verified_at"} else "submitted_at"
    cur = db.transactions.find(f, P).sort([(sort_key, 1 if dir == "asc" else -1), ("id", -1)])
    if format == "xlsx":
        cols, rows = txn_rows(await cur.to_list(50000), [("rejection_reason", "Rejection Reason")])
        return await xlsx_response("ledger", "Payment Ledger", cols, rows, user)
    if page:
        total = await db.transactions.count_documents(f)
        return {"items": await cur.skip((page - 1) * page_size).limit(page_size).to_list(page_size), "total": total}
    return await cur.to_list(1000)


@api.get("/transactions/{tid}")
async def get_txn(tid: str, user=Depends(current_user)):
    t = await get_txn_or_404(tid)
    t["driver"] = await db.drivers.find_one({"id": t["driver_id"]}, {"_id": 0, "adjustments": 0})
    t["vehicle"] = await db.vehicles.find_one({"vehicle_id": t["vehicle_id"]}, P) if t.get("vehicle_id") else None
    t["audit"] = await db.audit_logs.find({"entity_id": tid}, P).sort("ts", -1).to_list(200)
    return t


@api.post("/transactions/{tid}/approve")
async def approve_txn(tid: str, user=Depends(require("accounts", "admin"))):
    t = await get_txn_or_404(tid)
    if t["status"] != "pending":
        raise HTTPException(400, f"Only pending payments can be approved (current: {t['status']})")
    if user["id"] == t["submitted_by"]:
        raise HTTPException(403, "You cannot approve a payment you entered yourself")
    if user["id"] == t.get("amount_modified_by"):
        raise HTTPException(403, "You cannot approve a payment where you changed the payment amount")
    upd = {"status": "approved", "verified_by": user["id"], "verified_by_name": user["name"], "verified_at": now_iso()}
    if not await db.transactions.find_one_and_update({"id": tid, "status": "pending"}, {"$set": upd}):
        raise HTTPException(409, "This payment was already processed by someone else")
    await audit(user, "Transaction approved", "transaction", tid, "pending", "approved", t["driver_id"])
    return await get_txn(tid, user)


@api.post("/transactions/{tid}/reject")
async def reject_txn(tid: str, body: RejectIn, user=Depends(require("accounts", "admin"))):
    t = await get_txn_or_404(tid)
    if t["status"] != "pending":
        raise HTTPException(400, f"Only pending payments can be rejected (current: {t['status']})")
    if user["id"] == t["submitted_by"]:
        raise HTTPException(403, "You cannot reject a payment you entered yourself")
    reason = body.remarks.strip()
    upd = {"status": "rejected", "verified_by": user["id"], "verified_by_name": user["name"],
           "verified_at": now_iso(), "rejection_reason": reason}
    done = await db.transactions.find_one_and_update({"id": tid, "status": "pending"}, {"$set": upd, "$push": {"rejection_history": {
        "reason": reason, "by": user["name"], "at": upd["verified_at"], "amount": t["amount"], "utr": t["utr"]}}})
    if not done:
        raise HTTPException(409, "This payment was already processed by someone else")
    await audit(user, "Transaction rejected", "transaction", tid, "pending", f"rejected: {reason}", t["driver_id"])
    pd = date.fromisoformat(t["payment_date"]).strftime("%d %b %Y")
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()), "user_id": t["submitted_by"], "txn_id": tid, "driver_id": t["driver_id"],
        "payment_date": t["payment_date"], "read": False, "created_at": now_iso(),
        "message": f"Payment rejected for {t['driver_name']} ({pd}): {reason}"})
    return await get_txn(tid, user)


async def apply_edit(t, body: TxnEdit, user, label):
    utr = await validate_payment(body.method, body.utr, body.file_id or t.get("file_id"), exclude_id=t["id"])
    changes = {}
    if body.amount != t["amount"]:
        changes["amount"] = body.amount
        await audit(user, f"Amount changed{label}", "transaction", t["id"], inr(t["amount"]), inr(body.amount), t["driver_id"])
    if utr != t["utr"]:
        changes["utr"] = utr
        await audit(user, f"UTR changed{label}", "transaction", t["id"], t["utr"], utr, t["driver_id"])
    if body.method != t["method"]:
        changes["method"] = body.method
        await audit(user, f"Payment method changed{label}", "transaction", t["id"], t["method"], body.method, t["driver_id"])
    if body.file_id and body.file_id != t.get("file_id"):
        changes["file_id"] = body.file_id
        await audit(user, f"Screenshot replaced{label}", "transaction", t["id"], t.get("file_id"), body.file_id, t["driver_id"])
    if body.remarks.strip() != (t.get("remarks") or ""):
        changes["remarks"] = body.remarks.strip()
    if body.vehicle_id and body.vehicle_id != t.get("vehicle_id"):
        veh = await db.vehicles.find_one({"vehicle_id": body.vehicle_id}, P)
        if not veh:
            raise HTTPException(400, f"Vehicle {body.vehicle_id} not found")
        changes.update({"vehicle_id": veh["vehicle_id"], "vehicle_no": veh["reg_no"]})
        await audit(user, f"Vehicle ID changed{label}", "transaction", t["id"],
                    f"{t.get('vehicle_id') or 'not recorded'} ({t.get('vehicle_no')})", f"{veh['vehicle_id']} ({veh['reg_no']})", t["driver_id"])
    return changes


@api.put("/transactions/{tid}/resubmit")
async def resubmit_txn(tid: str, body: TxnEdit, user=Depends(require("staff", "accounts", "admin"))):
    t = await get_txn_or_404(tid)
    if t["status"] != "rejected":
        raise HTTPException(400, "Only rejected payments can be corrected and resubmitted")
    if user["role"] == "staff" and t["submitted_by"] != user["id"]:
        raise HTTPException(403, "Only the staff member who entered this payment can resubmit it")
    changes = await apply_edit(t, body, user, "")
    changes.update({"status": "pending", "verified_by": None, "verified_by_name": None, "verified_at": None,
                    "version": t.get("version", 1) + 1, "resubmitted_at": now_iso(), "last_modified_by": user["id"]})
    if "amount" in changes:
        changes["amount_modified_by"] = user["id"]
    await db.transactions.update_one({"id": tid}, {"$set": changes})
    await audit(user, "Transaction resubmitted", "transaction", tid, "rejected", "pending", t["driver_id"])
    return await get_txn(tid, user)


@api.put("/transactions/{tid}/utr")
async def update_txn_utr(tid: str, body: UtrUpdateIn, user=Depends(require("accounts", "admin"))):
    t = await get_txn_or_404(tid)
    new_utr = (body.utr or "").strip().upper()
    if not new_utr or len(new_utr) < 3:
        raise HTTPException(400, "Valid UTR reference is required (min 3 characters)")
    if new_utr != (t.get("utr") or "").strip().upper():
        dup = await db.transactions.find_one({"utr": new_utr, "id": {"$ne": tid}, "status": {"$ne": "rejected"}})
        if dup:
            raise HTTPException(409, f"UTR {new_utr} has already been used in transaction {dup['id']} ({dup.get('driver_name')})")
        old_utr = t.get("utr")
        reason_str = (body.reason or "").strip() or "UTR updated by Accounts"
        update_fields = {
            "utr": new_utr,
            "utr_updated_by": user["id"],
            "utr_updated_by_name": user["name"],
            "utr_updated_at": now_iso(),
            "utr_only_update": True,
        }
        update_op = {
            "$set": update_fields,
            "$push": {
                "corrections": {
                    "reason": reason_str,
                    "by": user["name"],
                    "at": now_iso(),
                    "prev_utr": old_utr,
                    "new_utr": new_utr
                }
            }
        }
        if t.get("last_modified_by") == user["id"] and not any("prev_amount" in c for c in (t.get("corrections") or [])):
            update_op["$unset"] = {"last_modified_by": ""}

        await db.transactions.update_one({"id": tid}, update_op)
        await audit(user, "UTR updated", "transaction", tid, old_utr, new_utr, t["driver_id"])
    return await get_txn(tid, user)


@api.put("/transactions/{tid}/correct")
async def correct_txn(tid: str, body: TxnEdit, user=Depends(require("accounts", "admin"))):
    t = await get_txn_or_404(tid)
    if len(body.reason.strip()) < 5:
        raise HTTPException(400, "A correction reason is required (min 5 characters)")
    if t["status"] == "rejected":
        raise HTTPException(400, "Use resubmit for rejected payments")
    changes = await apply_edit(t, body, user, " (admin correction)")
    if not changes:
        raise HTTPException(400, "No changes to correct")
    prev_status = t["status"]
    changes.update({"status": "pending", "verified_by": None, "verified_by_name": None, "verified_at": None,
                    "version": t.get("version", 1) + 1, "last_modified_by": user["id"]})
    if "amount" in changes:
        changes["amount_modified_by"] = user["id"]
    await db.transactions.update_one({"id": tid}, {"$set": changes, "$push": {"corrections": {
        "reason": body.reason.strip(), "by": user["name"], "at": now_iso(), "prev_status": prev_status,
        "prev_amount": t["amount"], "prev_utr": t["utr"]}}})
    await audit(user, "Correction authorised", "transaction", tid, prev_status,
                f"pending re-verification · reason: {body.reason.strip()}", t["driver_id"])
    return await get_txn(tid, user)


@api.get("/accounts/summary")
async def accounts_summary(user=Depends(current_user)):
    start = ist_day_start_utc(today_ist())
    pending = await db.transactions.find({"status": "pending"}, {"_id": 0, "amount": 1}).to_list(10000)
    return {
        "pending_count": len(pending), "pending_amount": sum(t["amount"] for t in pending),
        "approved_today": await db.transactions.count_documents({"status": "approved", "verified_at": {"$gte": start}}),
        "rejected_today": await db.transactions.count_documents({"status": "rejected", "verified_at": {"$gte": start}}),
    }


# ---------- notifications ----------
@api.get("/notifications")
async def notifications(user=Depends(current_user)):
    items = await db.notifications.find({"user_id": user["id"]}, P).sort("created_at", -1).to_list(50)
    return {"items": items, "unread": sum(1 for n in items if not n["read"])}


@api.post("/notifications/{nid}/read")
async def read_notification(nid: str, user=Depends(current_user)):
    await db.notifications.update_one({"id": nid, "user_id": user["id"]}, {"$set": {"read": True}})
    return {"ok": True}


@api.post("/notifications/read-all")
async def read_all(user=Depends(current_user)):
    await db.notifications.update_many({"user_id": user["id"]}, {"$set": {"read": True}})
    return {"ok": True}


# ---------- audit ----------
@api.get("/audit-logs")
async def audit_logs(q: str = "", action: str = "", user=Depends(require("admin"))):
    f = {}
    if action:
        f["action"] = action
    if q.strip():
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        f["$or"] = [{"user_name": rx}, {"entity_id": rx}, {"prev": rx}, {"new": rx}, {"driver_id": rx}]
    return await db.audit_logs.find(f, P).sort("ts", -1).to_list(500)


# ---------- reports ----------
def fmt_ts(s):
    return datetime.fromisoformat(s).astimezone(IST).strftime("%d %b %Y %H:%M") if s else ""


TXN_COLS = [("id", "Txn ID"), ("payment_date", "Payment Date"), ("driver_code", "Driver ID"), ("driver_name", "Driver"),
            ("vehicle_id", "Vehicle ID"), ("vehicle_no", "Vehicle Reg. No."), ("city", "City"), ("amount", "Amount (₹)"), ("utr", "UTR"),
            ("method", "Method"), ("submitted_by_name", "Entered By"), ("submitted_at", "Submitted At"),
            ("status", "Status"), ("verified_by_name", "Verified By"), ("verified_at", "Verified At")]


def cell(t, k):
    if k.endswith("_at"):
        return fmt_ts(t.get(k))
    if k == "vehicle_id":
        return t.get(k) or "Vehicle ID not recorded"
    return t.get(k)


def txn_rows(txns, extra=()):
    cols = TXN_COLS + list(extra)
    rows = [[cell(t, k) for k, _ in cols] for t in txns]
    return [c[1] for c in cols], rows


async def build_report(kind, report_date, driver_id, date_from, date_to, city=""):
    rng = {k: v for k, v in [("$gte", date_from), ("$lte", date_to)] if v}
    base = {"payment_date": rng} if rng else {}
    if city and city != "all":
        base["city"] = city_query_filter(city)
    sort = [("payment_date", -1), ("submitted_at", -1)]
    if kind == "daily":
        d = report_date or today_ist().isoformat()
        txns = await db.transactions.find({**base, "payment_date": d}, P).sort("submitted_at", 1).to_list(5000)
        return f"Daily Rent Collection – {d}", *txn_rows(txns)
    if kind in ("pending", "verified", "rejected"):
        st = {"verified": "approved"}.get(kind, kind)
        txns = await db.transactions.find({**base, "status": st}, P).sort(sort).to_list(10000)
        title = {"pending": "Pending Accounts Verification", "verified": "Verified Payments", "rejected": "Rejected Payments"}[kind]
        extra = [("rejection_reason", "Rejection Reason")] if kind == "rejected" else []
        return title, *txn_rows(txns, extra)
    if kind == "driver_history":
        if not driver_id:
            raise HTTPException(400, "Select a driver")
        drv = await get_driver_or_404(driver_id)
        txns = await db.transactions.find({**base, "driver_id": driver_id}, P).sort(sort).to_list(10000)
        return f"Driver Payment History – {drv['name']} ({drv.get('driver_code')})", *txn_rows(txns, [("rejection_reason", "Rejection Reason")])
    if kind == "staff_performance":
        settings = await get_settings()
        txns = await db.transactions.find(base, P).to_list(20000)
        staff = await db.users.find({"role": {"$in": ["staff", "admin"]}}, P).to_list(500)
        rows = []
        for s in staff:
            mine = [t for t in txns if t["submitted_by"] == s["id"]]
            if not mine and s["role"] == "admin":
                continue
            delayed = sum(1 for t in mine if (datetime.fromisoformat(t["submitted_at"]).astimezone(IST).date()
                                              - date.fromisoformat(t["payment_date"])).days > settings["delayed_days"])
            rows.append([s["name"], len(mine), sum(t["amount"] for t in mine),
                         sum(1 for t in mine if t["status"] == "pending"),
                         sum(1 for t in mine if t["status"] == "approved"),
                         sum(1 for t in mine if t["status"] == "rejected"), delayed])
        return "Staff Performance", ["Staff", "Transactions Entered", "Total Amount (₹)", "Pending Verification",
                                     "Approved", "Rejected", f"Delayed (> {settings['delayed_days']} day)"], rows
    raise HTTPException(404, "Unknown report")


@api.get("/reports/{kind}")
async def report(kind: str, date: str = Query("", alias="date"), driver_id: str = "", date_from: str = "",
                 date_to: str = "", city: str = "", format: str = "json", user=Depends(require("accounts", "admin"))):
    title, cols, rows = await build_report(kind, date, driver_id, date_from, date_to, city)
    if format != "xlsx":
        return {"title": title, "columns": cols, "rows": rows}
    return await xlsx_response(kind, title, cols, rows, user)


async def xlsx_response(kind, title, cols, rows, user):
    wb = Workbook()
    ws = wb.active
    ws.title = kind[:30]
    ws.append([title])
    ws["A1"].font = Font(bold=True, size=13)
    ws.append([f"Generated {datetime.now(IST).strftime('%d %b %Y %H:%M')} IST by {user['name']}"])
    ws.append([])
    ws.append(cols)
    for c in ws[4]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="DC2626")
    for r in rows:
        ws.append(r)
    for col in ws.columns:
        ws.column_dimensions[col[3].column_letter].width = max(12, min(40, max(len(str(c.value or "")) for c in col[3:]) + 2))
    buf = io.BytesIO()
    wb.save(buf)
    await audit(user, "Report exported", "report", kind, None, title)
    return Response(buf.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="myvolt_{kind}_{today_ist().isoformat()}.xlsx"'})


# ---------- dashboards ----------
def day_row(drv, txns, d: date):
    ds = d.isoformat()
    is_active = drv.get("status") == "Active"
    started = ds >= rent_start(drv)
    free = ds in (drv.get("rent_free_dates") or [])
    eligible = is_active and started and not free
    adj = sum(a["amount"] for a in drv.get("adjustments") or [] if a["date"] == ds)
    expected = max(drv["daily_rent"] - adj, 0.0) if eligible else 0.0
    act = [t for t in txns if t["status"] != "rejected"]
    verified = sum(t["amount"] for t in act if t["status"] == "approved")
    if not is_active:
        st = "inactive"
    elif not started:
        st = "not_started"
    elif free:
        st = "rent_free"
    elif any(t["status"] == "pending" for t in act):
        st = "pending"
    elif verified:
        st = "verified" if verified >= expected else "partial"
    else:
        st = "rejected" if txns else "unpaid"
    last = txns[-1] if txns else {}
    return {"id": drv["id"], "name": drv["name"], "driver_code": drv.get("driver_code"), "mobile": drv["mobile"],
            "city": drv["city"], "current_vehicle_id": drv.get("current_vehicle_id"), "vehicle_no": drv.get("vehicle_no"),
            "daily_rent": drv["daily_rent"], "driver_status": drv.get("status"), "eligible": eligible,
            "expected": expected, "submitted": sum(t["amount"] for t in act), "verified": verified,
            "outstanding": max(expected - verified, 0.0), "status": st, "staff": last.get("submitted_by_name"),
            "staff_id": last.get("submitted_by"), "txn_count": len(txns)}


def driver_filter(q):
    if not q.strip():
        return {}
    rx = {"$regex": re.escape(q.strip()), "$options": "i"}
    compact = re.sub(r"[^A-Za-z0-9]", "", q)
    ors = [{"name": rx}, {"mobile": rx}, {"vehicle_no": rx}, {"id": rx}, {"driver_code": rx}, {"current_vehicle_id": rx}, {"city": rx}]
    if compact:
        ors.append({"vehicle_no": {"$regex": r"\s*".join(compact), "$options": "i"}})
    return {"$or": ors}


BOARD_COLS = [("name", "Driver"), ("driver_code", "Driver ID"), ("mobile", "Mobile"), ("city", "City"),
              ("current_vehicle_id", "Vehicle ID"), ("vehicle_no", "Reg. No."), ("daily_rent", "Daily Rent (₹)"),
              ("expected", "Expected (₹)"), ("submitted", "Submitted (₹)"), ("verified", "Verified (₹)"),
              ("outstanding", "Outstanding (₹)"), ("status", "Status"), ("staff", "Staff")]


@api.get("/board")
async def board(day: str = Query("", alias="date"), q: str = "", city: str = "", status: str = "", staff_id: str = "",
                active: str = "all", sort: str = "name", dir: str = "asc", page: int = Query(1, ge=1),
                page_size: int = Query(25, ge=1, le=200), format: str = "json", user=Depends(current_user)):
    try:
        d = date.fromisoformat(day) if day else today_ist()
    except ValueError:
        raise HTTPException(400, "Invalid date")
    f = driver_filter(q)
    if city and city != "all":
        f["city"] = city_query_filter(city)
    if active == "active":
        f["status"] = "Active"
    elif active == "inactive":
        f["status"] = {"$ne": "Active"}
    drivers = await db.drivers.find(f, P).to_list(20000)
    by = {}
    async for t in db.transactions.find({"payment_date": d.isoformat()}, P).sort("submitted_at", 1):
        by.setdefault(t["driver_id"], []).append(t)
    rows = [day_row(x, by.get(x["id"], []), d) for x in drivers]
    el = [r for r in rows if r["eligible"]]
    cnt = lambda s: sum(1 for r in rows if r["status"] == s)
    exp, ver = sum(r["expected"] for r in el), sum(r["verified"] for r in el)
    kpis = {"eligible": len(el), "paid": cnt("verified"), "partial": cnt("partial"), "unpaid": cnt("unpaid"),
            "pending": cnt("pending"), "rejected": cnt("rejected"), "expected": exp, "verified": ver,
            "submitted": sum(r["submitted"] for r in rows), "outstanding": sum(r["outstanding"] for r in el)}
    if status:
        rows = [r for r in rows if r["status"] == status]
    if staff_id:
        rows = [r for r in rows if r["staff_id"] == staff_id]
    if sort in {k for k, _ in BOARD_COLS}:
        rows.sort(key=lambda r: (r.get(sort) is None, str(r.get(sort)).lower() if isinstance(r.get(sort), str) else (r.get(sort) or 0)),
                  reverse=dir == "desc")
    if format == "xlsx":
        return await xlsx_response("all_drivers", f"All Drivers – {d.isoformat()}", [c for _, c in BOARD_COLS],
                                   [[r.get(k) for k, _ in BOARD_COLS] for r in rows], user)
    return {"date": d.isoformat(), "kpis": kpis, "total": len(rows), "page": page, "page_size": page_size,
            "rows": rows[(page - 1) * page_size: page * page_size]}


@api.get("/overview")
async def overview(days: int = Query(14, ge=7, le=60), user=Depends(current_user)):
    today = today_ist()
    start, month_start = today - timedelta(days=days - 1), today.replace(day=1)
    first = min(start, month_start).isoformat()
    DRV_PROJ = {"_id": 0, "id": 1, "name": 1, "city": 1, "status": 1, "daily_rent": 1,
                "rent_start_date": 1, "joining_date": 1, "rent_free_dates": 1, "adjustments": 1, "current_vehicle_id": 1}
    drivers = await db.drivers.find({"status": "Active"}, DRV_PROJ).to_list(20000)
    txns = await db.transactions.find({"payment_date": {"$gte": first, "$lte": today.isoformat()}},
                                      {"_id": 0, "driver_id": 1, "city": 1, "payment_date": 1, "amount": 1, "status": 1}).to_list(200000)
    by = {}
    for t in txns:
        by.setdefault(t["payment_date"], []).append(t)
    sums = lambda ts, s: sum(t["amount"] for t in ts if t["status"] == s)
    series = []
    for i in range(days):
        dd = start + timedelta(days=i)
        ts = by.get(dd.isoformat(), [])
        series.append({"date": dd.isoformat(), "expected": sum(expected_between(x, dd, dd) for x in drivers),
                       "verified": sums(ts, "approved"), "pending": sums(ts, "pending")})
    mts = [t for t in txns if t["payment_date"] >= month_start.isoformat()]
    m_exp = sum(expected_between(x, month_start, today) for x in drivers)
    m_ver = sums(mts, "approved")

    all_vehicles = await db.vehicles.find({}, {"_id": 0, "vehicle_id": 1, "city": 1, "status": 1, "rental_status": 1}).to_list(20000)
    assigned_vids = {d["current_vehicle_id"] for d in drivers if d.get("current_vehicle_id")}
    drv_city_by_id = {d["id"]: d.get("city") for d in drivers if d.get("city")}
    city_map = {}

    def _c(c):
        name = c or "Other"
        if name not in city_map:
            city_map[name] = {
                "city": name,
                "active_drivers": 0,
                "vehicles_total": 0,
                "vehicles_rented": 0,
                "vehicles_available": 0,
                "expected": 0.0,
                "verified": 0.0,
            }
        return city_map[name]

    for d in drivers:
        entry = _c(d.get("city"))
        entry["active_drivers"] += 1
        entry["expected"] += expected_between(d, month_start, today)
    for v in all_vehicles:
        entry = _c(v.get("city"))
        entry["vehicles_total"] += 1
        if v.get("status") == "Active":
            if v["vehicle_id"] in assigned_vids or v.get("rental_status") == "rented":
                entry["vehicles_rented"] += 1
            else:
                entry["vehicles_available"] += 1
    for t in mts:
        if t["status"] == "approved":
            c = drv_city_by_id.get(t.get("driver_id")) or t.get("city") or "Other"
            _c(c)["verified"] += t["amount"]

    by_city = sorted(city_map.values(), key=lambda x: x["city"])
    return {"series": series, "month": {"expected": m_exp, "verified": m_ver, "pending": sums(mts, "pending"),
                                         "outstanding": max(m_exp - m_ver, 0.0)},
            "counts": {"active_drivers": len(drivers), "vehicles": len(all_vehicles),
                       "vehicles_active": sum(1 for v in all_vehicles if v.get("status") == "Active"),
                       "pending_txns": await db.transactions.count_documents({"status": "pending"})},
            "by_city": by_city}


app.include_router(api)
app.add_middleware(CORSMiddleware, allow_credentials=True,
                   allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','), allow_methods=["*"], allow_headers=["*"])
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')


async def migrate_passwords():
    default_hash = hash_password(DEFAULT_PASSWORD)
    res = await db.users.update_many(
        {"$or": [{"password_hash": {"$exists": False}}, {"password_hash": None}, {"password_hash": ""}]},
        {"$set": {"password_hash": default_hash}},
    )
    if res.modified_count:
        logger.info("Migrated default passwords for %d user(s)", res.modified_count)
    for su in SEED_USERS:
        await db.users.update_one(
            {"id": su["id"], "$or": [{"mobile": {"$exists": False}}, {"mobile": None}, {"mobile": ""}]},
            {"$set": {"mobile": su["mobile"]}},
        )
    missing = await db.users.find(
        {"$or": [{"mobile": {"$exists": False}}, {"mobile": None}, {"mobile": ""}]},
        {"_id": 0, "id": 1},
    ).to_list(1000)
    seq = 1
    for u in missing:
        while True:
            cand = f"984509{seq:04d}"
            seq += 1
            if not await db.users.find_one({"mobile": cand}):
                await db.users.update_one({"id": u["id"]}, {"$set": {"mobile": cand}})
                break


async def run_seed():
    try:
        await asyncio.to_thread(storage.init_storage)
        await seed(db, storage.put_object, APP_NAME)
        logger.info("Seed complete")
    except Exception as e:
        logger.error("Seed failed: %s", e)
    try:
        await migrate_passwords()
    except Exception as e:
        logger.error("Password migration failed: %s", e)
    try:
        await migrate_ids()
        await db.drivers.update_many({"package": {"$exists": True}}, {"$unset": {"package": ""}})
        logger.info("Driver/vehicle ID migration complete")
    except Exception as e:
        logger.error("ID migration failed: %s", e)


@app.on_event("startup")
async def startup():
    app.state.index_task = asyncio.create_task(ensure_indexes())
    app.state.seed_task = asyncio.create_task(run_seed())


@app.on_event("shutdown")
async def shutdown_db_client():
    for t in (app.state.index_task, app.state.seed_task):
        t.cancel()
        with suppress(asyncio.CancelledError):
            await t
    client.close()
