"""Optional author metadata: relative task difficulty is not grading or XP."""
import json
from pathlib import Path
import sys
import subprocess

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import build_tasks

PROFILE = {'difficulty': 'practice', 'skills': ['Вызов функции', 'Возврат результата'],
           'reason': 'Нужно проследить отдельно выполнение вызова и возвращённое значение.'}


def raw_profile(profile):
    return '''**Тип задания:** написать функцию
**Название:** Учебный пример
**Условие:** Верните число.
**Ответ:**
```python
def number():
    return 3
```
**Объяснение:** Возвращаем число.
**Проверено в CPython:** да
**Учебный профиль:**
```json
''' + json.dumps(profile, ensure_ascii=False) + '\n```\n---\n'


def test_learning_profile_is_optional_and_keeps_task_content():
    task = build_tasks.parse_task(raw_profile(PROFILE), 3, 6)
    assert task.pop('learning') == PROFILE
    plain = raw_profile(PROFILE).split('**Учебный профиль:**', 1)[0] + '\n---\n'
    assert task == build_tasks.parse_task(plain, 3, 6)


@pytest.mark.parametrize('profile', [
    None, [], {}, {**PROFILE, 'unknown': 'extra'},
    {**PROFILE, 'difficulty': 'expert'}, {**PROFILE, 'difficulty': []},
    {**PROFILE, 'skills': []}, {**PROFILE, 'skills': 'return'},
    {**PROFILE, 'skills': ['Один'] * 2}, {**PROFILE, 'skills': ['a', 'b', 'c', 'd']},
    {**PROFILE, 'skills': [False]}, {**PROFILE, 'skills': [' a']},
    {**PROFILE, 'skills': ['a' * 61]}, {**PROFILE, 'skills': ['Две\nстроки']},
    {**PROFILE, 'reason': ''}, {**PROFILE, 'reason': 7},
    {**PROFILE, 'reason': 'Две\nстроки'}, {**PROFILE, 'reason': 'a' * 241},
])
def test_learning_profile_rejects_broken_author_metadata(profile):
    with pytest.raises(ValueError, match='3.6.*Учебный профиль'):
        build_tasks.parse_task(raw_profile(profile), 3, 6)


def test_learning_profile_rejects_broken_json_and_duplicate_block():
    raw = raw_profile(PROFILE)
    with pytest.raises(ValueError, match='3.6.*Учебный профиль'):
        build_tasks.parse_task(raw.replace(json.dumps(PROFILE, ensure_ascii=False), '{broken}'), 3, 6)
    with pytest.raises(ValueError, match='3.6.*Учебный профиль'):
        block = '**Учебный профиль:**' + raw.split('**Учебный профиль:**', 1)[1]
        build_tasks.parse_task(raw + block, 3, 6)


def test_profile_needs_separate_block_after_verified_line():
    raw = raw_profile(PROFILE)
    raw = raw.replace('**Проверено в CPython:** да\n', '')
    with pytest.raises(ValueError, match='3.6.*Учебный профиль'):
        build_tasks.parse_task(raw, 3, 6)


def test_authored_profiles_cover_only_the_reviewed_blocks():
    topics = build_tasks.parse()
    labelled = [task for topic in topics for task in topic['tasks'] if task.get('learning')]
    expected = {f'{topic}.{i}' for topic in (3, 16, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65) for i in range(1, 11)}
    expected.update(f'{topic}.{i}' for topic in (52, 53) for i in range(1, 15))
    assert {task['id'] for task in labelled} == expected
    assert {task['learning']['difficulty'] for task in labelled} == {'easy', 'practice', 'challenge'}
    assert all(task['learning']['reason'] and 1 <= len(task['learning']['skills']) <= 3 for task in labelled)
    assert next(t for t in labelled if t['id'] == '3.4')['learning']['difficulty'] == 'challenge'


def test_default_profiles_distinguish_changing_a_list_from_preserving_settings():
    tasks = {task['id']: task for topic in build_tasks.parse() if topic['id'] == 16 for task in topic['tasks']}
    assert [tasks[f'16.{index}']['learning']['difficulty'] for index in range(1, 11)] == [
        'practice', 'easy', 'practice', 'easy', 'practice', 'easy', 'practice', 'easy', 'practice', 'challenge']
    assert 'Момент создания значения' in tasks['16.1']['learning']['skills']
    assert 'def' in tasks['16.1']['learning']['reason']
    for task_id in ('16.7', '16.9'):
        assert 'Идентичность списка' in tasks[task_id]['learning']['skills']
        assert 'переданн' in tasks[task_id]['learning']['reason']
    assert 'Копирование словаря' in tasks['16.10']['learning']['skills']
    assert 'Сохранность исходника' in tasks['16.10']['learning']['skills']
    assert 'новый' in tasks['16.10']['prompt'] and 'не меняйте' in tasks['16.10']['prompt']
    assert [(task_id, tasks[task_id]['finale']) for task_id in ('16.9', '16.10')] == [('16.9', 1), ('16.10', 2)]
    # Both finales ask for a function; their different reasoning load is authored,
    # not inferred from the exercise type or used as a different reward rule.
    assert tasks['16.9']['type'] == tasks['16.10']['type'] == 'написать функцию'


def test_real_legacy_profile_renderer():
    script = Path(__file__).resolve().parents[1] / 'scripts/verify_learning_profiles_unit.cjs'
    result = subprocess.run(['node', str(script)], capture_output=True, text=True, encoding='utf-8', timeout=10)
    assert result.returncode == 0, result.stdout + result.stderr
