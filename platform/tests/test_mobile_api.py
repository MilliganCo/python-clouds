# -*- coding: utf-8 -*-
"""Versioned public contracts used to bootstrap the native mobile client."""

import importlib
import hashlib
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

PLATFORM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PLATFORM))


@pytest.fixture()
def srv(tmp_path, monkeypatch):
    import server as srv

    importlib.reload(srv)
    monkeypatch.setattr(srv, "DB_PATH", tmp_path / "test.db")
    connection = sqlite3.connect(srv.DB_PATH)
    connection.executescript(srv.SCHEMA)
    connection.close()
    srv.app.config["TESTING"] = True
    return srv


@pytest.fixture()
def client(srv):
    with srv.app.test_client() as test_client:
        yield test_client


def register(client, username="mobile_user", password="synthetic-unit-password-2026"):
    response = client.post(
        "/api/register",
        json={"username": username, "password": password},
    )
    assert response.status_code == 200


def mobile_login(
    client,
    username="mobile_user",
    password="synthetic-unit-password-2026",
    device_id="device-12345678",
):
    return client.post(
        "/api/v1/mobile/login",
        json={
            "username": username,
            "password": password,
            "device_id": device_id,
            "device_name": "Pixel test",
        },
    )


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def test_mobile_capabilities(client, srv, monkeypatch):
    monkeypatch.setattr(srv, "OPENCODE_BIN", "fake-opencode")
    monkeypatch.setattr(srv, "AI_REMOTE_ENABLED", True, raising=False)
    response = client.get("/api/v1/mobile/capabilities")

    assert response.status_code == 200
    assert response.get_json() == {
        "api_version": 1,
        "min_android_api": 26,
        "python": "3.14.x",
        "service": "pycloud",
        "features": {"ai_assistant": True, "code_execution": False},
    }


def test_mobile_ai_ask_requires_bearer_and_reuses_server_assistant(client, srv, monkeypatch):
    register(client)
    login = mobile_login(client).get_json()
    monkeypatch.setattr(srv, "OPENCODE_BIN", "fake-opencode")
    monkeypatch.setattr(srv, "AI_REMOTE_ENABLED", True, raising=False)
    monkeypatch.setattr(
        srv,
        "ask_ai",
        lambda uid, task, question, history, context: ("Короткое объяснение.", "opencode"),
    )
    payload = {
        "task": {"id": "1.1", "type": "объяснить поведение", "prompt": "Что делает код?"},
        "question": "Почему список изменяемый?",
        "context": {"solved_count": 3},
    }

    assert client.post("/api/v1/mobile/ai/ask", json=payload).status_code == 401
    response = client.post(
        "/api/v1/mobile/ai/ask",
        headers=bearer(login["access_token"]),
        json=payload,
    )

    assert response.status_code == 200
    assert response.get_json()["reply"] == "Короткое объяснение."
    assert response.get_json()["engine"] == "opencode"


def test_mobile_ai_rate_limit_is_per_authenticated_user_not_shared_ip(client, srv, monkeypatch):
    register(client, username="mobile_one")
    first = mobile_login(client, username="mobile_one").get_json()
    register(client, username="mobile_two")
    second = mobile_login(client, username="mobile_two").get_json()
    monkeypatch.setattr(srv, "_ai_ask_response", lambda uid, data: ({"uid": uid}, 200))

    for token in (first["access_token"], second["access_token"]):
        for _ in range(8):
            assert client.post(
                "/api/v1/mobile/ai/ask",
                headers=bearer(token),
                json={},
            ).status_code == 200

    assert client.post(
        "/api/v1/mobile/ai/ask",
        headers=bearer(first["access_token"]),
        json={},
    ).status_code == 429


def test_mobile_login_me_refresh_and_logout(client):
    register(client)

    login_response = mobile_login(client)
    assert login_response.status_code == 200
    session = login_response.get_json()
    assert session["expires_in"] == 3600
    assert session["user"]["username"] == "mobile_user"
    assert isinstance(session["user"]["id"], int)
    assert session["access_token"]
    assert session["refresh_token"]

    me_response = client.get(
        "/api/v1/mobile/me",
        headers=bearer(session["access_token"]),
    )
    assert me_response.status_code == 200
    assert me_response.get_json() == session["user"]

    refresh_response = client.post(
        "/api/v1/mobile/refresh",
        json={
            "refresh_token": session["refresh_token"],
            "device_id": "device-12345678",
        },
    )
    assert refresh_response.status_code == 200
    refreshed = refresh_response.get_json()
    assert refreshed["expires_in"] == 3600
    assert refreshed["access_token"] != session["access_token"]
    assert client.get(
        "/api/v1/mobile/me",
        headers=bearer(session["access_token"]),
    ).status_code == 401

    logout_response = client.post(
        "/api/v1/mobile/logout",
        headers=bearer(refreshed["access_token"]),
    )
    assert logout_response.status_code == 200
    assert logout_response.get_json() == {"ok": True}
    assert client.get(
        "/api/v1/mobile/me",
        headers=bearer(refreshed["access_token"]),
    ).status_code == 401


@pytest.mark.parametrize(
    ("payload", "expected_status"),
    [
        ({}, 400),
        ({"username": "mobile_user"}, 400),
        (
            {
                "username": "mobile_user",
                "password": "wrong-password",
                "device_id": "device-12345678",
                "device_name": "Pixel test",
            },
            401,
        ),
    ],
)
def test_mobile_login_rejects_invalid_request(client, payload, expected_status):
    register(client)
    response = client.post("/api/v1/mobile/login", json=payload)
    assert response.status_code == expected_status


def test_mobile_refresh_is_bound_to_device(client):
    register(client)
    session = mobile_login(client).get_json()

    response = client.post(
        "/api/v1/mobile/refresh",
        json={
            "refresh_token": session["refresh_token"],
            "device_id": "another-device",
        },
    )

    assert response.status_code == 401


def test_mobile_access_token_expires(client, srv):
    register(client)
    session = mobile_login(client).get_json()
    token_hash = hashlib.sha256(session["access_token"].encode()).hexdigest()
    expired_at = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
    connection = sqlite3.connect(srv.DB_PATH)
    connection.execute(
        "UPDATE mobile_sessions SET access_expires_at = ? WHERE access_token_hash = ?",
        (expired_at, token_hash),
    )
    connection.commit()
    connection.close()

    response = client.get(
        "/api/v1/mobile/me",
        headers=bearer(session["access_token"]),
    )

    assert response.status_code == 401


def test_mobile_refresh_token_expires(client, srv):
    register(client)
    session = mobile_login(client).get_json()
    token_hash = hashlib.sha256(session["refresh_token"].encode()).hexdigest()
    expired_at = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
    connection = sqlite3.connect(srv.DB_PATH)
    connection.execute(
        "UPDATE mobile_sessions SET refresh_expires_at = ? WHERE refresh_token_hash = ?",
        (expired_at, token_hash),
    )
    connection.commit()
    connection.close()

    response = client.post(
        "/api/v1/mobile/refresh",
        json={
            "refresh_token": session["refresh_token"],
            "device_id": "device-12345678",
        },
    )

    assert response.status_code == 401
