# -*- coding: utf-8 -*-
"""Тесты проектных курсов: доступность этапов, версии кода и контекст ревью."""
import importlib
import sys
from pathlib import Path

import pytest

PLATFORM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PLATFORM))


@pytest.fixture()
def srv(tmp_path, monkeypatch):
    import server
    importlib.reload(server)
    monkeypatch.setattr(server, "DB_PATH", tmp_path / "test.db")
    import sqlite3
    conn = sqlite3.connect(server.DB_PATH)
    conn.executescript(server.SCHEMA)
    conn.close()
    server.app.config["TESTING"] = True
    return server


@pytest.fixture()
def client(srv):
    with srv.app.test_client() as c:
        yield c


def register(client, name="project_user", pwd="secret123"):
    return client.post("/api/register", json={"username": name, "password": pwd})


def solve_topic(client, srv, topic_id):
    ids = sorted(
        task_id for task_id in srv.TASKS_META
        if task_id.startswith(f"{topic_id}.") and not task_id.startswith("C")
    )
    assert ids, f"topic {topic_id} has no generated tasks"
    for task_id in ids:
        r = client.post("/api/progress", json={"task_id": task_id, "solved": True})
        assert r.status_code == 200


def test_project_courses_are_locked_until_required_topics_are_complete(client, srv):
    register(client)

    data = client.get("/api/project-courses").get_json()
    bot = next(c for c in data["courses"] if c["id"] == "chatbot_to_telegram")
    assert bot["status"] == "unavailable"
    assert bot["next_stage"]["status"] == "unavailable"

    solve_topic(client, srv, 1)
    data = client.get("/api/project-courses").get_json()
    bot = next(c for c in data["courses"] if c["id"] == "chatbot_to_telegram")
    assert bot["status"] == "available"
    assert bot["next_stage"]["id"] == "hello_name"
    assert bot["next_stage"]["status"] == "available"


def test_project_courses_have_quest_identity(client):
    register(client)
    courses = client.get("/api/project-courses").get_json()["courses"]
    assert len(courses) >= 5
    assert [c["id"] for c in courses if c['kind'] != 'local_practice'] == [
        "chatbot_to_telegram",
        "generative_poster",
        "text_analyzer",
        "habit_tracker",
        "python_game",
    ]
    emblems = {c["emblem"] for c in courses}
    accents = {c["accent"] for c in courses}
    assert emblems == {"bot", "analyzer", "habits", "poster", "game"}
    assert accents == {"cyan", "amber", "mint", "violet", "coral"}
    bot = next(c for c in courses if c["id"] == "chatbot_to_telegram")
    assert bot["quest_label"] == "Квест связи"
    assert bot["short_title"] == "Бот-собеседник"
    assert bot["track_order"] == 1
    assert bot["next_stage"]["required_topic_titles"] == ["Переменные и типы данных"]


def test_project_track_unlocks_ladder(client, srv):
    register(client)
    courses = {c["id"]: c for c in client.get("/api/project-courses").get_json()["courses"]}
    assert courses["chatbot_to_telegram"]["status"] == "unavailable"
    assert courses["generative_poster"]["status"] == "unavailable"

    solve_topic(client, srv, 1)
    courses = {c["id"]: c for c in client.get("/api/project-courses").get_json()["courses"]}
    assert courses["chatbot_to_telegram"]["status"] == "available"
    assert courses["generative_poster"]["status"] == "unavailable"

    for topic in (2, 3, 4, 5, 6, 7):
        solve_topic(client, srv, topic)
    courses = {c["id"]: c for c in client.get("/api/project-courses").get_json()["courses"]}
    assert courses["generative_poster"]["status"] == "available"
    assert courses["text_analyzer"]["status"] == "unavailable"

    prompts = client.get("/api/project-courses/prompts").get_json()["prompts"]
    assert any(p["course_id"] == "generative_poster" and p.get("kind") == "start" for p in prompts)


def test_start_save_complete_and_restore_project_stage(client, srv):
    register(client)
    solve_topic(client, srv, 1)
    solve_topic(client, srv, 3)

    start = client.post("/api/project-courses/chatbot_to_telegram/start")
    assert start.status_code == 200
    assert start.get_json()["course"]["status"] == "continue"

    # обычный автосейв (без snapshot: True) не создаёт новую версию — иначе
    # список версий рос бы на каждую паузу в наборе текста
    code_draft = "name = input('Как вас зовут? ')\n"
    autosave = client.post(
        "/api/project-courses/chatbot_to_telegram/stages/hello_name/save",
        json={"code": code_draft},
    )
    assert autosave.status_code == 200
    assert autosave.get_json()["snapshot"] is None

    code_v1 = "name = input('Как вас зовут? ')\nprint('Привет, ' + name)\n"
    save = client.post(
        "/api/project-courses/chatbot_to_telegram/stages/hello_name/save",
        json={"code": code_v1, "snapshot": True},
    )
    assert save.status_code == 200
    assert save.get_json()["snapshot"]["version"] == 2

    complete = client.post(
        "/api/project-courses/chatbot_to_telegram/stages/hello_name/complete",
        json={"code": code_v1, "check": {"ok": True, "stdout": "Привет, Аня"}},
    )
    assert complete.status_code == 200
    detail = complete.get_json()
    assert detail["stage"]["status"] == "completed"
    assert detail["course"]["completed_stages"] == 1

    code_v2 = code_v1 + "print('Версия испорчена')\n"
    client.post(
        "/api/project-courses/chatbot_to_telegram/stages/hello_name/save",
        json={"code": code_v2},
    )
    restore = client.post(
        "/api/project-courses/chatbot_to_telegram/stages/hello_name/restore",
        json={"snapshot_id": detail["snapshot"]["id"]},
    )
    assert restore.status_code == 200
    assert restore.get_json()["stage"]["current_code"] == code_v1

    course = client.get("/api/project-courses/chatbot_to_telegram").get_json()["course"]
    stage = next(s for s in course["stages"] if s["id"] == "hello_name")
    assert stage["current_code"] == code_v1
    # старт, явный save, complete — автосейвы и восстановление версий не добавляют
    assert len(stage["snapshots"]) == 3


def test_locked_stage_cannot_be_saved_or_completed(client, srv):
    register(client)
    solve_topic(client, srv, 1)
    solve_topic(client, srv, 3)
    client.post("/api/project-courses/chatbot_to_telegram/start")

    save = client.post(
        "/api/project-courses/chatbot_to_telegram/stages/conditions/save",
        json={"code": "print('too early')"},
    )
    assert save.status_code == 409

    complete = client.post(
        "/api/project-courses/chatbot_to_telegram/stages/conditions/complete",
        json={"code": "print('too early')", "check": {"ok": True}},
    )
    assert complete.status_code == 409


def test_return_prompt_appears_after_relevant_topic_and_can_be_dismissed(client, srv):
    register(client)
    solve_topic(client, srv, 1)
    solve_topic(client, srv, 3)
    client.post("/api/project-courses/chatbot_to_telegram/start")
    client.post(
        "/api/project-courses/chatbot_to_telegram/stages/hello_name/complete",
        json={"code": "name = input()\nprint('Привет, ' + name)\n", "check": {"ok": True}},
    )

    assert client.get("/api/project-courses/prompts").get_json()["prompts"] == []

    solve_topic(client, srv, 6)
    prompts = client.get("/api/project-courses/prompts").get_json()["prompts"]
    assert len(prompts) == 1
    assert prompts[0]["course_id"] == "chatbot_to_telegram"
    assert prompts[0]["stage_id"] == "conditions"
    assert "условия" in prompts[0]["message"].lower()

    dismiss = client.post(
        "/api/project-courses/prompts/dismiss",
        json={"course_id": "chatbot_to_telegram", "stage_id": "conditions"},
    )
    assert dismiss.status_code == 200
    assert client.get("/api/project-courses/prompts").get_json()["prompts"] == []


def test_review_prompt_contains_project_context(srv):
    prompt = srv.build_review_prompt(
        {
            "id": "project:chatbot_to_telegram:hello_name",
            "type": "проектный этап",
            "prompt": "Спросите имя и поприветствуйте пользователя.",
            "answer": "Проверяется поведением программы.",
            "project_context": {
                "course_title": "Бот-собеседник -> Telegram-бот",
                "stage_title": "Персональное приветствие",
                "previous_stage_summary": "Уже есть простое приветствие.",
                "learned_topics": ["Переменные и типы данных", "Строки"],
            },
        },
        {"ok": True, "code": "name = input()\nprint('Привет, ' + name)"},
    )
    assert "ПРОЕКТНЫЙ КОНТЕКСТ" in prompt
    assert "Бот-собеседник" in prompt
    assert "Уже есть простое приветствие" in prompt


@pytest.mark.parametrize('course_id', ['practice_local_file', 'practice_traceback', 'practice_docs', 'practice_tests', 'practice_environment', 'practice_git', 'practice_project_reading', 'practice_data_safety', 'practice_api_response', 'practice_file_organizer', 'practice_html_report', 'practice_debugger'])
def test_local_practice_manual_evidence_is_private_and_does_not_reward(client, srv, course_id):
    register(client)
    course = srv.pc.get_course(course_id)
    url = '/api/project-courses/' + course_id
    assert client.post(url + '/start').status_code == 409
    for topic in course['unlock_topics']:
        solve_topic(client, srv, topic)
    assert client.post(url + '/start').status_code == 200
    stage = course['stages'][0]
    assert 'reference_code' not in stage
    endpoint = url + '/stages/' + stage['id']
    checked = [item['id'] for item in stage['local_practice']['checklist']]
    evidence = {'checked': checked, 'reflection': 'Проверил свой файл, сохранил и повторно запустил его.'}
    before = client.get('/api/wallet').get_json()['drops'], client.get('/api/progress').get_json()['xp']
    for invalid in [None, [], {}, {'checked': checked, 'reflection': 'да'},
                    {'checked': checked + checked, 'reflection': evidence['reflection']},
                    {'checked': ['unknown'], 'reflection': evidence['reflection']},
                    {'checked': checked, 'reflection': 1}, {'checked': checked, 'reflection': 'x' * 2001}]:
        assert client.post(endpoint + '/complete', json={'check': {'ok': True}, 'local_evidence': invalid}).status_code == 400
    assert client.post(endpoint + '/complete', json={'local_evidence': evidence}).status_code == 400
    partial = {'checked': checked[:1], 'reflection': 'мой черновик'}
    saved = client.post(endpoint + '/save', json={'code': 'print(1)', 'snapshot': True, 'local_evidence': partial}).get_json()
    assert saved['stage']['local_evidence'] == partial
    done = client.post(endpoint + '/complete', json={'code': 'print(2)', 'check': {'ok': True}, 'local_evidence': evidence}).get_json()
    assert done['stage']['status_label'] == 'самопроверка завершена'
    assert done['course']['status'] == 'completed'
    assert client.post(endpoint + '/restore', json={'snapshot_id': saved['snapshot']['id']}).get_json()['stage']['local_evidence'] == evidence
    assert client.get(url).get_json()['course']['stages'][0]['local_evidence'] == evidence
    assert before == (client.get('/api/wallet').get_json()['drops'], client.get('/api/progress').get_json()['xp'])
    client.post('/api/logout')
    register(client, name='another_learner')
    assert client.get(url).get_json()['course']['stages'][0]['local_evidence'] == {}
