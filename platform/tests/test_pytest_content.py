"""A useful test suite accepts correct behavior and rejects independent defects."""
import contextlib
import io
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import build_tasks


@pytest.fixture(scope='module')
def stages():
    return {task['id']: task for topic in build_tasks.parse() if topic['id'] == 55 for task in topic['tasks']}


def checked(stage, source):
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        # Running tests is a separate operation after their definitions, as in the SPA.
        exec(source, {})
        exec(build_tasks.compose_check(stage['check'], source), {})
    assert output.getvalue().strip() == 'OK'


@pytest.mark.parametrize('task_id', ['55.2', '55.3', '55.4', '55.6', '55.7', '55.9', '55.10'])
def test_pytest_references_accept_good_functions_and_detect_all_mutants(stages, task_id):
    stage = stages[task_id]
    assert stage['check']['submissionSource'] and stage['displayType'] == 'написать тесты'
    checked(stage, stage['answer'])


@pytest.mark.parametrize(('source', 'reason'), [
    ("print('OK')", 'не нашёл ни одного теста'),
    ('def test_nothing():\n    pass', 'не вызвали ticket_price'),
    ('def test_no_assert():\n    ticket_price(30)', 'пропускают ошибку'),
    ('def test_always_fail():\n    ticket_price(30)\n    assert False', 'отвергают правильную'),
    ('import pytest\ndef test_skip():\n    ticket_price(30)\n    pytest.skip("skip")', 'Не пропускайте'),
    ('import pytest\n@pytest.mark.xfail\ndef test_xfail():\n    ticket_price(30)\n    assert False', 'Не пропускайте'),
    ('def test_broken(unknown_fixture):\n    assert ticket_price(30) == 100', 'Ошибка обнаружения или подготовки'),
    ('def test_one_example():\n    assert ticket_price(30) == 100', 'пропускают ошибку'),
])
def test_misleading_green_or_broken_suites_are_not_accepted(stages, source, reason):
    # The checker provides the subject after collection, independent of its starter body.
    with pytest.raises(AssertionError, match=reason):
        checked(stages['55.9'], source)


def test_tariff_alternative_without_parametrize_is_accepted(stages):
    source = '''import pytest
def test_tariffs():
    for age, expected in [(0,0),(6,0),(7,50),(17,50),(18,100),(64,100),(65,60)]:
        assert ticket_price(age) == expected
def test_invalid():
    with pytest.raises(ValueError):
        ticket_price(-8)
'''
    checked(stages['55.9'], source)


def test_file_alternative_with_parametrization_is_accepted(stages):
    source = '''import pytest
@pytest.mark.parametrize('text,expected', [('',''), (' \\n',''), ('b\\na\\nb\\n','b,a,b'), (' чай \\n кофе\\n','чай,кофе')])
def test_contents(tmp_path, text, expected):
    path = tmp_path / 'input.txt'
    path.write_text(text, encoding='utf-8')
    assert ','.join(load_labels(path)) == expected
def test_missing(tmp_path):
    with pytest.raises(FileNotFoundError):
        load_labels(tmp_path / 'absent.txt')
'''
    checked(stages['55.10'], source)


def test_learning_material_has_real_pytest_and_all_stage_hints(stages):
    support = build_tasks._load_support_content()
    sections = support['theory']['55']['sections']
    examples = [example for section in sections for example in section['examples']]
    assert len(examples) == 12
    assert any('subprocess.run' in example['code'] and "'pytest'" in example['code'] for example in examples)
    assert all('output' in example and not example.get('context') for example in examples)
    assert all(support['hints'].get(f'55.{i}') for i in range(1,9))
    assert all(support['intros'][task_id]['source'] == 'authored' for task_id in stages)
    assert [task.get('finale') for task in list(stages.values())[-2:]] == [1,2]
