"""Current documentation must match the runtime catalog, not old topic positions."""
import ast
from pathlib import Path
import re
import sys

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'platform'))
sys.path.insert(0, str(ROOT))
import build_tasks
import project_courses as pc

DOC = ROOT / 'platform/docs/PROJECT_COURSES_CONTENT.md'
MAIN = sorted(pc.PROJECT_COURSES, key=lambda course: course['track_order'])
LOCAL = [course for course in pc.all_courses() if course.get('kind') == 'local_practice']
TOPIC_NAMES = {topic['id']: topic['title'].replace('`', '') for topic in build_tasks.parse()}


def topic_labels(ids):
    return '; '.join(f'{topic_id} — {TOPIC_NAMES[topic_id]}' for topic_id in ids) or '—'


def rows(section):
    return [[field.strip() for field in line.split('|')[1:-1]] for line in section.splitlines()
            if line.startswith('| `')]


@pytest.mark.parametrize('course', MAIN, ids=lambda course: course['id'])
def test_main_project_dependency_rows_match_current_catalog(course):
    document = DOC.read_text(encoding='utf-8')
    marker = f"<!-- course:{course['id']} -->"
    assert document.count(marker) == 1
    section = document.split(marker, 1)[1].split('<!-- /course -->', 1)[0]
    assert f"Для открытия курса: {topic_labels(pc.course_unlock_topics(course))}." in section
    expected = []
    for stage in course['stages']:
        reminder = stage.get('return_after_topic')
        expected.append([
            f"`{stage['id']}`", stage['title'], topic_labels(stage.get('requirements', {}).get('topics', [])),
            topic_labels(stage.get('desired_topics', [])), topic_labels([reminder]) if reminder is not None else '—',
            stage.get('summary', ''),
        ])
    assert rows(section) == expected
    assert [document.index(f"<!-- course:{item['id']} -->") for item in MAIN] == sorted(document.index(f"<!-- course:{item['id']} -->") for item in MAIN)


@pytest.mark.parametrize('course', LOCAL, ids=lambda course: course['id'])
def test_local_quest_dependencies_are_explicit(course):
    document = DOC.read_text(encoding='utf-8').split('<!-- local_practice -->', 1)[1].split('<!-- /local_practice -->', 1)[0]
    actual = [row for row in rows(document) if row[0] == f"`{course['id']}`"]
    expected = [[f"`{course['id']}`", course.get('short_title', course['title']), f"`{stage['id']}`",
                 topic_labels(pc.course_unlock_topics(course)), topic_labels(stage.get('requirements', {}).get('topics', []))]
                for stage in course['stages']]
    assert actual == expected


def test_dependency_example_matches_a_real_stage():
    document = (ROOT / 'platform/docs/PROJECT_COURSES.md').read_text(encoding='utf-8').split('## Зависимости', 1)[1].split('## UX-потоки', 1)[0]
    example = ast.literal_eval(re.search(r'```python\n(.*?)\n```', document, re.S)[1])
    stage = pc.get_stage(pc.get_course('chatbot_to_telegram'), 'commands')
    assert example == {key: stage[key] for key in ('requirements', 'desired_topics', 'return_after_topic')}


def test_document_has_no_orphan_courses_or_stale_counts():
    document = DOC.read_text(encoding='utf-8')
    assert re.findall(r'<!-- course:([a-z_]+) -->', document) == [course['id'] for course in MAIN]
    local = document.split('<!-- local_practice -->', 1)[1].split('<!-- /local_practice -->', 1)[0]
    assert [row[0] for row in rows(local)] == [f"`{course['id']}`" for course in LOCAL for stage in course['stages']]
    assert f"{len(MAIN)} проектных курсов ({sum(len(course['stages']) for course in MAIN)} этапов) и {len(LOCAL)} локальных" in document
    assert f"мини-квестов ({sum(len(course['stages']) for course in LOCAL)} этапов)" in document


def test_referenced_topic_titles_agree_with_canonical_topics():
    ids = set()
    for course in pc.all_courses():
        ids.update(pc.course_unlock_topics(course))
        for stage in course['stages']:
            ids.update(stage.get('requirements', {}).get('topics', []))
            ids.update(stage.get('desired_topics', []))
            if stage.get('return_after_topic') is not None:
                ids.add(stage['return_after_topic'])
    assert all(pc.TOPIC_TITLES[topic_id] == TOPIC_NAMES[topic_id] for topic_id in ids)


def test_local_catalog_explains_isolated_execution():
    source = (ROOT / 'platform/static/project-courses.js').read_text(encoding='utf-8')
    assert 'Код проверяется в изолированной среде платформы' in source
    assert 'Код проверяется в браузере' not in source
