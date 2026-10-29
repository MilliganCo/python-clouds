"""Specific errors, real causes and non-destructive reads are part of the lesson."""
from pathlib import Path
import sys

import pytest

sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
import build_tasks


@pytest.fixture(scope='module')
def domain_tasks():
    tasks={t['id']:t for p in build_tasks.parse() if p['id']==39 for t in p['tasks']}
    support=build_tasks._load_support_content()['checks']
    for task_id,task in tasks.items():
        if 'check' not in task and task_id in support:
            task['check']=support[task_id]
    assert len(tasks)==9
    return tasks


@pytest.mark.parametrize(('task_id','code'),[
    ('39.2','NegativeError = Exception\ndef sqrt_checked(x):\n    if x < 0:\n        raise NegativeError()\n    return x ** 0.5'),
    ('39.2','class NegativeError(Exception):\n    pass\ndef sqrt_checked(x):\n    if x <= 0:\n        raise NegativeError()\n    return x ** 0.5'),
    ('39.6','class EmptyError(Exception):\n    pass\ndef head(items):\n    if not items or not items[0]:\n        raise EmptyError()\n    return items[0]'),
    ('39.6','class EmptyError(Exception):\n    pass\ndef head(items):\n    if not items:\n        raise EmptyError()\n    return items.pop(0)'),
    ('39.8','LimitError = ValueError\ndef reserve(requested, available):\n    if requested > available:\n        error = LimitError("limit")\n        error.requested, error.available = requested, available\n        raise error\n    return available - requested'),
    ('39.8',None),
    ('39.9','class ConfigError(Exception):\n    pass\ndef read_port(text):\n    try:\n        port = int(text)\n    except Exception as error:\n        raise ConfigError() from error\n    if not 1 <= port <= 65535:\n        raise ConfigError()\n    return port'),
    ('39.9','class ConfigError(Exception):\n    pass\ndef read_port(text):\n    try:\n        port = int(text)\n    except ValueError:\n        raise ConfigError() from ValueError("выдуманная причина")\n    if not 1 <= port <= 65535:\n        raise ConfigError()\n    return port'),
    ('39.9','class ConfigError(Exception):\n    pass\ndef read_port(text):\n    try:\n        port = int(text)\n        if not 1 <= port <= 65535:\n            raise ValueError("range")\n    except ValueError as error:\n        raise ConfigError() from error\n    return port'),
])
def test_domain_checks_reject_wrong_error_semantics(domain_tasks,task_id,code):
    if code is None:
        code=build_tasks._reference_program(domain_tasks[task_id]).replace('return available - requested','return int(available - requested)')
    namespace={}
    exec(code,namespace)
    with pytest.raises(AssertionError):
        exec(domain_tasks[task_id]['check']['append'],namespace)


@pytest.mark.parametrize('task_id',['39.2','39.6','39.8','39.9'])
def test_domain_reference_passes(domain_tasks,task_id,capsys):
    namespace={}
    exec(build_tasks._reference_program(domain_tasks[task_id]),namespace)
    exec(domain_tasks[task_id]['check']['append'],namespace)
    assert capsys.readouterr().out=='OK\n'


@pytest.mark.parametrize(('task_id','code'),[
    ('39.2','from math import sqrt\nclass NegativeError(ValueError):\n    pass\ndef sqrt_checked(x):\n    if x < 0:\n        raise NegativeError("negative")\n    return sqrt(x)'),
    ('39.6','class EmptyError(IndexError):\n    pass\ndef head(items):\n    try:\n        return items[0]\n    except IndexError as error:\n        raise EmptyError("empty") from error'),
    ('39.9','class ConfigError(Exception):\n    pass\ndef read_port(text):\n    failure = None\n    try:\n        port = int(text)\n    except ValueError as error:\n        failure = error\n    if failure is not None:\n        raise ConfigError("format") from failure\n    if port < 1 or port > 65535:\n        raise ConfigError("range")\n    return port'),
])
def test_domain_alternatives_do_not_need_reference_control_flow(domain_tasks,task_id,code,capsys):
    namespace={}
    exec(code,namespace)
    exec(domain_tasks[task_id]['check']['append'],namespace)
    assert capsys.readouterr().out=='OK\n'


def test_domain_lessons_have_visible_examples_and_authored_hints():
    support=build_tasks._load_support_content()
    assert all(support['hints'].get(f'39.{i}') for i in range(1,8))
    assert all(ex.get('output') and not ex.get('context') for section in support['theory']['39']['sections'] for ex in section['examples'])
