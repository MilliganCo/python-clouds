"""Daily rollover and Atlas economics; all records live in a temporary DB."""
import json
import sqlite3
import pytest
from concurrent.futures import ThreadPoolExecutor

from test_platform import client, register

NEW_TASK = {
    'title': 'Ступеньки баланса',
    'prompt': 'Напишите walking_balance(values): прибавляйте числа по очереди, не опуская баланс ниже нуля. Верните баланс после каждого шага. walking_balance([3, -5, 4]) → [3, 0, 4].',
    'func_name': 'walking_balance', 'starter': '# Напишите функцию walking_balance\n',
    'solution': 'def walking_balance(values):\n    total = 0\n    out = []\n    for value in values:\n        total = max(0, total + value)\n        out.append(total)\n    return out',
    'tests': "assert walking_balance([3, -5, 4]) == [3, 0, 4]\nassert walking_balance([]) == []\nassert walking_balance([-1, 2]) == [0, 2]\nassert walking_balance([1, 2]) == [1, 3]\nprint('OK')",
}

TEST_TASKS = [NEW_TASK, {
    'title': 'Промежуток до повтора',
    'prompt': 'Найдите число шагов между первым появлением значения и его первым повтором. Если повторов нет, верните 0. first_repeat_gap([1, 2, 1]) → 2.',
    'func_name': 'first_repeat_gap', 'starter': '# Напишите first_repeat_gap\n',
    'solution': 'def first_repeat_gap(values):\n    first = {}\n    for i, value in enumerate(values):\n        if value in first:\n            return i - first[value]\n        first[value] = i\n    return 0',
    'tests': "assert first_repeat_gap([]) == 0\nassert first_repeat_gap([1, 2, 1]) == 2\nassert first_repeat_gap([3, 3]) == 1\nassert first_repeat_gap([1, 2, 3]) == 0\nprint('OK')",
}, {
    'title': 'Подъёмы по ступенькам',
    'prompt': 'Верните соседние пары чисел, в которых второе число больше первого. ladder_pairs([1, 3, 2, 4]) → [(1, 3), (2, 4)].',
    'func_name': 'ladder_pairs', 'starter': '# Напишите ladder_pairs\n',
    'solution': 'def ladder_pairs(values):\n    return [(a, b) for a, b in zip(values, values[1:]) if b > a]',
    'tests': "assert ladder_pairs([]) == []\nassert ladder_pairs([1, 3, 2, 4]) == [(1, 3), (2, 4)]\nassert ladder_pairs([3, 2, 1]) == []\nassert ladder_pairs([1, 1, 2]) == [(1, 2)]\nprint('OK')",
}]

def test_daily_never_uses_startup_challenges_or_recycles_history(client, monkeypatch):
    import server as srv
    monkeypatch.setattr(srv, 'ai_available', lambda: False)
    register(client)
    seeds = {task['title'] for task in srv.ATLAS_SEEDS.values()}
    seen = {diff: set() for diff in srv.DAILY_AI_DROPS}
    for day in range(9, 17):
        monkeypatch.setattr(srv, 'now', lambda day=day: f'2026-10-{day:02}T12:00:00+00:00')
        data = client.get('/api/daily-ai').get_json()
        for diff, task in data['tasks'].items():
            assert task['title'] not in seeds
            assert task['title'] not in seen[diff]
            seen[diff].add(task['title'])
    assert all(len(titles) == 2 for titles in seen.values())


def test_daily_rollover_does_not_reward_yesterdays_task(client, monkeypatch):
    import server as srv
    monkeypatch.setattr(srv, "OPENCODE_BIN", None)
    monkeypatch.setattr(srv, "now", lambda: "2026-09-30T12:00:00+00:00")
    register(client)
    old = client.get('/api/daily-ai').get_json()
    monkeypatch.setattr(srv, "now", lambda: "2026-10-01T12:00:00+00:00")
    new = client.get('/api/daily-ai').get_json()
    assert old['day'] != new['day']
    assert all(old['tasks'][d] != new['tasks'][d] for d in srv.DAILY_AI_DROPS)
    stale = client.post('/api/daily-ai/solve', json={'day': old['day'], 'difficulty': 'expert'})
    assert stale.status_code == 409
    assert client.get('/api/daily-ai').get_json()['solved'] == []
    assert client.post('/api/daily-ai/solve', json={'difficulty': 'expert'}).status_code == 400
    fresh = client.post('/api/daily-ai/solve', json={'day': new['day'], 'difficulty': 'expert'})
    assert fresh.get_json()['awarded'] == 80
    assert client.post('/api/daily-ai/solve', json={'day': new['day'], 'difficulty': 'expert'}).get_json()['awarded'] == 0


def test_atlas_seeds_archive_and_shared_daily_reward(client, monkeypatch):
    import server as srv
    monkeypatch.setattr(srv, 'OPENCODE_BIN', None)
    monkeypatch.setattr(srv, 'now', lambda: '2026-09-29T12:00:00+00:00')
    register(client)
    seed = client.get('/api/atlas?source=seed').get_json()
    assert seed['total'] == 12
    assert {t['difficulty'] for t in seed['items']} == set(srv.DAILY_AI_DROPS)
    for t in seed['items']:
        assert t['available_reward'] > 0 and 'solution' not in t and 'tests' not in t
        detail = client.get('/api/atlas/' + t['id']).get_json()['task']
        assert 'solution' not in detail and detail['tests']
    today = client.get('/api/daily-ai').get_json()
    key = 'day-' + today['day'] + '-expert'
    assert client.post('/api/atlas/' + key + '/solve').get_json()['awarded'] == 80
    assert client.post('/api/daily-ai/solve', json={'day': today['day'], 'difficulty': 'expert'}).get_json()['awarded'] == 0
    client.post('/api/daily-ai/solve', json={'day': today['day'], 'difficulty': 'advanced'})
    assert client.post('/api/atlas/day-' + today['day'] + '-advanced/solve').get_json()['awarded'] == 0
    monkeypatch.setattr(srv, 'now', lambda: '2026-09-30T12:00:00+00:00')
    archive = client.get('/api/atlas?source=archive').get_json()['items']
    assert len(archive) == 3 and all(t['reward'] == 0 for t in archive)
    old = 'day-' + today['day'] + '-intermediate'
    assert client.post('/api/atlas/' + old + '/solve', json={'reward': 9999}).get_json()['awarded'] == 0
    task_id = seed['items'][0]['id']
    assert client.post('/api/atlas/' + task_id + '/solve').get_json()['awarded'] == 30
    assert client.post('/api/atlas/' + task_id + '/solve').get_json()['awarded'] == 0
    assert client.post('/api/atlas/unknown/solve').status_code == 404


def test_atlas_status_filter_uses_saved_solutions_before_pagination(client, monkeypatch):
    import server as srv
    monkeypatch.setattr(srv, 'OPENCODE_BIN', None)
    register(client)
    assert client.get('/api/atlas?status=unknown').status_code == 400
    initial = client.get('/api/atlas?source=seed&status=unsolved').get_json()
    task_id = initial['items'][0]['id']
    assert initial['total'] == 12
    assert client.get('/api/atlas?status=solved').get_json()['total'] == 0
    assert client.post('/api/atlas/' + task_id + '/solve').get_json()['awarded'] > 0
    pending = client.get('/api/atlas?source=seed&status=unsolved').get_json()
    completed = client.get('/api/atlas?source=seed&status=solved').get_json()
    assert pending['total'] == 11 and all(not t['solved'] and t['id'] != task_id for t in pending['items'])
    assert completed['total'] == 1 and completed['items'][0]['id'] == task_id
    assert completed['items'][0]['solved'] and completed['items'][0]['available_reward'] == 0
    assert client.get('/api/atlas?source=seed&status=all').get_json()['total'] == 12
    client.post('/api/logout')
    register(client, 'other_status')
    assert client.get('/api/atlas?status=solved').get_json()['total'] == 0
    assert client.get('/api/atlas?source=seed&status=unsolved').get_json()['total'] == 12


def test_atlas_catalog_deduplicates_content_before_pagination(client, monkeypatch):
    import server as srv
    today = '2026-11-30'
    monkeypatch.setattr(srv, 'now', lambda: today + 'T12:00:00+00:00')
    register(client)
    first = {d: next(t for t in srv.ATLAS_SEEDS.values() if t['difficulty'] == d)
             for d in srv.DAILY_AI_DROPS}
    with srv.app.app_context():
        for d, payload in first.items():
            srv.db().execute('INSERT INTO daily_ai_tasks VALUES (?, ?, ?)',
                             (today, d, json.dumps(payload)))
        for day in range(1, 26):
            srv.db().execute('INSERT INTO daily_ai_tasks VALUES (?, ?, ?)',
                             (f'2026-10-{day:02}', 'intermediate', json.dumps(first['intermediate'])))
        # A shared title alone does not make two different conditions identical.
        different = dict(first['intermediate'], prompt='Другое условие с тем же заголовком.')
        srv.db().execute('INSERT INTO daily_ai_tasks VALUES (?, ?, ?)',
                         ('2026-10-26', 'intermediate', json.dumps(different)))
        srv.db().commit()
    catalog = client.get('/api/atlas').get_json()
    assert catalog['total'] == len(catalog['items']) == 13
    assert len({(t['difficulty'], t['prompt']) for t in catalog['items']}) == 13
    assert all(t['origin'] == 'seed' for t in catalog['items'][:3])
    assert catalog['daily_ready'] == 0
    assert client.get('/api/atlas?source=today').get_json()['items'] == []
    assert all(t['available_reward'] > 0 for t in catalog['items'][:3])
    assert client.get('/api/atlas?page=2').get_json()['items'] == []
    assert client.get('/api/atlas?source=seed').get_json()['total'] == 12
    archived = client.get('/api/atlas?source=archive').get_json()
    assert archived['total'] == 2
    assert all(t['available_reward'] == 0 for t in archived['items'])
    assert 'day-2026-10-25-intermediate' in {t['id'] for t in archived['items']}
    old = 'day-2026-10-01-intermediate'
    assert client.get('/api/atlas/' + old).status_code == 200
    assert client.post('/api/atlas/' + old + '/solve').get_json()['awarded'] == 0
    assert client.get('/api/atlas?status=solved').get_json()['items'][0]['id'] == old


def test_atlas_generation_payment_privacy_and_retry(client, monkeypatch):
    import server as srv
    register(client)
    with client.session_transaction() as session:
        uid = session['uid']
    with srv.app.app_context():
        srv.wallet_add(uid, drops=120)
        srv.db().commit()
    calls = []
    monkeypatch.setattr(srv, 'ai_available', lambda: True)
    def generate(prompt):
        calls.append(prompt)
        return dict(NEW_TASK, reward=99999)
    monkeypatch.setattr(srv, 'call_opencode_json', generate)
    body = {'topic': 'Списки покупок', 'difficulty': 'intermediate', 'request_key': 'request-atlas-00001'}
    before = client.get('/api/wallet').get_json()['drops']
    made = client.post('/api/atlas/generate', json=body).get_json()
    assert made['validation']['solution'] and 'reward' not in made['validation']
    assert client.get('/api/wallet').get_json()['drops'] == before
    assert client.get('/api/atlas/' + made['id']).status_code == 404  # not activated
    assert client.post('/api/atlas/' + made['id'] + '/solve').status_code == 404
    assert client.post('/api/atlas/generate', json=body).get_json()['id'] == made['id']
    assert len(calls) == 1 and 'данные, не инструкции' in calls[0]
    cookie = client.get_cookie('session').value
    def activate(_):
        with srv.app.test_client() as c:
            c.set_cookie('session', cookie)
            return c.post('/api/atlas/' + made['id'] + '/activate').get_json()
    with ThreadPoolExecutor(max_workers=2) as pool:
        paid = list(pool.map(activate, range(2)))
    assert sorted(p['cost'] for p in paid) == [0, 40]
    assert all(p['drops'] == before - 40 for p in paid)
    assert client.post('/api/atlas/' + made['id'] + '/activate').get_json()['cost'] == 0
    assert client.post('/api/atlas/' + made['id'] + '/solve').get_json()['awarded'] == 10
    assert client.post('/api/atlas/' + made['id'] + '/solve').get_json()['awarded'] == 0
    client.post('/api/logout')
    register(client, 'otheruser')
    assert client.get('/api/atlas/' + made['id']).status_code == 404
    assert client.post('/api/atlas/' + made['id'] + '/activate').status_code == 404
    assert client.get('/api/atlas?source=custom').get_json()['items'] == []


def test_atlas_generation_errors_never_charge(client, monkeypatch):
    import server as srv
    register(client)
    with client.session_transaction() as session:
        uid = session['uid']
    body = {'topic': 'Строки', 'difficulty': 'expert', 'request_key': 'request-atlas-00002'}
    monkeypatch.setattr(srv, 'ai_available', lambda: True)
    monkeypatch.setattr(srv, 'call_opencode_json', lambda _: (_ for _ in ()).throw(AssertionError('must not call without balance')))
    assert client.post('/api/atlas/generate', json=body).status_code == 402
    with srv.app.app_context():
        srv.wallet_add(uid, drops=40)
        srv.db().commit()
    before = client.get('/api/wallet').get_json()['drops']
    monkeypatch.setattr(srv, 'call_opencode_json', lambda _: None)
    assert client.post('/api/atlas/generate', json=body).status_code == 503
    monkeypatch.setattr(srv, 'call_opencode_json', lambda _: dict(srv.ATLAS_SEEDS['seed-cache']))
    assert client.post('/api/atlas/generate', json=body).status_code == 503
    monkeypatch.setattr(srv, 'ai_available', lambda: False)
    assert client.post('/api/atlas/generate', json=body).status_code == 503
    assert client.get('/api/wallet').get_json()['drops'] == before


def test_new_challenge_guard_catches_renamed_solutions(client):
    import server as srv
    old = dict(NEW_TASK)
    changed = dict(old, title='Другой сюжет', prompt='Новое описание', func_name='another_balance',
                   solution=old['solution'].replace('walking_balance', 'another_balance').replace('values', 'numbers').replace('value', 'number'))
    assert not srv._challenge_is_new(changed, [old])
    assert not srv._challenge_is_new(dict(changed, solution=changed['solution'].replace('0', '7')), [old])
    assert not srv._challenge_is_new(dict(old, title='  СТУПЕНЬКИ-БАЛАНСА!'), [old])
    assert srv._challenge_is_new(old, list(srv.ATLAS_SEEDS.values()))


def test_daily_candidate_cannot_be_published_or_deleted_by_browser_claim(client, monkeypatch):
    import server as srv
    day, diff = '2026-10-09', 'intermediate'
    monkeypatch.setattr(srv, 'now', lambda: day + 'T12:00:00+00:00')
    monkeypatch.setattr(srv, 'ai_available', lambda: False)
    monkeypatch.setattr(srv, 'call_opencode_json', lambda _: dict(NEW_TASK))
    register(client)
    old = dict(srv.ATLAS_SEEDS['seed-parcel'])
    with srv.app.app_context():
        srv.db().execute('INSERT INTO daily_ai_tasks VALUES (?,?,?)', (day, diff, json.dumps(old)))
        srv.db().commit()
    old_key = client.get(f'/api/atlas/day-{day}-{diff}').get_json()['task']['task_key']
    before = client.get('/api/wallet').get_json()['drops']
    srv._generate_daily_background(day, diff)
    candidate = client.get('/api/daily-ai').get_json()['candidates'][diff]
    assert candidate['validation']['solution']
    body = dict(day=day, difficulty=diff, task_key=candidate['task_key'], ok=True)
    with srv.app.app_context():
        original_candidate = tuple(srv.db().execute('SELECT * FROM daily_ai_candidates WHERE day=? AND difficulty=?', (day, diff)).fetchone())
        original_task = tuple(srv.db().execute('SELECT * FROM daily_ai_tasks WHERE day=? AND difficulty=?', (day, diff)).fetchone())
    for claim in (dict(body, task_key='stale'), dict(body, ok=False), body):
        response = client.post('/api/daily-ai/validate', json=claim)
        assert response.status_code == (409 if claim['task_key'] == 'stale' else 503)
        if response.status_code == 503:
            assert response.get_json()['code'] == 'execution_disabled'
    with srv.app.app_context():
        assert tuple(srv.db().execute('SELECT * FROM daily_ai_candidates WHERE day=? AND difficulty=?', (day, diff)).fetchone()) == original_candidate
        assert tuple(srv.db().execute('SELECT * FROM daily_ai_tasks WHERE day=? AND difficulty=?', (day, diff)).fetchone()) == original_task
    assert client.get('/api/wallet').get_json()['drops'] == before
    assert client.post('/api/daily-ai/solve', json=dict(day=day, difficulty=diff, task_key=old_key)).get_json()['awarded'] == 30
    assert client.post(f'/api/atlas/day-{day}-{diff}/solve', json={'task_key': old_key}).get_json()['awarded'] == 0
    assert client.post('/api/daily-ai/solve', json=body).status_code == 409
    # A completed Atlas stage is idempotent regardless of a later stale claim.
    assert client.post(f'/api/atlas/day-{day}-{diff}/solve', json=body).get_json()['awarded'] == 0
    assert client.get('/api/wallet').get_json()['drops'] == before + 30


@pytest.mark.parametrize('claim', [True, False])
def test_daily_publication_uses_server_verdict_even_for_a_false_browser_claim(client, monkeypatch, claim):
    import server as srv
    day, diff = '2026-10-09', 'intermediate'
    monkeypatch.setattr(srv, 'now', lambda: day + 'T12:00:00+00:00')
    register(client)
    key = srv._daily_task_key(NEW_TASK)
    with srv.app.app_context():
        srv.db().execute('INSERT INTO daily_ai_tasks VALUES (?,?,?)', (day, diff, json.dumps(srv.ATLAS_SEEDS['seed-parcel'])))
        srv.db().execute('INSERT INTO daily_ai_candidates (day,difficulty,task_key,payload) VALUES (?,?,?,?)', (day, diff, key, json.dumps(NEW_TASK)))
        srv.db().commit()
    checked = []
    monkeypatch.setattr(srv, '_daily_validation', lambda payload: checked.append(payload) or True)
    before = client.get('/api/wallet').get_json()['drops']
    response = client.post('/api/daily-ai/validate', json=dict(day=day, difficulty=diff, task_key=key, ok=claim,
                                                          solution='attacker-controlled', tests="print('OK')"))
    assert response.status_code == 200 and response.get_json()['ok']
    assert checked == [NEW_TASK]
    with srv.app.app_context():
        published = json.loads(srv.db().execute('SELECT payload FROM daily_ai_tasks WHERE day=? AND difficulty=?', (day, diff)).fetchone()[0])
        assert published['solution'] == NEW_TASK['solution']
        assert not srv.db().execute('SELECT 1 FROM daily_ai_candidates WHERE day=? AND difficulty=?', (day, diff)).fetchone()
    assert client.get('/api/wallet').get_json()['drops'] == before


def test_daily_validator_runs_reference_and_two_negative_controls_in_fresh_jobs(client, monkeypatch):
    import server as srv
    from types import SimpleNamespace
    requests = []
    closed = []
    def create(uid, request):
        requests.append((uid, request))
        passed = len(requests) == 1
        return SimpleNamespace(stream=lambda: iter([dict(type='result', error=None if passed else 'assert failed',
                                                       check_stdout='OK\n' if passed else '')]), close=lambda: closed.append(True))
    monkeypatch.setattr(srv.sandbox.pool, 'create', create)
    assert srv._daily_validation(dict(NEW_TASK))
    assert [request['code'] for uid, request in requests] == [NEW_TASK['solution'], NEW_TASK['starter'], "print('OK')"]
    assert all(uid == 0 and request['check'] == NEW_TASK['tests'] for uid, request in requests)
    assert len(closed) == 3


def test_daily_generation_singleflight_and_bad_candidate_not_published(client, monkeypatch):
    import server as srv
    from types import SimpleNamespace
    starts = []
    scheduler = srv._schedule_daily_generation.original
    monkeypatch.setattr(srv, '_schedule_daily_generation', scheduler)
    monkeypatch.setattr(srv, 'ai_available', lambda: True)
    monkeypatch.setattr(srv.threading, 'Thread', lambda **kw: SimpleNamespace(start=lambda: starts.append(kw)))
    register(client)
    for _ in range(3):
        data = client.get('/api/daily-ai').get_json()
        assert data['pending'] and not data['tasks']
    assert len(starts) == 3
    # A repeated seed response never even becomes a browser candidate.
    monkeypatch.setattr(srv, 'call_opencode_json', lambda _: dict(srv.ATLAS_SEEDS['seed-parcel']))
    srv._generate_daily_background(data['day'], 'intermediate')
    assert not client.get('/api/daily-ai').get_json()['candidates']
    for body in ({'ok': True, 'difficulty': []}, [], {}):
        assert client.post('/api/daily-ai/validate', json=body).status_code == 400


def test_daily_failed_validation_and_already_solved_content_stay_unchanged(client, monkeypatch):
    import server as srv
    day, diff = '2026-10-09', 'intermediate'
    monkeypatch.setattr(srv, 'now', lambda: day + 'T12:00:00+00:00')
    monkeypatch.setattr(srv, 'ai_available', lambda: False)
    monkeypatch.setattr(srv, 'call_opencode_json', lambda _: dict(NEW_TASK))
    register(client)
    old = client.get('/api/daily-ai').get_json()['tasks'][diff]
    srv._generate_daily_background(day, diff)
    assert diff not in client.get('/api/daily-ai').get_json()['candidates']
    # Existing fresh content is not automatically replaced or exposed as pending.
    with srv.app.app_context():
        row = srv.db().execute('SELECT task_key FROM daily_ai_candidates WHERE day=? AND difficulty=?', (day, diff)).fetchone()
        key = row['task_key']
    assert not client.post('/api/daily-ai/validate', json=dict(day=day, difficulty=diff, task_key=key, ok=True)).get_json()['ok']
    srv._generate_daily_background(day, diff)
    assert client.post('/api/daily-ai/solve', json={'day': day, 'difficulty': diff}).get_json()['awarded'] == 30
    body = dict(day=day, difficulty=diff, task_key=key, ok=True)
    assert not client.post('/api/daily-ai/validate', json=body).get_json()['ok']
    assert client.get('/api/daily-ai').get_json()['tasks'][diff] == old
    assert not client.get('/api/daily-ai').get_json()['candidates']


def test_generated_code_is_inspected_not_executed(client, monkeypatch, tmp_path):
    import server as srv
    safe = dict(srv.ATLAS_SEEDS['seed-parcel'])
    assert srv._validate_daily_task(safe)
    for attack in ['import os\nos.remove("anything")', 'import js', 'eval("1")', 'x = ().__class__', 'open("anything")']:
        bad = dict(safe, solution=attack + '\n' + safe['solution'])
        assert not srv._validate_daily_task(bad)
    for bad in (None, [], {}, dict(safe, tests='print("OK")'), dict(safe, solution='bad syntax')):
        assert not srv._validate_daily_task(bad)
    # Even a non-terminating reference is only parsed here, never run on this host.
    assert srv._validate_daily_task(dict(safe, solution='def parcel_total(items):\n    while True:\n        pass'))


def test_atlas_concurrent_reward_once(client, monkeypatch):
    import server as srv
    register(client)
    cookie = client.get_cookie('session').value
    def solve(_):
        with srv.app.test_client() as c:
            c.set_cookie('session', cookie)
            return c.post('/api/atlas/seed-cache/solve').get_json()['awarded']
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(solve, range(2))) == [0, 80]


def test_offline_daily_bank_is_separate_from_startup_collection(client):
    import server as srv
    for diff in srv.DAILY_AI_DROPS:
        assert len(srv.DAILY_AI_FALLBACK[diff]) == 2
        assert not ({task['func_name'] for task in srv.DAILY_AI_FALLBACK[diff]}
                    & {task['func_name'] for task in srv.ATLAS_SEEDS.values()})


def test_atlas_boundaries_and_balance_changed_during_generation(client, monkeypatch):
    import server as srv
    register(client)
    for body in ([], {'topic': 'Строки', 'difficulty': []}, {'topic': 'x', 'difficulty': 'expert'}):
        assert client.post('/api/atlas/generate', json=body).status_code == 400
    # Rate limiter is separate from the payload/transaction checks in this test.
    srv._rate_buckets.clear()
    with client.session_transaction() as session:
        uid = session['uid']
    with srv.app.app_context():
        srv.wallet_add(uid, drops=40)
        srv.db().commit()
    monkeypatch.setattr(srv, 'ai_available', lambda: True)
    monkeypatch.setattr(srv, 'call_opencode_json', lambda _: dict(NEW_TASK))
    task = client.post('/api/atlas/generate', json={'topic': 'Списки', 'difficulty': 'expert', 'request_key': 'balance-race-request-1'}).get_json()
    with srv.app.app_context():
        srv.wallet_add(uid, drops=-35)  # another legitimate purchase while the model was working
        srv.db().commit()
    assert client.post('/api/atlas/' + task['id'] + '/activate').status_code == 402
    assert client.get('/api/wallet').get_json()['drops'] == 5
    assert client.get('/api/atlas/' + task['id']).status_code == 404
    assert client.get('/api/atlas?page=no').status_code == 400
    assert client.get('/api/atlas?source=secret').status_code == 400


def test_atlas_activation_does_not_use_model_admission(client, monkeypatch):
    from threading import Event
    import server as srv

    register(client)
    with client.session_transaction() as values:
        uid = values['uid']
    with srv.app.app_context():
        srv.wallet_add(uid, drops=120)
        srv.db().commit()
    monkeypatch.setattr(srv, 'ai_available', lambda: True)
    monkeypatch.setattr(srv, 'call_opencode_json', lambda _: dict(NEW_TASK))
    before = client.get('/api/wallet').get_json()['drops']
    made = client.post('/api/atlas/generate', json={
        'topic': 'Синтетические списки', 'difficulty': 'intermediate',
        'request_key': 'request-atlas-lock-proof-00001',
    }).get_json()
    assert made.get('validation', {}).get('solution'), made
    entered, release = Event(), Event()

    def unrelated_ai_turn():
        with srv.ai_controls.user_turn(uid):
            entered.set()
            assert release.wait(5), 'test did not release synthetic admission holder'

    with ThreadPoolExecutor(max_workers=1) as executor:
        holder = executor.submit(unrelated_ai_turn)
        try:
            assert entered.wait(5)
            paid = client.post('/api/atlas/' + made['id'] + '/activate')
            assert paid.status_code == 200, paid.get_json()
            assert paid.get_json()['cost'] == srv.ATLAS_PRICE
            assert paid.get_json()['drops'] == before - srv.ATLAS_PRICE
            repeated = client.post('/api/atlas/' + made['id'] + '/activate')
            assert repeated.status_code == 200, repeated.get_json()
            assert repeated.get_json()['cost'] == 0
        finally:
            release.set()
            holder.result(timeout=5)
