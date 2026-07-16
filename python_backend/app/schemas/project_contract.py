"""SEEKBCI 项目 JSON 契约校验（与 web_frontend/schemas/ssvep-project.schema.json 对齐）。"""
from __future__ import annotations

from typing import Any, Dict, List, Tuple

CONTRACT_VERSION = 1


def validate_seekbci_project(content: Dict[str, Any]) -> Tuple[bool, List[str]]:
    errors: List[str] = []
    if not isinstance(content, dict):
        return False, ["项目必须是 JSON 对象"]

    cv = content.get("contractVersion")
    if cv is not None and cv != CONTRACT_VERSION:
        errors.append(f"不支持的 contractVersion: {cv}")

    name = content.get("name")
    if not name or not str(name).strip():
        errors.append("缺少项目名称 name")

    pages = content.get("pages")
    if not isinstance(pages, list) or len(pages) == 0:
        errors.append("项目至少需要一个页面 pages")
    else:
        for i, page in enumerate(pages):
            if not isinstance(page, dict):
                errors.append(f"pages[{i}] 无效")
                continue
            if not isinstance(page.get("blocks"), list):
                errors.append(f"pages[{i}].blocks 必须是数组")

    return len(errors) == 0, errors


def ensure_contract_version(content: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(content)
    if out.get("contractVersion") is None:
        out["contractVersion"] = CONTRACT_VERSION
    return out
