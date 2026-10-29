"""Missing keys, ties and independent result groups are learner-visible contracts."""
import contextlib
import io
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import build_tasks


@pytest.fixture(scope='module')
def collection_tasks():
    tasks = {t['id']: t for p in build_tasks.parse() if p['id'] == 44 for t in p['tasks']}
    checks = build_tasks._load_support_content()['checks']
    for task_id, task in tasks.items():
        if 'check' not in task and task_id in checks:
            task['check'] = checks[task_id]
    assert len(tasks) == 8
    return tasks


def bad_program(tasks, task_id, code):
    reference = build_tasks._reference_program(tasks[task_id])
    if code == 'split-space':
        return reference.replace('text.split()', 'text.split(" ")')
    if code == 'lower-words':
        return reference.replace('text.split()', 'text.lower().split()')
    if code == 'strip-words':
        return reference.replace('text.split()', '[word.strip(".,!?") for word in text.split()]')
    if code == 'mutate-votes':
        return reference.replace('    counts = Counter(votes)', '    votes.sort()\n    counts = Counter(votes)')
    if code == 'two-leaders':
        return reference.replace('return sorted(name for name, count in counts.items() if count == highest)', 'return sorted(name for name, count in counts.items() if count == highest)[:2]')
    if code == 'casefold-sort':
        return reference.replace('return sorted(name for name, count in counts.items() if count == highest)', 'return sorted((name for name, count in counts.items() if count == highest), key=str.casefold)')
    if code == 'fixed-threshold':
        return reference.replace('highest = max(counts.values())', 'highest = 2 if any(count >= 2 for count in counts.values()) else 1')
    if code == 'empty-defaultdict':
        return reference.replace('    groups = defaultdict(list)', '    if not rows:\n        return defaultdict(list)\n    groups = defaultdict(list)')
    if code == 'cached-groups':
        return "_cache = {}\ndef orders_by_customer(rows):\n    _cache.clear()\n    for customer, product in rows:\n        _cache.setdefault(customer, []).append(product)\n    return _cache"
    if code == 'sort-products':
        return reference.replace('return dict(groups)', 'return {customer: sorted(products) for customer, products in groups.items()}')
    if code == 'drop-empty-product':
        return reference.replace('        groups[customer].append(product)', '        if product:\n            groups[customer].append(product)')
    return code


@pytest.mark.parametrize(('task_id', 'code'), [
    ('44.4', 'split-space'),
    ('44.4', 'lower-words'),
    ('44.4', 'strip-words'),
    ('44.5', "c = {'a': 2, 'b': 1}\nprint(dict(c))"),
    ('44.6', "d = {'a': ['x']}\nprint(d['a'])"),
    ('44.6', "from collections import defaultdict\nshared = []\nd = defaultdict(lambda: shared)\nd['a'].append('x')\nprint(d['a'])"),
    ('44.7', 'mutate-votes'),
    ('44.7', 'two-leaders'),
    ('44.7', 'casefold-sort'),
    ('44.7', 'fixed-threshold'),
    ('44.8', 'empty-defaultdict'),
    ('44.8', 'cached-groups'),
    ('44.8', 'sort-products'),
    ('44.8', 'drop-empty-product'),
])
def test_collection_checks_reject_old_false_accepts(collection_tasks, task_id, code):
    namespace = {}
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        exec(bad_program(collection_tasks, task_id, code), namespace)
    if 'check' not in collection_tasks[task_id]:
        expected = "{'a': 2, 'b': 1}" if task_id == '44.5' else "['x']"
        assert out.getvalue().strip() != expected, 'Готовый dict прошёл прежнюю проверку без требуемого контейнера'
    else:
        with pytest.raises(AssertionError):
            exec(collection_tasks[task_id]['check']['append'], namespace)


@pytest.mark.parametrize('task_id', ['44.4', '44.5', '44.6', '44.7', '44.8'])
def test_collection_references_pass(collection_tasks, task_id, capsys):
    namespace = {}
    with contextlib.redirect_stdout(io.StringIO()):
        exec(build_tasks._reference_program(collection_tasks[task_id]), namespace)
    exec(collection_tasks[task_id]['check']['append'], namespace)
    assert capsys.readouterr().out == 'OK\n'


@pytest.mark.parametrize(('task_id', 'code'), [
    ('44.4', 'from collections import Counter\ndef top_word(text):\n    counts = Counter(text.split())\n    return max(counts, key=counts.get)'),
    ('44.5', "from collections import Counter\ns = 'aab'\nc = Counter()\nc.update(s)"),
    ('44.6', "from collections import defaultdict\nd = defaultdict(lambda: [])\nd['a'] = ['x']"),
    ('44.8', 'from collections import defaultdict\ndef orders_by_customer(rows):\n    groups = defaultdict(lambda: [])\n    for customer, product in rows:\n        groups[customer].append(product)\n    return {customer: list(products) for customer, products in groups.items()}'),
])
def test_collection_equivalent_construction_and_factory_pass(collection_tasks, task_id, code, capsys):
    namespace = {}
    exec(code, namespace)
    exec(collection_tasks[task_id]['check']['append'], namespace)
    assert capsys.readouterr().out == 'OK\n'


def test_collection_examples_are_independent_visible_and_have_all_hints():
    support = build_tasks._load_support_content()
    examples = [e for s in support['theory']['44']['sections'] for e in s['examples']]
    assert len(examples) == 8
    assert all(e.get('output') and not e.get('context') for e in examples)
    assert all(support['hints'].get(f'44.{i}') for i in range(1, 7))
