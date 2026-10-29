# -*- coding: utf-8 -*-
"""Тесты публичной доски проектов: seed-карточки, публикация, premium multi-file и голоса."""
import importlib
import sqlite3
import sys
from pathlib import Path

import pytest

PLATFORM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PLATFORM))


@pytest.fixture()
def srv(tmp_path, monkeypatch):
    import server
    importlib.reload(server)
    monkeypatch.setattr(server, "DB_PATH", tmp_path / "test.db")
    conn = sqlite3.connect(server.DB_PATH)
    conn.executescript(server.SCHEMA)
    conn.close()
    server.app.config["TESTING"] = True
    return server


@pytest.fixture()
def client(srv):
    with srv.app.test_client() as c:
        yield c


def register(client, name="showcase_user", pwd="secret123"):
    return client.post("/api/register", json={"username": name, "password": pwd})


def give_drops(srv, user_id, amount=1000):
    with srv.app.app_context():
        srv.wallet_add(user_id, drops=amount)
        srv.db().commit()


def test_showcase_returns_seed_cards(client):
    register(client)

    data = client.get("/api/showcase").get_json()

    assert data["can_multi_file"] is False
    assert len(data["cards"]) >= 3
    assert data["leaderboard"]
    assert all(card["files"] for card in data["cards"])


def test_showcase_card_detail(client):
    register(client)
    card_id = client.get("/api/showcase").get_json()["cards"][0]["id"]

    detail = client.get(f"/api/showcase/cards/{card_id}")
    assert detail.status_code == 200
    payload = detail.get_json()
    assert payload["card"]["id"] == card_id
    assert payload["card"]["files"]
    assert "covers" in payload

    missing = client.get("/api/showcase/cards/999999")
    assert missing.status_code == 404


def test_showcase_create_vote_and_leaderboard(client):
    register(client)

    create = client.post("/api/showcase/cards", json={
        "title": "Мини-калькулятор",
        "description": "Складывает два числа и печатает результат.",
        "cover": "aurora",
        "files": [{"name": "main.py", "code": "print(2 + 3)\n"}],
    })
    assert create.status_code == 200
    card = create.get_json()["card"]
    assert card["owner_name"] == "showcase_user"
    assert card["file_count"] == 1

    vote = client.post(f"/api/showcase/cards/{card['id']}/vote", json={"value": 3})
    assert vote.status_code == 200
    voted = vote.get_json()["card"]
    assert voted["my_vote"] == 3
    assert voted["score"] >= 3

    board = client.get("/api/showcase").get_json()
    assert any(c["id"] == card["id"] for c in board["leaderboard"])


def test_showcase_rejects_multi_file_without_premium(client):
    register(client)

    response = client.post("/api/showcase/cards", json={
        "title": "Пакет модулей",
        "description": "main.py импортирует helpers.py.",
        "files": [
            {"name": "main.py", "code": "from helpers import answer\nprint(answer())\n"},
            {"name": "helpers.py", "code": "def answer():\n    return 42\n"},
        ],
    })

    assert response.status_code == 402
    assert "Небесная корона" in response.get_json()["error"]


def test_showcase_allows_multi_file_with_premium_crown(client, srv):
    register(client)
    give_drops(srv, 1, amount=1000)
    buy = client.post("/api/shop/buy", json={"item": "premium_crown"})
    assert buy.status_code == 200

    response = client.post("/api/showcase/cards", json={
        "title": "Пакет модулей",
        "description": "main.py импортирует helpers.py.",
        "cover": "cosmos",
        "files": [
            {"name": "main.py", "code": "from helpers import answer\nprint(answer())\n"},
            {"name": "helpers.py", "code": "def answer():\n    return 42\n"},
        ],
    })

    assert response.status_code == 200
    card = response.get_json()["card"]
    assert card["file_count"] == 2
    assert card["is_multi_file"] is True


@pytest.mark.parametrize("value", [-4, 4, "bad"])
def test_showcase_vote_rejects_invalid_values(client, value):
    register(client)
    card_id = client.get("/api/showcase").get_json()["cards"][0]["id"]

    response = client.post(f"/api/showcase/cards/{card_id}/vote", json={"value": value})

    assert response.status_code == 400
