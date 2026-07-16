"""
项目广场：基于 JSON 文件的轻量存储（无需 PostgreSQL）。
用户以 X-SSVEP-User-Id 请求头标识（客户端 localStorage 持久化）。
"""
from __future__ import annotations

import hashlib
import json
import re
import secrets
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from app.core.config import settings
from app.core.runtime_paths import resolve_app_data_dir
from app.schemas.project_contract import ensure_contract_version, validate_seekbci_project

_EMAIL_RE = re.compile(r"^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$")
PLAZA_TAGS = frozenset({"keyboard", "drone", "multimodal", "teaching"})
VERIFY_CODE_TTL_MIN = 15
MEMBER_POINTS_COST = 1000

_DATA_DIR = resolve_app_data_dir()
_STORE_PATH = _DATA_DIR / "plaza.json"
_LOCK = threading.Lock()


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _empty_store() -> Dict[str, Any]:
    return {"users": {}, "projects": [], "likes": {}, "reports": []}


def _load_unlocked() -> Dict[str, Any]:
    if not _STORE_PATH.exists():
        return _empty_store()
    try:
        raw = _STORE_PATH.read_text(encoding="utf-8")
        data = json.loads(raw)
        if not isinstance(data, dict):
            return _empty_store()
        data.setdefault("users", {})
        data.setdefault("projects", [])
        data.setdefault("likes", {})
        data.setdefault("reports", [])
        if not isinstance(data["users"], dict):
            data["users"] = {}
        if not isinstance(data["projects"], list):
            data["projects"] = []
        if not isinstance(data["likes"], dict):
            data["likes"] = {}
        return data
    except (OSError, json.JSONDecodeError):
        return _empty_store()


def _save_unlocked(data: Dict[str, Any]) -> None:
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = _STORE_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(_STORE_PATH)


def _with_store(mutator):
    with _LOCK:
        data = _load_unlocked()
        result = mutator(data)
        _save_unlocked(data)
        return result


def _project_summary(row: Dict[str, Any], viewer_id: Optional[str], likes_map: Dict[str, List[str]]) -> Dict[str, Any]:
    pid = row["id"]
    likers = likes_map.get(pid, [])
    return {
        "id": pid,
        "owner_id": row.get("owner_id"),
        "name": row.get("name", ""),
        "description": row.get("description") or "",
        "author_name": row.get("author_name") or "",
        "version": row.get("version") or "1.0.0",
        "thumbnail": row.get("thumbnail") or "📊",
        "thumbnail_image": row.get("thumbnail_image"),
        "page_count": row.get("page_count", 0),
        "block_count": row.get("block_count", 0),
        "like_count": len(likers),
        "liked_by_me": bool(viewer_id and viewer_id in likers),
        "published_at": row.get("published_at"),
        "updated_at": row.get("updated_at"),
        "tags": list(row.get("tags") or []),
        "import_only_no_republish": bool(row.get("import_only_no_republish")),
    }


def _count_blocks(pages: Any) -> int:
    if not isinstance(pages, list):
        return 0
    total = 0
    for page in pages:
        if isinstance(page, dict):
            blocks = page.get("blocks") or []
            if isinstance(blocks, list):
                total += len(blocks)
    return total


def ensure_user(user_id: str, display_name: Optional[str] = None) -> Dict[str, Any]:
    uid = (user_id or "").strip()
    if not uid:
        raise ValueError("缺少用户 ID")

    def mutate(data):
        users = data["users"]
        if uid not in users:
            users[uid] = {
                "id": uid,
                "display_name": (display_name or f"用户_{uid[:8]}").strip()[:50],
                "bio": "",
                "created_at": _utc_now_iso(),
                "updated_at": _utc_now_iso(),
            }
        elif display_name and display_name.strip():
            users[uid]["display_name"] = display_name.strip()[:50]
            users[uid]["updated_at"] = _utc_now_iso()
        return dict(users[uid])

    return _with_store(mutate)


def get_user(user_id: str) -> Optional[Dict[str, Any]]:
    with _LOCK:
        data = _load_unlocked()
        row = data["users"].get(user_id)
        return dict(row) if row else None


def _normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def _hash_password(password: str, salt: str) -> str:
    return hashlib.sha256((salt + password).encode("utf-8")).hexdigest()


def _sanitize_profile(row: Optional[Dict[str, Any]], user_id: str) -> Dict[str, Any]:
    if not row:
        return {
            "id": user_id,
            "display_name": "",
            "bio": "",
            "email": "",
            "email_verified": False,
            "registered": False,
            "points": 0,
            "membership_tier": "free",
            "avatar_image": None,
            "avatar_original_image": None,
            "avatar_display_mode": "fit",
            "avatar_edit_mode": "fit",
        }
    out = {k: v for k, v in row.items() if k not in ("password_hash", "password_salt", "verify_code", "verify_expires_at")}
    out["email_verified"] = bool(out.get("email_verified"))
    out["registered"] = bool(out.get("email") and out.get("email_verified"))
    out.setdefault("points", 0)
    out.setdefault("membership_tier", "free")
    out.setdefault("avatar_image", None)
    out.setdefault("avatar_original_image", None)
    out.setdefault("avatar_display_mode", "fit")
    out.setdefault("avatar_edit_mode", "fit")
    return out


def _public_profile(row: Optional[Dict[str, Any]], user_id: str) -> Dict[str, Any]:
    return _sanitize_profile(row, user_id)


def get_profile_for_user(user_id: str) -> Dict[str, Any]:
    return _public_profile(get_user(user_id), user_id)


def is_user_registered(user_id: str) -> bool:
    row = get_user(user_id)
    return bool(row and row.get("email") and row.get("email_verified"))


def _find_user_id_by_email(data: Dict[str, Any], email: str) -> Optional[str]:
    needle = _normalize_email(email)
    for uid, row in data.get("users", {}).items():
        if _normalize_email(row.get("email") or "") == needle:
            return uid
    return None


def register_user(
    user_id: str,
    email: str,
    display_name: str,
    password: str,
    password_confirm: str,
) -> Tuple[Dict[str, Any], Optional[str]]:
    uid = (user_id or "").strip()
    if not uid:
        raise ValueError("缺少用户 ID")
    mail = _normalize_email(email)
    if not mail or not _EMAIL_RE.match(mail):
        raise ValueError("邮箱格式不正确")
    name = (display_name or "").strip()[:50]
    if not name:
        raise ValueError("请填写显示名称")
    if not password or len(password) < 6:
        raise ValueError("密码至少 6 位")
    if password != password_confirm:
        raise ValueError("两次输入的密码不一致")

    code = f"{secrets.randbelow(1000000):06d}"
    expires = (datetime.now(timezone.utc) + timedelta(minutes=VERIFY_CODE_TTL_MIN)).replace(microsecond=0).isoformat()
    salt = secrets.token_hex(16)
    pwd_hash = _hash_password(password, salt)

    def mutate(data):
        users = data["users"]
        existing_uid = _find_user_id_by_email(data, mail)
        if existing_uid and existing_uid != uid:
            existing = users.get(existing_uid, {})
            if existing.get("email_verified"):
                raise ValueError("该邮箱已被注册")
        now = _utc_now_iso()
        row = users.get(uid) or {
            "id": uid,
            "bio": "",
            "points": 0,
            "membership_tier": "free",
            "created_at": now,
        }
        row.update(
            {
                "display_name": name,
                "email": mail,
                "email_verified": False,
                "password_salt": salt,
                "password_hash": pwd_hash,
                "verify_code": code,
                "verify_expires_at": expires,
                "updated_at": now,
            }
        )
        row.setdefault("registered_at", now)
        users[uid] = row
        return _public_profile(row, uid)

    profile = _with_store(mutate)
    dev_code = code if settings.DEBUG else None
    return profile, dev_code


def login_user(email: str, password: str) -> Tuple[Dict[str, Any], str]:
    mail = _normalize_email(email)
    if not mail or not _EMAIL_RE.match(mail):
        raise ValueError("邮箱格式不正确")
    if not password:
        raise ValueError("请输入密码")

    def mutate(data):
        uid = _find_user_id_by_email(data, mail)
        if not uid:
            raise ValueError("该邮箱尚未注册，请先注册")
        row = data["users"].get(uid) or {}
        if not row.get("password_hash"):
            raise ValueError("该邮箱尚未注册，请先注册")
        salt = str(row.get("password_salt") or "")
        if _hash_password(password, salt) != row.get("password_hash"):
            raise ValueError("邮箱或密码错误")
        return _public_profile(row, uid), uid

    return _with_store(mutate)


def verify_email_code(user_id: str, code: str) -> Dict[str, Any]:
    uid = (user_id or "").strip()
    entered = (code or "").strip()
    if not entered:
        raise ValueError("请输入验证码")

    def mutate(data):
        row = data["users"].get(uid)
        if not row or not row.get("email"):
            raise ValueError("请先提交注册信息")
        if row.get("email_verified"):
            return _public_profile(row, uid)
        if entered != str(row.get("verify_code") or ""):
            raise ValueError("验证码错误")
        exp = row.get("verify_expires_at")
        if exp:
            try:
                exp_dt = datetime.fromisoformat(str(exp).replace("Z", "+00:00"))
                if datetime.now(timezone.utc) > exp_dt:
                    raise ValueError("验证码已过期，请重新注册")
            except ValueError as e:
                if "验证码已过期" in str(e):
                    raise
        row["email_verified"] = True
        row.pop("verify_code", None)
        row.pop("verify_expires_at", None)
        row["updated_at"] = _utc_now_iso()
        row.setdefault("points", 0)
        return _public_profile(row, uid)

    return _with_store(mutate)


def redeem_membership_with_points(user_id: str) -> Dict[str, Any]:
    def mutate(data):
        row = data["users"].get(user_id)
        if not row or not row.get("email_verified"):
            raise ValueError("请先完成注册与邮箱验证")
        pts = int(row.get("points") or 0)
        if row.get("membership_tier") == "member":
            raise ValueError("您已是会员")
        if pts < MEMBER_POINTS_COST:
            raise ValueError(f"积分不足，兑换会员需要 {MEMBER_POINTS_COST} 积分")
        row["points"] = pts - MEMBER_POINTS_COST
        row["membership_tier"] = "member"
        row["updated_at"] = _utc_now_iso()
        return _public_profile(row, user_id)

    return _with_store(mutate)


def require_registered_user(user_id: str) -> Dict[str, Any]:
    row = get_user(user_id)
    if not row or not row.get("email"):
        raise ValueError("请先在个人中心使用邮箱完成注册")
    if not row.get("email_verified"):
        raise ValueError("请先完成邮箱验证")
    return row


def update_user_profile(
    user_id: str,
    display_name: Optional[str],
    bio: Optional[str],
    avatar_image: Optional[str] = None,
    avatar_original_image: Optional[str] = None,
    avatar_display_mode: Optional[str] = None,
    avatar_edit_mode: Optional[str] = None,
    avatar_image_provided: bool = False,
    avatar_original_provided: bool = False,
    avatar_mode_provided: bool = False,
    avatar_edit_mode_provided: bool = False,
) -> Dict[str, Any]:
    def mutate(data):
        users = data["users"]
        if user_id not in users or not users[user_id].get("email"):
            raise ValueError("请先在个人中心使用邮箱完成注册")
        row = users[user_id]
        if display_name is not None and display_name.strip():
            row["display_name"] = display_name.strip()[:50]
        if bio is not None:
            row["bio"] = bio.strip()[:500]
        if avatar_image_provided:
            if avatar_image is None or avatar_image == "":
                row["avatar_image"] = None
            else:
                raw = str(avatar_image)
                if not raw.startswith("data:image/"):
                    raise ValueError("头像须为图片 data URL")
                if len(raw) > 350_000:
                    raise ValueError("头像过大，请裁剪或压缩后再试")
                row["avatar_image"] = raw
        if avatar_original_provided:
            if avatar_original_image is None or avatar_original_image == "":
                row["avatar_original_image"] = None
            else:
                raw_o = str(avatar_original_image)
                if not raw_o.startswith("data:image/"):
                    raise ValueError("头像原图须为图片 data URL")
                if len(raw_o) > 900_000:
                    raise ValueError("头像原图过大，请换一张较小的图片")
                row["avatar_original_image"] = raw_o
        if avatar_mode_provided and avatar_display_mode in ("fit", "stretch", "cover"):
            row["avatar_display_mode"] = avatar_display_mode
        elif avatar_image_provided and row.get("avatar_image") and not row.get("avatar_display_mode"):
            row["avatar_display_mode"] = "fit"
        if avatar_edit_mode_provided and avatar_edit_mode in ("fit", "stretch", "crop"):
            row["avatar_edit_mode"] = avatar_edit_mode
        row["updated_at"] = _utc_now_iso()
        return _public_profile(row, user_id)

    return _with_store(mutate)


def list_public_projects(
    viewer_id: Optional[str],
    sort: str = "recent",
    q: Optional[str] = None,
    skip: int = 0,
    limit: int = 24,
) -> Tuple[List[Dict[str, Any]], int]:
    with _LOCK:
        data = _load_unlocked()
        likes_map = data["likes"]
        rows = list(data["projects"])
        if q and q.strip():
            needle = q.strip().lower()
            rows = [
                r
                for r in rows
                if needle in (r.get("name") or "").lower()
                or needle in (r.get("description") or "").lower()
                or needle in (r.get("author_name") or "").lower()
            ]
        if sort == "popular":
            rows.sort(key=lambda r: len(likes_map.get(r.get("id"), [])), reverse=True)
        else:
            rows.sort(key=lambda r: r.get("published_at") or "", reverse=True)
        total = len(rows)
        page = rows[max(0, skip) : max(0, skip) + max(1, min(limit, 100))]
        return [_project_summary(r, viewer_id, likes_map) for r in page], total


def get_public_project(project_id: str, viewer_id: Optional[str]) -> Optional[Dict[str, Any]]:
    with _LOCK:
        data = _load_unlocked()
        for row in data["projects"]:
            if row.get("id") == project_id:
                summary = _project_summary(row, viewer_id, data["likes"])
                summary["content"] = row.get("content")
                return summary
        return None


def publish_project(
    owner_id: str,
    content: Dict[str, Any],
    description_override: Optional[str] = None,
    tags: Optional[List[str]] = None,
    ip_rights_ack: bool = False,
) -> Dict[str, Any]:
    if not isinstance(content, dict):
        raise ValueError("项目内容无效")
    content = ensure_contract_version(content)
    ok, contract_errors = validate_seekbci_project(content)
    if not ok:
        raise ValueError("项目格式不符合契约: " + "; ".join(contract_errors))
    name = str(content.get("name") or "").strip()
    if not name:
        raise ValueError("项目名称不能为空")
    pages = content.get("pages")
    if not isinstance(pages, list) or len(pages) == 0:
        raise ValueError("项目至少需要一个页面")
    if content.get("importOnlyNoRepublish"):
        raise ValueError("该项目为「仅导入」副本，不可再次发布到广场")
    if not ip_rights_ack:
        raise ValueError("请确认您拥有分享内容的知识产权")

    tag_list = []
    for t in tags or []:
        ts = str(t).strip().lower()
        if ts in PLAZA_TAGS and ts not in tag_list:
            tag_list.append(ts)

    owner_row = require_registered_user(owner_id)
    owner = owner_row
    author_name = (
        content.get("author") or owner_row.get("display_name") or ""
    ).strip()[:50]
    now = _utc_now_iso()
    local_id = str(content.get("id") or "").strip()

    def mutate(data):
        existing_idx = None
        for i, row in enumerate(data["projects"]):
            if row.get("owner_id") == owner_id and row.get("local_project_id") == local_id and local_id:
                existing_idx = i
                break
        base = {
            "owner_id": owner_id,
            "local_project_id": local_id or None,
            "name": name[:120],
            "description": (description_override or content.get("description") or "").strip()[:2000],
            "author_name": author_name,
            "version": str(content.get("version") or "1.0.0")[:20],
            "thumbnail": content.get("thumbnail") or "📊",
            "thumbnail_image": content.get("thumbnailImage"),
            "page_count": len(pages),
            "block_count": _count_blocks(pages),
            "content": content,
            "tags": tag_list,
            "import_only_no_republish": False,
            "updated_at": now,
        }
        if existing_idx is not None:
            row = data["projects"][existing_idx]
            row.update(base)
            row["published_at"] = row.get("published_at") or now
            out = dict(row)
        else:
            out = {"id": f"plaza_{uuid.uuid4().hex[:16]}", "published_at": now, **base}
            data["projects"].append(out)
        summary = _project_summary(out, owner_id, data["likes"])
        summary["plaza_id"] = out["id"]
        return summary

    return _with_store(mutate)


def unpublish_project(owner_id: str, project_id: str) -> bool:
    def mutate(data):
        before = len(data["projects"])
        data["projects"] = [p for p in data["projects"] if not (p.get("id") == project_id and p.get("owner_id") == owner_id)]
        data["likes"].pop(project_id, None)
        return before != len(data["projects"])

    return _with_store(mutate)


def list_my_projects(owner_id: str, viewer_id: Optional[str]) -> List[Dict[str, Any]]:
    with _LOCK:
        data = _load_unlocked()
        likes_map = data["likes"]
        mine = [p for p in data["projects"] if p.get("owner_id") == owner_id]
        mine.sort(key=lambda r: r.get("updated_at") or "", reverse=True)
        return [_project_summary(r, viewer_id or owner_id, likes_map) for r in mine]


def like_project(user_id: str, project_id: str) -> Dict[str, Any]:
    def mutate(data):
        exists = any(p.get("id") == project_id for p in data["projects"])
        if not exists:
            raise KeyError("项目不存在")
        require_registered_user(user_id)
        likers = data["likes"].setdefault(project_id, [])
        newly_liked = user_id not in likers
        if newly_liked:
            likers.append(user_id)
        row = next(p for p in data["projects"] if p.get("id") == project_id)
        summary = _project_summary(row, user_id, data["likes"])
        summary["newly_liked"] = newly_liked
        return summary

    return _with_store(mutate)


def user_stats(user_id: str) -> Dict[str, Any]:
    with _LOCK:
        data = _load_unlocked()
        mine = [p for p in data["projects"] if p.get("owner_id") == user_id]
        total_likes = sum(len(data["likes"].get(p.get("id"), [])) for p in mine)
        row = data["users"].get(user_id) or {}
        return {
            "published_count": len(mine),
            "total_likes_received": total_likes,
            "points": int(row.get("points") or 0),
            "membership_tier": row.get("membership_tier") or "free",
            "member_points_cost": MEMBER_POINTS_COST,
        }


def report_project(user_id: str, project_id: str, reason: str) -> Dict[str, Any]:
    require_registered_user(user_id)
    text = (reason or "").strip()[:500]
    if not text:
        raise ValueError("请填写举报原因")

    def mutate(data):
        if not any(p.get("id") == project_id for p in data["projects"]):
            raise KeyError("项目不存在")
        rep = {
            "id": f"rep_{uuid.uuid4().hex[:12]}",
            "project_id": project_id,
            "reporter_id": user_id,
            "reason": text,
            "created_at": _utc_now_iso(),
            "status": "open",
        }
        data.setdefault("reports", []).append(rep)
        return rep

    return _with_store(mutate)


def admin_remove_project(admin_key: str, project_id: str, note: str = "") -> bool:
    expected = getattr(settings, "SEEKBCi_ADMIN_KEY", None) or "seekbci-admin-dev"
    if (admin_key or "").strip() != expected:
        raise ValueError("管理员密钥无效")

    def mutate(data):
        before = len(data["projects"])
        data["projects"] = [p for p in data["projects"] if p.get("id") != project_id]
        data["likes"].pop(project_id, None)
        for rep in data.get("reports", []):
            if rep.get("project_id") == project_id:
                rep["status"] = "resolved"
                rep["admin_note"] = (note or "管理员下架")[:200]
        return before != len(data["projects"])

    return _with_store(mutate)


_DEMO_OWNER_ID = "system_plaza_demo"
_DEMO_SEED_FLAG = "demo_seeded_v1"


def _demo_projects_payload() -> List[Dict[str, Any]]:
    """广场为空时写入的演示项目（与前端 sample-projects 同名，便于体验）。"""
    now = _utc_now_iso()
    music_page = {
        "id": 0,
        "name": "音乐台",
        "stimulusLayoutRef": {"width": 1200, "height": 700},
        "blocks": [
            {
                "id": 0,
                "shape": "circle",
                "x": 120,
                "y": 160,
                "width": 200,
                "height": 200,
                "label": "小星星",
                "frequency": 8.0,
                "phase": 0,
                "color": "#FF6B9D",
                "rotation": 0,
                "opaqueFlickerRegion": True,
                "actions": [{"type": "python", "content": "play_melody('twinkle')", "targetPage": None, "delayMs": 0}],
            },
            {
                "id": 1,
                "shape": "hexagon",
                "x": 380,
                "y": 160,
                "width": 200,
                "height": 200,
                "label": "生日快乐",
                "frequency": 10.0,
                "phase": 0.15,
                "color": "#FFD166",
                "rotation": 0,
                "opaqueFlickerRegion": True,
                "actions": [{"type": "python", "content": "play_melody('happy')", "targetPage": None, "delayMs": 0}],
            },
        ],
        "multimodalBlocks": [],
    }
    dice_page = {
        "id": 0,
        "name": "运势台",
        "stimulusLayoutRef": {"width": 1200, "height": 700},
        "blocks": [
            {
                "id": 0,
                "shape": "circle",
                "x": 140,
                "y": 180,
                "width": 220,
                "height": 220,
                "label": "掷 1 骰",
                "frequency": 8.0,
                "phase": 0,
                "color": "#FFE066",
                "rotation": 0,
                "opaqueFlickerRegion": True,
                "actions": [{"type": "python", "content": "roll_dice(1)", "targetPage": None, "delayMs": 0}],
            },
            {
                "id": 1,
                "shape": "diamond",
                "x": 420,
                "y": 180,
                "width": 220,
                "height": 220,
                "label": "掷 2 骰",
                "frequency": 10.0,
                "phase": 0.15,
                "color": "#FF6B6B",
                "rotation": 0,
                "opaqueFlickerRegion": True,
                "actions": [{"type": "python", "content": "roll_dice(2)", "targetPage": None, "delayMs": 0}],
            },
        ],
        "multimodalBlocks": [],
    }
    return [
        {
            "contractVersion": 1,
            "id": "sample_brain_music_box",
            "name": "脑控音乐盒",
            "description": "注视闪烁目标播放旋律，Python winsound 反馈。可从广场导入后在本地运行。",
            "author": "SSVEP 平台示例",
            "version": "1.0.0",
            "created_at": now,
            "updated_at": now,
            "thumbnail": "🎵",
            "pages": [music_page],
            "settings": {
                "pythonGlobalCode": "import winsound\n\ndef play_melody(key):\n    freqs = {'twinkle': 523, 'happy': 659}\n    winsound.Beep(freqs.get(key, 440), 300)\n    print('[MusicBox]', key)",
                "pythonImports": [],
                "autoAssignFreqPhaseOnSave": False,
            },
        },
        {
            "contractVersion": 1,
            "id": "sample_brain_dice_fortune",
            "name": "脑控骰子运势站",
            "description": "SSVEP 触发掷骰与运势播报，适合体验 Python 动作链。",
            "author": "SSVEP 平台示例",
            "version": "1.0.0",
            "created_at": now,
            "updated_at": now,
            "thumbnail": "🎲",
            "pages": [dice_page],
            "settings": {
                "pythonGlobalCode": "import random\nimport winsound\n\ndef roll_dice(n=1):\n    faces = [random.randint(1, 6) for _ in range(n)]\n    winsound.Beep(400 + sum(faces) * 20, 200)\n    print('[Dice]', faces)",
                "pythonImports": [],
                "autoAssignFreqPhaseOnSave": False,
            },
        },
    ]


def seed_demo_plaza_if_empty() -> int:
    """首次启动且广场无项目时写入演示数据。返回新增条数。"""
    with _LOCK:
        data = _load_unlocked()
        if data["projects"] or data.get("meta", {}).get(_DEMO_SEED_FLAG):
            return 0

    def ensure_demo_user(data):
        now = _utc_now_iso()
        data["users"][_DEMO_OWNER_ID] = {
            "id": _DEMO_OWNER_ID,
            "display_name": "SEEKBCI 官方示例",
            "bio": "",
            "email": "demo@seekbci.local",
            "email_verified": True,
            "points": 0,
            "membership_tier": "free",
            "created_at": now,
            "registered_at": now,
            "updated_at": now,
        }

    _with_store(ensure_demo_user)
    added = 0
    for payload in _demo_projects_payload():
        publish_project(
            _DEMO_OWNER_ID,
            payload,
            tags=["teaching"],
            ip_rights_ack=True,
        )
        added += 1

    def mark(data):
        data.setdefault("meta", {})[_DEMO_SEED_FLAG] = _utc_now_iso()
        return added

    _with_store(mark)
    return added
