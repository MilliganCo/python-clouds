"""Property teaching must check live values, validation and unchanged rejected state."""
from pathlib import Path
import runpy
import sys

import pytest

sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
import build_tasks


@pytest.fixture(scope='module')
def property_tasks():
    tasks={t['id']:t for p in build_tasks.parse() if p['id']==35 for t in p['tasks']}
    support=build_tasks._load_support_content()['checks']
    for task_id,task in tasks.items():
        if 'check' not in task and task_id in support:
            task['check']=support[task_id]
    assert len(tasks)==9
    return tasks


@pytest.mark.parametrize(('task_id','code'),[
    ('35.3','class Temp:\n    def __init__(self, kelvin):\n        self._k = kelvin\n        self.cached = kelvin - 273.15\n    @property\n    def celsius(self):\n        return self.cached'),
    ('35.6','class Temp:\n    def __init__(self, c):\n        self._c = c\n    @property\n    def celsius(self):\n        return self._c\n    @celsius.setter\n    def celsius(self, value):\n        self._c = 20\nt = Temp(10)\nt.celsius = 20'),
    ('35.7','class Circle:\n    def __init__(self, radius):\n        self.radius = radius\n        self.area = 3.14 * radius * radius'),
    ('35.8','class Progress:\n    def __init__(self, value=0):\n        if not 0 <= value <= 100:\n            raise ValueError()\n        self.value = value\n    @property\n    def value(self):\n        return self._value\n    @value.setter\n    def value(self, value):\n        if value < 0:\n            raise ValueError()\n        self._value = value'),
    ('35.8',None),
    ('35.9','class TextBuffer:\n    def __init__(self, text):\n        global shared_text\n        shared_text = text\n        self.text = text\n    @property\n    def length(self):\n        return len(shared_text)\n    def __setattr__(self, name, value):\n        global shared_text\n        object.__setattr__(self, name, value)\n        if name == "text":\n            shared_text = value'),
    ('35.9',None),
])
def test_property_checks_reject_stale_values_and_partial_validation(property_tasks,task_id,code):
    if code is None:
        code=build_tasks._reference_program(property_tasks[task_id])
        if task_id=='35.8':
            code=code.replace('self._value = value','self._value = int(value)')
        else:
            code+='\n    @length.setter\n    def length(self, value):\n        self.text = "changed"\n        raise AttributeError("read only")'
    namespace={}
    exec(code,namespace)
    with pytest.raises(AssertionError):
        exec(property_tasks[task_id]['check']['append'],namespace)


@pytest.mark.parametrize('task_id',['35.3','35.6','35.7','35.8','35.9'])
def test_property_reference_passes(property_tasks,task_id,capsys):
    namespace={}
    exec(build_tasks._reference_program(property_tasks[task_id]),namespace)
    capsys.readouterr()
    exec(property_tasks[task_id]['check']['append'],namespace)
    assert capsys.readouterr().out=='OK\n'


@pytest.mark.parametrize('task_id',['35.3','35.6'])
def test_property_checks_do_not_compare_demo_print(property_tasks,task_id):
    assert property_tasks[task_id]['check']['expect']=='OK'


@pytest.mark.parametrize(('task_id','code'),[
    ('35.8','class Progress:\n    def __init__(self, value=0):\n        self.value = value\n    def read(self):\n        return self.stored\n    def write(self, value):\n        if value < 0 or value > 100:\n            raise ValueError()\n        self.stored = value\n    value = property(read, write)'),
    ('35.9','class TextBuffer:\n    def __init__(self, text):\n        self.text = text\n    length = property(lambda self: len(self.text))'),
])
def test_property_constructor_form_is_also_valid(property_tasks,task_id,code,capsys):
    namespace={}
    exec(code,namespace)
    exec(property_tasks[task_id]['check']['append'],namespace)
    assert capsys.readouterr().out=='OK\n'


def test_property_examples_are_independent_and_have_no_stale_context_map():
    article=build_tasks._load_support_content()['theory']['35']
    assert all(not ex.get('context') and ex.get('output') for section in article['sections'] for ex in section['examples'])
    verifier=runpy.run_path(str(Path(__file__).resolve().parents[1]/'scripts/verify_learning_content.py'))
    assert 'CONTEXT' not in verifier
