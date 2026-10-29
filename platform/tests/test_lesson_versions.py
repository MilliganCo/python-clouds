"""Supplemental lessons follow the material, not only its historical ID."""
import copy
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import subprocess

import pytest

from test_platform import client, register


@pytest.fixture(params=["stage", "topic"])
def lesson_request(request):
    theory = {"lead": "Объект хранит данные", "sections": [{"title": "self", "text": "Текущий объект"}]}
    if request.param == "stage":
        return "/api/ai/lesson", {"task": {"id": "32.1", "type": "написать функцию", "prompt": "Создайте класс", "code": "class Example: pass"}, "theory": theory}
    return "/api/ai/topic-lesson", {"topic": {"id": 32, "title": "Классы", "description": "Свои объекты", "theory": theory}}


def test_same_content_reuses_cache_with_ai_offline(client, monkeypatch, lesson_request):
    import server as srv
    register(client)
    url, payload = lesson_request
    calls = []
    monkeypatch.setattr(srv, "ai_available", lambda: True)
    monkeypatch.setattr(srv, "call_opencode", lambda prompt, **kw: calls.append(prompt) or ("актуальный урок", None))
    assert client.post(url, json=payload).get_json() == {"lesson": "актуальный урок", "cached": False}
    monkeypatch.setattr(srv, "ai_available", lambda: False)
    assert client.post(url, json=payload).get_json() == {"lesson": "актуальный урок", "cached": True}
    assert len(calls) == 1


@pytest.mark.parametrize("change", ["statement", "theory", "system"])
def test_changed_material_creates_version_and_keeps_previous(client, monkeypatch, lesson_request, change):
    import server as srv
    register(client)
    url, payload = lesson_request
    monkeypatch.setattr(srv, "ai_available", lambda: True)
    calls = []
    monkeypatch.setattr(srv, "call_opencode", lambda prompt, **kw: calls.append(prompt) or (f"урок {len(calls)}", None))
    assert client.post(url, json=payload).get_json()["lesson"] == "урок 1"
    updated = copy.deepcopy(payload)
    system_name = "LESSON_SYSTEM" if "task" in payload else "TOPIC_LESSON_SYSTEM"
    original_system = getattr(srv, system_name)
    if change == "system":
        monkeypatch.setattr(srv, system_name, original_system + "\nНовый формат урока")
    elif "task" in payload:
        if change == "statement":
            updated["task"]["prompt"] += " с независимыми данными"
        else:
            updated["theory"]["sections"][0]["text"] += " и его состояние"
    elif change == "statement":
        updated["topic"]["description"] += " с независимыми данными"
    else:
        updated["topic"]["theory"]["sections"][0]["text"] += " и его состояние"
    monkeypatch.setattr(srv, "ai_available", lambda: False)
    assert client.post(url, json=updated).get_json() == {"lesson": None, "cached": False}
    monkeypatch.setattr(srv, "ai_available", lambda: True)
    assert client.post(url, json=updated).get_json() == {"lesson": "урок 2", "cached": False}
    monkeypatch.setattr(srv, system_name, original_system)
    assert client.post(url, json=payload).get_json() == {"lesson": "урок 1", "cached": True}
    assert len(calls) == 2
    with sqlite3.connect(srv.DB_PATH) as conn:
        assert conn.execute("SELECT count(*) FROM ai_lesson_versions").fetchone()[0] == 2


def test_code_change_invalidates_stage_but_answers_never_enter_prompt(client, monkeypatch):
    import server as srv
    register(client)
    calls = []
    monkeypatch.setattr(srv, "ai_available", lambda: True)
    monkeypatch.setattr(srv, "call_opencode", lambda prompt, **kw: calls.append(prompt) or ("урок", None))
    payload = {"task": {"id": "32.1", "prompt": "Прочитайте код", "code": "class Label: pass", "answer": "PRIVATE_ANSWER", "check": "PRIVATE_CHECK", "explanation": "PRIVATE_EXPLANATION"}}
    assert client.post("/api/ai/lesson", json=payload).get_json()["cached"] is False
    payload["task"]["code"] = "class Label: value = 1"
    assert client.post("/api/ai/lesson", json=payload).get_json()["cached"] is False
    assert len(calls) == 2
    assert "class Label: value = 1" in calls[-1]
    assert all(secret not in prompt for prompt in calls for secret in ("PRIVATE_ANSWER", "PRIVATE_CHECK", "PRIVATE_EXPLANATION"))


def test_failed_generation_is_not_cached(client, monkeypatch, lesson_request):
    import server as srv
    register(client)
    url, payload = lesson_request
    monkeypatch.setattr(srv, "ai_available", lambda: True)
    monkeypatch.setattr(srv, "call_opencode", lambda *a, **kw: None)
    assert client.post(url, json=payload).get_json() == {"lesson": None, "cached": False}
    monkeypatch.setattr(srv, "call_opencode", lambda *a, **kw: ("после сбоя", None))
    assert client.post(url, json=payload).get_json() == {"lesson": "после сбоя", "cached": False}


def test_legacy_cache_survives_schema_upgrade_but_is_not_reused(client, monkeypatch):
    import server as srv
    register(client)
    with sqlite3.connect(srv.DB_PATH) as conn:
        conn.execute("DROP TABLE ai_lesson_versions")
        conn.execute("INSERT INTO ai_lessons VALUES ('32.1', 'старый этап', 'then')")
        conn.execute("INSERT INTO ai_topic_lessons VALUES (32, 'старая тема', 'then')")
        conn.executescript(srv.SCHEMA)
        conn.executescript(srv.SCHEMA)
        assert conn.execute("SELECT text FROM ai_lessons").fetchone()[0] == "старый этап"
        assert conn.execute("SELECT text FROM ai_topic_lessons").fetchone()[0] == "старая тема"
    monkeypatch.setattr(srv, "ai_available", lambda: False)
    assert client.post("/api/ai/lesson", json={"task": {"id": "32.1"}}).get_json() == {"lesson": None, "cached": False}
    assert client.post("/api/ai/topic-lesson", json={"topic": {"id": 32}}).get_json() == {"lesson": None, "cached": False}


def test_same_version_returns_first_published_text(client, monkeypatch, lesson_request):
    import server as srv
    register(client)
    url, payload = lesson_request
    monkeypatch.setattr(srv, "ai_available", lambda: True)
    def publish_other_completion(prompt, **kwargs):
        kind = "stage" if "task" in payload else "topic"
        subject = str(payload.get("task", payload.get("topic"))["id"])
        digest = hashlib.sha256(prompt.encode("utf-8")).hexdigest()
        with sqlite3.connect(srv.DB_PATH) as conn:
            conn.execute("INSERT INTO ai_lesson_versions VALUES (?, ?, ?, ?, ?)", (kind, subject, digest, "первый вариант", "now"))
        return "поздний вариант", None
    monkeypatch.setattr(srv, "call_opencode", publish_other_completion)
    assert client.post(url, json=payload).get_json() == {"lesson": "первый вариант", "cached": False}
    assert client.post(url, json=payload).get_json() == {"lesson": "первый вариант", "cached": True}


def test_json_key_order_does_not_create_version(client, monkeypatch, lesson_request):
    import server as srv
    register(client)
    url, payload = lesson_request
    monkeypatch.setattr(srv, "ai_available", lambda: True)
    monkeypatch.setattr(srv, "call_opencode", lambda *a, **kw: ("тот же урок", None))
    assert client.post(url, json=payload).get_json()["cached"] is False
    def reverse_keys(value):
        if isinstance(value, dict):
            return {k: reverse_keys(v) for k, v in reversed(value.items())}
        if isinstance(value, list):
            return [reverse_keys(v) for v in value]
        return value
    response = client.post(url, data=json.dumps(reverse_keys(payload), ensure_ascii=False), content_type="application/json")
    assert response.get_json() == {"lesson": "тот же урок", "cached": True}


@pytest.mark.parametrize("button,endpoint", [("lessonBtn", "/api/ai/lesson"), ("topicLessonBtn", "/api/ai/topic-lesson")])
def test_legacy_lesson_click_sends_full_article_not_student_solution(button, endpoint):
    app = (Path(__file__).resolve().parents[1] / "static/app.js").read_text(encoding="utf-8")
    match = re.search(rf'\$\("{button}"\)\.addEventListener\("click", (async \(\) => \{{.*?\n    \}})\);', app, re.S)
    assert match
    script = r"""
const assert = require('node:assert/strict');
const input = JSON.parse(process.argv[1]);
const th = {raw: {lead: 'current lead', sections: [{text: 'current section'}]}};
const task = {id: '32.1', type: 'example', prompt: 'current prompt', code: 'class Label: pass', answer: 'SECRET', check: 'SECRET', explanation: 'SECRET'};
const topic = {id: 32, title: 'classes', description: 'objects', tasks: [task]};
const element = {isConnected:true};
const authEpoch = 1, introEpoch = 1, introRoute = '#/task/32.1';
const location = {hash:introRoute};
const window = {THEORY_ARTICLES:{32:th.raw}};
const normalizeTheory = () => th;
const $ = () => element;
const waitingHtml = thinkingHtml = renderMd = esc = text => text;
let sent;
const post = async (url, body) => { sent = {url, body}; return {lesson: 'ready'}; };
(async () => {
  await eval('(' + input.handler + ')')();
  assert.equal(sent.url, input.endpoint);
  const article = sent.body.theory?.article || sent.body.topic.theory;
  assert.deepEqual(article, th.raw);
  if (sent.body.task) assert.equal(sent.body.task.code, task.code);
  assert.ok(!JSON.stringify(sent.body).includes('SECRET'));
})().catch(error => { console.error(error); process.exitCode = 1; });
"""
    result = subprocess.run(["node", "-e", script, json.dumps({"handler": match[1], "endpoint": endpoint})], capture_output=True, text=True, encoding="utf-8", timeout=15)
    assert result.returncode == 0, result.stderr
