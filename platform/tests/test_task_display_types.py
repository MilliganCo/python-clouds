"""Visible task format may be more precise than the stable grading type."""
import ast
import json
from pathlib import Path
import runpy
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
import build_tasks

CLASS_IDS = {'31.7', '31.10', '32.2', '32.6', '32.9', '32.10', '33.9', '34.7', '34.9', '34.10', '35.7', '35.8', '35.9', '36.7', '36.8', '36.9','58.2'}
MIXED_IDS = {'39.2', '39.6', '39.8', '39.9','58.5','58.6','58.8','58.9','58.10'}
TEST_IDS = {f'55.{i}' for i in (2, 3, 4, 6, 7, 9, 10)}


def test_canonical_class_formats_are_explicit_and_do_not_change_grading_type():
    tasks = [t for topic in build_tasks.parse() for t in topic['tasks']]
    marked = {t['id']: t['displayType'] for t in tasks if t.get('displayType')}
    assert marked == {**dict.fromkeys(CLASS_IDS, 'написать класс'), **dict.fromkeys(MIXED_IDS, 'класс и функция'), **dict.fromkeys(TEST_IDS, 'написать тесты')}
    for task in tasks:
        if task['type'] != 'написать функцию':
            continue
        tree = ast.parse(build_tasks._reference_program(task))
        has_class = any(isinstance(node, ast.ClassDef) for node in tree.body)
        assert has_class == (task['id'] in CLASS_IDS | MIXED_IDS), task['id']
        if task['id'] in CLASS_IDS | MIXED_IDS:
            assert task['type'] == 'написать функцию'
            has_function = any(isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) for node in tree.body)
            assert has_function == (task['id'] in MIXED_IDS)


@pytest.mark.parametrize('label', ['', 'новый тип', 'определить вывод', 'написать класс\nлишняя строка'])
def test_unknown_display_format_fails_build(label):
    raw = f'**Тип задания:** написать функцию\n\n**Название:** Example\n\n**Формат для ученика:** {label}\n\n**Условие:** x\n\n**Ответ:**\n\n```python\npass\n```\n\n**Объяснение:** x\n\n**Проверено в CPython:** да\n'
    with pytest.raises(ValueError, match='Формат для ученика'):
        build_tasks.parse_task(raw, 32, 2)


def test_display_format_cannot_change_another_execution_mode():
    raw = '**Тип задания:** демо\n\n**Название:** Example\n\n**Формат для ученика:** написать класс\n\n**Условие:** x\n\n**Ответ:**\n\n```python\npass\n```\n\n**Объяснение:** x\n\n**Проверено в CPython:** да\n'
    with pytest.raises(ValueError, match='Формат для ученика'):
        build_tasks.parse_task(raw, 32, 2)


def test_template_goals_match_class_or_combined_contract():
    generator = runpy.run_path(str(ROOT / 'platform/scripts/enrich_task_intros.py'))
    intros = build_tasks._load_support_content()['intros']
    for topic in build_tasks.parse():
        for task in topic['tasks']:
            if task['id'] not in CLASS_IDS | MIXED_IDS:
                continue
            expected = generator['build_intro'](task)
            assert intros[task['id']] == expected
            if expected['source']=='template':
                assert 'класс' in expected['goal']
                if task['id'] in CLASS_IDS:
                    assert 'функцию' not in expected['goal']


def test_legacy_visible_format_intro_starter_and_catalog_use_display_type():
    script = r"""
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const source = fs.readFileSync('platform/static/app.js', 'utf8');
const context = {window: {}, console};
vm.createContext(context);
vm.runInContext(fs.readFileSync('platform/static/lessons.js', 'utf8'), context);
const functions = ['taskTypeLabel', 'getTaskIntro', 'stageTrainHtml', 'starterCodeFor', 'topicHtml'];
const bodies = functions.map(name => {
  const start = source.indexOf('  function ' + name + '(');
  assert.ok(start >= 0, name);
  const end = source.indexOf('\n  function ', start + 1);
  return source.slice(start, end < 0 ? undefined : end);
});
const hintsStart = source.indexOf('  const HINT_BY_TYPE = ');
const hintsEnd = source.indexOf('\n  };', hintsStart) + '\n  };'.length;
vm.runInContext(source.slice(hintsStart, hintsEnd) + '\n' + bodies.join('\n'), context);
context.esc = context.inline = value => String(value).replaceAll('<', '&lt;');
context.terminalHtml = () => '';
context.solved = new Set();
context.firstUnsolvedIn = tasks => tasks[0];
context.learningHref = () => '#/topic/32/theory';
context.taskMatchesSearch = () => false;
context.pointsFor = () => 30;
context.stageTitle = task => task.title;
context.LEVEL_RU = {advanced: 'продвинутый'};
context.TOPIC_SYMBOL = {};
context.theoryTeaser = () => '';
context.window.CHALLENGES = {};
for (const [label, id] of [['написать класс', '32.2'], ['класс и функция', '39.2'], ['написать функцию', '3.5']]) {
  const task = {id, type: 'написать функцию', title: 'Task', ...(id === '3.5' ? {} : {displayType: label})};
  assert.equal(context.taskTypeLabel(task), label);
  const intro = context.getTaskIntro(task);
  const html = context.stageTrainHtml(intro, task);
  assert.ok(html.includes('Формат задания · ' + label));
  assert.ok(html.includes(context.window.TYPE_STAGE[label]));
  const listing = context.topicHtml({id: 32, title: 'classes', level: 'advanced', tasks: [task]});
  assert.ok(listing.includes('<span class="t-type">' + label + '</span>'));
  const starter = context.starterCodeFor(task);
  assert.ok(starter.includes(id === '3.5' ? 'функцию' : 'решение'));
  assert.equal(context.starterCodeFor({...task, code: 'existing code'}), 'existing code');
}
assert.equal(context.taskTypeLabel({type: 'квиз'}), 'квиз');
const authored = {goal: 'Авторская цель', explanation: 'Авторский текст'};
context.window.TASK_INTRO = {'32.2': authored};
assert.equal(context.getTaskIntro({id: '32.2', displayType: 'написать класс'}).goal, authored.goal);
const map = fs.readFileSync('platform/static/topic-map.js', 'utf8');
assert.ok(map.includes('esc(typeLabel(task))'));
assert.ok(map.includes('${typeLabel(task)}'));
assert.ok(source.includes('typeLabel: taskTypeLabel'));
assert.ok(source.includes('ALL_TASKS.map(taskTypeLabel)'));
"""
    result = subprocess.run(['node', '-e', script], cwd=ROOT, capture_output=True, text=True, encoding='utf-8', timeout=20)
    assert result.returncode == 0, result.stderr
