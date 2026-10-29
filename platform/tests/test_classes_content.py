"""Independent object state and same-instance inheritance, with visible method results."""
import contextlib
import io
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import build_tasks


@pytest.fixture(scope='module')
def tasks():
    result = {t['id']: t for p in build_tasks.parse() if p['id'] in (32, 33) for t in p['tasks']}
    assert len(result) == 20
    return result


def program(tasks, task_id, code):
    reference = build_tasks._reference_program(tasks[task_id])
    if code is None:
        return reference
    if not code.startswith('@'):
        return code
    if code == '@bank-factory':
        return reference.replace('class BankAccount:', 'class _Account:') + '\ndef BankAccount(balance=0):\n    return _Account(balance)'
    if code == '@messages-consume':
        return 'def collect_messages(items):\n    out=[]\n    while items: out.append(items.pop(0).message())\n    return out'
    changes = {
        '@bank-shared': ('self.balance', 'BankAccount.balance'),
        '@bank-int': ('self.balance += amount', 'self.balance += int(amount)'),
        '@counter-shared': ('self.value', 'Counter.value'),
        '@counter-bool': ('self.value = 0', 'self.value = False'),
        '@counter-hidden': ('self.value += 1', "self.calls = getattr(self, 'calls', 0) + 1\n        self.value = self.calls"),
        '@point-fixed': ('self.x = x\n        self.y = y', 'self.x = 2\n        self.y = 3'),
        '@stock-empty-bool': ('return True', 'return bool(self.amount)'),
        '@stock-add-return': ('self.amount += count', 'self.amount += count\n        return self.amount'),
        '@measure-floor': ('sum(self.values) / len(self.values)', 'sum(self.values) // len(self.values)'),
        '@measure-sort': ('return sum(self.values) / len(self.values)', 'self.values.sort()\n        return sum(self.values) / len(self.values)'),
        '@describe-twice': ('return obj.speak()', 'obj.speak()\n    return obj.speak()'),
        '@describe-false': ('return obj.speak()', 'return obj.speak() or None'),
        '@describe-copy': ('return obj.speak()', 'return __import__("copy").deepcopy(obj.speak())'),
        '@describe-hide': ('return obj.speak()', 'try:\n        return obj.speak()\n    except ValueError:\n        return None'),
        '@child-other': ('super().speak()', 'Parent().speak()'),
        '@child-twice': ("return super().speak() + '!'", "super().speak()\n        return super().speak() + '!'"),
        '@cap-copy': ('super().cost(units)', 'units * self.rate'),
        '@cap-change-limit': ('return min(super().cost(units), self.limit)', 'result = min(super().cost(units), self.limit)\n        self.limit = 100000\n        return result'),
        '@messages-twice': ('return [item.message() for item in items]', 'return [(item.message(), item.message())[1] for item in items]'),
        '@messages-copy': ('item.message()', '__import__("copy").deepcopy(item.message())'),
        '@messages-filter': ('return [item.message() for item in items]', 'return [item.message() for item in items if item.message()]'),
        '@good-bank': ('self.balance += amount', 'self.balance = amount + self.balance'),
        '@good-counter': ('self.value += 1', 'self.value = self.value + 1'),
        '@good-point': ('p = Point(2, 3)', 'p = Point(y=3, x=2)'),
        '@good-stock': ('if count > self.amount:\n            return False\n        self.amount -= count\n        return True', 'if count <= self.amount:\n            self.amount -= count\n            return True\n        return False'),
        '@good-measure': ('return sum(self.values) / len(self.values)', 'return __import__("statistics").mean(self.values)'),
        '@good-measure-return': ('self.values.append(value)', 'self.values.append(value)\n        return len(self.values)'),
        '@good-dog': ("return 'гав'", "return 'г' + 'ав'"),
        '@good-describe': ('return obj.speak()', 'result = obj.speak()\n    return result'),
        '@good-child': ("return super().speak() + '!'", "base = super()\n        return base.speak() + '!'"),
        '@good-cap': ('return min(super().cost(units), self.limit)', 'cost = super().cost(units)\n        return self.limit if cost > self.limit else cost'),
        '@good-messages': ('return [item.message() for item in items]', 'result=[]\n    for item in items:\n        result.append(item.message())\n    return result'),
    }
    before, after = changes[code]
    assert before in reference, (task_id, code)
    return reference.replace(before, after)


def checked(task, code):
    ns = {}
    with contextlib.redirect_stdout(io.StringIO()):
        exec(code, ns)
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        exec(task['check']['append'], ns)
    assert output.getvalue().strip() == 'OK'


@pytest.mark.parametrize('task_id', ['32.2', '32.6', '32.7', '32.9', '32.10', '33.6', '33.7', '33.8', '33.9', '33.10'])
def test_references(tasks, task_id):
    checked(tasks[task_id], program(tasks, task_id, None))


@pytest.mark.parametrize(('task_id', 'code'), [
    ('32.2', '@bank-factory'), ('32.2', '@bank-shared'), ('32.2', '@bank-int'),
    ('32.6', '@counter-shared'), ('32.6', '@counter-bool'), ('32.6', '@counter-hidden'),
    ('32.7', '@point-fixed'), ('32.9', '@stock-empty-bool'),
    ('32.10', '@measure-floor'), ('32.10', '@measure-sort'),
    ('33.7', '@describe-twice'), ('33.7', '@describe-false'), ('33.7', '@describe-copy'), ('33.7', '@describe-hide'),
    ('33.8', '@child-other'), ('33.8', '@child-twice'),
    ('33.9', '@cap-copy'), ('33.9', '@cap-change-limit'),
    ('33.10', '@messages-twice'), ('33.10', '@messages-copy'), ('33.10', '@messages-consume'), ('33.10', '@messages-filter'),
])
def test_rejects_shared_state_and_method_contract_errors(tasks, task_id, code):
    with pytest.raises(AssertionError):
        checked(tasks[task_id], program(tasks, task_id, code))


@pytest.mark.parametrize(('task_id', 'code'), [
    ('32.2', '@good-bank'), ('32.6', '@good-counter'), ('32.7', '@good-point'),
    ('32.9', '@good-stock'), ('32.9', '@stock-add-return'),
    ('32.10', '@good-measure'), ('32.10', '@good-measure-return'), ('33.6', '@good-dog'),
    ('33.7', '@good-describe'), ('33.8', '@good-child'), ('33.9', '@good-cap'), ('33.10', '@good-messages'),
])
def test_equivalent_solutions(tasks, task_id, code):
    checked(tasks[task_id], program(tasks, task_id, code))


@pytest.mark.parametrize(('task_id', 'code', 'ok'), [
    ('32.7', None, True),
    ('33.6', "class Animal:\n    def speak(self): return '...'\nclass Dog(Animal):\n    def speak(self): return 'гав'", False),
    ('33.7', None, True), ('33.8', '@child-other', False), ('33.9', None, True),
])
def test_actual_runner_same_self_and_mixed_output(tasks, task_id, code, ok):
    import importlib.util
    spec = importlib.util.spec_from_file_location('classes_runner_test', Path(__file__).resolve().parents[1] / 'sandbox_http_plots/runner.py')
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    task = tasks[task_id]
    events = []
    result = runner.execute({'code': program(tasks, task_id, code), 'check': task['check']['append'], 'interactive': False, 'reportTests': True},
                            io.StringIO(), lambda kind, **data: events.append((kind, data)))
    assert any(kind == 'test_event' and data['event']['type'] == 'plan' for kind, data in events)
    output = result['check_stdout'] if task['check']['expect'] == 'OK' else result['stdout']
    assert (result['error'] is None and build_tasks._normalized_output(output) == build_tasks._normalized_output(task['check']['expect'])) is ok


def test_theory_and_hints():
    support = build_tasks._load_support_content()
    for topic, count, ordinary in ((32, 12, 8), (33, 11, 8)):
        examples = [e for s in support['theory'][str(topic)]['sections'] for e in s['examples']]
        assert len(examples) == count and all(('output' in e and (e['output'] or e.get('error'))) and not e.get('context') for e in examples)
        assert all(support['hints'].get(f'{topic}.{i}') for i in range(1, ordinary + 1))
    assert not set(support['checks']) & {'32.2', '32.6', '32.7', '33.6', '33.7', '33.8'}
