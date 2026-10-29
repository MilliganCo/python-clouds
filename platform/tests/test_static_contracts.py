# -*- coding: utf-8 -*-
"""Контрактные проверки статического UI против серверного каталога магазина."""
import importlib
import re
import sys
from pathlib import Path

PLATFORM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PLATFORM))


def test_stage_intro_templates_do_not_introduce_unrelated_code():
    import runpy

    generator = runpy.run_path(str(PLATFORM / "scripts" / "enrich_task_intros.py"))
    for task_type in generator["TYPE_GOALS"]:
        task = {"id": "1.1", "type": task_type, "title": "Переменные"}
        intro = generator["build_intro"](task)
        assert intro["example"] is None
        assert intro["application"] == ""
        assert generator["is_bootstrap"](intro)
        # Старые шаблоны всех типов тоже должны мигрировать, не только output.
        old_intro = {"explanation": generator["TYPE_EXPLANATION_TAIL"][task_type]}
        assert generator["is_bootstrap"](old_intro)
    assert not generator["is_bootstrap"]({"goal": "Авторский разбор присваивания"})
    for task_id, authored in generator["FIRST_FUNCTIONS"].items():
        intro = generator["build_intro"]({"id": task_id})
        assert intro["explanation"] == authored["explanation"]
        assert intro["example"] is None


def test_required_topic_finales_and_theory_results():
    sys.path.insert(0, str(PLATFORM.parent))
    import build_tasks

    topics = build_tasks.parse()
    assert len(topics) == 66
    assert sum(len(t["tasks"]) for t in topics) == 642
    for topic in topics:
        tasks = topic["tasks"]
        assert [t.get("finale") for t in tasks[-2:]] == [1, 2]
        assert not any(t.get("finale") for t in tasks[:-2])
        for task in tasks[-2:]:
            assert task["hint"] and task["check"]["append"] and task["check"]["expect"]
    support = build_tasks._load_support_content()
    examples = [e for a in support["theory"].values() for s in a.get("sections", []) for e in s.get("examples", [])]
    assert len(examples) == 656
    for topic_id in ('52', '53'):
        article = support['theory'][topic_id]
        assert 'pandas' in article['title']
        assert len(article['sections']) == 12
        assert all(not example.get('context') for section in article['sections'] for example in section['examples'])
    for example in examples:
        assert "output" in example or (example.get("codeLanguage") == "shell" and example.get("resultNote"))
    assert support["theory"]["14"]["sections"][1]["examples"][1]["output"] == "['запуск']"
    app = (PLATFORM / "static/app.js").read_text(encoding="utf-8")
    assert "if (t.check) window.CHECKS[t.id] = t.check" in app
    assert 'Object.hasOwn(ex, "output")' in app
    html = (PLATFORM / 'static/index.html').read_text(encoding='utf-8')
    assert 'theory-articles-52-53.js' in html
    assert 'test-report.js' in html
    assert 'taskTests' in app and 'dailyTests' in app
    assert 'projectTests' in (PLATFORM / 'static/project-courses.js').read_text(encoding='utf-8')


def _array_items(source, name):
    match = re.search(rf"const\s+{name}\s*=\s*\[(.*?)\]", source, re.S)
    assert match, f"{name} not found in static/app.js"
    return set(re.findall(r'"([^"]+)"', match.group(1)))


def test_shop_apply_lists_cover_all_visual_items():
    import server
    importlib.reload(server)
    source = (PLATFORM / "static" / "app.js").read_text(encoding="utf-8", errors="ignore")

    sky_keys = {k for k, item in server.SHOP.items() if item.get("kind") == "sky"}
    term_keys = {k for k, item in server.SHOP.items() if item.get("kind") == "term"}
    fx_keys = {k for k, item in server.SHOP.items() if item.get("kind") == "fx"}

    assert sky_keys <= _array_items(source, "SKY_SKINS")
    assert term_keys <= _array_items(source, "TERM_THEMES")
    assert fx_keys <= _array_items(source, "FX_OVERLAYS")
    assert "sky-fx-leaves" in (PLATFORM / "static" / "index.html").read_text(encoding="utf-8", errors="ignore")
    assert "fx-leaves" in (PLATFORM / "static" / "styles.css").read_text(encoding="utf-8", errors="ignore")


def test_server_challenge_ids_match_legacy_catalog():
    import server
    importlib.reload(server)
    source = (PLATFORM / "static" / "challenges.js").read_text(encoding="utf-8")
    legacy_ids = set(re.findall(r'\bid:\s*"(C\d+\.\d+)"\s*,\s*topicId:', source))

    assert len(legacy_ids) == 8
    assert legacy_ids == set(server.CHALLENGE_IDS)


def test_order_game_puzzles_have_goal_output_and_lines():
    source = (PLATFORM / "static" / "minigame.js").read_text(encoding="utf-8", errors="ignore")
    match = re.search(r"const\s+ORDER_PUZZLES\s*=\s*\[(.*?)\];", source, re.S)
    assert match, "ORDER_PUZZLES not found"
    block = match.group(1)
    puzzle_count = len(re.findall(r"\{\s*goal:", block))

    assert puzzle_count >= 28
    assert len(re.findall(r"\bgoal:", block)) == puzzle_count
    assert len(re.findall(r"\boutput:", block)) == puzzle_count
    assert len(re.findall(r"\blines:", block)) == puzzle_count


def test_minigames_have_broader_variation_pools():
    source = (PLATFORM / "static" / "minigame.js").read_text(encoding="utf-8", errors="ignore")
    blitz_block = re.search(r"const\s+BLITZ_QUESTIONS\s*=\s*\[(.*?)\];", source, re.S).group(1)
    match_block = re.search(r"const\s+MATCH_PAIRS\s*=\s*\[(.*?)\];", source, re.S).group(1)
    trace_block = re.search(r"const\s+TRACE_ITEMS\s*=\s*\[(.*?)\];", source, re.S).group(1)
    fill_block = re.search(r"const\s+FILL_ITEMS\s*=\s*\[(.*?)\];", source, re.S).group(1)

    assert len(re.findall(r',\s*(?:true|false)\]', blitz_block)) >= 100
    assert len(re.findall(r"\[[^\[\]]+,\s*[^\[\]]+\]", match_block)) >= 45
    assert len(re.findall(r"\banswer:", trace_block)) >= 28
    assert len(re.findall(r"\banswer:", fill_block)) >= 28


def test_home_and_topics_nav_routes_exist():
    html = (PLATFORM / "static" / "index.html").read_text(encoding="utf-8", errors="ignore")
    assert 'data-route="home" href="#/"' in html
    assert ">Главная<" in html
    assert 'data-route="topics" href="#/topics"' in html
    assert ">Темы<" in html
    app = (PLATFORM / "static" / "app.js").read_text(encoding="utf-8", errors="ignore")
    assert 'location.hash === "#/topics"' in app
    assert "function renderHome()" in app
    assert "function renderTopicsCatalog(" in app
    assert "home-mode" in (PLATFORM / "static" / "styles.css").read_text(encoding="utf-8", errors="ignore")


def test_course_progress_counter_excludes_challenges():
    app = (PLATFORM / "static" / "app.js").read_text(encoding="utf-8", errors="ignore")

    assert "function courseSolvedCount()" in app
    assert app.count("courseSolvedCount()") >= 3
    assert '"решено " + solved.size + " / " + ALL_TASKS.length' not in app
    assert "const done = solved.size;" not in app


def test_wallet_updates_every_visible_balance():
    app = (PLATFORM / "static" / "app.js").read_text(encoding="utf-8", errors="ignore")

    assert app.count("data-wallet-drops") >= 3
    assert 'document.querySelectorAll("[data-wallet-drops]")' in app


def test_review_queue_has_legacy_route_home_entry_and_attempt_logging():
    app = (PLATFORM / "static" / "app.js").read_text(encoding="utf-8", errors="ignore")

    assert 'location.hash === "#/review"' in app
    assert 'api("/api/review-queue")' in app
    assert 'post("/api/attempts"' in app
    assert "Повторить ошибки" in app


def test_home_groups_secondary_destinations_instead_of_equal_cards():
    app = (PLATFORM / "static" / "app.js").read_text(encoding="utf-8", errors="ignore")

    assert 'class="dash-card bento-more"' in app
    assert 'class="dashboard-more-links"' in app
    assert 'class="dash-card bento-projects"' not in app
    assert 'class="dash-card bento-showcase"' not in app
    assert 'class="dash-card bento-shop"' not in app


def test_task_page_puts_work_before_supporting_panels():
    app = (PLATFORM / "static" / "app.js").read_text(encoding="utf-8", errors="ignore")
    flow = app.index('<div class="pane flow-task">')
    hints = app.index('<details class="pane hints-pane">', flow)
    notes = app.index('<details class="pane notes-pane">', hints)

    assert flow < hints < notes
    assert '<div class="pane intro-pane">' not in app


def test_mobile_layout_uses_body_scroll_and_static_sky():
    css = (PLATFORM / "static" / "styles.css").read_text(encoding="utf-8", errors="ignore")
    app = (PLATFORM / "static" / "app.js").read_text(encoding="utf-8", errors="ignore")

    assert "body.home-mode,\nbody.list-mode {\n  overflow: hidden" not in css
    assert "grid-template-columns: repeat(auto-fit, minmax(min(100%, 3.75em), 1fr))" in css
    assert "body.home-mode .daily-ai-list" in css
    assert "grid-template-columns: 1fr" in css
    assert 'window.addEventListener("scroll"' not in app
    assert '$("topics").addEventListener("scroll"' not in app
    assert "requestAnimationFrame(frame)" not in app
    assert "isolation: isolate" in css
    assert "sky-base-scroll" not in css


def test_editor_is_full_code_without_gap_mode():
    app = (PLATFORM / "static" / "app.js").read_text(encoding="utf-8", errors="ignore")
    html = (PLATFORM / "static" / "index.html").read_text(encoding="utf-8", errors="ignore")

    assert "modeFull" not in app
    assert "gapWrap" not in app
    assert "gapInput" not in app
    assert "свободный режим" not in app
    assert "term-reset-btn" in app
    assert "starterCodeFor" in app
    assert "renderTheoryArticle" in app
    assert "#/topic/" in app
    assert "nerd-icons.css" in html
    assert "theory-articles-13-25.js" in html
    assert "theory-articles-26-39.js" in html
    assert "theory-articles-40-50.js" in html
    assert "Symbols Nerd Font" in (PLATFORM / "static" / "nerd-icons.css").read_text(encoding="utf-8")
    assert "ryanoasis/nerd-fonts" in (PLATFORM / "static" / "nerd-icons.css").read_text(encoding="utf-8")


def test_generate_choices_dedups_authored_wrong():
    app = (PLATFORM / "static" / "app.js").read_text(encoding="utf-8", errors="ignore")
    assert "new Set(" in app
    assert "task.wrong" in app


def test_verification_badge_and_cpython_version_follow_content_and_runtime():
    app = (PLATFORM / "static" / "app.js").read_text(encoding="utf-8", errors="ignore")
    html = (PLATFORM / "static" / "index.html").read_text(encoding="utf-8", errors="ignore")
    # The learner sees a badge only for tasks carrying verified metadata.
    # Interpreter version is a runtime/content contract, not hard-coded UI copy.
    assert re.search(r'/\^да/i\.test\(task\.verified\s*\|\|\s*""\).*chip-verified', app)
    assert 'Эталон задания проверен' in app
    assert "CPython 3.12" not in app
    assert "CPython 3.12" not in html
    dockerfile = (PLATFORM / "sandbox" / "Dockerfile").read_text(encoding="utf-8")
    verifier = (PLATFORM / "scripts" / "verify_learning_content.py").read_text(encoding="utf-8")
    builder = (PLATFORM.parent / "build_tasks.py").read_text(encoding="utf-8")
    assert re.search(r"^FROM python:3\.14(?:\.\d+)?-", dockerfile, re.M)
    assert "sys.version_info[:2] == (3, 14)" in verifier
    assert '"python_runtime": "3.14.x"' in builder
    assert 'field(raw, r"Проверено в CPython"' in builder
