"""UTC-offset practice compares actual moments and keeps local evidence private."""
import contextlib
import copy
import io
import json
from pathlib import Path
import sys

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
import build_tasks
from test_project_courses import client, srv, register, solve_topic


def quest():
    section = build_tasks.SRC.read_text(encoding='utf8').split(
        '\n## Мини-квесты на своём компьютере\n', 1)[1]
    courses = json.loads(build_tasks.first_fence(section)[1])
    found = [course for course in courses if course['id'] == 'practice_time_offsets']
    assert len(found) == 1
    return found[0]


def checked(source):
    stage = quest()['stages'][0]
    namespace = {}
    with contextlib.redirect_stdout(io.StringIO()):
        exec(source, namespace)
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        exec(stage['check']['append'], namespace)
    assert output.getvalue().strip() == 'OK'


def test_date_task_ids_and_existing_finales_remain_unchanged():
    topic = next(topic for topic in build_tasks.parse() if topic['id'] == 24)
    assert [task['id'] for task in topic['tasks']] == [f'24.{n}' for n in range(1, 10)]
    assert [(task['id'], task['finale']) for task in topic['tasks'] if task.get('finale')] == [
        ('24.8', 1), ('24.9', 2)]


ALTERNATIVE = '''def elapsed_minutes(start, end):
    from datetime import datetime
    points = [datetime.fromisoformat(text) for text in (start, end)]
    if any(point.utcoffset() is None for point in points):
        raise ValueError('offset required')
    return int((points[1] - points[0]).total_seconds() / 60)
'''


@pytest.mark.parametrize('variant', ['reference', 'direct_aware_subtraction'])
def test_equivalent_algorithms_accept_negative_zero_and_multiday_durations(variant):
    source = quest()['stages'][0]['reference_code'] if variant == 'reference' else ALTERNATIVE
    checked(source)


MUTATIONS = [
    ('right.astimezone(UTC) - left.astimezone(UTC)',
     'right.replace(tzinfo=UTC) - left.replace(tzinfo=UTC)'),
    ('elapsed.total_seconds()', 'elapsed.seconds'),
    ('return int(elapsed.total_seconds() // 60)', 'return abs(int(elapsed.total_seconds() // 60))'),
    ('return int(elapsed.total_seconds() // 60)', 'return elapsed.total_seconds() // 60'),
    ('left.utcoffset() is None or right.utcoffset() is None', 'left.utcoffset() is None'),
    ('left.utcoffset() is None or right.utcoffset() is None', 'right.utcoffset() is None'),
    ('left.utcoffset() is None or right.utcoffset() is None',
     'not left.utcoffset() or not right.utcoffset()'),
    ("    if left.utcoffset() is None or right.utcoffset() is None:\n"
     "        raise ValueError('Нужно UTC-смещение у обеих меток')\n",
     '    left = left.replace(tzinfo=UTC) if left.utcoffset() is None else left\n'
     '    right = right.replace(tzinfo=UTC) if right.utcoffset() is None else right\n'),
    ('return int(elapsed.total_seconds() // 60)', 'print(int(elapsed.total_seconds() // 60))'),
]


@pytest.mark.parametrize('old,new', MUTATIONS)
def test_partial_fixes_do_not_pass_the_authored_contract(old, new):
    source = quest()['stages'][0]['reference_code']
    assert old in source
    with pytest.raises((AssertionError, NameError, TypeError, ValueError)):
        checked(source.replace(old, new))


@pytest.mark.parametrize('variant', ['starter', 'print_only', 'hardcoded'])
def test_placeholder_stdout_and_one_answer_do_not_substitute_for_the_function(variant):
    source = {
        'starter': quest()['stages'][0]['starter_code'],
        'print_only': "print('OK')",
        'hardcoded': 'def elapsed_minutes(start, end): return 30',
    }[variant]
    with pytest.raises((AssertionError, NameError)):
        checked(source)


def test_failure_message_identifies_the_call_expected_result_and_actual_type():
    with pytest.raises(AssertionError) as failure:
        checked('def elapsed_minutes(start, end): return 30.0')
    assert all(part in str(failure.value) for part in ('Вызов:', 'Ожидалось:', 'Получено:', 'float'))


def test_new_theory_examples_run_independently_without_system_timezone():
    text = (ROOT / 'platform/static/theory-articles-13-25.js').read_text(encoding='utf8')
    articles = json.loads(text.split('|| {}, ', 1)[1].rsplit(');', 1)[0])
    sections = articles['24']['sections'][-3:]
    assert len(articles['24']['sections']) == 11
    assert sum(len(section.get('examples', [])) for section in articles['24']['sections']) == 12
    for section in sections:
        for example in section['examples']:
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                exec(example['code'], {})
            assert output.getvalue().rstrip('\n') == example['output']
            assert 'now(' not in example['code'] and 'today(' not in example['code']


def test_local_route_teaches_predictions_signed_time_and_explicit_unknown_zone():
    course = quest()
    stage = course['stages'][0]
    assert course['unlock_topics'] == stage['requirements']['topics'] == [3, 18, 23, 24]
    assert course['kind'] == 'local_practice'
    assert stage['id'] == 'elapsed'
    local = stage['local_practice']
    assert {item['id'] for item in local['checklist']} == {'saved', 'same_moment', 'signed', 'missing'}
    text = ' '.join(item['text'] for item in local['guide'])
    assert all(part in text for part in ('1530', '-1530', 'ValueError', 'Z', 'UTC', 'datetime.py'))
    assert 'не подключалась к вашей IDE' in stage['completion_message']
    assert local['links'][0]['url'] == 'https://docs.python.org/3.14/library/datetime.html'
    for guide in local['guide']:
        if 'code' in guide:
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                exec(guide['code'], {})
            assert output.getvalue().rstrip('\n') == guide['output']


def test_generated_course_matches_canonical_and_hides_the_reference(srv):
    actual = srv.pc.get_course('practice_time_offsets')
    expected = copy.deepcopy(quest())
    for stage in expected['stages']:
        stage.pop('reference_code')
    assert actual == expected


def test_route_unlock_and_local_evidence_are_private_without_new_rewards(client, srv):
    register(client, name='time_offsets_owner')
    url = '/api/project-courses/practice_time_offsets'
    assert client.post(url + '/start').status_code == 409
    for topic in quest()['unlock_topics']:
        solve_topic(client, srv, topic)
    assert client.post(url + '/start').status_code == 200
    before = (client.get('/api/wallet').get_json()['drops'],
              client.get('/api/progress').get_json()['xp'])
    endpoint = url + '/stages/elapsed/complete'
    assert client.post(endpoint, json={'check': {'ok': True}}).status_code == 400
    local = quest()['stages'][0]['local_practice']
    evidence = {'checked': [item['id'] for item in local['checklist']],
                'reflection': 'Сверил один момент UTC, отрицательные минуты и отказ без смещения.'}
    result = client.post(endpoint, json={'code': '# own study code', 'check': {'ok': True},
                                         'local_evidence': evidence})
    assert result.status_code == 200, result.get_json()
    assert client.get(url).get_json()['course']['status'] == 'completed'
    assert before == (client.get('/api/wallet').get_json()['drops'],
                      client.get('/api/progress').get_json()['xp'])
    client.post('/api/logout')
    register(client, name='time_offsets_other')
    assert all(not stage['local_evidence'] for stage in client.get(url).get_json()['course']['stages'])
