"""Branch selection changes presentation; saved task IDs and rewards stay stable."""
import json
from pathlib import Path
import subprocess
import sys
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
import build_tasks


def test_curriculum_navigation():
    subprocess.run(['node', str(ROOT / 'platform/scripts/verify_curriculum_unit.cjs')], check=True)


def test_library_prerequisites_exist_and_precede_topics():
    topics = build_tasks.parse()
    order = {topic['id']: i for i, topic in enumerate(topics)}
    for topic in topics:
        for prerequisite in topic.get('prerequisites', []):
            assert order[prerequisite] < order[topic['id']]
    assert {topic['id'] for topic in topics if topic.get('track') == 'tools'} >= {52, 53}
    assert all(topic.get('track', 'python') == 'python' for topic in topics if topic['id'] < 52)


def test_generated_catalog_agrees_with_canonical_metadata():
    source = (ROOT / 'platform/static/tasks.js').read_text(encoding='utf8')
    catalog = json.loads(source.split('window.TASKS = ', 1)[1].rstrip().removesuffix(';'))
    assert catalog == build_tasks.parse()


@pytest.mark.parametrize('header', [
    '**Направление:** Unknown',
    '**Предпосылки:** [0]',
    '**Предпосылки:** [1, 1]',
    '**Предпосылки:** [true]',
    '**Предпосылки:** [99]',
    '**Предпосылки:** [1]',
])
def test_parser_rejects_invalid_track_and_prerequisites(tmp_path, monkeypatch, header):
    source = tmp_path / 'collection.md'
    source.write_text('## Список\n\n## Тема 0. A\n**Уровень:** начальный\n' + header + '\n\n## Тема 1. B\n**Уровень:** начальный\n', encoding='utf8')
    monkeypatch.setattr(build_tasks, 'SRC', source)
    monkeypatch.setattr(build_tasks, 'COURSE_ORDER', (0, 1))
    with pytest.raises(ValueError):
        build_tasks.parse()
