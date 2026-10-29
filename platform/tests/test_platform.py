# -*- coding: utf-8 -*-
"""Тесты платформы: API (регистрация, прогресс, заметки, статистика) и парсер коллекции.

Запуск из platform/:  python -m pytest tests/ -q
"""
import importlib.util
import json
import re
import sys
from pathlib import Path

import pytest

PLATFORM = Path(__file__).resolve().parents[1]
ROOT = PLATFORM.parent
sys.path.insert(0, str(PLATFORM))


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """Flask test client с чистой временной БД."""
    import server as srv
    importlib.reload(srv)  # сброс глобального состояния между сессиями
    monkeypatch.setattr(srv, "DB_PATH", tmp_path / "test.db")
    import sqlite3
    conn = sqlite3.connect(srv.DB_PATH)
    conn.executescript(srv.SCHEMA)
    conn.close()
    srv.app.config["TESTING"] = True
    # Unit tests must never launch a real subscribed model in background threads.
    scheduler = srv._schedule_daily_generation
    def no_external_generation(day, diff):
        return False
    no_external_generation.original = scheduler
    monkeypatch.setattr(srv, '_schedule_daily_generation', no_external_generation)
    with srv.app.test_client() as c:
        yield c


def register(client, name="tester", pwd="secret123"):
    return client.post("/api/register", json={"username": name, "password": pwd})


def test_shop_concurrent_purchases_cannot_overspend(client, monkeypatch):
    """Two affordable requests must not both spend the same balance."""
    import sqlite3
    import time
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    import server as srv

    register(client)
    with client.session_transaction() as session:
        uid = session["uid"]
    with sqlite3.connect(srv.DB_PATH) as conn:
        conn.execute("INSERT OR REPLACE INTO wallet(user_id,drops,freezes) VALUES (?,260,0)", (uid,))
    original = srv.wallet_get
    def slow_read(user_id):
        wallet = original(user_id)
        time.sleep(0.08)
        return wallet
    monkeypatch.setattr(srv, "wallet_get", slow_read)
    gate = Barrier(2)
    def buy(item):
        with srv.app.test_client() as buyer:
            with buyer.session_transaction() as session:
                session["uid"] = uid
            gate.wait(timeout=5)
            response = buyer.post("/api/shop/buy", json={"item": item})
            return item, response.status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(buy, ["sky_space", "sky_aurora"]))
    assert sorted(status for _, status in results) == [200, 402]
    winner = next(item for item, status in results if status == 200)
    with sqlite3.connect(srv.DB_PATH) as conn:
        assert conn.execute("SELECT item_key FROM purchases WHERE user_id=?", (uid,)).fetchall() == [(winner,)]
        assert conn.execute("SELECT drops FROM wallet WHERE user_id=?", (uid,)).fetchone()[0] == 260 - srv.SHOP[winner]["price"] + srv.ACHIEVEMENT_BONUS


# ── Аутентификация ────────────────────────────────────────────────────────
def test_register_login_me(client):
    r = register(client)
    assert r.status_code == 200
    assert r.get_json()["username"] == "tester"

    r = client.get("/api/me")
    assert r.status_code == 200

    client.post("/api/logout")
    assert client.get("/api/me").status_code == 401

    r = client.post("/api/login", json={"username": "tester", "password": "secret123"})
    assert r.status_code == 200


def test_session_cookie_changes_only_on_auth(client):
    # A delayed ordinary response must not restore the old account's cookie.
    assert register(client).headers.get("Set-Cookie")
    assert client.get("/api/me").headers.get("Set-Cookie") is None
    assert client.post("/api/chest/claim").headers.get("Set-Cookie") is None
    assert client.get("/api/chest").headers.get("Set-Cookie") is None
    assert client.post("/api/logout").headers.get("Set-Cookie")
    assert client.post("/api/login", json={"username": "tester", "password": "secret123"}).headers.get("Set-Cookie")


def test_register_validation(client):
    assert register(client, name="ab").status_code == 400          # короткое имя
    assert register(client, pwd="123").status_code == 400           # короткий пароль
    register(client)
    assert register(client).status_code == 409                      # дубликат


def test_login_wrong_password(client):
    register(client)
    r = client.post("/api/login", json={"username": "tester", "password": "wrong!"})
    assert r.status_code == 401


def test_api_requires_auth(client):
    assert client.get("/api/progress").status_code == 401
    assert client.get("/api/stats").status_code == 401
    assert client.post("/api/notes", json={}).status_code == 401


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    data = r.get_json()
    assert data["ok"] is True
    assert data["service"] == "pycloud"


# ── Прогресс ──────────────────────────────────────────────────────────────
def test_progress_roundtrip(client):
    register(client)
    assert client.post("/api/progress", json={"task_id": "1.1", "solved": True}).status_code == 200
    assert client.post("/api/progress", json={"task_id": "2.3", "solved": True}).status_code == 200
    solved = client.get("/api/progress").get_json()["solved"]
    assert set(solved) == {"1.1", "2.3"}

    client.post("/api/progress", json={"task_id": "1.1", "solved": False})
    assert client.get("/api/progress").get_json()["solved"] == ["2.3"]


def test_progress_rejects_bad_id(client):
    register(client)
    r = client.post("/api/progress", json={"task_id": "DROP TABLE", "solved": True})
    assert r.status_code == 400


def test_progress_rejects_unknown_well_formed_id(client):
    register(client)
    r = client.post("/api/progress", json={"task_id": "999.999", "solved": True})
    assert r.status_code == 400
    assert client.get("/api/wallet").get_json()["drops"] == 0


def test_task_xp_server_catalog_and_idempotent_progress(client):
    import server as srv
    register(client)
    catalog = client.get("/api/progress").get_json()
    assert catalog["xp"] == 0
    assert set(catalog["task_xp"]) == srv.KNOWN_TASK_IDS
    # Every old reward is preserved or increased, including existing solutions.
    for task_id, reward in catalog["task_xp"].items():
        if task_id in srv.TASKS_META:
            assert reward >= srv.XP_BY_LEVEL[srv.TASKS_META[task_id]]
        else:
            assert reward >= 60
    assert catalog["task_xp"]["3.1"] == 10  # demo
    assert catalog["task_xp"]["3.3"] == 15  # predict output
    assert catalog["task_xp"]["3.5"] == 35  # write a function
    assert catalog["task_xp"]["3.9"] == 45  # first finale
    assert catalog["task_xp"]["3.10"] == 60  # second finale
    topics = json.loads((srv.BASE / "static/tasks.js").read_text(encoding="utf-8").split("window.TASKS = ", 1)[1].strip().removesuffix(";"))
    for topic in topics:
        for task in topic["tasks"]:
            if task["type"] == "квиз":
                assert catalog["task_xp"][task["id"]] == srv.XP_BY_LEVEL[topic["level"]] + 10 + min(4, max(0, len(task.get("questions", [])) - 1)) * 5
    task_ids = ["3.1", "3.2", "3.9", "3.10", "C4.1"]
    total = 0
    for task_id in task_ids:
        response = client.post("/api/progress", json={"task_id": task_id, "solved": True, "xp": 99999}).get_json()
        total += catalog["task_xp"][task_id]
        assert response["xp"] == total
        assert response["xp_awarded"] == catalog["task_xp"][task_id]
        repeat = client.post("/api/progress", json={"task_id": task_id, "solved": True}).get_json()
        assert repeat["xp_awarded"] == 0 and repeat["xp"] == total
    assert client.get("/api/progress").get_json()["xp"] == total
    removed = client.post("/api/progress", json={"task_id": "3.1", "solved": False}).get_json()
    assert removed["xp"] == total - 10 and removed["xp_awarded"] == 0
    restored = client.post("/api/progress", json={"task_id": "3.1", "solved": True}).get_json()
    assert restored["xp"] == total and restored["drops_awarded"] == 0
    # Existing records need no destructive data migration or second solve.
    with srv.app.app_context():
        uid = srv.db().execute("SELECT id FROM users WHERE username = 'tester'").fetchone()[0]
        srv.db().execute("INSERT INTO progress VALUES (?, ?, ?)", (uid, "3.3", srv.now()))
        srv.db().commit()
    assert client.get("/api/progress").get_json()["xp"] == total + catalog["task_xp"]["3.3"]


# ── Заметки ───────────────────────────────────────────────────────────────
def test_notes_roundtrip(client):
    register(client)
    client.post("/api/notes", json={"task_id": "3.1", "text": "моя заметка"})
    assert client.get("/api/notes?task_id=3.1").get_json()["text"] == "моя заметка"

    # пустой текст удаляет заметку
    client.post("/api/notes", json={"task_id": "3.1", "text": "  "})
    assert client.get("/api/notes?task_id=3.1").get_json()["text"] == ""


def test_notes_export(client):
    register(client)
    client.post("/api/notes", json={"task_id": "1.1", "text": "a"})
    client.post("/api/notes", json={"task_id": "2.2", "text": "b"})
    notes = client.get("/api/notes/all").get_json()["notes"]
    assert [n["task_id"] for n in notes] == ["1.1", "2.2"]


# ── Статистика ────────────────────────────────────────────────────────────
def test_stats(client):
    register(client)
    client.post("/api/progress", json={"task_id": "1.1", "solved": True})
    data = client.get("/api/stats").get_json()
    assert len(data["solved"]) == 1
    assert data["solved"][0]["task_id"] == "1.1"
    assert data["solved"][0]["solved_at"]
    assert data["notes_count"] == 0
    assert data["member_since"]


# ── Экономика ─────────────────────────────────────────────────────────────
def test_drops_awarded_once(client):
    register(client)
    r = client.post("/api/progress", json={"task_id": "1.1", "solved": True})
    first = r.get_json()
    assert first["drops_awarded"] > 0
    # снятие и повторное решение не фармит капли
    client.post("/api/progress", json={"task_id": "1.1", "solved": False})
    r2 = client.post("/api/progress", json={"task_id": "1.1", "solved": True})
    assert r2.get_json()["drops_awarded"] == 0
    assert r2.get_json()["drops"] == first["drops"]


def test_challenge_drops(client):
    register(client)
    r = client.post("/api/progress", json={"task_id": "C4.1", "solved": True})
    assert r.get_json()["drops_awarded"] == 30


def test_shop_buy_and_insufficient(client):
    register(client)
    r = client.post("/api/shop/buy", json={"item": "sky_dawn"})
    assert r.status_code == 402  # нет капель
    # накапливаем: 13 заданий начального уровня по 5 капель = 65
    for i in range(1, 14):
        client.post("/api/progress", json={"task_id": f"{i}.1", "solved": True})
    r = client.post("/api/shop/buy", json={"item": "freeze"})  # 60
    assert r.status_code == 200
    w = client.get("/api/wallet").get_json()
    assert w["freezes"] == 1
    assert r.get_json()["drops"] == w["drops"]


def test_shop_can_buy_every_catalog_item(client):
    import server as srv
    register(client, name="shopper")
    total_price = sum(item["price"] for item in srv.SHOP.values())
    with srv.app.app_context():
        row = srv.db().execute("SELECT id FROM users WHERE username = ?", ("shopper",)).fetchone()
        srv.wallet_add(row["id"], drops=total_price + 10)
        srv.db().commit()

    for key in srv.SHOP:
        r = client.post("/api/shop/buy", json={"item": key})
        assert r.status_code == 200, key

    wallet = client.get("/api/wallet").get_json()
    owned = set(wallet["owned"])
    for key, item in srv.SHOP.items():
        if item["kind"] == "consumable":
            assert wallet["freezes"] >= 1
        else:
            assert key in owned


def test_achievement_claim_idempotent(client):
    register(client)
    r1 = client.post("/api/achievements/claim", json={"key": "first_solve"})
    assert r1.get_json()["new"] is True
    r2 = client.post("/api/achievements/claim", json={"key": "first_solve"})
    assert r2.get_json()["new"] is False
    earned = client.get("/api/achievements").get_json()["earned"]
    assert "first_solve" in earned
    assert client.post("/api/achievements/claim", json={"key": "hack"}).status_code == 400


def test_game_daily_cap_per_game(client):
    register(client)
    r1 = client.post("/api/game/result", json={"score": 12, "game": "blitz"}).get_json()
    assert r1["awarded"] == 12
    r2 = client.post("/api/game/result", json={"score": 24, "game": "blitz"}).get_json()
    assert r2["awarded"] == 18  # кэп 30 на игру в день
    assert r2["cap_left"] == 0
    # у другой игры свой кэп
    r3 = client.post("/api/game/result", json={"score": 10, "game": "order"}).get_json()
    assert r3["awarded"] == 10
    assert client.post("/api/game/result", json={"score": 5, "game": "hack"}).status_code == 400


def test_chest_once_a_day(client):
    register(client)
    r1 = client.post("/api/chest/claim", json={})
    assert r1.status_code == 200
    result = r1.get_json()['result']
    assert 5 <= result['amount'] <= 200
    assert result['amount'] == sum(result['rewards'][sum(path)] for path in result['paths'])
    assert client.get('/api/chest').get_json()['result'] == result
    assert client.post("/api/chest/claim", json={}).status_code == 409
    assert client.get("/api/chest").get_json()["ready"] is False


@pytest.mark.parametrize('right, amount', [(0, 200), (1, 200), (None, 5)])
def test_chest_server_random_paths_replay_and_next_day(client, monkeypatch, right, amount):
    import server as srv
    register(client)
    monkeypatch.setattr(srv, 'now', lambda: '2026-09-30T12:00:00+00:00')
    bits = iter([0, 1, 0, 1, 0, 1, 0, 1] * 5)
    monkeypatch.setattr(srv.secrets, 'randbelow', lambda n: next(bits) if right is None else right)
    state = client.get('/api/chest').get_json()
    assert state['ready'] and state['result'] is None
    assert state['min_amount'] == 5 and state['max_amount'] == 200
    assert state['bonus_launches'] == 3 and state['available_launches'] == 4
    reward = client.post('/api/chest/claim', json={'amount': 999999, 'paths': [[1]]}).get_json()
    assert reward['amount'] == amount
    assert len(reward['result']['paths']) == 5
    assert all(len(path) == 8 for path in reward['result']['paths'])
    assert client.get('/api/wallet').get_json()['drops'] == amount
    assert client.post('/api/chest/claim').status_code == 409
    assert client.get('/api/chest').get_json()['result'] == reward['result']
    assert client.get('/api/wallet').get_json()['drops'] == amount
    monkeypatch.setattr(srv, 'now', lambda: '2026-10-01T00:01:00+00:00')
    monkeypatch.setattr(srv.secrets, 'randbelow', lambda n: 0)
    assert client.get('/api/chest').get_json()['ready']
    assert client.post('/api/chest/claim').get_json()['amount'] == 200
    assert client.get('/api/wallet').get_json()['drops'] == amount + 200


def test_chest_concurrent_claim_is_atomic_and_legacy_reward_is_preserved(client, monkeypatch):
    import server as srv
    from concurrent.futures import ThreadPoolExecutor
    register(client)
    with client.session_transaction() as session:
        uid = session['uid']
    monkeypatch.setattr(srv, 'now', lambda: '2026-09-30T12:00:00+00:00')
    monkeypatch.setattr(srv.secrets, 'randbelow', lambda n: 0)
    def claim(_):
        with srv.app.test_client() as c:
            with c.session_transaction() as s:
                s['uid'] = uid
            return c.post('/api/chest/claim').status_code
    with ThreadPoolExecutor(2) as pool:
        assert sorted(pool.map(claim, range(2))) == [200, 409]
    assert client.get('/api/wallet').get_json()['drops'] == 200
    monkeypatch.setattr(srv, 'now', lambda: '2026-10-01T12:00:00+00:00')
    with srv.app.app_context():
        srv.db().execute('INSERT INTO daily_claims(user_id, day) VALUES (?, ?)', (uid, '2026-10-01'))
        srv.wallet_add(uid, drops=15)
        srv.db().commit()
    assert client.get('/api/chest').get_json()['result'] == {'amount': 15, 'paths': []}
    assert client.post('/api/chest/claim').status_code == 409
    assert client.get('/api/wallet').get_json()['drops'] == 215
    old_board = dict(rows=6, drop_count=5, rewards=[10, 5, 3, 2, 3, 5, 10], paths=[[0]*6]*5, amount=50)
    with srv.app.app_context():
        srv.db().execute('UPDATE daily_claims SET result_json=? WHERE user_id=? AND day=?',
                         (json.dumps(old_board), uid, '2026-10-01'))
        srv.db().commit()
    assert client.get('/api/chest').get_json()['result'] == old_board
    assert client.post('/api/chest/claim').status_code == 409
    assert client.get('/api/wallet').get_json()['drops'] == 215  # Old boards are never re-rolled.


def test_chest_all_paths_have_exact_binomial_rewards(monkeypatch):
    import server as srv
    from itertools import product
    from collections import Counter
    amounts = []
    for path in product((0, 1), repeat=8):
        bits = iter(path)
        monkeypatch.setattr(srv.secrets, 'randbelow', lambda n: next(bits))
        result = srv._roll_chest(1)
        assert result['paths'] == [list(path)]
        amounts.append(result['amount'])
    assert Counter(amounts) == {40: 2, 12: 16, 5: 56, 2: 112, 1: 70}
    assert sum(amounts) == 846  # 846/256 = 3.3046875 per ball; 16.5234375 per ×5.


def test_chest_simulation_checks_all_requested_packs_without_wallets():
    from scripts.simulate_chest import simulate
    result = simulate()
    assert result['balls'] == 4080
    assert result['exact_per_ball'] == 3.3046875
    assert [pack['count'] for pack in result['packs']] == [1, 5, 10, 20, 100]
    assert sum(pack['launches'] for pack in result['packs']) == 150
    for pack in result['packs']:
        assert len(pack['amounts']) == 30
        assert pack['min'] <= pack['median'] <= pack['max']
        assert pack['expected_net_paid'] < 0
        assert 0 < pack['exact_profit_probability'] < 1


def test_chest_launch_prices_bonus_replays_and_boundaries(client, monkeypatch):
    import server as srv
    from itertools import cycle
    assert client.post('/api/chest/launch', json={}).status_code == 401
    register(client)
    monkeypatch.setattr(srv, 'now', lambda: '2026-10-01T12:00:00+00:00')
    bits = cycle([0, 1] * 4)
    monkeypatch.setattr(srv.secrets, 'randbelow', lambda n: next(bits))
    body = dict(kind='paid', count=5, day='2026-10-01', request_key='launch-valid-key-01')
    for bad in ([], None, {**body, 'count': True}, {**body, 'count': 5.0}, {**body, 'count': 101},
                {**body, 'kind': []}, {**body, 'request_key': 'short'}, {**body, 'kind': 'bonus', 'count': 10}):
        assert client.post('/api/chest/launch', json=bad).status_code == 400
    assert client.post('/api/chest/launch', json=body).status_code == 409  # Daily first.
    client.post('/api/chest/claim')
    assert client.post('/api/chest/launch', json=body).status_code == 402
    with client.session_transaction() as s:
        uid = s['uid']
    with srv.app.app_context():
        srv.wallet_add(uid, drops=1000)
        srv.db().commit()
    balance = 1005
    for count, cost in srv.CHEST_PACKS.items():
        request_body = {**body, 'count': count, 'request_key': f'paid-launch-key-{count:03}'}
        result = client.post('/api/chest/launch', json={**request_body, 'cost': 0, 'amount': 999999}).get_json()
        balance += count-cost
        assert (result['cost'], result['net'], result['drops']) == (cost, count-cost, balance)
        assert len(result['result']['paths']) == count and result['result']['amount'] == count
        repeat = client.post('/api/chest/launch', json=request_body).get_json()
        assert repeat['replay'] and repeat['result'] == result['result'] and repeat['drops'] == balance
        assert client.post('/api/chest/launch', json={**request_body, 'kind': 'bonus'}).status_code in (400, 409)
    bonus_body = {**body, 'kind': 'bonus'}
    for i in range(3):
        r = client.post('/api/chest/launch', json={**bonus_body, 'request_key': f'bonus-launch-key-{i:02}'}).get_json()
        balance += 5
        assert r['cost'] == 0 and r['drops'] == balance and r['bonus_launches'] == 2-i
    assert client.post('/api/chest/launch', json={**bonus_body, 'request_key': 'bonus-launch-key-99'}).status_code == 402
    assert client.get('/api/chest').get_json()['bonus_launches'] == 0
    assert client.get('/api/chest').get_json()['last_launch']['request_key'] == 'bonus-launch-key-02'
    # The receipt survives a UTC rollover; new requests require a new free chest.
    monkeypatch.setattr(srv, 'now', lambda: '2026-10-02T00:00:00+00:00')
    assert client.post('/api/chest/launch', json={**bonus_body, 'request_key': 'bonus-launch-key-02'}).get_json()['drops'] == balance
    assert client.post('/api/chest/launch', json={**body, 'request_key': 'new-launch-key-000'}).status_code == 409
    assert client.get('/api/chest').get_json()['bonus_launches'] == 0  # Gift is not daily.
    register(client, name='chest_another')
    assert client.get('/api/chest').get_json()['bonus_launches'] == 3
    assert client.get('/api/chest').get_json()['last_launch'] is None


def test_chest_topic_grants_include_finales_and_old_progress_once(client):
    import server as srv
    register(client)
    assert client.get('/api/chest').get_json()['bonus_launches'] == 3
    topics = {}
    for task, level in srv.TASKS_META.items():
        topics.setdefault(task.split('.')[0], (level, []))[1].append(task)
    chosen = {level: tasks for level, tasks in topics.values()}
    with client.session_transaction() as s:
        uid = s['uid']
    # Old completed topics backfill, but missing even the last finale must not award.
    for level, tasks in chosen.items():
        with srv.app.app_context():
            srv.db().executemany('INSERT INTO progress(user_id,task_id,solved_at) VALUES(?,?,?)',
                                 [(uid, task, srv.now()) for task in tasks[:-1]])
            srv.db().commit()
        before = client.get('/api/chest').get_json()['bonus_launches']
        r = client.post('/api/progress', json={'task_id': tasks[-1], 'solved': True}).get_json()
        assert r['chest_launches_awarded'] == srv.CHEST_TOPIC_LAUNCHES[level]
        assert client.get('/api/chest').get_json()['bonus_launches'] == before + srv.CHEST_TOPIC_LAUNCHES[level]
        client.post('/api/progress', json={'task_id': tasks[-1], 'solved': False})
        assert client.post('/api/progress', json={'task_id': tasks[-1], 'solved': True}).get_json()['chest_launches_awarded'] == 0
    # A completion already in SQLite, not via the new POST path.
    old_tasks = next(tasks for level, tasks in topics.values() if tasks != chosen[level])
    with srv.app.app_context():
        srv.db().executemany('INSERT INTO progress(user_id,task_id,solved_at) VALUES(?,?,?)',
                             [(uid, task, srv.now()) for task in old_tasks])
        srv.db().commit()
    expected = 3 + sum(srv.CHEST_TOPIC_LAUNCHES.values()) + srv.CHEST_TOPIC_LAUNCHES[srv.TASKS_META[old_tasks[0]]]
    assert client.get('/api/chest').get_json()['bonus_launches'] == expected
    assert client.get('/api/chest').get_json()['bonus_launches'] == expected


def test_chest_concurrent_paid_launch_and_failure_rollback(client, monkeypatch):
    import server as srv
    from concurrent.futures import ThreadPoolExecutor
    from itertools import cycle
    register(client)
    monkeypatch.setattr(srv, 'now', lambda: '2026-10-01T12:00:00+00:00')
    bits = cycle([0, 1] * 4)
    monkeypatch.setattr(srv.secrets, 'randbelow', lambda n: next(bits))
    client.post('/api/chest/claim')
    with client.session_transaction() as s:
        uid = s['uid']
    with srv.app.app_context():
        srv.db().execute('UPDATE wallet SET drops=4 WHERE user_id=?', (uid,))
        srv.db().commit()
    body = dict(kind='paid', count=1, day='2026-10-01', request_key='parallel-launch-key')
    def launch(key):
        with srv.app.test_client() as c:
            with c.session_transaction() as s:
                s['uid'] = uid
            return c.post('/api/chest/launch', json={**body, 'request_key': key}).status_code
    with ThreadPoolExecutor(2) as pool:
        assert list(pool.map(launch, [body['request_key']] * 2)) == [200, 200]
    assert client.get('/api/wallet').get_json()['drops'] == 1
    with srv.app.app_context():
        srv.db().execute('UPDATE wallet SET drops=4 WHERE user_id=?', (uid,))
        srv.db().commit()
    with ThreadPoolExecutor(2) as pool:
        assert sorted(pool.map(launch, ['parallel-launch-aaa', 'parallel-launch-bbb'])) == [200, 402]
    # A failure after spending rolls back both ticket consumption and wallet changes.
    def broken(_count=5):
        raise RuntimeError('test random failure')
    monkeypatch.setattr(srv, '_roll_chest', broken)
    with pytest.raises(RuntimeError):
        client.post('/api/chest/launch', json={**body, 'kind': 'bonus', 'count': 5, 'request_key': 'failure-launch-key'})
    assert client.get('/api/chest').get_json()['bonus_launches'] == 3
    assert client.get('/api/wallet').get_json()['drops'] == 1


def test_daily_fact_cached(client, monkeypatch):
    import server as srv
    monkeypatch.setattr(srv, "OPENCODE_BIN", None)
    register(client)
    a = client.get("/api/fact")
    assert a.status_code == 200
    fa = a.get_json()
    assert fa["fact"] and fa["source"] == "fallback"
    b = client.get("/api/fact").get_json()
    assert b["fact"] == fa["fact"]
    assert b["day"] == fa["day"]


def test_daily_fact_returns_fallback_before_ai_generation(client, monkeypatch):
    import server as srv
    scheduled = []

    monkeypatch.setattr(
        srv,
        "call_opencode",
        lambda *_args, **_kwargs: pytest.fail("AI must not run in the request thread"),
    )
    monkeypatch.setattr(
        srv,
        "_schedule_daily_fact_generation",
        lambda day: scheduled.append(day),
        raising=False,
    )
    register(client)

    response = client.get("/api/fact")
    data = response.get_json()

    assert response.status_code == 200
    assert data["fact"] in srv.FACT_FALLBACKS
    assert data["source"] == "fallback"
    assert scheduled == [data["day"]]


def test_daily_fact_slow_ai_runs_once_without_blocking_request(client, monkeypatch):
    import threading
    import time
    import server as srv

    started = threading.Event()
    release = threading.Event()
    finished = threading.Event()
    calls = []

    def slow_generation(*_args, **_kwargs):
        calls.append(True)
        started.set()
        release.wait(timeout=3)
        finished.set()
        return None

    monkeypatch.setattr(srv, "ai_available", lambda: True)
    monkeypatch.setattr(srv, "call_opencode", slow_generation)
    register(client)

    try:
        before = time.perf_counter()
        first = client.get("/api/fact")
        elapsed = time.perf_counter() - before
        second = client.get("/api/fact")

        assert first.status_code == second.status_code == 200
        assert elapsed < 0.75
        assert started.wait(timeout=0.5)
        assert len(calls) == 1
    finally:
        release.set()
    assert finished.wait(timeout=0.5)


def test_daily_fact_background_replaces_cached_fallback(client, monkeypatch):
    import sqlite3
    import server as srv

    monkeypatch.setattr(srv, "OPENCODE_BIN", None)
    register(client)
    initial = client.get("/api/fact").get_json()
    generated = "Python сохраняет читаемость кода благодаря значимым отступам и небольшому числу специальных символов."
    monkeypatch.setattr(srv, "call_opencode", lambda *_args, **_kwargs: (generated, {}))

    srv._generate_daily_fact_background(initial["day"])

    conn = sqlite3.connect(srv.DB_PATH)
    row = conn.execute(
        "SELECT fact, source FROM daily_facts WHERE day = ?", (initial["day"],)
    ).fetchone()
    conn.close()
    assert row == (generated, "ai")


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ('{"reply":"ok"}', {"reply": "ok"}),
        ('text {"reply":"ok"}', None),
        ('```json\n{"reply":"ok"}\n```', {"reply": "ok"}),  # типичный ответ opencode CLI
        ("```\n{\"reply\":\"ok\"}\n```", {"reply": "ok"}),
        ('Here is JSON:\n```json\n{"reply":"ok"}\n```', None),  # prose вокруг ограды
        ('[{"reply":"ok"}]', None),
        ('{"reply":NaN}', None),
        ('{"reply":"ok"} trailing', None),
    ],
)
def test_opencode_json_contract_accepts_only_one_exact_object(client, raw, expected):
    import server as srv

    assert srv._parse_opencode_json(raw) == expected


def test_opencode_run_uses_selected_model(monkeypatch):
    import server as srv

    commands = []

    class Finished:
        returncode = 0

        def communicate(self, timeout):
            return ('> build · model\n{"reply":"готово"}', "")

    def fake_popen(command, **_kwargs):
        commands.append(command)
        return Finished()

    monkeypatch.setattr(srv, "OPENCODE_BIN", "opencode.exe")
    monkeypatch.setattr(srv, "AI_MODEL", "opencode/mimo-v2.6-flash-free")
    monkeypatch.setattr(srv, "AI_REMOTE_ENABLED", True)
    monkeypatch.setattr(srv.subprocess, "Popen", fake_popen)

    assert not srv.ai_available()
    assert srv._run_opencode("prompt") is None
    assert commands == []


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        ("A", "A"),
        ("b)", "B"),
        ("Ответ: c", "C"),
        ("вариант D", "D"),
        ("A или B", None),
        ("думаю, что список", None),
    ],
)
def test_riddle_choice_normalization_is_unambiguous(client, message, expected):
    import server as srv

    assert srv.normalize_riddle_choice(message) == expected


def test_riddle_offline_five_no_drops(client, monkeypatch):
    import server as srv
    monkeypatch.setattr(srv, "OPENCODE_BIN", None)
    register(client)
    before = client.get("/api/wallet").get_json()["drops"]
    start = client.post("/api/riddle/turn", json={"message": ""})
    assert start.status_code == 200
    body = start.get_json()
    assert body["engine"] == "offline"
    assert body["left"] == 4
    assert "Загадка" in body["reply"] or "bool" in body["reply"]
    answers = ["B", "C", "B", "C", "B"]
    last = None
    for letter in answers:
        last = client.post("/api/riddle/turn", json={"message": letter}).get_json()
    assert last["finished"] is True
    assert last["left"] == 0
    status = client.get("/api/riddle/status").get_json()
    assert status["asked"] == 5
    assert status["left"] == 0
    capped = client.post("/api/riddle/turn", json={"message": "A"})
    assert capped.status_code == 200
    assert capped.get_json()["finished"] is True
    after = client.get("/api/wallet").get_json()["drops"]
    assert after == before


def test_riddle_online_verdict_is_server_owned(client, monkeypatch):
    import server as srv

    register(client)
    monkeypatch.setattr(srv, "OPENCODE_BIN", "fake-opencode")
    monkeypatch.setattr(srv, "AI_REMOTE_ENABLED", True, raising=False)

    structured = iter([
        {
            "reply": "**Загадка 1/5.** Вопрос?\n\nA) один\nB) два\nC) три\nD) четыре",
            "answer": "C",
            "finished": False,
        },
        {
            "explanation": "Выражение возвращает третий вариант.",
            "correct": True,
            "next": {
                "reply": "**Загадка 2/5.** Следующий вопрос?\n\nA) да\nB) нет\nC) оба\nD) ни один",
                "answer": "A",
            },
        },
    ])
    monkeypatch.setattr(
        srv,
        "call_opencode_json",
        lambda *_args, **_kwargs: next(structured),
        raising=False,
    )

    # Старый маршрут использует только reply и отдаёт correct=null. Это и есть
    # регрессия, которую должен поймать тест до перехода на структурный контракт.
    legacy = iter([
        ("**Загадка 1/5.** Вопрос?\n\nA) один\nB) два\nC) три\nD) четыре", {}),
        ("Верно! Модель переосмыслила ответ.", {}),
    ])
    monkeypatch.setattr(srv, "call_opencode", lambda *_args, **_kwargs: next(legacy))

    start = client.post("/api/riddle/turn", json={"message": ""})
    assert start.status_code == 200
    result = client.post("/api/riddle/turn", json={"message": "вариант D"})

    assert result.status_code == 200
    body = result.get_json()
    assert body["engine"] == "opencode"
    assert body["correct"] is False
    assert body["reply"].startswith("Неверно.")


def test_riddle_rejects_ambiguous_choice_without_advancing(client, monkeypatch):
    import server as srv

    monkeypatch.setattr(srv, "OPENCODE_BIN", None)
    register(client)
    client.post("/api/riddle/turn", json={"message": ""})

    response = client.post("/api/riddle/turn", json={"message": "A или B"})

    assert response.status_code == 400
    assert client.get("/api/riddle/status").get_json()["asked"] == 1


def test_hint_unlock_flow(client):
    register(client)
    # без капель — 402
    assert client.post("/api/hints/unlock", json={"task_id": "1.2", "level": 2}).status_code == 402
    client.post("/api/chest/claim", json={})  # +15 капель
    r = client.post("/api/hints/unlock", json={"task_id": "1.2", "level": 2})
    assert r.status_code == 200
    unlocked = client.get("/api/hints?task_id=1.2").get_json()["unlocked"]
    assert unlocked == [2]
    # повторная разблокировка бесплатна/идемпотентна
    again = client.post("/api/hints/unlock", json={"task_id": "1.2", "level": 2}).get_json()
    assert again.get("already") is True


def test_achievement_set_grants_item(client):
    register(client)
    for key in ("blitz_15", "first_challenge"):  # комплект «Игрок»
        client.post("/api/achievements/claim", json={"key": key})
    owned = client.get("/api/wallet").get_json()["owned"]
    assert "term_phosphor" in owned


def test_ai_paid_after_free(client, monkeypatch):
    import server as srv
    monkeypatch.setattr(srv, "OPENCODE_BIN", "fake-opencode")
    monkeypatch.setattr(srv, "AI_REMOTE_ENABLED", True, raising=False)
    monkeypatch.setattr(srv, "call_opencode", lambda *args, **kwargs: ("Разберём механизм.", {}))
    register(client)
    task = {"id": "1.1", "type": "дописать код", "prompt": "x", "explanation": "y"}
    for _ in range(3):  # бесплатные
        r = client.post("/api/ai/ask", json={"task": task, "question": "почему?"})
        assert r.get_json()["cost"] == 0
    # 4-й — платный, капель нет → 402
    r4 = client.post("/api/ai/ask", json={"task": task, "question": "ещё"})
    assert r4.status_code == 402
    client.post("/api/chest/claim", json={})  # +15
    r5 = client.post("/api/ai/ask", json={"task": task, "question": "ещё"})
    assert r5.status_code == 200
    assert r5.get_json()["cost"] == 5


def test_memory_clear_is_private_and_preserves_history_quota_and_learning(client, monkeypatch):
    import server as srv
    assert client.get("/api/ai/memory").status_code == 401
    assert client.delete("/api/ai/memory").status_code == 401
    monkeypatch.setattr(srv, "OPENCODE_BIN", "fake-opencode")
    monkeypatch.setattr(srv, "AI_REMOTE_ENABLED", True)
    monkeypatch.setattr(srv, "call_opencode", lambda *a, **kw: ("Разберём механизм.", {"style": "Нужны примеры"}))
    register(client)
    question = {"task": {"id": "1.1"}, "question": "Почему?"}
    for _ in range(srv.AI_FREE_QUESTIONS_PER_DAY):
        assert client.post("/api/ai/ask", json=question).status_code == 200
    client.post("/api/progress", json={"task_id": "1.1", "solved": True})
    client.post("/api/notes", json={"task_id": "1.1", "text": "Моя запись"})
    with srv.app.app_context():
        uid = srv.db().execute("SELECT id FROM users WHERE username = 'tester'").fetchone()[0]
        srv.record_attempt(uid, "1.1", srv.normalize_attempt({"verdict": "неверно", "code": "print(0)"}))
    own_memory = client.get("/api/ai/memory").get_json()["memory"]
    assert own_memory["ai:style"] == "Нужны примеры"
    with srv.app.app_context():
        tables = ("ai_messages", "progress", "notes", "wallet", "attempts")
        before = {table: [tuple(row) for row in srv.db().execute(f"SELECT * FROM {table}")] for table in tables}
    other = srv.app.test_client()
    register(other, "other_student")
    assert other.get("/api/ai/memory").get_json()["memory"] == {}
    # A forged user id cannot clear another account's memory.
    assert other.delete("/api/ai/memory?user_id=1", json={"user_id": 1}).status_code == 200
    assert client.get("/api/ai/memory").get_json()["memory"] == own_memory
    for _ in range(2):
        assert client.delete("/api/ai/memory").get_json() == {"memory": {}}
    with srv.app.app_context():
        after = {table: [tuple(row) for row in srv.db().execute(f"SELECT * FROM {table}")] for table in tables}
    assert after == before
    assert client.get("/api/ai/memory").get_json()["memory"] == {}
    # Clearing memory must not create another free question.
    paid = client.post("/api/ai/ask", json=question).get_json()
    assert paid["cost"] == srv.AI_QUESTION_PRICE and paid["free_left"] == 0


def test_memory_clear_rejects_inflight_answer_then_explicit_retry_clears(client, monkeypatch):
    import server as srv
    import threading
    from concurrent.futures import ThreadPoolExecutor
    register(client)
    with client.session_transaction() as session:
        uid = session["uid"]
    entered, release = threading.Event(), threading.Event()

    def answer(*args, **kwargs):
        entered.set()
        assert release.wait(5)
        return "Посмотрим.", {"style": "Старая заметка"}

    def request(method, path, **kwargs):
        with srv.app.test_client() as worker:
            with worker.session_transaction() as session:
                session["uid"] = uid
            return worker.open(path, method=method, **kwargs).status_code

    monkeypatch.setattr(srv, "call_opencode", answer)
    monkeypatch.setattr(srv, "ai_available", lambda: True)
    with ThreadPoolExecutor(max_workers=2) as pool:
        asking = pool.submit(request, "POST", "/api/ai/ask", json={"task": {"id": "1.1"}, "question": "Почему?"})
        try:
            assert entered.wait(5)
            clearing = pool.submit(request, "DELETE", "/api/ai/memory")
            assert clearing.result(timeout=1) == 503
        finally:
            release.set()
        assert asking.result() == 200
    assert client.get('/api/ai/memory').get_json()['memory']
    assert client.delete('/api/ai/memory').status_code==200
    assert client.get("/api/ai/memory").get_json()["memory"] == {}
    assert len(client.get("/api/ai/history?task_id=1.1").get_json()["messages"]) == 2


def test_ai_unavailable_does_not_charge_or_store_question(client, monkeypatch):
    import server as srv

    monkeypatch.setattr(srv, "OPENCODE_BIN", None)
    register(client)
    before = client.get("/api/wallet").get_json()["drops"]
    response = client.post(
        "/api/ai/ask",
        json={"task": {"id": "1.1", "type": "объяснить поведение"}, "question": "Что такое список?"},
    )

    assert response.status_code == 503
    assert client.get("/api/wallet").get_json()["drops"] == before
    assert client.get("/api/ai/history?task_id=1.1").get_json()["messages"] == []


@pytest.mark.parametrize(
    "payload",
    [
        [1],
        {"question": ["Почему?"], "task": {"id": "1.1"}},
        {"question": "Почему?", "task": ["1.1"]},
        {"question": "Почему?", "task": {"id": ["1.1"]}},
    ],
)
def test_ai_ask_rejects_malformed_json_without_500(client, monkeypatch, payload):
    import server as srv

    monkeypatch.setattr(srv, "OPENCODE_BIN", "fake-opencode")
    monkeypatch.setattr(srv, "AI_REMOTE_ENABLED", True, raising=False)
    register(client)

    response = client.post("/api/ai/ask", json=payload)

    assert response.status_code == 400


def test_ai_requests_for_one_user_have_no_waiting_queue(client, monkeypatch):
    import server as srv
    import threading
    import time
    from concurrent.futures import ThreadPoolExecutor

    active = 0
    maximum_active = 0
    counter_lock = threading.Lock()

    def slow_response(uid, data):
        nonlocal active, maximum_active
        with counter_lock:
            active += 1
            maximum_active = max(maximum_active, active)
        time.sleep(0.03)
        with counter_lock:
            active -= 1
        return uid

    monkeypatch.setattr(srv, "_ai_ask_response_locked", slow_response)

    def call():
        with srv.app.app_context():
            try:return srv._ai_ask_response(17, {})
            except srv.ai_controls.AIBusy:return 'busy'

    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(lambda _: call(), range(2)))
        assert results.count(17)==1 and results.count('busy')==1

    assert maximum_active == 1


def test_ai_prompt_never_contains_task_answer_or_explanation(client):
    import server as srv
    prompt = srv.build_ai_prompt(
        {
            "id": "2.4",
            "type": "определить вывод",
            "prompt": "Что выведет программа?",
            "code": "print(17 % 5, -17 % 5, 17 // 5, -17 // 5)",
            "answer": "2 3 3 -4",
            "explanation": "-17 // 5 округляет вниз",
        },
        "покажи ответ",
        history=[],
        memory={},
        context={},
    )
    assert "2 3 3 -4" not in prompt
    assert "-17 // 5 округляет вниз" not in prompt
    assert '"answer"' not in prompt
    assert '"explanation"' not in prompt
    assert "не добавляй подсказку" in prompt.lower()
    assert "ответь прямо" in prompt.lower()


def test_review_prompt_hides_answer_for_wrong_attempt(client):
    import server as srv
    task = {
        "id": "2.4",
        "type": "определить вывод",
        "prompt": "Что выведет программа?\nprint(17 % 5, -17 % 5, 17 // 5, -17 // 5)",
        "answer": "2 3 3 -4",
    }
    prompt = srv.build_review_prompt(
        task,
        {"verdict": "неверно", "code": "", "text": "3 4 4 -3", "error": "", "output": ""},
    )
    assert "2 3 3 -4" not in prompt
    assert '"answer"' not in prompt


def test_ai_review_redacts_spoiled_answer_for_wrong_attempt(client, monkeypatch):
    import server as srv
    register(client)
    monkeypatch.setattr(srv, "OPENCODE_BIN", "fake-opencode")
    monkeypatch.setattr(srv, "AI_REMOTE_ENABLED", True)
    monkeypatch.setattr(
        srv,
        "call_opencode",
        lambda *args, **kwargs: (
            "Ответ «3 4 4 -3» неверен — правильный: «2 3 3 -4». Пересчитай отрицательное деление.",
            {},
        ),
    )
    r = client.post("/api/ai/review", json={
        "task": {
            "id": "2.4",
            "type": "определить вывод",
            "prompt": "Что выведет программа?\nprint(17 % 5, -17 % 5, 17 // 5, -17 // 5)",
            "answer": "2 3 3 -4",
        },
        "attempt": {"ok": False, "text": "3 4 4 -3", "code": "", "error": "", "got": ""},
    })
    assert r.status_code == 200
    review = r.get_json()["review"]
    assert "2 3 3 -4" not in review
    assert "правильный:" not in review.lower()
    assert "Пересчитай" in review


def test_attempt_memory_keeps_only_current_task_tail(client):
    import server as srv
    register(client, name="attempt_user")
    with srv.app.app_context():
        uid = srv.db().execute("SELECT id FROM users WHERE username = ?", ("attempt_user",)).fetchone()["id"]
        for i in range(6):
            srv.record_attempt(uid, "2.4", {
                "verdict": "неверно",
                "code": "",
                "text": f"wrong-{i}",
                "error": "",
                "output": "",
            })
        srv.record_attempt(uid, "3.1", {
            "verdict": "неверно",
            "code": "",
            "text": "other-topic-attempt",
            "error": "",
            "output": "",
        })
        rows_24 = srv.db().execute(
            "SELECT text FROM attempts WHERE user_id = ? AND task_id = ? ORDER BY id",
            (uid, "2.4"),
        ).fetchall()
        rows_31 = srv.db().execute(
            "SELECT text FROM attempts WHERE user_id = ? AND task_id = ? ORDER BY id",
            (uid, "3.1"),
        ).fetchall()
        history = srv.record_attempt(uid, "2.4", {
            "verdict": "неверно",
            "code": "",
            "text": "current",
            "error": "",
            "output": "",
        })

    assert [r["text"] for r in rows_24] == ["wrong-1", "wrong-2", "wrong-3", "wrong-4", "wrong-5"]
    assert [r["text"] for r in rows_31] == ["other-topic-attempt"]
    assert [h["text"] for h in history] == ["wrong-2", "wrong-3", "wrong-4", "wrong-5"]
    assert "other-topic-attempt" not in [h["text"] for h in history]


def test_review_queue_tracks_latest_wrong_attempts_without_ai(client, monkeypatch):
    import server as srv

    register(client, name="review_user")
    monkeypatch.setattr(srv, "ai_available", lambda: False)

    wrong = {
        "ok": False,
        "code": "",
        "text": "неверный ответ",
        "error": "",
        "got": "",
    }
    first = client.post("/api/attempts", json={"task_id": "2.4", "attempt": wrong})
    second = client.post("/api/attempts", json={"task_id": "2.4", "attempt": wrong})
    other = client.post(
        "/api/attempts",
        json={
            "task_id": "3.1",
            "attempt": {**wrong, "error": "SyntaxError", "text": ""},
        },
    )

    assert first.status_code == second.status_code == other.status_code == 200
    assert isinstance(first.get_json()["attempt_id"], int)
    queue = client.get("/api/review-queue").get_json()
    assert queue["total"] == 2
    assert [item["task_id"] for item in queue["tasks"]] == ["2.4", "3.1"]
    assert queue["tasks"][0]["failed_attempts"] == 2
    assert queue["tasks"][1]["issue"] == "error"

    correct = client.post(
        "/api/attempts",
        json={"task_id": "2.4", "attempt": {**wrong, "ok": True, "text": "2 3 3 -4"}},
    )
    assert correct.status_code == 200
    queue = client.get("/api/review-queue").get_json()
    assert queue["total"] == 1
    assert queue["tasks"][0]["task_id"] == "3.1"


def test_review_history_survives_attempt_tail_and_keeps_only_current_fixes(client):
    assert client.get("/api/review-history").status_code == 401
    register(client, name="fix_owner")
    wrong = {"ok": False, "text": "bad", "got": "0", "code": "", "error": ""}
    def save(task_id, attempt):
        assert client.post("/api/attempts", json={"task_id": task_id, "attempt": attempt}).status_code == 200
    save("3.1", {**wrong, "ok": True})
    assert client.get("/api/review-history").get_json() == {"tasks": [], "total": 0}
    save("2.4", wrong)
    save("2.4", {**wrong, "ok": True})
    history = client.get("/api/review-history").get_json()
    assert history["total"] == 1
    fixed = history["tasks"][0]
    assert set(fixed) == {"task_id", "issue", "last_failed_at", "fixed_at"}
    assert (fixed["task_id"], fixed["issue"]) == ("2.4", "output")
    for _ in range(6):
        save("2.4", {**wrong, "ok": True})
    assert client.get("/api/review-history").get_json() == history
    assert client.get("/api/review-queue").get_json() == {"tasks": [], "total": 0}
    save("2.4", {**wrong, "error": "SyntaxError"})
    assert client.get("/api/review-history").get_json()["total"] == 0
    assert client.get("/api/review-queue").get_json()["total"] == 1
    save("2.4", {**wrong, "ok": True})
    latest = client.get("/api/review-history").get_json()["tasks"][0]
    assert latest["issue"] == "error" and latest["fixed_at"] > fixed["fixed_at"]
    assert client.get("/api/progress").get_json()["solved"] == [], "recording a fix does not award progress"
    client.post("/api/logout")
    register(client, name="another_fix_owner")
    assert client.get("/api/review-history").get_json() == {"tasks": [], "total": 0}


def test_review_history_backfill_uses_actual_first_success_and_is_idempotent(client):
    import server as srv
    register(client, name="historical_fixes")
    with srv.app.app_context():
        uid = srv.db().execute("SELECT id FROM users WHERE username='historical_fixes'").fetchone()["id"]
        for task_id, verdicts in [("2.4", ["неверно", "верно", "верно"]), ("3.1", ["верно"]),
                                 ("3.2", ["неверно", "верно", "неверно"]), ("unknown", ["неверно", "верно"])]:
            for i, verdict in enumerate(verdicts):
                srv.db().execute("INSERT INTO attempts (user_id,task_id,verdict,error,output,created_at) VALUES (?,?,?,?,?,?)",
                                 (uid, task_id, verdict, "", "", f"2026-09-01T12:0{i}:00+00:00"))
        srv.backfill_review_fixes(srv.db())
        srv.backfill_review_fixes(srv.db())
        srv.db().commit()
        assert srv.db().execute("SELECT COUNT(*) FROM review_fixes WHERE user_id=?", (uid,)).fetchone()[0] == 1
    assert client.get("/api/review-history").get_json() == {"total": 1, "tasks": [{
        "task_id": "2.4", "issue": "answer", "last_failed_at": "2026-09-01T12:00:00+00:00",
        "fixed_at": "2026-09-01T12:01:00+00:00"}]}


def test_review_practice_waits_three_full_days_and_get_is_read_only(client, monkeypatch):
    import server as srv
    assert client.get("/api/review-practice").status_code == 401
    register(client, name="spaced_owner")
    def save(ok):
        return client.post("/api/attempts", json={"task_id": "2.4", "attempt": {"ok": ok}})
    monkeypatch.setattr(srv, "now", lambda: "2026-10-01T12:00:00.123456+00:00")
    assert save(False).status_code == save(True).status_code == 200
    baseline = client.get("/api/review-history").get_json()
    progress = client.get("/api/progress").get_json()
    wallet = client.get("/api/wallet").get_json()
    monkeypatch.setattr(srv, "now", lambda: "2026-10-04T12:00:00.123455+00:00")
    assert client.get("/api/review-practice").get_json() == {"tasks": [], "total": 0, "delay_days": 3}
    monkeypatch.setattr(srv, "now", lambda: "2026-10-04T15:00:00.123456+03:00")
    expected = {"delay_days": 3, "total": 1, "tasks": [{
        "task_id": "2.4", "issue": "answer", "fixed_at": "2026-10-01T12:00:00.123456+00:00",
        "due_at": "2026-10-04T12:00:00.123456+00:00"}]}
    assert client.get("/api/review-practice").get_json() == expected
    assert client.get("/api/review-practice").get_json() == expected
    assert client.get("/api/review-history").get_json() == baseline
    assert client.get("/api/progress").get_json() == progress
    assert client.get("/api/wallet").get_json() == wallet


def test_review_practice_success_clears_only_due_fix_without_awarding(client, monkeypatch):
    import server as srv
    register(client, name="spaced_success")
    def save(ok):
        assert client.post("/api/attempts", json={"task_id": "2.4", "attempt": {"ok": ok}}).status_code == 200
    monkeypatch.setattr(srv, "now", lambda: "2026-10-01T12:00:00+00:00")
    save(False)
    save(True)
    history = client.get("/api/review-history").get_json()
    monkeypatch.setattr(srv, "now", lambda: "2026-10-02T12:00:00+00:00")
    for _ in range(6):
        save(True)
    monkeypatch.setattr(srv, "now", lambda: "2026-10-04T12:00:00+00:00")
    assert client.get("/api/review-practice").get_json()["total"] == 1
    progress = client.get("/api/progress").get_json()
    wallet = client.get("/api/wallet").get_json()
    save(True)
    with srv.app.app_context():
        completed = tuple(srv.db().execute("SELECT * FROM review_practice").fetchone())
        srv.db().executescript(srv.SCHEMA)
        srv.db().executescript(srv.SCHEMA)
    for _ in range(6):
        save(True)
    with srv.app.app_context():
        assert tuple(srv.db().execute("SELECT * FROM review_practice").fetchone()) == completed
    assert client.get("/api/review-practice").get_json()["total"] == 0
    assert client.get("/api/review-history").get_json() == history
    monkeypatch.setattr(srv, "now", lambda: "2026-12-01T12:00:00+00:00")
    assert client.get("/api/review-practice").get_json()["total"] == 0
    assert client.get("/api/progress").get_json() == progress
    assert client.get("/api/wallet").get_json() == wallet


def test_review_practice_new_failure_requires_new_fix_and_wait(client, monkeypatch):
    import server as srv
    register(client, name="spaced_new_failure")
    def save(ok):
        assert client.post("/api/attempts", json={"task_id": "2.4", "attempt": {"ok": ok}}).status_code == 200
    monkeypatch.setattr(srv, "now", lambda: "2026-10-01T12:00:00+00:00")
    save(False)
    save(True)
    monkeypatch.setattr(srv, "now", lambda: "2026-10-05T12:00:00+00:00")
    save(True)
    assert client.get("/api/review-practice").get_json()["total"] == 0
    save(False)
    assert client.get("/api/review-practice").get_json()["total"] == 0
    assert client.get("/api/review-queue").get_json()["total"] == 1
    save(True)
    assert client.get("/api/review-queue").get_json()["total"] == 0
    assert client.get("/api/review-practice").get_json()["total"] == 0
    monkeypatch.setattr(srv, "now", lambda: "2026-10-08T12:00:00+00:00")
    assert client.get("/api/review-practice").get_json()["total"] == 1
    save(True)
    assert client.get("/api/review-practice").get_json()["total"] == 0


def test_review_practice_uses_current_known_fixes_and_isolates_users(client, monkeypatch):
    import server as srv
    register(client, name="spaced_history")
    monkeypatch.setattr(srv, "now", lambda: "2026-10-17T12:00:00+00:00")
    with srv.app.app_context():
        uid = srv.db().execute("SELECT id FROM users WHERE username='spaced_history'").fetchone()[0]
        for task_id, fixed_at in [("2.4", "2026-10-02T12:00:00+00:00"),
                                  ("3.1", "2026-10-01T12:00:00+00:00"),
                                  ("3.2", "broken"), ("3.3", "2026-10-01T12:00:00"),
                                  ("unknown", "2026-10-01T12:00:00+00:00")]:
            srv.db().execute("INSERT INTO review_fixes VALUES (?,?,?,?,?)",
                             (uid, task_id, "answer", fixed_at, fixed_at))
        srv.db().commit()
    due = client.get("/api/review-practice").get_json()
    assert due["total"] == 2
    assert [item["task_id"] for item in due["tasks"]] == ["3.1", "2.4"]
    assert all(set(item) == {"task_id", "issue", "fixed_at", "due_at"} for item in due["tasks"])
    client.post("/api/logout")
    register(client, name="spaced_other")
    assert client.get("/api/review-practice").get_json()["total"] == 0
    assert client.post("/api/attempts", json={"task_id": "2.4", "attempt": {"ok": True}}).status_code == 200
    client.post("/api/logout")
    client.post("/api/login", json={"username": "spaced_history", "password": "secret123"})
    assert client.get("/api/review-practice").get_json() == due


def test_attempt_endpoint_rejects_unknown_task_and_isolates_users(client):
    register(client, name="first_review_user")
    attempt = {"ok": False, "text": "нет", "code": "", "error": "", "got": ""}
    assert client.post(
        "/api/attempts", json={"task_id": "999.999", "attempt": attempt}
    ).status_code == 400
    assert client.post(
        "/api/attempts", json={"task_id": "1.2", "attempt": attempt}
    ).status_code == 200

    client.post("/api/logout")
    register(client, name="second_review_user")
    assert client.get("/api/review-queue").get_json() == {"tasks": [], "total": 0}


def test_ai_review_reuses_separately_recorded_attempt(client, monkeypatch):
    import server as srv

    register(client, name="review_once_user")
    attempt = {"ok": False, "text": "3 4 4 -3", "code": "", "error": "", "got": ""}
    saved = client.post(
        "/api/attempts", json={"task_id": "2.4", "attempt": attempt}
    ).get_json()
    monkeypatch.setattr(srv, "ai_available", lambda: True)
    monkeypatch.setattr(srv, "call_opencode", lambda *_args, **_kwargs: ("Проверьте деление.", {}))

    response = client.post(
        "/api/ai/review",
        json={
            "task": {"id": "2.4", "type": "определить вывод", "prompt": "Что выведет код?"},
            "attempt": attempt,
            "attempt_id": saved["attempt_id"],
        },
    )

    assert response.status_code == 200
    with srv.app.app_context():
        count = srv.db().execute("SELECT COUNT(*) AS n FROM attempts").fetchone()["n"]
    assert count == 1


def test_survey_roundtrip(client):
    register(client)
    ans = {"experience": "Знаю основы", "known": ["циклы", "функции"]}
    assert client.post("/api/survey", json={"answers": ans}).status_code == 200
    assert client.get("/api/survey").get_json()["answers"] == ans
    assert client.post("/api/survey", json={"answers": "hack"}).status_code == 400


def test_stats_streak_field(client):
    register(client)
    client.post("/api/progress", json={"task_id": "1.1", "solved": True})
    data = client.get("/api/stats").get_json()
    assert data["streak"] == 1


# ── Парсер коллекции ──────────────────────────────────────────────────────
def _load_build_tasks():
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    spec = importlib.util.spec_from_file_location("build_tasks", ROOT / "build_tasks.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_parser_counts():
    topics = _load_build_tasks().parse()
    total = sum(len(t["tasks"]) for t in topics)
    assert len(topics) >= 40
    assert total >= 300
    assert all(t["tasks"] for t in topics), "у каждой теме есть задания"
    coding = sum(
        1
        for t in topics
        for x in t["tasks"]
        if any(h in x["type"] for h in ("дописать", "написать", "исправить"))
    )
    assert coding >= 140


def test_lambda_precedes_sorting_without_changing_stable_ids():
    topics = _load_build_tasks().parse()
    ids = [topic["id"] for topic in topics]
    assert ids.index(22) + 1 == ids.index(21)
    assert [task["id"] for task in topics[ids.index(22)]["tasks"]][:1] == ["22.1"]
    assert [task["id"] for task in topics[ids.index(21)]["tasks"]][:1] == ["21.1"]


def test_course_order_teaches_prerequisites_before_their_use():
    topics = _load_build_tasks().parse()
    ids = [topic["id"] for topic in topics]
    assert len(ids) == len(set(ids)) == 66
    assert set(ids) == set(range(66))
    # Срезы → генераторы, классы → протоколы, аннотации → dataclass,
    # замыкания → декораторы, генераторы → contextmanager.
    for prerequisite, dependent in [(9, 41), (41, 28), (22, 21), (32, 27),
                                    (32, 31), (27, 34), (28, 39), (37, 36), (30, 29), (28, 31), (49, 52), (52, 53), (55, 61), (59, 61), (51, 62), (61, 62), (62, 63), (60, 64), (61, 65)]:
        assert ids.index(prerequisite) < ids.index(dependent)


def test_curriculum_checks_reject_incomplete_or_wrong_solutions():
    import contextlib
    import io

    builder = _load_build_tasks()
    tasks = {task["id"]: task for topic in builder.parse() for task in topic["tasks"]}
    checks = builder._load_support_content()["checks"]
    wrong = {
        "4.7": "def shout(s): return s + '!'",
        "13.2": "def absolute_difference(a, b): return a - b",
        "13.3": "def min_max(values): return (max(values), min(values))",
        "35.6": tasks["35.6"]["code"],
        "37.3": "def total(numbers): return sum(numbers)",
        "40.5": "def first_duplicate(values): return None",
        "44.4": "def top_word(text): return text.split()[0]",
        "45.16": tasks["45.16"]["code"],
    }
    for task_id, bad_code in wrong.items():
        check = tasks[task_id].get("check") or checks[task_id]
        out = io.StringIO()
        if check["expect"].strip() == "OK":
            namespace = {}
            with contextlib.redirect_stdout(io.StringIO()):
                exec(builder._reference_program(tasks[task_id]), namespace)
            with contextlib.redirect_stdout(out):
                exec(check["append"], namespace)
        else:
            with contextlib.redirect_stdout(out):
                exec(builder._reference_program(tasks[task_id]) + "\n" + check["append"], {})
        assert out.getvalue().strip() == check["expect"], task_id
        for incomplete in (bad_code, "pass"):
            with contextlib.redirect_stdout(io.StringIO()):
                with pytest.raises((AssertionError, NameError, AttributeError)):
                    exec(incomplete + "\n" + check["append"], {})

    # Ошибка диапазона должна проявляться уже на исходных данных.
    bad, good = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(bad):
        exec(tasks["5.8"]["code"], {})
    with contextlib.redirect_stdout(good):
        exec(builder._reference_program(tasks["5.8"]), {})
    assert bad.getvalue() != good.getvalue()


def test_topic_audit_uses_current_challenge_catalog():
    import runpy

    audit = runpy.run_path(str(ROOT / "platform" / "scripts" / "audit_topics.py"))
    assert 4 in audit["challenge_topics"]()
    assert 7 not in audit["challenge_topics"]()


def test_parser_task_fields():
    topics = _load_build_tasks().parse()
    for topic in topics:
        assert topic["level"] in ("beginner", "intermediate", "advanced", "expert")
        for task in topic["tasks"]:
            assert task["id"].startswith(str(topic["id"]) + ".")
            assert task["type"], f"{task['id']}: пустой тип"
            assert task.get("title"), f"{task['id']}: пустое название этапа"
            assert task["prompt"], f"{task['id']}: пустое условие"
            assert task["answer"], f"{task['id']}: пустой ответ"
            assert task["explanation"], f"{task['id']}: пустое объяснение"


def test_explanation_tasks_have_short_authored_rubrics():
    tasks = [task for topic in _load_build_tasks().parse() for task in topic['tasks']
             if task['type'] == 'объяснить поведение']
    assert len(tasks) == 27
    for task in tasks:
        _, rubric = task['prompt'].split('**Что важно объяснить:**')
        points = [line for line in rubric.splitlines() if line.startswith('- ')]
        assert 2 <= len(points) <= 3, task['id']
        assert all(len(point) < 200 for point in points), task['id']


def test_task_2_4_answer_matches_cpython_stdout():
    import contextlib
    import io
    topics = _load_build_tasks().parse()
    task = next(t for topic in topics for t in topic["tasks"] if t["id"] == "2.4")
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        exec(task["code"], {})

    assert buf.getvalue().strip() == task["answer"] == "2 3 3 -4"


def test_task_2_3_has_authored_wrong_choices():
    topics = _load_build_tasks().parse()
    task = next(t for topic in topics for t in topic["tasks"] if t["id"] == "2.3")
    assert task["answer"] == "3.14 7"
    assert "Функция `round" not in task["prompt"]  # без спойлера в условии
    wrong = task.get("wrong") or []
    assert set(wrong) == {"3.14 -7", "3.14159 7", "3.15 7"}
    assert task["answer"] not in wrong


def test_prediction_tasks_have_authored_wrong_choices():
    """У коротких «определить вывод» есть ≥2 ловушки (не «ответ±1»)."""
    topics = _load_build_tasks().parse()
    checked = 0
    for topic in topics:
        for task in topic["tasks"]:
            if task["type"] != "определить вывод":
                continue
            ans = (task.get("answer") or "").strip()
            if not ans or ans.count("\n") > 1:
                continue
            wrong = task.get("wrong") or []
            assert len(wrong) >= 2, f"{task['id']}: мало ловушек {wrong!r}"
            assert ans not in wrong, f"{task['id']}: правильный ответ среди wrong"
            checked += 1
    assert checked >= 100


def test_parser_levels_moved_by_review():
    """Ревью: рекурсия — продвинутый, контекстные менеджеры — средний, генераторы — экспертный.

    После перестановки тем в коллекции: рекурсия = 25, контекстные менеджеры = 31
    (24 — даты/время, 30 — замыкания).
    """
    topics = {t["id"]: t for t in _load_build_tasks().parse()}
    assert topics[25]["title"].lower().startswith("рекурсия")
    assert topics[25]["level"] == "advanced"
    assert "контекстн" in topics[31]["title"].lower()
    assert topics[31]["level"] == "intermediate"
    assert topics[27]["level"] == "expert"
    assert topics[28]["level"] == "expert"
    assert topics[28]["title"].lower().startswith("генератор")


def test_mobile_content_bundle_merges_course_support_data_and_hashes_deterministically():
    builder = _load_build_tasks()
    topics = builder.parse()

    first = builder.build_mobile_bundle(topics)
    second = builder.build_mobile_bundle(topics)

    assert first == second
    assert first["schema_version"] == 2
    assert first["python_runtime"] == "3.14.x"
    assert re.fullmatch(r"sha256:[0-9a-f]{64}", first["content_hash"])
    assert first["content_version"] == first["content_hash"][7:23]
    topic = next(item for item in first["topics"] if item["id"] == 1)
    assert topic["theory"]["text"]
    task_1_1 = next(item for item in topic["tasks"] if item["id"] == "1.1")
    assert task_1_1["hint"]
    assert task_1_1["intro"]["text"]
    task_0_9 = next(
        task
        for item in first["topics"]
        for task in item["tasks"]
        if task["id"] == "0.9"
    )
    assert task_0_9["questions"] and len(task_0_9["questions"]) >= 3
    assert task_0_9["questions"][0]["wrong"]
    task_3_5 = next(
        task
        for item in first["topics"]
        for task in item["tasks"]
        if task["id"] == "3.5"
    )
    assert task_3_5["check"]["expect"] == "OK"
    assert "is_even" in task_3_5["check"]["append"]
    task_4_5 = next(
        task
        for item in first["topics"]
        for task in item["tasks"]
        if task["id"] == "4.5"
    )
    assert task_4_5["check"]["expect"] == "OK"
    assert "reverse" in task_4_5["check"]["append"]


def test_mobile_content_schema_declares_atomic_versioned_contract():
    schema_path = ROOT / "docs" / "mobile-content-bundle.schema.json"
    schema = json.loads(schema_path.read_text(encoding="utf-8"))

    assert schema["$id"] == "https://pythonclouds.ru/schemas/mobile-content-bundle-v2.json"
    assert schema["properties"]["schema_version"]["const"] == 2
    assert set(schema["required"]) == {
        "schema_version", "content_version", "content_hash", "python_runtime", "topics"
    }


def test_mobile_executable_references_pass_cpython314():
    builder = _load_build_tasks()

    result = builder.verify_mobile_tasks(builder.parse())

    assert result["python"].startswith("3.14")
    assert result["checked"] >= 250


# ── ИИ-урок этапа и задания дня ───────────────────────────────────────────
def test_lesson_cache(client, monkeypatch):
    import server as srv
    monkeypatch.setattr(srv, "ai_available", lambda: False)
    register(client)
    # без ИИ и без кэша — lesson: None
    r = client.post("/api/ai/lesson", json={"task": {"id": "1.1", "type": "дописать код", "prompt": "x"}})
    assert r.status_code == 200
    assert r.get_json()["lesson"] is None
    # Старый кэш без версии сохраняется, но актуальность его текста неизвестна.
    import sqlite3
    conn = sqlite3.connect(srv.DB_PATH)
    conn.execute("INSERT INTO ai_lessons (task_id, text, created_at) VALUES ('1.1', 'урок', 'now')")
    conn.commit()
    conn.close()
    r2 = client.post("/api/ai/lesson", json={"task": {"id": "1.1", "type": "дописать код", "prompt": "x"}})
    assert r2.get_json() == {"lesson": None, "cached": False}
    monkeypatch.setattr(srv, "ai_available", lambda: True)
    monkeypatch.setattr(srv, "call_opencode", lambda *a, **kw: ("новый урок", None))
    assert client.post("/api/ai/lesson", json={"task": {"id": "1.1", "type": "дописать код", "prompt": "x"}}).get_json() == {"lesson": "новый урок", "cached": False}
    monkeypatch.setattr(srv, "ai_available", lambda: False)
    assert client.post("/api/ai/lesson", json={"task": {"id": "1.1", "type": "дописать код", "prompt": "x"}}).get_json() == {"lesson": "новый урок", "cached": True}
    assert client.post("/api/ai/lesson", json={"task": {"id": "zzz"}}).status_code == 400


def test_daily_ai_fallback_and_solve(client, monkeypatch):
    import server as srv
    monkeypatch.setattr(srv, "OPENCODE_BIN", None)  # офлайн → фолбэк-пул
    register(client)
    r = client.get("/api/daily-ai").get_json()
    assert set(r["tasks"]) == {"intermediate", "advanced", "expert"}
    for t in r["tasks"].values():
        assert t["title"] and t["prompt"] and t["tests"]
        assert "solution" not in t  # эталон клиенту не отдаём
    assert r["solved"] == []
    assert r["drops"] == {"intermediate": 30, "advanced": 50, "expert": 80}
    # решение: капли один раз в день
    s1 = client.post("/api/daily-ai/solve", json={"difficulty": "expert", "day": r["day"]}).get_json()
    assert s1["awarded"] == 80
    s2 = client.post("/api/daily-ai/solve", json={"difficulty": "expert", "day": r["day"]}).get_json()
    assert s2["awarded"] == 0
    assert client.get("/api/daily-ai").get_json()["solved"] == ["expert"]
    assert client.post("/api/daily-ai/solve", json={"difficulty": "nope"}).status_code == 400


def test_daily_ai_tasks_stable_within_day(client, monkeypatch):
    import server as srv
    monkeypatch.setattr(srv, "OPENCODE_BIN", None)
    register(client)
    a = client.get("/api/daily-ai").get_json()["tasks"]
    b = client.get("/api/daily-ai").get_json()["tasks"]
    assert a == b  # в течение дня задания не меняются
