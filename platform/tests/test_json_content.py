"""Trusted JSON finale checks preserve values, types and readable Cyrillic."""
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import build_tasks


@pytest.fixture(scope='module')
def json_tasks():
    topic = next(topic for topic in build_tasks.parse() if topic['id'] == 26)
    assert [task['id'] for task in topic['tasks']] == [f'26.{n}' for n in range(1, 10)]
    return {task['id']: task for task in topic['tasks']}


@pytest.mark.parametrize(('task_id', 'code'), [
    ('26.8', 'import json\ndef json_total(text):\n    return sum(row["price"] for row in json.loads(text))'),
    ('26.9', 'import json\ndef update_json(text, key, value):\n    data = json.loads(text)\n    data[key] = int(value) if type(value) is bool else value\n    return json.dumps(data, ensure_ascii=False)'),
    ('26.9', 'import json\ndef update_json(text, key, value):\n    data = json.loads(text)\n    data[key] = value\n    return json.dumps(data).replace(json.dumps("Тула")[1:-1], "Тула")'),
    ('26.9', 'import json\ndef update_json(text, key, value):\n    data = json.loads(text)\n    if isinstance(value, list):\n        value = [int(x) if type(x) is bool else x for x in value]\n    data[key] = value\n    return json.dumps(data, ensure_ascii=False)'),
    ('26.9', 'import json\ndef update_json(text, key, value):\n    data = json.loads(text)\n    data[key] = value\n    return json.dumps(data, ensure_ascii=False).replace(" ", "")'),
    ('26.9', 'import json\ndef update_json(text, key, value):\n    data = json.loads(text)\n    data[key] = value\n    return str(data)'),
])
def test_json_finales_reject_wrong_values_and_explain_the_failing_call(json_tasks, task_id, code):
    namespace = {}
    exec(code, namespace)
    with pytest.raises(AssertionError) as failure:
        exec(json_tasks[task_id]['check']['append'], namespace)
    assert all(label in str(failure.value) for label in ('Вызов:', 'Ожидалось:', 'Получено:'))


@pytest.mark.parametrize('task_id', ['26.8', '26.9'])
def test_json_finale_reference_passes(json_tasks, task_id, capsys):
    namespace = {}
    exec(build_tasks._reference_program(json_tasks[task_id]), namespace)
    exec(json_tasks[task_id]['check']['append'], namespace)
    assert capsys.readouterr().out == 'OK\n'


@pytest.mark.parametrize('normalize_numbers', [False, True])
def test_json_update_accepts_other_whitespace_key_order_and_number_spelling(json_tasks, capsys, normalize_numbers):
    namespace = {'_normalize_numbers': normalize_numbers}
    exec('import json\ndef update_json(text, key, value):\n'
         '    data = json.loads(text)\n'
         '    data[key] = value\n'
         '    if _normalize_numbers:\n'
         '        data = json.loads(json.dumps(data), parse_int=float)\n'
         '    return json.dumps(data, ensure_ascii=False, sort_keys=True, indent=4)', namespace)
    exec(json_tasks['26.9']['check']['append'], namespace)
    assert capsys.readouterr().out == 'OK\n'
