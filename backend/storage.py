import logging
import os
from datetime import datetime, timezone
from pathlib import Path

from bson.binary import Binary
from dotenv import load_dotenv
from pymongo import MongoClient

logger = logging.getLogger(__name__)
ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")
LOCAL_UPLOADS = ROOT / "uploads"  # old files, read-only fallback
LOCAL_UPLOADS.mkdir(parents=True, exist_ok=True)
_col = None


def _blobs():
    global _col
    if _col is None:
        client = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
        _col = client[os.environ.get("DB_NAME", "myvolt_db")]["file_blobs"]
    return _col


def init_storage(force: bool = False):
    _blobs().create_index("path", unique=True)
    return "mongodb:file_blobs"


def put_object(path: str, data: bytes, content_type: str) -> dict:
    safe_name = path.replace("/", "_")
    _blobs().update_one(
        {"path": safe_name},
        {"$set": {"path": safe_name, "data": Binary(data), "content_type": content_type,
                  "size": len(data), "created_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True)
    return {"path": safe_name}


def get_object(path: str):
    safe_name = path.replace("/", "_")
    doc = _blobs().find_one({"path": safe_name})
    if doc:
        return bytes(doc["data"]), doc.get("content_type") or "application/octet-stream"
    f = LOCAL_UPLOADS / safe_name
    if f.exists():
        meta = LOCAL_UPLOADS / f"{safe_name}.meta"
        ct = meta.read_text(encoding="utf-8") if meta.exists() else "application/octet-stream"
        return f.read_bytes(), ct
    raise FileNotFoundError(f"Object {path} not found")
