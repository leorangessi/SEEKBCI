from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Query

from app.schemas.plaza import (
    PlazaAdminRemoveRequest,
    PlazaLikeResponse,
    PlazaProfileResponse,
    PlazaProfileUpdate,
    PlazaProjectDetail,
    PlazaProjectListResponse,
    PlazaPublishRequest,
    PlazaLoginRequest,
    PlazaRegisterRequest,
    PlazaReportRequest,
    PlazaVerifyEmailRequest,
)
from app.services import plaza_store

router = APIRouter()


def _require_user_id(x_ssvep_user_id: Optional[str]) -> str:
    uid = (x_ssvep_user_id or "").strip()
    if not uid or len(uid) > 80:
        raise HTTPException(
            status_code=401,
            detail="请在请求头提供 X-SSVEP-User-Id（前端 js/plaza-client.js 会自动生成）",
        )
    return uid


@router.get("/projects", response_model=PlazaProjectListResponse)
async def list_plaza_projects(
    sort: str = Query("recent", pattern="^(recent|popular)$"),
    q: Optional[str] = Query(None, max_length=100),
    tag: Optional[str] = Query(None, max_length=32),
    skip: int = Query(0, ge=0),
    limit: int = Query(24, ge=1, le=100),
    x_ssvep_user_id: Optional[str] = Header(None),
):
    items, total = plaza_store.list_public_projects(
        viewer_id=(x_ssvep_user_id or "").strip() or None,
        sort=sort,
        q=q,
        skip=skip,
        limit=limit,
    )
    if tag and tag.strip():
        t = tag.strip().lower()
        items = [i for i in items if t in (i.get("tags") or [])]
        total = len(items)
    return {"success": True, "total": total, "items": items}


@router.get("/projects/{project_id}", response_model=PlazaProjectDetail)
async def get_plaza_project(
    project_id: str,
    x_ssvep_user_id: Optional[str] = Header(None),
):
    row = plaza_store.get_public_project(
        project_id, viewer_id=(x_ssvep_user_id or "").strip() or None
    )
    if not row:
        raise HTTPException(status_code=404, detail="广场项目不存在")
    return row


@router.post("/projects", response_model=PlazaProjectDetail)
async def publish_to_plaza(
    body: PlazaPublishRequest,
    x_ssvep_user_id: Optional[str] = Header(None),
):
    user_id = _require_user_id(x_ssvep_user_id)
    try:
        summary = plaza_store.publish_project(
            owner_id=user_id,
            content=body.content,
            description_override=body.description,
            tags=body.tags,
            ip_rights_ack=body.ip_rights_ack,
        )
    except ValueError as e:
        msg = str(e)
        code = 403 if ("注册" in msg or "验证" in msg or "知识产权" in msg or "仅导入" in msg) else 400
        raise HTTPException(status_code=code, detail=msg) from e
    detail = plaza_store.get_public_project(summary["id"], viewer_id=user_id)
    return detail


@router.delete("/projects/{project_id}")
async def unpublish_from_plaza(
    project_id: str,
    x_ssvep_user_id: Optional[str] = Header(None),
):
    user_id = _require_user_id(x_ssvep_user_id)
    ok = plaza_store.unpublish_project(user_id, project_id)
    if not ok:
        raise HTTPException(status_code=404, detail="未找到你的广场项目")
    return {"success": True}


@router.post("/projects/{project_id}/like", response_model=PlazaLikeResponse)
async def like_plaza_project(
    project_id: str,
    x_ssvep_user_id: Optional[str] = Header(None),
):
    user_id = _require_user_id(x_ssvep_user_id)
    try:
        row = plaza_store.like_project(user_id, project_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    msg = "感谢点赞！" if row.get("newly_liked") else "你已经点过赞了"
    return {
        "success": True,
        "id": row["id"],
        "like_count": row["like_count"],
        "liked_by_me": row["liked_by_me"],
        "message": msg,
    }


@router.post("/projects/{project_id}/report")
async def report_plaza_project(
    project_id: str,
    body: PlazaReportRequest,
    x_ssvep_user_id: Optional[str] = Header(None),
):
    user_id = _require_user_id(x_ssvep_user_id)
    try:
        rep = plaza_store.report_project(user_id, project_id, body.reason)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"success": True, "report": rep}


@router.delete("/admin/projects/{project_id}")
async def admin_remove_plaza_project(
    project_id: str,
    body: PlazaAdminRemoveRequest,
    x_admin_key: Optional[str] = Header(None, alias="X-Admin-Key"),
):
    try:
        ok = plaza_store.admin_remove_project(x_admin_key or "", project_id, body.note or "")
    except ValueError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    if not ok:
        raise HTTPException(status_code=404, detail="项目不存在")
    return {"success": True}


@router.get("/users/me", response_model=PlazaProfileResponse)
async def get_my_plaza_profile(
    x_ssvep_user_id: Optional[str] = Header(None),
):
    user_id = _require_user_id(x_ssvep_user_id)
    profile = plaza_store.get_profile_for_user(user_id)
    stats = plaza_store.user_stats(user_id)
    return {"success": True, "profile": profile, "stats": stats}


@router.post("/users/login", response_model=PlazaProfileResponse)
async def login_plaza_user(
    body: PlazaLoginRequest,
    x_ssvep_user_id: Optional[str] = Header(None),
):
    _require_user_id(x_ssvep_user_id)
    try:
        profile, account_uid = plaza_store.login_user(body.email, body.password)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    stats = plaza_store.user_stats(account_uid)
    return {
        "success": True,
        "profile": profile,
        "stats": stats,
        "account_user_id": account_uid,
    }


@router.post("/users/register", response_model=PlazaProfileResponse)
async def register_plaza_user(
    body: PlazaRegisterRequest,
    x_ssvep_user_id: Optional[str] = Header(None),
):
    user_id = _require_user_id(x_ssvep_user_id)
    try:
        profile, dev_code = plaza_store.register_user(
            user_id,
            body.email,
            body.display_name,
            body.password,
            body.password_confirm,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    stats = plaza_store.user_stats(user_id)
    return {
        "success": True,
        "profile": profile,
        "stats": stats,
        "dev_verify_code": dev_code,
    }


@router.post("/users/verify-email", response_model=PlazaProfileResponse)
async def verify_plaza_email(
    body: PlazaVerifyEmailRequest,
    x_ssvep_user_id: Optional[str] = Header(None),
):
    user_id = _require_user_id(x_ssvep_user_id)
    try:
        profile = plaza_store.verify_email_code(user_id, body.code)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    stats = plaza_store.user_stats(user_id)
    return {"success": True, "profile": profile, "stats": stats}


@router.post("/users/redeem-membership", response_model=PlazaProfileResponse)
async def redeem_membership(
    x_ssvep_user_id: Optional[str] = Header(None),
):
    user_id = _require_user_id(x_ssvep_user_id)
    try:
        profile = plaza_store.redeem_membership_with_points(user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    stats = plaza_store.user_stats(user_id)
    return {"success": True, "profile": profile, "stats": stats}


@router.put("/users/me", response_model=PlazaProfileResponse)
async def update_my_plaza_profile(
    body: PlazaProfileUpdate,
    x_ssvep_user_id: Optional[str] = Header(None),
):
    user_id = _require_user_id(x_ssvep_user_id)
    try:
        fields_set = getattr(body, "model_fields_set", None) or getattr(body, "__fields_set__", set())
        profile = plaza_store.update_user_profile(
            user_id,
            body.display_name,
            body.bio,
            avatar_image=body.avatar_image,
            avatar_original_image=body.avatar_original_image,
            avatar_display_mode=body.avatar_display_mode,
            avatar_edit_mode=body.avatar_edit_mode,
            avatar_image_provided="avatar_image" in fields_set,
            avatar_original_provided="avatar_original_image" in fields_set,
            avatar_mode_provided="avatar_display_mode" in fields_set,
            avatar_edit_mode_provided="avatar_edit_mode" in fields_set,
        )
    except ValueError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    stats = plaza_store.user_stats(user_id)
    return {"success": True, "profile": profile, "stats": stats}


@router.get("/users/me/projects", response_model=PlazaProjectListResponse)
async def list_my_plaza_projects(
    x_ssvep_user_id: Optional[str] = Header(None),
):
    user_id = _require_user_id(x_ssvep_user_id)
    items = plaza_store.list_my_projects(user_id, user_id)
    return {"success": True, "total": len(items), "items": items}
