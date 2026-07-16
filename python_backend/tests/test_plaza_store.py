"""项目广场存储单元测试。"""
from __future__ import annotations

import pytest

from app.services import plaza_store


@pytest.fixture(autouse=True)
def isolated_plaza_store(tmp_path, monkeypatch):
    store = tmp_path / "plaza.json"
    monkeypatch.setattr(plaza_store, "_STORE_PATH", store)
    monkeypatch.setattr(plaza_store, "_DATA_DIR", tmp_path)
    yield
    if store.exists():
        store.unlink()


def _register_verified(uid: str, email: str, name: str, password: str = "secret1") -> None:
    _, code = plaza_store.register_user(uid, email, name, password, password)
    assert code
    plaza_store.verify_email_code(uid, code)


def _sample_content(**extra):
    base = {
        "contractVersion": 1,
        "id": "local_proj_1",
        "name": "测试项目",
        "description": "desc",
        "author": "Alice",
        "version": "1.0.0",
        "pages": [{"id": 0, "name": "P1", "blocks": [{"id": 1}], "multimodalBlocks": []}],
    }
    base.update(extra)
    return base


def test_register_verify_and_publish_like():
    uid = "user_test_1"
    _register_verified(uid, "test1@example.com", "Tester")
    row = plaza_store.publish_project(uid, _sample_content(), tags=["teaching"], ip_rights_ack=True)
    assert row["name"] == "测试项目"
    assert row["like_count"] == 0
    assert "teaching" in (row.get("tags") or [])

    _register_verified("user_other", "other@example.com", "Other")
    liked = plaza_store.like_project("user_other", row["id"])
    assert liked["like_count"] == 1
    assert liked["liked_by_me"] is True

    again = plaza_store.like_project("user_other", row["id"])
    assert again["like_count"] == 1
    assert again.get("newly_liked") is False

    items, total = plaza_store.list_public_projects("user_other", sort="popular")
    assert total == 1
    assert items[0]["liked_by_me"] is True


def test_login_with_email_password():
    uid = "user_login_test"
    _register_verified(uid, "login@example.com", "LoginUser", "pass1234")
    profile, account_uid = plaza_store.login_user("login@example.com", "pass1234")
    assert account_uid == uid
    assert profile["email"] == "login@example.com"
    assert profile["email_verified"] is True
    with pytest.raises(ValueError, match="密码"):
        plaza_store.login_user("login@example.com", "wrongpass")


def test_unverified_cannot_publish():
    uid = "user_unverified"
    plaza_store.register_user(uid, "u@example.com", "U", "pass12", "pass12")
    with pytest.raises(ValueError, match="邮箱验证"):
        plaza_store.publish_project(uid, _sample_content(), ip_rights_ack=True)


def test_import_only_cannot_republish():
    uid = "user_owner"
    _register_verified(uid, "owner@example.com", "Owner")
    content = _sample_content(id="lp1", importOnlyNoRepublish=True)
    with pytest.raises(ValueError, match="仅导入"):
        plaza_store.publish_project(uid, content, ip_rights_ack=True)


def test_unpublish_own_project():
    uid = "user_owner2"
    _register_verified(uid, "owner2@example.com", "Owner")
    row = plaza_store.publish_project(
        uid,
        _sample_content(id="lp1", name="Mine"),
        ip_rights_ack=True,
    )
    assert plaza_store.unpublish_project(uid, row["id"]) is True
    assert plaza_store.get_public_project(row["id"], uid) is None
