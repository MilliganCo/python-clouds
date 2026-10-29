from pathlib import Path
import subprocess

STATIC = Path(__file__).resolve().parents[1] / 'static'


def test_shared_editor_keyboard_contract():
    run = subprocess.run(['node', str(STATIC.parent / 'scripts/verify_editor_keys_unit.cjs')],
                         capture_output=True, text=True, encoding='utf-8', timeout=10)
    assert run.returncode == 0, run.stdout + run.stderr


def test_keyboard_asset_precedes_consumers_and_targets_remain_focusable():
    html = (STATIC / 'index.html').read_text(encoding='utf-8')
    assert html.count('src="editor-keys.js"') == 1
    assert html.index('src="editor-keys.js"') < html.index('src="project-courses.js"') < html.index('src="app.js"')
    assert 'id="skipContent"' in html
    assert 'id="listView" tabindex="-1"' in html
    assert 'id="taskView" tabindex="-1"' in html


def test_visible_editor_labels_and_answer_descriptions():
    html = (STATIC / 'index.html').read_text(encoding='utf-8')
    app = (STATIC / 'app.js').read_text(encoding='utf-8')
    projects = (STATIC / 'project-courses.js').read_text(encoding='utf-8')
    assert '<label class="terminal-title" for="sandboxEditor">main.py</label>' in html
    assert '<label class="terminal-title" for="projectEditor">project.py</label>' in projects
    assert 'editorId: "dailyEditor"' in app
    assert app.count('editorId: "editor"') == 2  # demo and solution branches
    assert 'aria-labelledby="answerOutputTitle" aria-describedby="answerOutputHint"' in app
    assert 'id="answerOutputTitle"' in app and 'id="answerOutputHint"' in app
    assert 'id="taskNotesTitle"' in app and 'aria-labelledby="taskNotesTitle"' in app
    assert '<label for="showHelperCode">Код дополнительного файла</label>' in projects
