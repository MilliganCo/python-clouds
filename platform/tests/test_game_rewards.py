"""Mini-game rewards keep per-game daily limits and serialize concurrent claims."""
from concurrent.futures import ThreadPoolExecutor
import sqlite3
from threading import Barrier

import pytest

from test_platform import client, register


def user_id(client):
    with client.session_transaction() as session:
        return session['uid']


def result(client, score, game='blitz'):
    response = client.post('/api/game/result', json={'score': score, 'game': game})
    assert response.status_code == 200, response.get_json()
    payload = response.get_json()
    assert set(payload) == {'ok', 'awarded', 'cap_left', 'best'}
    assert payload['ok'] is True
    return payload


def test_partial_limit_replays_zero_score_and_best_remain_compatible(client):
    register(client)
    assert result(client, 12) == {'ok': True, 'awarded': 12, 'cap_left': 18, 'best': 12}
    assert result(client, 12) == {'ok': True, 'awarded': 12, 'cap_left': 6, 'best': 12}
    assert result(client, 12) == {'ok': True, 'awarded': 6, 'cap_left': 0, 'best': 12}
    assert result(client, 60) == {'ok': True, 'awarded': 0, 'cap_left': 0, 'best': 60}
    assert result(client, 0) == {'ok': True, 'awarded': 0, 'cap_left': 0, 'best': 60}
    assert client.get('/api/wallet').get_json()['drops'] == 30


def test_score_clamp_and_omitted_game_keep_legacy_contract(client):
    register(client)
    assert result(client, -100) == {'ok': True, 'awarded': 0, 'cap_left': 30, 'best': 0}
    response = client.post('/api/game/result', json={'score': '99'})
    assert response.get_json() == {'ok': True, 'awarded': 30, 'cap_left': 0, 'best': 60}
    assert result(client, 1000)['best'] == 60


def test_all_five_games_have_independent_caps_and_users_do_not_share_them(client):
    import server as srv
    register(client, name='game_owner')
    owner = user_id(client)
    before_xp = client.get('/api/progress').get_json()['xp']
    assert srv.GAMES == {'blitz', 'order', 'match', 'trace', 'fill'}
    for game in sorted(srv.GAMES):
        assert result(client, 60, game)['awarded'] == 30
    assert client.get('/api/wallet').get_json()['drops'] == 150
    assert client.get('/api/progress').get_json()['xp'] == before_xp
    client.post('/api/logout')
    register(client, name='game_other')
    assert result(client, 60)['awarded'] == 30
    assert client.get('/api/wallet').get_json()['drops'] == 30
    with sqlite3.connect(srv.DB_PATH) as connection:
        assert connection.execute('SELECT drops FROM wallet WHERE user_id=?', (owner,)).fetchone()[0] == 150


def test_new_utc_day_has_a_fresh_cap_and_keeps_previous_day(client, monkeypatch):
    import server as srv
    register(client)
    moment = ['2026-10-23T23:59:59+00:00']
    monkeypatch.setattr(srv, 'now', lambda: moment[0])
    assert result(client, 60)['awarded'] == 30
    moment[0] = '2026-10-24T00:00:00+00:00'
    assert result(client, 60)['awarded'] == 30
    uid = user_id(client)
    with sqlite3.connect(srv.DB_PATH) as connection:
        assert connection.execute('SELECT day,drops FROM game_log WHERE user_id=? ORDER BY day', (uid,)).fetchall() == [
            ('2026-10-23:blitz', 30), ('2026-10-24:blitz', 30)]


def test_old_rewards_and_history_are_retained_when_the_limit_increases(client, monkeypatch):
    import server as srv
    register(client)
    uid = user_id(client)
    monkeypatch.setattr(srv, 'now', lambda: '2026-10-23T12:00:00+00:00')
    with sqlite3.connect(srv.DB_PATH) as connection:
        connection.execute('INSERT OR REPLACE INTO wallet(user_id,drops,freezes) VALUES (?,40,2)', (uid,))
        connection.executemany('INSERT INTO game_log(user_id,day,drops,best_score) VALUES (?,?,?,?)', [
            (uid, '2026-10-22:blitz', 15, 20), (uid, '2026-10-23:blitz', 15, 20)])
        connection.execute('INSERT INTO drop_awards(user_id,task_id) VALUES (?,?)', (uid, '0.1'))
    assert result(client, 30) == {'ok': True, 'awarded': 15, 'cap_left': 0, 'best': 30}
    with sqlite3.connect(srv.DB_PATH) as connection:
        assert connection.execute('SELECT drops,freezes FROM wallet WHERE user_id=?', (uid,)).fetchone() == (55, 2)
        assert connection.execute('SELECT drops,best_score FROM game_log WHERE user_id=? AND day=?', (uid, '2026-10-22:blitz')).fetchone() == (15, 20)
        assert connection.execute('SELECT task_id FROM drop_awards WHERE user_id=?', (uid,)).fetchall() == [('0.1',)]


def test_parallel_claims_cannot_exceed_the_cap_even_when_unlocked_reads_overlap(client, monkeypatch):
    """Old code deterministically reads the same balance twice; locked reads never wait."""
    import server as srv
    register(client)
    uid = user_id(client)
    # Isolate the race itself from the independently tested cap-size change.
    monkeypatch.setattr(srv, 'GAME_DAILY_CAP', 30)
    monkeypatch.setattr(srv, 'now', lambda: '2026-10-23T12:00:00+00:00')
    original_connect = sqlite3.connect
    unlocked_reads = Barrier(2)
    start = Barrier(2)

    class CachedRow:
        def __init__(self, row):
            self.row = row

        def fetchone(self):
            return self.row

    class RacingConnection(sqlite3.Connection):
        def execute(self, sql, parameters=()):
            cursor = super().execute(sql, parameters)
            normalized = ' '.join(sql.split())
            if normalized.startswith('SELECT drops, best_score FROM game_log ') and not self.in_transaction:
                # Cache the old snapshot before either request writes. Never place
                # a barrier inside BEGIN IMMEDIATE: the second writer must wait.
                row = cursor.fetchone()
                cursor.close()
                unlocked_reads.wait(timeout=5)
                return CachedRow(row)
            return cursor

    def racing_connect(*args, **kwargs):
        kwargs['factory'] = RacingConnection
        return original_connect(*args, **kwargs)

    monkeypatch.setattr(srv.sqlite3, 'connect', racing_connect)

    def submit(score):
        with srv.app.test_client() as player:
            with player.session_transaction() as session:
                session['uid'] = uid
            start.wait(timeout=5)
            return result(player, score)

    with ThreadPoolExecutor(max_workers=2) as pool:
        replies = list(pool.map(submit, [29, 60]))
    assert sum(reply['awarded'] for reply in replies) == 30
    assert all(0 <= reply['cap_left'] <= 30 for reply in replies)
    with original_connect(srv.DB_PATH) as connection:
        assert connection.execute('SELECT drops,best_score FROM game_log WHERE user_id=? AND day=?', (uid, '2026-10-23:blitz')).fetchone() == (30, 60)
        assert connection.execute('SELECT drops FROM wallet WHERE user_id=?', (uid,)).fetchone()[0] == 30


def test_wallet_failure_rolls_back_daily_claim_and_wallet_creation_together(client, monkeypatch):
    import server as srv
    register(client)
    uid = user_id(client)
    with sqlite3.connect(srv.DB_PATH) as connection:
        connection.execute('DELETE FROM wallet WHERE user_id=?', (uid,))
    original = srv.wallet_add

    def failed_wallet(user, drops=0, freezes=0):
        original(user, drops=drops, freezes=freezes)
        raise RuntimeError('synthetic wallet failure')

    monkeypatch.setattr(srv, 'wallet_add', failed_wallet)
    with pytest.raises(RuntimeError, match='synthetic wallet failure'):
        result(client, 60)
    with sqlite3.connect(srv.DB_PATH) as connection:
        assert connection.execute('SELECT * FROM game_log WHERE user_id=?', (uid,)).fetchall() == []
        assert connection.execute('SELECT * FROM wallet WHERE user_id=?', (uid,)).fetchall() == []
    monkeypatch.setattr(srv, 'wallet_add', original)
    assert result(client, 60)['awarded'] == 30


def test_auth_and_unknown_game_rejections_do_not_award(client):
    import server as srv
    assert client.post('/api/game/result', json={'score': 60}).status_code == 401
    register(client, name='game_session')
    assert client.post('/api/game/result', json={'score': 60, 'game': 'hack'}).status_code == 400
    assert client.post('/api/game/result', json={'score': 60}, headers={'X-Pycloud-User': 'someone_else'}).status_code == 409
    with sqlite3.connect(srv.DB_PATH) as connection:
        assert connection.execute('SELECT * FROM game_log').fetchall() == []
