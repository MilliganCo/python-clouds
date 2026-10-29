"""Project pages have one route owner, not repeated bootstrap timers."""
from pathlib import Path
import subprocess

PLATFORM = Path(__file__).resolve().parents[1]


def test_project_module_lifecycle_and_prompt_races():
    result = subprocess.run(['node', str(PLATFORM / 'scripts/verify_project_lifecycle_unit.cjs')],
                            capture_output=True, text=True, encoding='utf-8', timeout=10)
    assert result.returncode == 0, result.stdout + result.stderr


def test_project_module_is_available_before_app_boots():
    html = (PLATFORM / 'static/index.html').read_text(encoding='utf-8')
    app = (PLATFORM / 'static/app.js').read_text(encoding='utf-8')
    assert html.index('src="project-courses.js"') < html.index('src="app.js"')
    assert 'window.ProjectCourses?.renderHomePrompts();' in app
