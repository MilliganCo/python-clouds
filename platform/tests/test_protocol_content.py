"""Behavioral regressions for cleanup, ownership and special-method teaching."""
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import build_tasks


@pytest.fixture(scope='module')
def protocol_tasks():
    tasks = {t['id']: t for p in build_tasks.parse() if p['id'] in (31, 34) for t in p['tasks']}
    support = build_tasks._load_support_content()['checks']
    for task_id, task in tasks.items():
        if 'check' not in task and task_id in support:
            task['check'] = support[task_id]
    assert len(tasks) == 20
    return tasks


@pytest.mark.parametrize(('task_id', 'code'), [
    ('31.7', "class NullCtx:\n    def __enter__(self):\n        return 'inside'\n    def __exit__(self, *args):\n        return True"),
    ('31.9', 'from contextlib import contextmanager\n@contextmanager\ndef temporary_value(mapping, key, value):\n    before = dict(mapping)\n    mapping[key] = value\n    try:\n        yield mapping\n    finally:\n        mapping.clear()\n        mapping.update(before)'),
    ('31.9', 'from contextlib import contextmanager\n@contextmanager\ndef temporary_value(mapping, key, value):\n    existed, old = key in mapping, mapping.get(key)\n    mapping[key] = value\n    try:\n        yield mapping\n    except BaseException:\n        if not existed:\n            mapping.pop(key, None)\n        raise\n    else:\n        if existed:\n            mapping[key] = old\n        else:\n            mapping.pop(key, None)'),
    ('31.10', "class Managed:\n    def __init__(self, resource):\n        self.resource = resource\n    def __enter__(self):\n        return self.resource\n    def __exit__(self, exc_type, exc, tb):\n        self.resource.close()\n        if exc_type is not None:\n            raise ValueError('подменённая ошибка')\n        return False"),
    ('34.7', 'class Box:\n    def __init__(self, items):\n        self.items = items\n    def __len__(self):\n        return len(self.items)'),
    ('34.8', "class Pair:\n    def __init__(self, a, b):\n        self.a, self.b = a, b\n    def __eq__(self, other):\n        return hasattr(other, 'a') and hasattr(other, 'b') and (self.a, self.b) == (other.a, other.b)"),
    ('34.9', None),
    ('34.10', None),
])
def test_protocol_checks_reject_hidden_mutations_and_wrong_exit(protocol_tasks, task_id, code):
    if code is None:
        code = build_tasks._reference_program(protocol_tasks[task_id])
        if task_id == '34.9':
            code = code.replace('return Basket(self.items + other.items)', 'return self if not other.items else Basket(self.items + other.items)')
        else:
            code = code.replace('return self.text.lower() == other.text.lower()', 'self.text = self.text.lower()\n        other.text = other.text.lower()\n        return self.text == other.text')
    namespace = {}
    exec(code, namespace)
    with pytest.raises((AssertionError, TypeError)):
        exec(protocol_tasks[task_id]['check']['append'], namespace)


@pytest.mark.parametrize('task_id', ['31.7', '31.9', '31.10', '34.6', '34.7', '34.8', '34.9', '34.10'])
def test_protocol_reference_passes(protocol_tasks, task_id, capsys):
    namespace = {}
    exec(build_tasks._reference_program(protocol_tasks[task_id]), namespace)
    capsys.readouterr()
    exec(protocol_tasks[task_id]['check']['append'], namespace)
    assert capsys.readouterr().out == 'OK\n'


@pytest.mark.parametrize('task_id', ['34.6', '34.8'])
def test_demo_output_is_not_the_function_check_result(protocol_tasks, task_id):
    assert protocol_tasks[task_id]['check']['expect'] == 'OK'


def test_class_context_manager_is_a_valid_temporary_value_solution(protocol_tasks, capsys):
    namespace = {}
    exec('class temporary_value:\n    def __init__(self, mapping, key, value):\n        self.mapping, self.key, self.value = mapping, key, value\n    def __enter__(self):\n        self.existed = self.key in self.mapping\n        self.previous = self.mapping.get(self.key)\n        self.mapping[self.key] = self.value\n        return self.mapping\n    def __exit__(self, *args):\n        if self.existed:\n            self.mapping[self.key] = self.previous\n        else:\n            self.mapping.pop(self.key, None)\n        return False', namespace)
    exec(protocol_tasks['31.9']['check']['append'], namespace)
    assert capsys.readouterr().out == 'OK\n'


def test_pair_may_return_notimplemented_for_foreign_type(protocol_tasks, capsys):
    code = build_tasks._reference_program(protocol_tasks['34.8']).replace('return isinstance(other, Pair) and (self.a, self.b) == (other.a, other.b)', 'if not isinstance(other, Pair):\n            return NotImplemented\n        return (self.a, self.b) == (other.a, other.b)')
    namespace = {}
    exec(code, namespace)
    capsys.readouterr()
    exec(protocol_tasks['34.8']['check']['append'], namespace)
    assert capsys.readouterr().out == 'OK\n'
