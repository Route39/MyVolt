import asyncio
import io
import os
import re
import uuid
import logging
from contextlib import suppress
from datetime import datetime, timezone, timedelta, date, time
from pathlib import Path
from typing import Optional, List, Literal

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from fastapi import FastAPI, APIRouter, Query, Header, HTTPException, UploadFile, File, Depends, Response
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING, DESCENDING, IndexModel, ReturnDocument
from pydantic import BaseModel, Field
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill

import storage
from seed import seed

client = AsyncIOMotorClient(os.environ.get('MONGO_URL', 'mongodb://localhost:27017'))
db = client[os.environ.get('DB_NAME', 'myvolt_db')]
APP_NAME = os.environ.get('APP_NAME', 'myvolt')
IST = timezone(timedelta(hours=5, minutes=30))
logger = logging.getLogger(__name__)

INDEXES: dict[str, list[IndexModel]] = {
    "users": [IndexModel([("id", ASCENDING)], name="id", unique=True)],
    "drivers": [IndexModel([("id", ASCENDING)], name="id", unique=True),
                IndexModel([("driver_code", ASCENDING)], name="driver_code", unique=True,
                           partialFilterExpression={"driver_code": {"$type": "string"}}),
                IndexModel([("current_vehicle_id", ASCENDING)], name="current_vehicle", unique=True,
                           partialFilterExpression={"current_vehicle_id": {"$type": "string"}})],
    "transactions": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("driver_id", ASCENDING), ("payment_date", ASCENDING)], name="driver_date"),
        IndexModel([("status", ASCENDING), ("submitted_at", DESCENDING)], name="status_submitted"),
        IndexModel([("utr", ASCENDING)], name="utr"),
        IndexModel([("payment_date", ASCENDING)], name="payment_date"),
    ],
    "audit_logs": [IndexModel([("ts", DESCENDING)], name="ts"), IndexModel([("entity_id", ASCENDING)], name="entity")],
    "notifications": [IndexModel([("user_id", ASCENDING), ("created_at", DESCENDING)], name="user_created")],
    "files": [IndexModel([("id", ASCENDING)], name="id", unique=True)],
    "vehicles": [IndexModel([("vehicle_id", ASCENDING)], name="vehicle_id", unique=True),
                 IndexModel([("reg_key", ASCENDING)], name="reg_key", unique=True)],
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


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def today_ist() -> date:
    return datetime.now(IST).date()


def ist_day_start_utc(d: date) -> str:
    return datetime.combine(d, time(0), IST).astimezone(timezone.utc).isoformat()


def inr(v):
    return f"₹{v:,.0f}"


# ---------- auth (role switcher, header-based) ----------
async def current_user(x_user_id: Optional[str] = Header(None)):
    if not x_user_id:
        raise HTTPException(401, "Select a user to continue")
    u = await db.users.find_one({"id": x_user_id, "active": True}, P)
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
class UserIn(BaseModel):
    name: str = Field(min_length=2)
    email: str
    role: Literal["staff", "accounts", "admin"]
    active: bool = True


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


class VehicleIn(BaseModel):
    reg_no: str = Field(min_length=4)
    city: str = Field(min_length=2)
    vehicle_type: str = ""
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


# ---------- users & settings ----------
@api.get("/")
async def root():
    return {"message": "Route39 MyVolt Fleet API", "app": "MyVolt", "version": "1.0.0"}


@api.get("/users/switcher")
async def users_switcher():
    return await db.users.find({"active": True}, {"_id": 0, "id": 1, "name": 1, "role": 1}).sort("role", 1).to_list(200)


@api.get("/me")
async def me(user=Depends(current_user)):
    return user


@api.get("/users")
async def list_users(user=Depends(require("admin"))):
    return await db.users.find({}, P).sort("name", 1).to_list(500)


@api.get("/users/staff")
async def list_staff(user=Depends(current_user)):
    return await db.users.find({"role": {"$in": ["staff", "admin"]}}, {"_id": 0, "id": 1, "name": 1}).to_list(500)


@api.post("/users")
async def create_user(body: UserIn, user=Depends(require("admin"))):
    if await db.users.find_one({"email": body.email.lower()}):
        raise HTTPException(409, "A user with this email already exists")
    doc = {"id": f"u-{uuid.uuid4().hex[:8]}", **body.model_dump(), "email": body.email.lower(), "created_at": now_iso()}
    await db.users.insert_one(doc)
    await audit(user, "User created", "user", doc["id"], None, f"{doc['name']} ({doc['role']})")
    doc.pop("_id", None)
    return doc


@api.put("/users/{uid}")
async def update_user(uid: str, body: UserIn, user=Depends(require("admin"))):
    old = await db.users.find_one({"id": uid}, P)
    if not old:
        raise HTTPException(404, "User not found")
    if uid == user["id"] and (not body.active or body.role != "admin"):
        raise HTTPException(400, "You cannot deactivate or demote yourself")
    new = {**body.model_dump(), "email": body.email.lower()}
    await db.users.update_one({"id": uid}, {"$set": new})
    for k in ["name", "email", "role", "active"]:
        if old.get(k) != new[k]:
            await audit(user, "User information changed", "user", uid, f"{k}: {old.get(k)}", f"{k}: {new[k]}")
    return await db.users.find_one({"id": uid}, P)


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
    s = max(start, date.fromisoformat(rent_start(drv)))
    if end < s:
        return 0.0
    free = set(drv.get("rent_free_dates") or [])
    days = sum(1 for i in range((end - s).days + 1) if (s + timedelta(days=i)).isoformat() not in free)
    adj = sum(a["amount"] for a in drv.get("adjustments") or [] if s.isoformat() <= a["date"] <= end.isoformat())
    return max(days * drv["daily_rent"] - adj, 0.0)


def summarize(drv, txns, start: date, end: date):
    end = min(end, today_ist())
    s, e = start.isoformat(), end.isoformat()
    inrange = [t for t in txns if s <= t["payment_date"] <= e]
    verified = sum(t["amount"] for t in inrange if t["status"] == "approved")
    pending = sum(t["amount"] for t in inrange if t["status"] == "pending")
    expected = expected_between(drv, start, end)
    return {"expected": expected, "submitted": verified + pending, "verified": verified, "pending": pending,
            "rejected_count": sum(1 for t in inrange if t["status"] == "rejected"),
            "outstanding": max(expected - verified, 0.0)}


async def get_driver_or_404(did):
    d = await db.drivers.find_one({"id": did}, P)
    if not d:
        raise HTTPException(404, "Driver not found")
    return d


@api.get("/drivers")
async def list_drivers(q: str = "", user=Depends(current_user)):
    return await db.drivers.find(driver_filter(q), P).sort("name", 1).to_list(2000)


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


DRIVER_CODE_RX = re.compile(r"^[A-Z]{3}-D-\d{3,}$")


@api.post("/drivers")
async def create_driver(body: DriverCreate, user=Depends(require("admin"))):
    last = await db.drivers.find({}, {"_id": 0, "id": 1}).to_list(5000)
    nums = [int(d["id"].split("-")[-1]) for d in last if d["id"].split("-")[-1].isdigit()]
    data = body.model_dump(exclude={"driver_code", "current_vehicle_id"})
    data["handover_date"] = data["handover_date"] or data["joining_date"]
    data["rent_start_date"] = data["rent_start_date"] or data["handover_date"]
    if body.current_vehicle_id:
        await check_assignable(body.current_vehicle_id, None)
    code = (body.driver_code or "").strip().upper()
    if code:
        if not DRIVER_CODE_RX.match(code):
            raise HTTPException(400, "Driver ID override must look like BLR-D-001")
        if await db.drivers.find_one({"driver_code": code}):
            raise HTTPException(409, f"Driver ID {code} is already used")
    else:
        code = await next_code("driver", city_prefix(data["city"]))
    doc = {"id": f"R39-DRV-{(max(nums) if nums else 1000) + 1}", "driver_code": code, **data, "vehicle_no": "",
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
    await db.drivers.update_one({"id": did}, {"$set": new})
    for k, v in new.items():
        if old.get(k) != v:
            action = "Rental amount changed" if k == "daily_rent" else "Driver information changed"
            await audit(user, action, "driver", did, f"{k}: {old.get(k)}", f"{k}: {v}", did)
    return await get_driver(did, user)


# ---------- vehicles & assignments ----------
CITY_PREFIX = {"bengaluru": "BLR", "bangalore": "BLR", "chennai": "CHN", "coimbatore": "CBE",
               "tiruppur": "TPR", "tirupur": "TPR", "hyderabad": "HYD"}


def city_prefix(city):
    return CITY_PREFIX.get(city.strip().lower()) or (re.sub(r"[^A-Z]", "", city.upper())[:3] or "GEN")


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


async def insert_vehicle(reg_no, city, vehicle_type="", status="Active", details=""):
    if await db.vehicles.find_one({"reg_key": reg_key(reg_no)}):
        raise HTTPException(409, f"A vehicle with registration {reg_no.upper()} already exists")
    doc = {"vehicle_id": await next_code("vehicle", city_prefix(city)), "reg_no": reg_no.strip().upper(),
           "reg_key": reg_key(reg_no), "city": city.strip(), "vehicle_type": vehicle_type, "status": status,
           "details": details, "created_at": now_iso()}
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
async def list_vehicles(q: str = "", user=Depends(current_user)):
    f = {}
    if q.strip():
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        f = {"$or": [{"vehicle_id": rx}, {"reg_no": rx}, {"reg_key": {"$regex": re.escape(reg_key(q)) or ".", "$options": "i"}},
                     {"city": rx}, {"vehicle_type": rx}]}
    vehicles = await db.vehicles.find(f, P).sort("vehicle_id", 1).to_list(2000)
    drivers = await db.drivers.find({"current_vehicle_id": {"$ne": None}},
                                    {"_id": 0, "id": 1, "name": 1, "driver_code": 1, "current_vehicle_id": 1}).to_list(5000)
    by_vid = {d["current_vehicle_id"]: d for d in drivers}
    for v in vehicles:
        v["current_driver"] = by_vid.get(v["vehicle_id"])
    return vehicles


@api.post("/vehicles")
async def create_vehicle(body: VehicleIn, user=Depends(require("admin"))):
    doc = await insert_vehicle(body.reg_no, body.city, body.vehicle_type, body.status, body.details)
    await audit(user, "Vehicle created", "vehicle", doc["vehicle_id"], None, f"{doc['reg_no']} · {doc['city']}")
    return doc


@api.put("/vehicles/{vid}")
async def update_vehicle(vid: str, body: VehicleIn, user=Depends(require("admin"))):
    old = await db.vehicles.find_one({"vehicle_id": vid}, P)
    if not old:
        raise HTTPException(404, "Vehicle not found")
    new = {**body.model_dump(), "reg_no": body.reg_no.strip().upper(), "reg_key": reg_key(body.reg_no)}
    if new["reg_key"] != old["reg_key"] and await db.vehicles.find_one({"reg_key": new["reg_key"]}):
        raise HTTPException(409, f"A vehicle with registration {new['reg_no']} already exists")
    if new["status"] == "Inactive" and old["status"] != "Inactive":
        holder = await db.drivers.find_one({"current_vehicle_id": vid}, P)
        if holder:
            raise HTTPException(409, f"{vid} is assigned to {holder['name']} ({holder.get('driver_code')}). Change that driver's vehicle before marking it inactive.")
    await db.vehicles.update_one({"vehicle_id": vid}, {"$set": new})
    for k in ["reg_no", "city", "vehicle_type", "status", "details"]:
        if old.get(k) != new[k]:
            await audit(user, "Vehicle information changed", "vehicle", vid, f"{k}: {old.get(k)}", f"{k}: {new[k]}")
    if new["reg_no"] != old["reg_no"]:
        await db.drivers.update_many({"current_vehicle_id": vid}, {"$set": {"vehicle_no": new["reg_no"]}})
    return await db.vehicles.find_one({"vehicle_id": vid}, P)


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
    days = []
    for i in range(last.day):
        d = first + timedelta(days=i)
        ds = d.isoformat()
        day_txns = by_date.get(ds, [])
        active = [t for t in day_txns if t["status"] != "rejected"]
        approved = sum(t["amount"] for t in active if t["status"] == "approved")
        if any(t["status"] == "pending" for t in active):
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
            "rent_free": ds in free, "adjusted": ds in adj_dates,
            "amount": sum(t["amount"] for t in active) if active else (day_txns[-1]["amount"] if day_txns else 0),
            "txns": [{k: t.get(k) for k in ["id", "amount", "status", "utr", "method", "is_split", "submitted_by_name",
                                            "rejection_reason", "submitted_by", "vehicle_id", "vehicle_no"]} for t in day_txns],
        })
    await enrich_driver(drv)
    return {"driver": {k: v for k, v in drv.items() if k != "adjustments"}, "settings": settings, "days": days,
            "month_summary": summarize(drv, txns, first, last),
            "overall_summary": summarize(drv, txns, date.fromisoformat(rs), today)}


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
        if not file_id:
            raise HTTPException(400, "Payment screenshot is required for UPI and bank transfers")
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
                    city: str = "", staff_id: str = "", date_from: str = "", date_to: str = "",
                    page: Optional[int] = Query(None, ge=1), page_size: int = Query(25, ge=1, le=200),
                    sort: str = "submitted_at", dir: str = "desc", format: str = "json", user=Depends(current_user)):
    f = {}
    if status and status != "all":
        f["status"] = status
    if driver_id:
        f["driver_id"] = driver_id
    for field, val in [("driver_name", driver_name), ("utr", utr), ("city", city)]:
        if val.strip():
            f[field] = {"$regex": re.escape(val.strip()), "$options": "i"}
    ands = []
    if vehicle.strip():
        vrx = {"$regex": re.escape(vehicle.strip()), "$options": "i"}
        ands.append({"$or": [{"vehicle_no": vrx}, {"vehicle_id": vrx}]})
    if payment_date:
        f["payment_date"] = payment_date
    elif date_from or date_to:
        f["payment_date"] = {k: v for k, v in [("$gte", date_from), ("$lte", date_to)] if v}
    if staff_id:
        f["submitted_by"] = staff_id
    if q.strip():
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        ands.append({"$or": [{"driver_name": rx}, {"driver_id": rx}, {"driver_code": rx}, {"vehicle_no": rx},
                             {"vehicle_id": rx}, {"utr": rx}, {"id": rx}]})
    if ands:
        f["$and"] = ands
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
    if user["id"] in (t["submitted_by"], t.get("last_modified_by")):
        raise HTTPException(403, "You cannot approve a payment you entered or changed yourself")
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
    if user["id"] in (t["submitted_by"], t.get("last_modified_by")):
        raise HTTPException(403, "You cannot reject a payment you entered or changed yourself")
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
async def resubmit_txn(tid: str, body: TxnEdit, user=Depends(require("staff", "admin"))):
    t = await get_txn_or_404(tid)
    if t["status"] != "rejected":
        raise HTTPException(400, "Only rejected payments can be corrected and resubmitted")
    if user["role"] == "staff" and t["submitted_by"] != user["id"]:
        raise HTTPException(403, "Only the staff member who entered this payment can resubmit it")
    changes = await apply_edit(t, body, user, "")
    changes.update({"status": "pending", "verified_by": None, "verified_by_name": None, "verified_at": None,
                    "version": t.get("version", 1) + 1, "resubmitted_at": now_iso(), "last_modified_by": user["id"]})
    await db.transactions.update_one({"id": tid}, {"$set": changes})
    await audit(user, "Transaction resubmitted", "transaction", tid, "rejected", "pending", t["driver_id"])
    return await get_txn(tid, user)


@api.put("/transactions/{tid}/correct")
async def correct_txn(tid: str, body: TxnEdit, user=Depends(require("admin"))):
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
    if city:
        base["city"] = city
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
        c.fill = PatternFill("solid", fgColor="15803D")
    for r in rows:
        ws.append(r)
    for col in ws.columns:
        ws.column_dimensions[col[3].column_letter].width = max(12, min(40, max(len(str(c.value or "")) for c in col[3:]) + 2))
    buf = io.BytesIO()
    wb.save(buf)
    await audit(user, "Report exported", "report", kind, None, title)
    return Response(buf.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="route39_{kind}_{today_ist().isoformat()}.xlsx"'})


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
    ors = [{"name": rx}, {"mobile": rx}, {"vehicle_no": rx}, {"id": rx}, {"driver_code": rx}, {"current_vehicle_id": rx}]
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
    if city:
        f["city"] = city
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
    drivers = [x for x in await db.drivers.find({}, P).to_list(20000) if x.get("status") == "Active"]
    txns = await db.transactions.find({"payment_date": {"$gte": first, "$lte": today.isoformat()}},
                                      {"_id": 0, "payment_date": 1, "amount": 1, "status": 1}).to_list(200000)
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
    return {"series": series, "month": {"expected": m_exp, "verified": m_ver, "pending": sums(mts, "pending"),
                                         "outstanding": max(m_exp - m_ver, 0.0)},
            "counts": {"active_drivers": len(drivers), "vehicles": await db.vehicles.count_documents({}),
                       "vehicles_active": await db.vehicles.count_documents({"status": "Active"}),
                       "pending_txns": await db.transactions.count_documents({"status": "pending"})}}


app.include_router(api)
app.add_middleware(CORSMiddleware, allow_credentials=True,
                   allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','), allow_methods=["*"], allow_headers=["*"])
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')


async def run_seed():
    try:
        await asyncio.to_thread(storage.init_storage)
        await seed(db, storage.put_object, APP_NAME)
        logger.info("Seed complete")
    except Exception as e:
        logger.error("Seed failed: %s", e)
    try:
        await migrate_ids()
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
