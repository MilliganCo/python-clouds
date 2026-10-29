"""Inventory reports structural coverage, not a substitute for editorial review."""
from copy import deepcopy
from pathlib import Path
import runpy

import pytest

PATH = Path(__file__).resolve().parents[1] / 'scripts/audit_topics.py'


def audit_namespace():
    return runpy.run_path(str(PATH))


def test_current_inventory_covers_required_finales_and_theory():
    audit = audit_namespace()
    data = audit['audit_topics']()
    assert len(data['topics']) == 66
    assert sum(row['tasks'] for row in data['topics']) == 642
    assert sum(len(row['required_finales']) for row in data['topics']) == 132
    assert sum(row['quiz_questions'] for row in data['topics']) == 68
    assert sum(row['theory_examples'] for row in data['topics']) == 656
    assert not data['coverage_issues']
    report = audit['render_markdown'](data)
    assert 'необязатель' in report and 'два обязательных финала' in report
    assert '66' in report and '656' in report
    assert 'не доказывает' in report


@pytest.mark.parametrize('defect', ['finale_position', 'finale_check', 'theory', 'output'])
def test_inventory_exposes_missing_structural_coverage(defect):
    audit = audit_namespace()
    topic = {'id': 0, 'title': 'Test', 'levelRu': 'начальный', 'tasks': [
        {'id': '0.1', 'type': 'код', 'finale': 1, 'check': {'append': 'check', 'expect': 'OK'}, 'hint': 'hint'},
        {'id': '0.2', 'type': 'код', 'finale': 2, 'check': {'append': 'check', 'expect': 'OK'}, 'hint': 'hint'},
    ]}
    support = {'intros': {}, 'theory': {'0': {'sections': [{'examples': [{'code': 'print(1)', 'output': '1'}]}]}}}
    if defect == 'finale_position':
        topic['tasks'].reverse()
    elif defect == 'finale_check':
        topic['tasks'][1]['check'] = None
    elif defect == 'theory':
        support['theory'] = {}
    else:
        del support['theory']['0']['sections'][0]['examples'][0]['output']
    function = audit['audit_topics']
    function.__globals__.update(parse=lambda: deepcopy([topic]), _load_support_content=lambda: deepcopy(support), challenge_topics=lambda: set())
    data = function()
    assert data['coverage_issues']
    assert all(issue['topic_id'] == 0 for issue in data['coverage_issues'])


def test_optional_boss_without_quiz_is_not_a_broken_topic(monkeypatch):
    audit = audit_namespace()
    function = audit['main']
    function.__globals__['audit_topics'] = lambda: {
        'topics': [{'id': 0, 'has_challenge': True, 'quiz_before_challenge': False}],
        'coverage_issues': [],
    }
    function.__globals__['render_markdown'] = lambda _: 'inventory'
    monkeypatch.setattr('sys.argv', ['audit_topics.py'])
    assert function() == 0


def test_structural_failure_sets_nonzero_exit(monkeypatch):
    audit = audit_namespace()
    function = audit['main']
    function.__globals__['audit_topics'] = lambda: {'coverage_issues': [{'topic_id': 0, 'reason': 'missing'}]}
    function.__globals__['render_markdown'] = lambda _: 'inventory'
    monkeypatch.setattr('sys.argv', ['audit_topics.py'])
    assert function() == 1


def test_support_loader_failure_is_not_silently_reported_as_no_leaks():
    audit = audit_namespace()
    def fail():
        raise RuntimeError('support unavailable')
    audit['audit_topics'].__globals__['_load_support_content'] = fail
    with pytest.raises(RuntimeError, match='support unavailable'):
        audit['audit_topics']()


def test_capitalize_question_has_one_matching_operation():
    from build_tasks import parse
    task = next(task for topic in parse() for task in topic['tasks'] if task['id'] == '4.9')
    question = task['questions'][1]
    choices = [question['answer'], *question['wrong']]
    matches = [choice for choice in choices if getattr('пРИВЕТ мИР', choice.removesuffix('()'))() == 'Привет мир']
    assert matches == [question['answer']]
    assert 'пРИВЕТ мИР' in question['prompt'] and 'Привет мир' in question['prompt']
