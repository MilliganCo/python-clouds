"""Course checks must distinguish typed declarations from runtime validation."""
from pathlib import Path
import runpy
import sys

import pytest

sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
import build_tasks


@pytest.fixture(scope='module')
def typed_tasks():
    tasks={t['id']:t for p in build_tasks.parse() if p['id'] in (36,37) for t in p['tasks']}
    support=build_tasks._load_support_content()['checks']
    for task_id,task in tasks.items():
        if 'check' not in task and task_id in support:
            task['check']=support[task_id]
    assert len(tasks)==18
    return tasks


@pytest.mark.parametrize(('task_id','code'),[
    ('36.7','class Point:\n    def __init__(self, x, y):\n        self.x, self.y = x, y\n    def as_tuple(self):\n        return self.x, self.y'),
    ('36.8',None),
    ('36.9',"from dataclasses import dataclass, FrozenInstanceError\n@dataclass\nclass Position:\n    x: int\n    y: int\n    def __setattr__(self, name, value):\n        if name == 'x' and hasattr(self, 'x'):\n            raise FrozenInstanceError()\n        object.__setattr__(self, name, value)\n    def moved(self, dx, dy):\n        return Position(self.x + dx, self.y + dy)"),
    ('37.7','def strlen(s):\n    return len(s)'),
    ('37.8','def find_price(prices: dict[str, int], name: str) -> int | None:\n    return prices.pop(name, None)'),
    ('37.9',None),
    ('37.9','def positive_total(values: list[int]) -> int:\n    if any(type(value) is not int for value in values):\n        raise TypeError()\n    return float(sum(value for value in values if value > 0))'),
])
def test_typed_checks_reject_wrong_structure_and_hidden_data_loss(typed_tasks,task_id,code):
    if code is None:
        code=build_tasks._reference_program(typed_tasks[task_id])
        if task_id=='36.8':
            code=code.replace('self.items.append(name)','self.items = [name]')
        else:
            code=code.replace('values: list[int]','values').replace(') -> int:','):')
    namespace={}
    exec(code,namespace)
    with pytest.raises(AssertionError):
        exec(typed_tasks[task_id]['check']['append'],namespace)


@pytest.mark.parametrize('task_id',['36.2','36.6','36.7','36.8','36.9','37.3','37.6','37.7','37.8','37.9'])
def test_typed_reference_passes(typed_tasks,task_id,capsys):
    namespace={}
    exec(build_tasks._reference_program(typed_tasks[task_id]),namespace)
    capsys.readouterr()
    exec(typed_tasks[task_id]['check']['append'],namespace)
    assert capsys.readouterr().out=='OK\n'


@pytest.mark.parametrize(('task_id','code'),[
    ('36.2',"from dataclasses import make_dataclass\nPoint = make_dataclass('Point', [('x', int), ('y', int, 0)])"),
    ('37.3','from typing import List\ndef total(numbers: List[int]) -> int:\n    return sum(numbers)'),
    ('37.8','from typing import Dict, Optional\ndef find_price(prices: Dict[str, int], name: str) -> Optional[int]:\n    return prices.get(name)'),
    ('37.9','from typing import List\ndef positive_total(values: List[int]) -> int:\n    for value in values:\n        if isinstance(value, bool) or not isinstance(value, int):\n            raise TypeError()\n    return sum(value for value in values if value > 0)'),
])
def test_equivalent_annotation_and_dataclass_forms_are_valid(typed_tasks,task_id,code,capsys):
    namespace={}
    exec(code,namespace)
    exec(typed_tasks[task_id]['check']['append'],namespace)
    assert capsys.readouterr().out=='OK\n'


def test_typed_examples_are_visible_and_standalone():
    theory=build_tasks._load_support_content()['theory']
    for topic_id in ('36','37'):
        assert all(ex.get('output') and not ex.get('context') for section in theory[topic_id]['sections'] for ex in section['examples'])
    verifier=runpy.run_path(str(Path(__file__).resolve().parents[1]/'scripts/verify_learning_content.py'))
    assert 'CONTEXT' not in verifier


def test_annotation_explanation_program_returns_but_does_not_print(typed_tasks,capsys):
    namespace={}
    exec(typed_tasks['37.2']['code'],namespace)
    assert namespace['f']('hello')=='hellohello'
    assert capsys.readouterr().out==''
