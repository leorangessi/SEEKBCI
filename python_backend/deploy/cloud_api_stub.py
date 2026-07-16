"""
云端同步 API 占位（未挂载到 main.py）。

后续实现：
- POST /api/cloud/projects — 上传/更新用户项目（受 membership 限额约束）
- GET  /api/cloud/projects — 列表
- POST /api/cloud/projects/{id}/restore — 拉取到本地

当前点赞、广场发布仍走 /api/plaza/* 与本机 plaza.json。
"""

from __future__ import annotations

from typing import Any, Dict, List

# 占位常量，与 DEVELOPMENT_PLAN.md 一致
CLOUD_PROJECT_LIMIT_FREE = 10
CLOUD_PROJECT_LIMIT_MEMBER = 100


def cloud_project_limit_for_tier(membership_tier: str) -> int:
    if membership_tier == "member":
        return CLOUD_PROJECT_LIMIT_MEMBER
    return CLOUD_PROJECT_LIMIT_FREE


def validate_cloud_sync_payload(payload: Dict[str, Any]) -> None:
    if not isinstance(payload, dict):
        raise ValueError("payload 须为对象")
    if not payload.get("name"):
        raise ValueError("缺少项目名称")
    if not isinstance(payload.get("pages"), list):
        raise ValueError("缺少 pages 数组")


def list_cloud_projects_stub(user_id: str) -> List[Dict[str, Any]]:
    raise NotImplementedError("云端备份尚未部署，见 python_backend/deploy/README.md")
