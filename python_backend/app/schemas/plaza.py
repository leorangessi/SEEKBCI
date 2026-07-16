from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class PlazaPublishRequest(BaseModel):
    content: Dict[str, Any] = Field(..., description="完整 SSVEP 项目 JSON")
    description: Optional[str] = Field(None, max_length=2000)
    tags: List[str] = Field(default_factory=list)
    ip_rights_ack: bool = Field(False, description="确认拥有分享内容的知识产权")


class PlazaRegisterRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=100)
    display_name: str = Field(..., min_length=1, max_length=50)
    password: str = Field(..., min_length=6, max_length=128)
    password_confirm: str = Field(..., min_length=6, max_length=128)


class PlazaLoginRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=100)
    password: str = Field(..., min_length=6, max_length=128)


class PlazaVerifyEmailRequest(BaseModel):
    code: str = Field(..., min_length=4, max_length=8)


class PlazaReportRequest(BaseModel):
    reason: str = Field(..., min_length=4, max_length=500)


class PlazaAdminRemoveRequest(BaseModel):
    note: Optional[str] = Field(None, max_length=200)


class PlazaProfileUpdate(BaseModel):
    display_name: Optional[str] = Field(None, min_length=1, max_length=50)
    bio: Optional[str] = Field(None, max_length=500)
    avatar_image: Optional[str] = Field(
        None,
        description="头像展示用 data URL（已烘焙）；传空字符串表示清除",
        max_length=350_000,
    )
    avatar_original_image: Optional[str] = Field(
        None,
        description="头像原图 data URL，供再次编辑；传空字符串表示清除",
        max_length=900_000,
    )
    avatar_display_mode: Optional[str] = Field(None, pattern="^(fit|stretch|cover)$")
    avatar_edit_mode: Optional[str] = Field(None, pattern="^(fit|stretch|crop)$")


class PlazaProjectSummary(BaseModel):
    id: str
    owner_id: Optional[str] = None
    name: str
    description: str = ""
    author_name: str = ""
    version: str = "1.0.0"
    thumbnail: str = "📊"
    thumbnail_image: Optional[str] = None
    page_count: int = 0
    block_count: int = 0
    like_count: int = 0
    liked_by_me: bool = False
    published_at: Optional[str] = None
    updated_at: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    import_only_no_republish: bool = False


class PlazaProjectDetail(PlazaProjectSummary):
    content: Optional[Dict[str, Any]] = None


class PlazaProjectListResponse(BaseModel):
    success: bool = True
    total: int
    items: List[PlazaProjectSummary]


class PlazaLikeResponse(BaseModel):
    success: bool = True
    id: str
    like_count: int
    liked_by_me: bool
    message: str = ""


class PlazaProfileResponse(BaseModel):
    success: bool = True
    profile: Dict[str, Any]
    stats: Dict[str, Any]
    dev_verify_code: Optional[str] = None
    account_user_id: Optional[str] = None
