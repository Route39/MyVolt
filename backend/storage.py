import os
import requests
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
storage_key = None

LOCAL_UPLOADS = Path(__file__).resolve().parent / "uploads"
LOCAL_UPLOADS.mkdir(parents=True, exist_ok=True)


def init_storage(force: bool = False):
    global storage_key
    if storage_key and not force:
        return storage_key
    emergent_key = os.environ.get("EMERGENT_LLM_KEY")
    if not emergent_key:
        return None
    try:
        resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": emergent_key}, timeout=10)
        resp.raise_for_status()
        storage_key = resp.json()["storage_key"]
        return storage_key
    except Exception as e:
        logger.warning("Remote storage init failed, using local storage: %s", e)
        return None


def _request(method: str, path: str, headers=None, **kwargs):
    resp = None
    for attempt in range(2):
        key = init_storage(force=attempt == 1)
        if not key:
            raise RuntimeError("No storage key available")
        resp = requests.request(method, f"{STORAGE_URL}/objects/{path}",
                                headers={"X-Storage-Key": key, **(headers or {})}, **kwargs)
        if resp.status_code != 404:
            break
    resp.raise_for_status()
    return resp


def put_object(path: str, data: bytes, content_type: str) -> dict:
    if os.environ.get("EMERGENT_LLM_KEY"):
        try:
            return _request("PUT", path, headers={"Content-Type": content_type}, data=data, timeout=15).json()
        except Exception as e:
            logger.info("Remote put_object failed, falling back to local storage: %s", e)
    
    # Local fallback
    safe_name = path.replace("/", "_")
    target_file = LOCAL_UPLOADS / safe_name
    target_file.parent.mkdir(parents=True, exist_ok=True)
    target_file.write_bytes(data)
    meta_file = LOCAL_UPLOADS / f"{safe_name}.meta"
    meta_file.write_text(content_type, encoding="utf-8")
    return {"path": safe_name}


def get_object(path: str):
    if os.environ.get("EMERGENT_LLM_KEY"):
        try:
            resp = _request("GET", path, timeout=10)
            return resp.content, resp.headers.get("Content-Type", "application/octet-stream")
        except Exception:
            pass
    
    safe_name = path.replace("/", "_")
    target_file = LOCAL_UPLOADS / safe_name
    if target_file.exists():
        content = target_file.read_bytes()
        meta_file = LOCAL_UPLOADS / f"{safe_name}.meta"
        ct = meta_file.read_text(encoding="utf-8") if meta_file.exists() else "application/octet-stream"
        return content, ct
    raise FileNotFoundError(f"Object {path} not found")
