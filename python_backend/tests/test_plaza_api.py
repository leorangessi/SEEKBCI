"""项目广场 API 冒烟测试。"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import plaza_store


@pytest.fixture(autouse=True)
def isolated_plaza_store(tmp_path, monkeypatch):
    store = tmp_path / "plaza.json"
    monkeypatch.setattr(plaza_store, "_STORE_PATH", store)
    monkeypatch.setattr(plaza_store, "_DATA_DIR", tmp_path)
    yield


@pytest.fixture
def client():
    return TestClient(app)


def test_plaza_register_verify_publish_like(client):
    uid = "user_api_test"
    content = {
        "contractVersion": 1,
        "id": "local_x",
        "name": "API 测试项目",
        "description": "hello",
        "author": "Tester",
        "pages": [{"id": 0, "name": "P", "blocks": [{"id": 1}], "multimodalBlocks": []}],
    }
    headers = {"X-SSVEP-User-Id": uid}
    reg = client.post(
        "/api/plaza/users/register",
        json={
            "email": "api@test.com",
            "display_name": "API Tester",
            "password": "secret1",
            "password_confirm": "secret1",
        },
        headers=headers,
    )
    assert reg.status_code == 200, reg.text
    dev_code = reg.json().get("dev_verify_code")
    assert dev_code
    verify = client.post(
        "/api/plaza/users/verify-email",
        json={"code": dev_code},
        headers=headers,
    )
    assert verify.status_code == 200, verify.text

    pub = client.post(
        "/api/plaza/projects",
        json={
            "content": content,
            "tags": ["keyboard"],
            "ip_rights_ack": True,
        },
        headers=headers,
    )
    assert pub.status_code == 200, pub.text
    pid = pub.json()["id"]

    listed = client.get("/api/plaza/projects", headers=headers)
    assert listed.status_code == 200
    assert listed.json()["total"] >= 1

    liked = client.post(f"/api/plaza/projects/{pid}/like", headers=headers)
    assert liked.status_code == 200
    assert liked.json()["liked_by_me"] is True

    again = client.post(f"/api/plaza/projects/{pid}/like", headers=headers)
    assert again.json()["message"] == "你已经点过赞了"


def test_plaza_login(client):
    uid = "user_login_api"
    headers = {"X-SSVEP-User-Id": uid}
    reg = client.post(
        "/api/plaza/users/register",
        json={
            "email": "login_api@test.com",
            "display_name": "Login API",
            "password": "secret1",
            "password_confirm": "secret1",
        },
        headers=headers,
    )
    assert reg.status_code == 200, reg.text
    dev_code = reg.json().get("dev_verify_code")
    verify = client.post(
        "/api/plaza/users/verify-email",
        json={"code": dev_code},
        headers=headers,
    )
    assert verify.status_code == 200, verify.text

    new_device = {"X-SSVEP-User-Id": "user_new_device"}
    login = client.post(
        "/api/plaza/users/login",
        json={"email": "login_api@test.com", "password": "secret1"},
        headers=new_device,
    )
    assert login.status_code == 200, login.text
    body = login.json()
    assert body["account_user_id"] == uid
    assert body["profile"]["email_verified"] is True

    bad = client.post(
        "/api/plaza/users/login",
        json={"email": "login_api@test.com", "password": "wrong"},
        headers=new_device,
    )
    assert bad.status_code == 400
