import io
import random
import uuid
import asyncio
import bcrypt
from datetime import datetime, timedelta, timezone, time
from PIL import Image, ImageDraw, ImageFont

IST = timezone(timedelta(hours=5, minutes=30))
DEFAULT_PASSWORD = "route39@123"


def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

USERS = [
    {"id": "u-admin", "name": "Anita Rao", "mobile": "9845000001", "email": "anita.admin@route39.in", "role": "admin"},
    {"id": "u-staff-1", "name": "Ravi Kumar", "mobile": "9845000004", "email": "ravi.staff@route39.in", "role": "staff"},
    {"id": "u-staff-2", "name": "Suresh Patel", "mobile": "9845000005", "email": "suresh.staff@route39.in", "role": "staff"},
    {"id": "u-staff-3", "name": "Meena Iyer", "mobile": "9845000006", "email": "meena.staff@route39.in", "role": "staff"},
    {"id": "u-acc-1", "name": "Priya Sharma", "mobile": "9845000002", "email": "priya.accounts@route39.in", "role": "accounts"},
    {"id": "u-acc-2", "name": "Farhan Ali", "mobile": "9845000003", "email": "farhan.accounts@route39.in", "role": "accounts"},
]

DRIVERS = [
    ("Rajesh Kumar", "9845012301", "KA 01 AB 3901", "Bengaluru", 75, 75, 800),
    ("Mohammed Irfan", "9845012302", "KA 05 MN 3912", "Bengaluru", 60, 55, 750),
    ("Venkatesh Reddy", "9848012303", "TS 09 EZ 3920", "Hyderabad", 90, 90, 900),
    ("Arun Prakash", "9840012304", "TN 10 BK 3933", "Chennai", 40, 34, 700),
    ("Sandeep Singh", "9845012305", "KA 03 HJ 3947", "Bengaluru", 25, 18, 850),
    ("Lakshmi Narayan", "9848012306", "TS 07 FG 3958", "Hyderabad", 120, 120, 800),
    ("Karthik Raja", "9840012307", "TN 22 CD 3961", "Chennai", 14, 9, 650),
    ("Deepak Yadav", "9845012308", "KA 51 QR 3975", "Bengaluru", 70, 70, 800),
]


def _font(size):
    for p in ["/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
              "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf"]:
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


def receipt_png(amount, utr, name, pay_date, method):
    img = Image.new("RGB", (540, 900), (248, 250, 252))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 540, 200], fill=(22, 128, 61))
    d.ellipse([230, 50, 310, 130], fill=(255, 255, 255))
    d.text((252, 62), "✓", fill=(22, 128, 61), font=_font(50))
    d.text((270, 160), "Payment Successful", fill="white", font=_font(28), anchor="mm")
    d.text((270, 280), f"Rs. {amount:,.0f}", fill=(30, 41, 59), font=_font(56), anchor="mm")
    rows = [("Paid to", "ROUTE39 MOBILITY PVT LTD — MYVOLT"), ("From", name), ("Method", method),
            ("Date", pay_date), ("UTR / Ref No.", utr)]
    y = 380
    for k, v in rows:
        d.text((40, y), k, fill=(100, 116, 139), font=_font(22))
        d.text((40, y + 32), v, fill=(30, 41, 59), font=_font(26))
        d.line([40, y + 78, 500, y + 78], fill=(226, 232, 240), width=2)
        y += 96
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


async def seed(db, put_object, app_name):
    if await db.users.count_documents({}) > 0:
        return
    rnd = random.Random(39)
    now = datetime.now(timezone.utc).isoformat()
    default_hash = hash_pw(DEFAULT_PASSWORD)
    for u in USERS:
        await db.users.insert_one({**u, "active": True, "password_hash": default_hash, "created_at": now})
    await db.settings.update_one({"id": "global"}, {"$set": {
        "id": "global", "allow_future_dates": False, "allow_multiple_per_date": False, "delayed_days": 1}}, upsert=True)

    today = datetime.now(IST).date()
    drivers = []
    for i, (name, mobile, veh, city, join_ago, handover_ago, rent) in enumerate(DRIVERS):
        joining = today - timedelta(days=join_ago)
        handover = today - timedelta(days=min(join_ago, handover_ago))
        doc = {
            "id": f"R39-DRV-{1001 + i}", "name": name, "mobile": mobile, "vehicle_no": veh, "city": city,
            "joining_date": joining.isoformat(), "handover_date": handover.isoformat(),
            "rent_start_date": handover.isoformat(), "daily_rent": float(rent), "status": "Active",
            "rent_free_dates": [], "adjustments": [], "created_at": now,
        }
        if i == 0:
            doc["rent_free_dates"] = [(today - timedelta(days=12)).isoformat()]
            doc["adjustments"] = [{"id": str(uuid.uuid4()), "date": (today - timedelta(days=20)).isoformat(),
                                   "amount": 400.0, "reason": "Vehicle in workshop half day",
                                   "by": "Anita Rao", "at": now}]
        drivers.append(doc)
        await db.drivers.insert_one(doc)

    staff = [u for u in USERS if u["role"] == "staff"]
    accounts = [u for u in USERS if u["role"] == "accounts"]
    generic = {}

    async def upload(data, uploader):
        path = f"{app_name}/screenshots/{uuid.uuid4()}.png"
        res = await asyncio.to_thread(put_object, path, data, "image/png")
        fid = str(uuid.uuid4())
        await db.files.insert_one({"id": fid, "storage_path": res["path"], "content_type": "image/png",
                                   "original_filename": "screenshot.png", "uploaded_by": uploader,
                                   "is_deleted": False, "created_at": now})
        return fid

    n = 0
    for drv in drivers[:6]:
        for back in range(1, 19):
            pd = today - timedelta(days=back)
            if pd.isoformat() < drv["rent_start_date"] or pd.isoformat() in drv["rent_free_dates"]:
                continue
            r = rnd.random()
            if back > 4 and r < 0.18:
                continue
            if back <= 3:
                status = "pending" if r < 0.8 else None
            else:
                status = "approved" if r < 0.85 else "rejected"
            if not status:
                continue
            amount = drv["daily_rent"] if rnd.random() > 0.1 else drv["daily_rent"] - 200
            method = rnd.choice(["UPI", "UPI", "UPI", "Bank Transfer", "Cash"])
            utr = f"{rnd.randint(10**11, 10**12 - 1)}" if method != "Cash" else f"CASH-{rnd.randint(1000, 9999)}"
            st = rnd.choice(staff)
            delay = 0 if rnd.random() > 0.2 else 2
            sub_at = datetime.combine(pd + timedelta(days=delay), time(10 + rnd.randint(0, 8), rnd.randint(0, 59)), IST)
            if sub_at > datetime.now(IST):
                sub_at = datetime.now(IST) - timedelta(minutes=30)
            if status == "approved":
                key = drv["id"]
                if key not in generic:
                    generic[key] = await upload(receipt_png(drv["daily_rent"], "XXXXXXXX" + utr[-4:], drv["name"], "—", method), st["id"])
                fid = generic[key]
            else:
                fid = await upload(receipt_png(amount, utr, drv["name"], pd.strftime("%d %b %Y"), method), st["id"])
            n += 1
            txn = {
                "id": f"TXN-{100000 + n}", "driver_id": drv["id"], "driver_name": drv["name"],
                "vehicle_no": drv["vehicle_no"], "city": drv["city"], "payment_date": pd.isoformat(),
                "amount": float(amount), "utr": utr, "method": method, "file_id": fid, "remarks": "",
                "is_split": False, "status": status, "submitted_by": st["id"], "submitted_by_name": st["name"],
                "submitted_at": sub_at.astimezone(timezone.utc).isoformat(), "verified_by": None,
                "verified_by_name": None, "verified_at": None, "rejection_reason": None,
                "rejection_history": [], "corrections": [], "version": 1,
            }
            if status in ("approved", "rejected"):
                acc = rnd.choice(accounts)
                txn["verified_by"], txn["verified_by_name"] = acc["id"], acc["name"]
                txn["verified_at"] = (sub_at + timedelta(hours=3)).astimezone(timezone.utc).isoformat()
                if status == "rejected":
                    txn["rejection_reason"] = rnd.choice(["UTR not found in bank statement",
                                                          "Screenshot is blurry, amount not readable",
                                                          "Amount on screenshot does not match entry"])
                    await db.notifications.insert_one({
                        "id": str(uuid.uuid4()), "user_id": st["id"], "txn_id": txn["id"], "driver_id": drv["id"],
                        "payment_date": txn["payment_date"], "read": False, "created_at": txn["verified_at"],
                        "message": f"Payment rejected for {drv['name']} ({pd.strftime('%d %b %Y')}): {txn['rejection_reason']}"})
            await db.transactions.insert_one(txn)
            await db.audit_logs.insert_one({
                "id": str(uuid.uuid4()), "user_id": st["id"], "user_name": st["name"], "action": "Transaction submitted",
                "entity": "transaction", "entity_id": txn["id"], "driver_id": drv["id"], "prev": None,
                "new": f"₹{amount:,.0f} · UTR {utr} · {method}", "ts": txn["submitted_at"]})
            if txn["verified_at"]:
                await db.audit_logs.insert_one({
                    "id": str(uuid.uuid4()), "user_id": txn["verified_by"], "user_name": txn["verified_by_name"],
                    "action": "Transaction approved" if status == "approved" else "Transaction rejected",
                    "entity": "transaction", "entity_id": txn["id"], "driver_id": drv["id"], "prev": "pending",
                    "new": status if status == "approved" else f"rejected: {txn['rejection_reason']}", "ts": txn["verified_at"]})
