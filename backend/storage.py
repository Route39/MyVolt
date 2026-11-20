import logging
from pathlib import Path

logger = logging.getLogger(__name__)

LOCAL_UPLOADS = Path(__file__).resolve().parent / "uploads"
LOCAL_UPLOADS.mkdir(parents=True, exist_ok=True)


def init_storage(force: bool = False):
    LOCAL_UPLOADS.mkdir(parents=True, exist_ok=True)
    return str(LOCAL_UPLOADS)


def put_object(path: str, data: bytes, content_type: str) -> dict:
    safe_name = path.replace("/", "_")
    target_file = LOCAL_UPLOADS / safe_name
    target_file.parent.mkdir(parents=True, exist_ok=True)
    target_file.write_bytes(data)
    meta_file = LOCAL_UPLOADS / f"{safe_name}.meta"
    meta_file.write_text(content_type, encoding="utf-8")
    return {"path": safe_name}


def get_object(path: str):
    safe_name = path.replace("/", "_")
    target_file = LOCAL_UPLOADS / safe_name
    if target_file.exists():
        content = target_file.read_bytes()
        meta_file = LOCAL_UPLOADS / f"{safe_name}.meta"
        ct = meta_file.read_text(encoding="utf-8") if meta_file.exists() else "application/octet-stream"
        return content, ct
    raise FileNotFoundError(f"Object {path} not found")
