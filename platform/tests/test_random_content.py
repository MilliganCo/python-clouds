"""Pinned random inputs; secrets assertions never require two tokens to differ."""
import contextlib
import io
from pathlib import Path
import random
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import build_tasks


@pytest.fixture(autouse=True)
def preserve_global_random():
    state = random.getstate()
    random.seed(987654321)
    try:
        yield
    finally:
        random.setstate(state)


@pytest.fixture(scope='module')
def random_tasks():
    tasks = {t['id']: t for p in build_tasks.parse() if p['id'] == 47 for t in p['tasks']}
    checks = build_tasks._load_support_content()['checks']
    for task_id, task in tasks.items():
        if 'check' not in task and task_id in checks:
            task['check'] = checks[task_id]
    assert len(tasks) == 9
    return tasks


def bad_program(tasks, task_id, code):
    reference = build_tasks._reference_program(tasks[task_id])
    if code == 'float-roll':
        return reference.replace('return random.randint(1, 6)', 'return float(random.randint(1, 6))')
    if code == 'falsey-pick':
        return reference.replace('return random.choice(items)', 'return random.choice(items) or items[0]')
    if code == 'clone-pick':
        return 'from copy import deepcopy\n' + reference.replace('return random.choice(items)', 'return deepcopy(random.choice(items))')
    if code == 'empty-alias':
        return reference.replace('copy = list(items)', 'if not items:\n        return items\n    copy = list(items)')
    if code == 'sorted-shuffle':
        return reference.replace('copy = list(items)', 'copy = sorted(items)')
    if code == 'deep-shuffle':
        return 'from copy import deepcopy\n' + reference.replace('copy = list(items)', 'copy = deepcopy(items)')
    if code == 'zero-dice-global':
        return reference.replace('    rng = random.Random(seed)', '    if count == 0:\n        random.seed(seed)\n        return []\n    rng = random.Random(seed)')
    if code == 'float-dice':
        return reference.replace('rng.randint(1, 6)', 'float(rng.randint(1, 6))')
    if code == 'eight-dice':
        return reference.replace('range(count)', 'range(8 if count else 0)')
    if code == 'zero-team-global':
        return reference.replace('    return random.Random(seed).sample(names, count)', '    if count == 0:\n        random.seed(seed)\n        return []\n    return random.Random(seed).sample(names, count)')
    if code == 'full-team-alias':
        return reference.replace('    return random.Random(seed).sample(names, count)', '    if count == len(names):\n        return names\n    return random.Random(seed).sample(names, count)')
    if code == 'full-team-reverse':
        return reference.replace('    return random.Random(seed).sample(names, count)', '    if count == len(names):\n        names.reverse()\n        return names.copy()\n    return random.Random(seed).sample(names, count)')
    return code


@pytest.mark.parametrize(('task_id', 'code'), [
    ('47.2', 'float-roll'),
    ('47.3', 'falsey-pick'),
    ('47.3', 'clone-pick'),
    ('47.6', 'empty-alias'),
    ('47.6', 'sorted-shuffle'),
    ('47.6', 'deep-shuffle'),
    ('47.7', 'import random\nn = 2\nprint(n)'),
    ('47.8', 'zero-dice-global'),
    ('47.8', 'float-dice'),
    ('47.8', 'eight-dice'),
    ('47.9', 'zero-team-global'),
    ('47.9', 'full-team-alias'),
    ('47.9', 'full-team-reverse'),
])
def test_random_checks_reject_old_false_accepts(random_tasks, task_id, code):
    namespace = {}
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        exec(bad_program(random_tasks, task_id, code), namespace)
    if 'check' not in random_tasks[task_id]:
        assert out.getvalue().strip() != '2', 'Готовая цифра прошла прежнюю проверку без вызова генератора'
    else:
        with pytest.raises(AssertionError):
            exec(random_tasks[task_id]['check']['append'], namespace)


@pytest.mark.parametrize('task_id', ['47.2', '47.3', '47.6', '47.7', '47.8', '47.9'])
def test_random_references_pass(random_tasks, task_id, capsys):
    namespace = {}
    with contextlib.redirect_stdout(io.StringIO()):
        exec(build_tasks._reference_program(random_tasks[task_id]), namespace)
    exec(random_tasks[task_id]['check']['append'], namespace)
    assert capsys.readouterr().out == 'OK\n'


@pytest.mark.parametrize(('task_id', 'code'), [
    ('47.2', 'import random\ndef roll():\n    return random.randrange(1, 7)'),
    ('47.2', 'import random\ndef roll():\n    return int(random.random() * 6) + 1'),
    ('47.6', 'import random\ndef shuffle_copy(items):\n    result = items.copy()\n    random.shuffle(result)\n    return result'),
    ('47.9', 'import random\ndef pick_team(names, count, seed):\n    rng = random.Random(seed)\n    return rng.sample(population=names, k=count)'),
])
def test_random_equivalent_public_apis_and_copy_pass(random_tasks, task_id, code, capsys):
    namespace = {}
    exec(code, namespace)
    exec(random_tasks[task_id]['check']['append'], namespace)
    assert capsys.readouterr().out == 'OK\n'


def test_random_examples_have_exact_public_outputs_and_all_hints():
    support = build_tasks._load_support_content()
    examples = [e for s in support['theory']['47']['sections'] for e in s['examples']]
    assert len(examples) == 8
    assert all(e.get('output') and not e.get('context') and not e.get('outputKind') for e in examples)
    assert all(support['hints'].get(f'47.{i}') for i in range(1, 8))
