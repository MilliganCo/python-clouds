# -*- coding: utf-8 -*-
"""Парсер коллекции: markdown -> legacy web и mobile content bundle.

Запуск: python build_tasks.py
Пересобирает данные для веб-платформы из markdown-коллекции.
"""
import json
import hashlib
import os
import re
import shutil
import subprocess
import tempfile
import sys
from contextlib import contextmanager
import importlib.util
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parent/'platform'))
import content_generation

SRC = Path(__file__).parent / "python_tasks_collection.md"
OUT = Path(__file__).parent / "platform" / "static" / "tasks.js"
MOBILE_OUT = Path(__file__).parent / "android" / "app" / "src" / "main" / "assets" / "content" / "content-bundle.json"
SUPPORT_EXPORTER = Path(__file__).parent / "scripts" / "export_mobile_content.mjs"
SOURCE_RULES = Path(__file__).parent / 'platform_source_rules.py'

# Учебная последовательность едина для каталога и перехода к следующему заданию.
# ID остаются прежними: по ним хранятся решения, черновики и награды.
COURSE_ORDER = (
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 41, 10, 11, 12, 13,
    14, 15, 16, 17, 18, 19, 20, 22, 21, 23, 24, 26,
    42, 43, 44, 45, 46, 47, 48, 49, 50, 51,
    25, 32, 33, 27, 28, 34, 35, 37, 36, 38, 39, 30, 29, 31, 40,
    54, 52, 53, 55, 56, 57, 58, 59, 60, 64, 61, 65, 62, 63,
)

LEVEL_MAP = {
    "начальный": "beginner",
    "средний": "intermediate",
    "продвинутый": "advanced",
    "экспертный": "expert",
}


def first_fence(text):
    """Возвращает (язык, код) первого блока ``` ... ``` или (None, None)."""
    m = re.search(r"```(\w+)?\n(.*?)```", text, re.S)
    if not m:
        return None, None
    return (m.group(1) or "text"), m.group(2).rstrip("\n")


def field(block, name, stop):
    """Текст между **name:** и следующим маркером stop (regex)."""
    m = re.search(rf"\*\*{name}:\*\*(.*?)(?={stop})", block, re.S)
    return m.group(1).strip() if m else ""


def parse_task(raw, topic_id, idx):
    tid = f"{topic_id}.{idx}"
    ttype = field(raw, "Тип задания", r"\*\*(?:Название|Условие)")
    title = field(raw, "Название", r"\*\*(?:Формат для ученика|Условие)").strip()
    # однострочное название без fence
    if title and "```" in title:
        title = title.split("```", 1)[0].strip()
    title = re.sub(r"\s+", " ", title).strip() if title else ""

    # Условие: текст + необязательный код задания
    # (до Ответа или до блока Вопросы у многошаговых квизов)
    cond = field(raw, "Условие", r"\*\*(?:Вопросы|Ответ)")
    code_lang, code = first_fence(cond)
    prompt = re.sub(r"```.*?```", "", cond, flags=re.S).strip()

    # Многошаговый квиз: JSON-массив вопросов
    questions = None
    questions_raw = field(raw, "Вопросы", r"\*\*Ответ")
    if questions_raw:
        _qlang, qbody = first_fence(questions_raw)
        body = qbody if qbody is not None else questions_raw.strip()
        if body:
            questions = json.loads(body)

    # Ответ: первый блок кода/текста
    ans = field(raw, "Ответ", r"\*\*(?:Ошибочные варианты|Объяснение)")
    ans_lang, answer = first_fence(ans)

    wrong_raw = field(raw, "Ошибочные варианты", r"\*\*Объяснение")
    wrong = []
    if wrong_raw:
        _wlang, wrong_body = first_fence(wrong_raw)
        body = wrong_body if wrong_body is not None else wrong_raw
        wrong = parse_wrong_options(body, answer or "")

    explanation = field(raw, "Объяснение", r"\*\*Проверено")

    verified = field(raw, r"Проверено в CPython", r"\n---|\Z")
    verified = verified.splitlines()[0].strip() if verified else ""

    task = {
        "id": tid,
        "type": ttype,
        "prompt": prompt,
        "code": code,           # код в условии (или None)
        "codeLang": code_lang or "python",
        "answer": answer or "",
        "answerLang": ans_lang or "text",
        "explanation": explanation,
        "verified": verified,
    }
    if title:
        task["title"] = title
    profile_marker = "**Учебный профиль:**"
    if profile_marker in raw:
        verified_marker = "**Проверено в CPython:**"
        error = f"{tid}: Учебный профиль — нужен один JSON-блок после Проверено в CPython"
        if raw.count(profile_marker) != 1 or verified_marker not in raw or raw.index(profile_marker) < raw.index(verified_marker):
            raise ValueError(error)
        profile_raw = field(raw, "Учебный профиль", r"\n\*\*[^\n]+:\*\*|\n---|\Z")
        language, body = first_fence(profile_raw)
        try:
            profile = json.loads(body or "")
        except ValueError as exc:
            raise ValueError(error) from exc
        if language != "json" or not isinstance(profile, dict) or set(profile) != {"difficulty", "skills", "reason"}:
            raise ValueError(error)
        if not isinstance(profile["difficulty"], str) or profile["difficulty"] not in {"easy", "practice", "challenge"}:
            raise ValueError(f"{tid}: Учебный профиль — неизвестная сложность внутри темы")
        skills = profile["skills"]
        if not isinstance(skills, list) or not 1 <= len(skills) <= 3:
            raise ValueError(f"{tid}: Учебный профиль — нужны 1–3 навыка")
        for value, limit in [(profile["reason"], 240), *[(skill, 60) for skill in skills]]:
            if not isinstance(value, str) or not value or value.strip() != value or len(value) > limit or "\n" in value or "\r" in value:
                raise ValueError(f"{tid}: Учебный профиль — нужны короткие однострочные навыки и причина")
        if len(set(skills)) != len(skills):
            raise ValueError(f"{tid}: Учебный профиль — навыки не должны повторяться")
        task["learning"] = profile
    display_type = field(raw, "Формат для ученика", r"\*\*Условие")
    if "**Формат для ученика:**" in raw:
        allowed = {"написать класс": {"написать функцию"}, "класс и функция": {"написать функцию", "исправить ошибку"},
                   "написать тесты": {"написать функцию", "исправить ошибку"}}
        if ttype not in allowed.get(display_type, set()):
            raise ValueError(f"{tid}: некорректный Формат для ученика")
        task["displayType"] = display_type
    if wrong:
        task["wrong"] = wrong
    if questions:
        task["questions"] = questions
    if "**Проверять тесты:**" in raw and "**Проверка:**" not in raw:
        raise ValueError(f"{tid}: Проверять тесты требует исполняемую Проверка")
    finale = field(raw, "Финал темы", r"\n|\Z")
    if finale:
        task["finale"] = int(finale)
        task["hint"] = field(raw, "Подсказка", r"\*\*Проверка")
    if finale or "**Проверка:**" in raw or "**Ожидаемый вывод:**" in raw or "**Проверка исходника:**" in raw:
        _, check = first_fence(field(raw, "Проверка", r"\*\*Ожидаемый вывод"))
        _, expected = first_fence(field(raw, "Ожидаемый вывод", r"\n---|\Z"))
        if finale and task["finale"] not in (1, 2):
            raise ValueError(f"{tid}: финалу нужен номер 1/2")
        if not check or expected is None:
            raise ValueError(f"{tid}: нужны проверка и ожидаемый вывод")
        task["check"] = {"append": check, "expect": expected}
        if "**Проверять тесты:**" in raw:
            if field(raw, "Проверять тесты", r"\n") != "да" or display_type != "написать тесты":
                raise ValueError(f"{tid}: Проверять тесты требует формата написать тесты и значения да")
            task["check"]["submissionSource"] = True
        source_raw = field(raw, "Проверка исходника", r"\*\*Проверка:\*\*")
        if source_raw:
            validate_rule = _source_policy().validate_rule
            _, source_json = first_fence(source_raw)
            source_rule = json.loads(source_json or '')
            validate_rule(source_rule)
            task['check']['source'] = source_rule
    return task


def parse_wrong_options(body, answer=""):
    """Разбирает ошибочные варианты: блоки через пустую строку или
    группировка по числу строк ответа (для многострочного вывода)."""
    text = (body or "").strip()
    if not text:
        return []
    if re.search(r"\n\s*\n", text):
        blocks = [b.strip() for b in re.split(r"\n\s*\n", text) if b.strip()]
    else:
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        ans_lines = [ln for ln in (answer or "").splitlines() if ln.strip()]
        n = len(ans_lines)
        if n > 1 and len(lines) >= n and len(lines) % n == 0:
            blocks = ["\n".join(lines[i:i + n]) for i in range(0, len(lines), n)]
        else:
            blocks = lines
    # дедуп с сохранением порядка; ответ эталона исключаем
    ans_norm = (answer or "").strip()
    seen = set()
    out = []
    for b in blocks:
        if not b or b == ans_norm or b in seen:
            continue
        seen.add(b)
        out.append(b)
    return out


def validate_choice_wrongs(topics):
    """Для «определить вывод» и шагов квиза: ≥2 уникальных wrong после нормализации."""
    errors = []
    for topic in topics:
        for task in topic["tasks"]:
            if task["type"] == "определить вывод" and "wrong" in task:
                if len(task["wrong"]) < 2:
                    errors.append(
                        f"{task['id']}: после нормализации меньше 2 уникальных "
                        f"ошибочных вариантов ({task['wrong']!r})"
                    )
            for i, q in enumerate(task.get("questions") or [], start=1):
                wrong = q.get("wrong") or []
                ans = str(q.get("answer") or "").strip()
                uniq = []
                seen = set()
                for w in wrong:
                    s = str(w).strip()
                    if s and s != ans and s not in seen:
                        seen.add(s)
                        uniq.append(s)
                if len(uniq) < 2:
                    errors.append(
                        f"{task['id']} вопрос {i}: меньше 2 уникальных wrong"
                    )
    if errors:
        raise ValueError(
            "Некорректные ошибочные варианты:\n- " + "\n- ".join(errors)
        )


def parse():
    text = SRC.read_text(encoding="utf-8").split("\n## Атлас челленджей", 1)[0]
    # Отрезаем всё до первой темы
    topic_chunks = re.split(r"\n## Тема ", text)[1:]
    topics = []
    for chunk in topic_chunks:
        head = chunk.splitlines()[0]  # "1. Название темы"
        m = re.match(r"(\d+)\.\s*(.+)", head)
        topic_id = int(m.group(1))
        title = m.group(2).strip()

        level_ru = field(chunk, "Уровень", r"\n").strip()
        level = LEVEL_MAP.get(level_ru, "beginner")
        desc = field(chunk, "Описание", r"\n").strip()

        task_chunks = re.split(r"\n### Задание ", chunk)[1:]
        tasks = []
        for i, tc in enumerate(task_chunks, start=1):
            tasks.append(parse_task(tc, topic_id, i))

        topic = {
            "id": topic_id,
            "title": title,
            "level": level,
            "levelRu": level_ru,
            "description": desc,
            "tasks": tasks,
        }
        track = field(chunk.split("\n### Задание ", 1)[0], "Направление", r"\n")
        if track:
            if track != "Инструменты и библиотеки":
                raise ValueError(f"Тема {topic_id}: неизвестное направление {track!r}")
            topic["track"] = "tools"
        prerequisites = field(chunk.split("\n### Задание ", 1)[0], "Предпосылки", r"\n")
        if prerequisites:
            values = json.loads(prerequisites)
            if not isinstance(values, list) or any(type(n) is not int for n in values) or len(set(values)) != len(values) or topic_id in values:
                raise ValueError(f"Тема {topic_id}: предпосылки должны содержать разные ID других тем")
            topic["prerequisites"] = values
        topics.append(topic)
    order = {topic_id: index for index, topic_id in enumerate(COURSE_ORDER)}
    ids = [topic["id"] for topic in topics]
    if len(order) != len(COURSE_ORDER) or len(set(ids)) != len(ids) or set(ids) != set(order):
        raise ValueError("Состав тем изменился: синхронизируйте COURSE_ORDER с коллекцией")
    topics.sort(key=lambda topic: order[topic["id"]])
    for topic in topics:
        for prerequisite in topic.get("prerequisites", []):
            if prerequisite not in order or order[prerequisite] >= order[topic["id"]]:
                raise ValueError(f"Тема {topic['id']}: предпосылка {prerequisite} должна идти раньше темы")
    return topics


def _load_support_content():
    """Сериализует доверенные JS object literals в изолированном Node vm."""
    result = subprocess.run(
        ["node", str(SUPPORT_EXPORTER)],
        cwd=Path(__file__).parent,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    )
    payload = json.loads(result.stdout)
    if not isinstance(payload, dict):
        raise ValueError("export_mobile_content.mjs должен вернуть JSON-объект")
    return payload


def _source_policy():
    name='_pycloud_build_rules_'+hashlib.sha256(SOURCE_RULES.read_bytes()).hexdigest()
    if name not in sys.modules:
        spec=importlib.util.spec_from_file_location(name,SOURCE_RULES)
        module=importlib.util.module_from_spec(spec);sys.modules[name]=module
        spec.loader.exec_module(module)
    return sys.modules[name]


@contextmanager
def _captured_inputs(base):
    """All verification/export uses one owned input tree, not changing source files."""
    global SRC,SOURCE_RULES,SUPPORT_EXPORTER
    original=(SRC,SOURCE_RULES,SUPPORT_EXPORTER)
    source_static=Path(__file__).resolve().parent/'platform/static'
    # This generated asset may not exist on a first build. Its real bytes are
    # always regenerated and verified from the captured canonical source below.
    overrides={
        'counterexample-data.js': b'// Generated during publication.\nwindow.COUNTEREXAMPLE_QUESTIONS = [];\n',
        'theory-manifest.js': b'// Generated during publication.\n',
        'task-index.js': b'// Generated during publication.\n'}
    for name in re.findall(r'data-course-src="(task-banks/topic-\d+\.js)"',(source_static/'index.html').read_text(encoding='utf8')):
        overrides[name]=b'// Generated during publication.\n'
    public,scripts,styles=content_generation.collect_public(source_static,overrides=overrides)
    with tempfile.TemporaryDirectory(prefix='.content-input-',dir=base) as folder:
        root=Path(folder)
        for path,data in [(root/'python_tasks_collection.md',SRC.read_bytes()),(root/'platform_source_rules.py',SOURCE_RULES.read_bytes()),
                          (root/'scripts/export_mobile_content.mjs',SUPPORT_EXPORTER.read_bytes()),
                          (root/'platform/scripts/build_theory_manifest.cjs',(Path(__file__).resolve().parent/'platform/scripts/build_theory_manifest.cjs').read_bytes())]:
            path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
        for name,data in public.items():
            path=content_generation.safe_file(root/'platform/static',name);path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
        SRC=root/'python_tasks_collection.md';SOURCE_RULES=root/'platform_source_rules.py';SUPPORT_EXPORTER=root/'scripts/export_mobile_content.mjs'
        try:yield public,scripts,styles
        finally:SRC,SOURCE_RULES,SUPPORT_EXPORTER=original


def _normalize_intro(intro):
    """Приводит intro к mobile-контракту: всегда есть text; example — строка или null."""
    if not intro or not isinstance(intro, dict):
        return None
    example = intro.get("example")
    if isinstance(example, dict):
        example = example.get("code")
    text = (
        intro.get("text")
        or intro.get("explanation")
        or intro.get("goal")
        or ""
    )
    out = dict(intro)
    out["text"] = text
    out["example"] = example
    return out


def _normalize_theory(theory):
    if not theory or not isinstance(theory, dict):
        return None
    out = dict(theory)
    if not out.get("text"):
        out["text"] = out.get("lead") or ""
    if "example" not in out:
        sections = out.get("sections") or []
        first_ex = None
        for sec in sections:
            examples = (sec or {}).get("examples") or []
            if examples:
                first_ex = examples[0].get("code")
                break
        out["example"] = first_ex
    return out


def build_mobile_bundle(topics):
    support = _load_support_content()
    theories = support.get("theory", {})
    hints = support.get("hints", {})
    intros = support.get("intros", {})
    checks = support.get("checks", {})
    mobile_topics = []
    for topic in topics:
        mobile_tasks = []
        for task in topic["tasks"]:
            task_id = task["id"]
            check = task.get("check") or checks.get(task_id)
            mobile_task = {
                "id": task_id,
                "type": task["type"],
                "title": task.get("title") or "",
                "prompt": task["prompt"],
                "code": task["code"],
                "code_language": task["codeLang"],
                "answer": task["answer"],
                "answer_language": task["answerLang"],
                "explanation": task["explanation"],
                "verified": task["verified"],
                "hint": task.get("hint") or hints.get(task_id),
                "intro": _normalize_intro(intros.get(task_id)),
                # Frozen mobile schema accepts only these existing fields.
                "check": {key: check[key] for key in ('append', 'expect') if key in check} if check else None,
                "wrong": task.get("wrong"),
                "questions": task.get("questions"),
            }
            mobile_tasks.append(mobile_task)
        mobile_topics.append({
            "id": topic["id"],
            "title": topic["title"],
            "level": topic["level"],
            "level_label": topic["levelRu"],
            "description": topic["description"],
            "theory": _normalize_theory(
                theories.get(str(topic["id"])) or theories.get(topic["id"])
            ),
            "tasks": mobile_tasks,
        })

    hashed_payload = {
        "schema_version": 2,
        "python_runtime": "3.14.x",
        "topics": mobile_topics,
    }
    canonical = json.dumps(
        hashed_payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    digest = hashlib.sha256(canonical).hexdigest()
    return {
        "schema_version": 2,
        "content_version": digest[:16],
        "content_hash": "sha256:" + digest,
        "python_runtime": "3.14.x",
        "topics": mobile_topics,
    }


def _python314_command():
    configured = os.environ.get("PYCLOUD_PYTHON314")
    candidates = [[configured]] if configured else []
    py_launcher = shutil.which("py")
    if py_launcher:
        candidates.append([py_launcher, "-3.14"])
    python314 = shutil.which("python3.14")
    if python314:
        candidates.append([python314])
    for command in candidates:
        if not command[0]:
            continue
        probe = subprocess.run(
            command + ["-I", "-X", "utf8", "-c", "import sys; print(sys.version_info[:2])"],
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        if probe.returncode == 0 and "(3, 14)" in probe.stdout:
            return command
    raise RuntimeError("Для mobile bundle нужен установленный CPython 3.14")


def _reference_program(task):
    if task["type"] == "определить вывод":
        return task.get("code")
    if task["type"] in ("объяснить поведение", "демо", "квиз"):
        return None
    if task["type"] == "дописать код" and task.get("code"):
        todo = re.search(
            r"^([ \t]*)# TODO: допишите код здесь[ \t]*$",
            task["code"],
            flags=re.M,
        )
        if todo:
            indent = todo.group(1)
            fragment = "\n".join(indent + line if line else line for line in task["answer"].splitlines())
            return task["code"].replace(todo.group(0), fragment, 1)
    return task.get("answer")


def _normalized_output(text):
    lines = str(text or "").replace("\r", "").strip().splitlines()
    normalized = []
    for line in lines:
        line = re.sub(r"\s+", " ", line.strip())
        line = re.sub(
            r"\{([^{}]*)\}",
            lambda match: "{" + ", ".join(sorted(
                part.strip() for part in match.group(1).split(",") if part.strip()
            )) + "}",
            line,
        )
        normalized.append(line)
    return normalized


def compose_check(check, source):
    """Same trusted source checker as legacy-web; submitted source is only data."""
    append = check.get('append', '')
    if check.get('submissionSource'):
        append = '_pycloud_submission_source = ' + json.dumps(source, ensure_ascii=True) + '\n' + append
    if not check.get('source'):
        return append
    validate_rule = _source_policy().validate_rule
    validate_rule(check['source'])
    library = SOURCE_RULES.read_text(encoding='utf-8')
    literal = lambda value: json.dumps(value, ensure_ascii=True)
    return ("import builtins as _pycloud_source_builtins\n"
            "_pycloud_source_ns = {}\n"
            f"_pycloud_source_builtins.exec({literal(library)}, _pycloud_source_ns)\n"
            f"_pycloud_source_result = _pycloud_source_ns['inspect_source']({literal(source)}, "
            f"_pycloud_source_ns['_json'].loads({literal(json.dumps(check['source'], ensure_ascii=True))}))\n"
            "if _pycloud_source_result['status'] == 'unsupported':\n"
            "    raise RuntimeError('PYCLOUD_SOURCE_UNSUPPORTED: ' + _pycloud_source_result['message'])\n"
            "assert _pycloud_source_result['status'] == 'ok', _pycloud_source_result['message']\n" + append)


def verify_mobile_tasks(topics):
    """Проверяет исполняемые эталоны bundle в реальном CPython 3.14."""
    command = _python314_command()
    checks = _load_support_content().get("checks", {})
    checked = 0
    failures = []
    for topic in topics:
        for task in topic["tasks"]:
            program = _reference_program(task)
            if not program:
                continue
            check = task.get("check") or checks.get(task["id"], {})
            if check.get("append"):
                append = compose_check(check, program)
                # Match legacy grade: function-check output excludes the learner's demo.
                if task["type"] != "определить вывод" and _normalized_output(check.get("expect")) == ["OK"]:
                    program = (
                        "import contextlib as _reference_contextlib, io as _reference_io\n"
                        "with _reference_contextlib.redirect_stdout(_reference_io.StringIO()):\n"
                        f"    exec({program!r}, globals())\n\n" + append
                    )
                else:
                    program += "\n\n" + append
            try:
                with tempfile.TemporaryDirectory(prefix="pycloud-reference-") as folder:
                    result = subprocess.run(
                        command + ["-I", "-X", "utf8", "-c", program],
                        cwd=folder,
                        stdin=subprocess.DEVNULL,
                        capture_output=True,
                        text=True,
                        encoding="utf-8",
                        timeout=5,
                    )
            except subprocess.TimeoutExpired:
                failures.append(f"{task['id']}: timeout")
                continue
            checked += 1
            if result.returncode != 0:
                failures.append(f"{task['id']}: {result.stderr.strip()[:240]}")
                continue
            expected = task["answer"] if task["type"] == "определить вывод" else check.get("expect")
            if expected is not None and _normalized_output(result.stdout) != _normalized_output(expected):
                failures.append(
                    f"{task['id']}: ожидалось {expected!r}, получено {result.stdout.strip()!r}"
                )
    if failures:
        raise AssertionError("CPython 3.14 verification failed:\n" + "\n".join(failures[:20]))
    version = subprocess.run(
        command + ["-I", "-X", "utf8", "-c", "import platform; print(platform.python_version())"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    ).stdout.strip()
    return {"python": version, "checked": checked}


def parse_atlas():
    section = SRC.read_text(encoding="utf-8").split("\n## Атлас челленджей\n", 1)[1]
    tasks = json.loads(first_fence(section)[1])
    assert len({task['id'] for task in tasks}) == len(tasks)
    for task in tasks:
        assert re.fullmatch(r'seed-[a-z0-9-]+', task['id'])
        assert task['difficulty'] in ('intermediate', 'advanced', 'expert')
        with tempfile.TemporaryDirectory() as folder:
            for source, expected in ((task['solution'], True), (task['starter'], False), ("print('OK')", False)):
                run = subprocess.run([*_python314_command(), '-I', '-X', 'utf8', '-c', source + '\n' + task['tests']],
                                     cwd=folder, capture_output=True, text=True, encoding='utf-8', timeout=6)
                assert (run.returncode == 0 and run.stdout.strip() == 'OK') == expected, task['id']
    return tasks


def parse_practice_quests():
    section = SRC.read_text(encoding='utf-8').split('\n## Мини-квесты на своём компьютере\n', 1)[1]
    courses = json.loads(first_fence(section)[1])
    assert len({c['id'] for c in courses}) == len(courses)
    for course in courses:
        assert re.fullmatch(r'practice_[a-z_]+', course['id']) and course['kind'] == 'local_practice'
        assert course['unlock_topics'] and course['stages']
        for stage in course['stages']:
            local = stage['local_practice']
            items = local['checklist']
            assert items and len({item['id'] for item in items}) == len(items)
            assert all(re.fullmatch(r'[a-z_]+', item['id']) and item['text'] for item in items)
            assert all(link['url'].startswith('https://') for link in local['links'])
            # Trusted author content only, never arbitrary submissions or AI code.
            check = stage['check']['append']
            prefix = 'import contextlib, io\nns = {{}}\nwith contextlib.redirect_stdout(io.StringIO()):\n    exec({!r}, ns)\nexec({!r}, ns)'
            programs = [(prefix.format(stage['reference_code'], check), 'OK', True),
                        (prefix.format(stage['starter_code'], check), 'OK', False),
                        (prefix.format("print('OK')", check), 'OK', False)]
            programs += [(g['code'], g['output'], True) for g in local['guide'] if 'code' in g]
            for program, expected, should_pass in programs:
                with tempfile.TemporaryDirectory(prefix='pycloud-practice-') as folder:
                    result = subprocess.run([*_python314_command(), '-I', '-X', 'utf8', '-c', program],
                                            cwd=folder, capture_output=True, text=True, encoding='utf-8', timeout=6)
                passed = result.returncode == 0 and result.stdout.rstrip('\n') == expected
                assert passed == should_pass, (course['id'], stage['id'], result.stderr, result.stdout)
            del stage['reference_code']
    return courses


def counterexample_program(question):
    """Trusted author code only; fresh namespace per candidate input."""
    return '''question = %r
def outcome(source, call):
    namespace = {}
    exec(source, namespace)
    try:
        return repr(eval(call, namespace)), False
    except Exception as error:
        return type(error).__name__, True
for choice in question['choices']:
    assert outcome(question['reference_code'], choice['call']) == (choice['expected'], False)
    assert outcome(question['code'], choice['call']) == (choice['actual'], choice['error'])
print('OK')
''' % question


def parse_counterexamples(*, verify=True):
    section = SRC.read_text(encoding='utf-8').split('\n## Игра «Контрпример»\n', 1)[1]
    bank = json.loads(first_fence(section)[1])
    fields = {'id', 'title', 'contract', 'code', 'reference_code', 'choices', 'explanation'}
    if not isinstance(bank, list) or not 1 <= len(bank) <= 64:
        raise ValueError('Контрпример: нужен непустой ограниченный банк')
    identifiers = set()
    for question in bank:
        if type(question) is not dict or set(question) != fields:
            raise ValueError('Контрпример: неверные поля карточки')
        if any(not isinstance(question[key], str) or not question[key].strip() for key in fields - {'choices'}):
            raise ValueError('Контрпример: текст карточки не заполнен')
        if not re.fullmatch(r'[a-z][a-z0-9-]{1,63}', question['id']) or question['id'] in identifiers:
            raise ValueError('Контрпример: повторный или неверный ID')
        identifiers.add(question['id'])
        choices = question['choices']
        if not isinstance(choices, list) or len(choices) != 4:
            raise ValueError('Контрпример: нужны четыре входа')
        for choice in choices:
            if (type(choice) is not dict or set(choice) != {'call', 'actual', 'expected', 'error'}
                    or type(choice['error']) is not bool
                    or any(not isinstance(choice[key], str) or not choice[key] for key in ('call', 'actual', 'expected'))):
                raise ValueError('Контрпример: неверный результат входа')
        if len({choice['call'] for choice in choices}) != 4:
            raise ValueError('Контрпример: повторный вход')
        if sum(choice['error'] or choice['actual'] != choice['expected'] for choice in choices) != 1:
            raise ValueError('Контрпример: нужен ровно один различающий вход')
        if verify:
            with tempfile.TemporaryDirectory(prefix='pycloud-counterexample-') as folder:
                result = subprocess.run([*_python314_command(), '-I', '-X', 'utf8', '-c', counterexample_program(question)],
                    cwd=folder, capture_output=True, text=True, encoding='utf-8', timeout=6)
            if result.returncode or result.stdout.strip() != 'OK':
                raise ValueError('Контрпример: выводы не совпали в CPython3.14: ' + question['id'])
    return [{key: value for key, value in question.items() if key != 'reference_code'} for question in bank]


def parse_weekly(*, verify=True):
    section=SRC.read_text(encoding='utf-8').split('\n## Недельный практикум\n',1)[1]
    bank=json.loads(first_fence(section)[1])
    from datetime import date
    if type(bank) is not dict or set(bank)!={'version','anchor','tasks'} or type(bank['version']) is not int or bank['version']!=1:
        raise ValueError('Неизвестный формат недельного практикума')
    if date.fromisoformat(bank['anchor']).weekday()!=0 or not isinstance(bank['tasks'],list) or not bank['tasks']:
        raise ValueError('Практикуму нужны понедельник начала и задания')
    seen=set();keys=set()
    legacy=json.loads(first_fence(SRC.read_text(encoding='utf-8').split('\n## Атлас челленджей\n',1)[1])[1])
    fields=('title','prompt','func_name','starter','solution','tests')
    def identity(task):return hashlib.sha256(json.dumps({k:task[k] for k in fields},sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    legacy_keys={identity(task) for task in legacy}
    required={'id','difficulty',*fields,'skills','prerequisites','reflection','explanation','negative_codes'}
    for task in bank['tasks']:
        if type(task) is not dict or set(task)!=required or not re.fullmatch(r'weekly-[a-z0-9-]+-v[1-9][0-9]*',task['id']) or task['id'] in seen:
            raise ValueError('Нужны стабильные уникальные ID практикума с версией')
        if task['difficulty'] not in ('intermediate','advanced','expert') or any(not isinstance(task[k],str) or not task[k].strip() for k in (*fields,'reflection','explanation')):
            raise ValueError('Неполное упражнение практикума')
        if not re.fullmatch(r'[a-z][a-z0-9_]*',task['func_name']):raise ValueError('Неверная функция')
        if (not isinstance(task['skills'],list) or not 2<=len(task['skills'])<=4 or any(not isinstance(v,str) or not v.strip() for v in task['skills'])
                or not isinstance(task['prerequisites'],list) or not task['prerequisites']
                or any(type(v) is not int or v not in COURSE_ORDER for v in task['prerequisites'])
                or len(set(task['prerequisites']))!=len(task['prerequisites'])):
            raise ValueError('Практикуму нужны явные навыки и темы основ')
        negatives=task['negative_codes']
        if not isinstance(negatives,list) or len(negatives)<2 or any(not isinstance(v,str) or not v.strip() for v in negatives):raise ValueError('Нужны отрицательные проверки практикума')
        key=identity(task)
        if key in keys|legacy_keys:raise ValueError('Практикум повторяет существующее содержание')
        if verify:
            for source,want in [(task['solution'],True),(task['starter'],False),("print('OK')",False),*[(v,False) for v in negatives]]:
                with tempfile.TemporaryDirectory(prefix='pycloud-weekly-reference-') as folder:
                    result=subprocess.run([*_python314_command(),'-I','-X','utf8','-c',source+'\n'+task['tests']],cwd=folder,
                        capture_output=True,text=True,encoding='utf-8',timeout=6)
                if (result.returncode==0 and result.stdout.strip()=='OK')!=want:raise ValueError('Проверка практикума не различает решение: '+task['id'])
        del task['negative_codes']
        seen.add(task['id']);keys.add(key)
    return bank


def parse_diagnostics(*, verify=True):
    """A separate optional placement sample; never enters task XP/progress IDs."""
    section = SRC.read_text(encoding='utf-8').split('\n## Диагностика точки входа\n', 1)[1]
    bank = json.loads(first_fence(section)[1])
    if (type(bank) is not dict or set(bank) != {'version', 'all_pass_topic', 'no_evidence_topic', 'tasks'}
            or type(bank['version']) is not int or bank['version'] != 1
            or type(bank['tasks']) is not list or not 3 <= len(bank['tasks']) <= 5):
        raise ValueError('Некорректный банк диагностики')
    for key in ('all_pass_topic', 'no_evidence_topic'):
        if type(bank[key]) is not int or bank[key] not in COURSE_ORDER:
            raise ValueError('Неизвестная тема рекомендации диагностики')
    seen = set()
    for task in bank['tasks']:
        required = {'id', 'title', 'skill', 'topic_id', 'format', 'prompt', 'starter_code',
                    'reference_code', 'check', 'explanation', 'negative_codes'}
        if type(task) is not dict or set(task) != required:
            raise ValueError('Некорректные поля диагностики')
        if not isinstance(task['id'], str) or not re.fullmatch(r'diag_[a-z_]+', task['id']) or task['id'] in seen:
            raise ValueError('Некорректный ID диагностики')
        seen.add(task['id'])
        if type(task['topic_id']) is not int or task['topic_id'] not in COURSE_ORDER or task['format'] not in ('write', 'repair'):
            raise ValueError('Некорректная тема/форма диагностики')
        if any(not isinstance(task[key], str) or not task[key].strip() for key in
               ('title', 'skill', 'prompt', 'starter_code', 'reference_code', 'explanation')):
            raise ValueError('Пустой материал диагностики')
        check = task['check']
        if (type(check) is not dict or set(check) != {'append', 'expect'}
                or not isinstance(check['append'], str) or not check['append'].strip() or check['expect'] != 'OK'
                or type(task['negative_codes']) is not list
                or any(not isinstance(code,str) or not code.strip() for code in task['negative_codes'])):
            raise ValueError('Некорректная проверка диагностики')
        if verify:
            for source, should_pass in [(task['reference_code'], True), (task['starter_code'], False),
                                        ("print('OK')", False), *[(code,False) for code in task['negative_codes']]]:
                with tempfile.TemporaryDirectory(prefix='pycloud-diagnostic-') as folder:
                    run = subprocess.run([*_python314_command(), '-I', '-X', 'utf8', '-c', source+'\n'+check['append']],
                                         cwd=folder,capture_output=True,text=True,encoding='utf-8',timeout=6)
                passed = run.returncode == 0 and run.stdout.strip() == 'OK'
                if passed != should_pass:
                    raise ValueError(f"Диагностика {task['id']}: неверная исполняемая проверка")
        del task['reference_code']
        del task['negative_codes']
    return bank


def build_workshop_catalog():
    """Generate optional server catalogue from the same canonical source, without activation."""
    text=SRC.read_text(encoding='utf8')
    matches=re.findall(r'<!-- WORKSHOP_CATALOG_START -->\s*(.*?)\s*<!-- WORKSHOP_CATALOG_END -->',text,re.S)
    if len(matches)!=1:raise ValueError('Нужен один канонический банк мастерской')
    bank=json.loads(matches[0]);seen=set()
    if type(bank) is not list or not bank:raise ValueError('Пустая мастерская')
    for item in bank:
        if not re.fullmatch(r'[a-z][a-z0-9_]{0,40}',item['id']) or item['id'] in seen:raise ValueError('ID мастерской')
        seen.add(item['id'])
        for source,expected in [(item['reference'],True),(item['files'][0]['code'],False)]:
            with tempfile.TemporaryDirectory(prefix='pycloud-workshop-build-') as folder:
                for file in item['files']:
                    if not re.fullmatch(r'[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,60}',file['name']) or '..' in file['name']:raise ValueError('Имя файла мастерской')
                    (Path(folder)/file['name']).write_text(source if file['name']=='main.py' else file['code'],encoding='utf8')
                code='import sys\nsys.path.insert(0,'+repr(folder)+')\n'+'\n'.join(s['check'] for s in item['stages'])+'\nprint("WORKSHOP_OK")'
                result=subprocess.run([*_python314_command(),'-I','-X','utf8','-c',code],cwd=folder,capture_output=True,text=True,encoding='utf8',timeout=6)
                if (result.returncode==0 and result.stdout.rstrip().endswith('WORKSHOP_OK'))!=expected:raise ValueError(f"Мастерская {item['id']}: проверка эталона/стартера")
        del item['reference']
    return ('# Generated by build_tasks.py from python_tasks_collection.md. Do not edit.\nCATALOG = '+repr(bank)+'\n').encode('utf8')


TASK_METADATA_FIELDS=frozenset({'id','type','title','prompt','code','displayType','finale','learning'})
TASK_DEFERRED_FIELDS=frozenset({'codeLang','answer','answerLang','explanation','verified','check','wrong','hint','questions'})


def build_task_banks(topics,source_rules):
    """Split serialized data only; keep every canonical field and stable topic/task IDs."""
    compact=lambda value:json.dumps(value,ensure_ascii=False,separators=(',',':'))
    metadata=[];banks={};public={};seen=set()
    for topic in topics:
        file=f"task-banks/topic-{topic['id']}.js";banks[str(topic['id'])]=file;items=[];short=[]
        for task in topic['tasks']:
            if task['id'] in seen or set(task)-TASK_METADATA_FIELDS-TASK_DEFERRED_FIELDS:raise ValueError('Неподдерживаемая схема или повтор ID задания')
            seen.add(task['id'])
            short.append({key:value for key,value in task.items() if key in TASK_METADATA_FIELDS})
            items.append({key:value for key,value in task.items() if key=='id' or key in TASK_DEFERRED_FIELDS})
        metadata.append({**topic,'tasks':short})
        public[file]=('// Generated by build_tasks.py. Do not edit.\nwindow.TASK_BANKS = window.TASK_BANKS || Object.create(null);\n'
            +f'window.TASK_BANKS[{topic["id"]}] = '+compact(dict(version=1,topicId=topic['id'],tasks=items))+';\n').encode('utf8')
    public['task-index.js']=('// Generated by build_tasks.py. Do not edit.\nwindow.SOURCE_RULES_PYTHON = '+json.dumps(source_rules,ensure_ascii=True)+';\n'
        +'window.TASK_INDEX = '+compact(dict(version=1,topics=metadata,banks=banks))+';\n'
        +'Object.freeze(window.TASK_INDEX.banks);\nObject.freeze(window.TASK_INDEX);\n'
        +'window.TASKS = window.TASKS || window.TASK_INDEX.topics;\n').encode('utf8')
    return public


def task_bank_declarations(html,public):
    files=[name for name in public if re.fullmatch(r'task-banks/topic-\d+\.js',name)]
    block='<!-- task-banks:start -->\n'+''.join(f'  <script type="application/x-pycloud-script" data-course-src="{name}"></script>\n' for name in files)+'  <!-- task-banks:end -->'
    result,count=re.subn(r'<!-- task-banks:start -->.*?<!-- task-banks:end -->',lambda _:block,html,flags=re.S)
    if count!=1:raise ValueError('Нужен один блок task-banks в index.html')
    return result


def _prepare_outputs():
    topics = parse()
    validate_choice_wrongs(topics)
    verification = verify_mobile_tasks(topics)
    atlas = parse_atlas()
    practice = parse_practice_quests()
    diagnostics = parse_diagnostics()
    weekly = parse_weekly()
    counterexamples = parse_counterexamples()
    total = sum(len(t["tasks"]) for t in topics)
    payload = json.dumps(topics, ensure_ascii=False, indent=2)
    tasks_text=(
        "// Автоматически сгенерировано build_tasks.py. Не редактировать вручную.\n"
        f"// Тем: {len(topics)}, заданий: {total}.\n"
        f"window.SOURCE_RULES_PYTHON = {json.dumps(SOURCE_RULES.read_text(encoding='utf-8'), ensure_ascii=True)};\n"
        f"window.TASKS = {payload};\n"
    )
    # Метаданные для сервера: id задания -> уровень (начисление наград)
    meta = {t["id"]: topic["level"] for topic in topics for t in topic["tasks"]}
    mobile_bundle = build_mobile_bundle(topics)
    # Простейшая проверка целостности
    assert len(topics) >= 30, "должно быть не менее 30 тем"
    assert total >= 100, "должно быть не менее 100 заданий"
    assert all(t["tasks"] for t in topics), "у каждой темы есть задания"
    encoded=lambda value:(json.dumps(value,ensure_ascii=False,indent=2)+'\n').encode('utf-8')
    public={'counterexample-data.js':('// Generated by build_tasks.py from canonical game content.\nwindow.COUNTEREXAMPLE_QUESTIONS = '
        +json.dumps(counterexamples,ensure_ascii=False,indent=2)+';\n').encode('utf-8'),
        'tasks.js':tasks_text.encode('utf-8'),'diagnostic-tasks.js':(
        '// Generated by build_tasks.py from canonical diagnostic content.\nwindow.DIAGNOSTIC_TASKS = '
        +json.dumps(diagnostics,ensure_ascii=False,indent=2)+';\n').encode('utf-8')}
    public['theory-manifest.js']=subprocess.run(['node',str(SRC.parent/'platform/scripts/build_theory_manifest.cjs'),
        str(SRC.parent/'platform/static'),'-'],capture_output=True,check=True).stdout
    public.update(build_task_banks(topics,SOURCE_RULES.read_text(encoding='utf8')))
    private={'tasks_meta.json':json.dumps(meta,ensure_ascii=False).encode('utf-8'),
        'atlas_tasks.json':encoded(atlas),'practice_quests.json':encoded(practice),'weekly_tasks.json':encoded(weekly),
        'mobile/content-bundle.json':encoded(mobile_bundle)}
    return public,private,dict(topics=len(topics),tasks=total,mobile=mobile_bundle['content_version'],verification=verification)


def main():
    base=OUT.parent.parent.resolve()
    with content_generation.writer_lock(base):
        with _captured_inputs(base) as (assets,scripts,styles):
            generated,private,summary=_prepare_outputs()
            workshop=build_workshop_catalog()
            assets.update(generated)
            if 'task-index.js' in generated:
                assets['index.html']=task_bank_declarations(assets['index.html'].decode('utf8'),generated).encode('utf8')
                for name in list(assets):
                    if re.fullmatch(r'task-banks/topic-\d+\.js',name) and name not in generated:assets.pop(name)
                parser=content_generation._Assets();parser.feed(assets['index.html'].decode('utf8'));scripts,styles=parser.scripts,parser.styles
            private['index.html']=assets.pop('index.html')
            # Compile without executing UI code or allowing a later syntax failure.
            for name in (name for name in assets if name.endswith('.js')):
                path=SUPPORT_EXPORTER.parent.parent/'platform/static'/name
                if name in generated:
                    path.parent.mkdir(parents=True,exist_ok=True)
                    path.write_bytes(generated[name])
                subprocess.run(['node','--check',str(path)],capture_output=True,text=True,encoding='utf-8',check=True)
            mirrors={OUT:generated['tasks.js'],OUT.parent/'diagnostic-tasks.js':generated['diagnostic-tasks.js'],
                     OUT.parent/'counterexample-data.js':generated['counterexample-data.js'],MOBILE_OUT:private['mobile/content-bundle.json']}
            if 'theory-manifest.js' in generated:mirrors[OUT.parent/'theory-manifest.js']=generated['theory-manifest.js']
            mirrors.update({OUT.parent/name:data for name,data in generated.items() if name=='task-index.js' or name.startswith('task-banks/')})
            mirrors.update({base/name:data for name,data in private.items() if name not in ('index.html','mobile/content-bundle.json')})
            # Generated backend source is staged on disk, just like generated JS
            # before syntax checks. It is not a browser-public teaching artifact;
            # only a coordinated server restart loads it into the runtime.
            content_generation.atomic_write(base/'workshop_catalog.py',workshop)
            selected=content_generation.publish(base,assets,private,scripts,styles,mirrors)
    print(f"OK: поколение {selected.generation}, согласованный public/private набор")
    print(f"OK: тем {summary['topics']}, заданий {summary['tasks']} -> {OUT}")
    print(f"OK: mobile content {summary['mobile']} -> {MOBILE_OUT}")
    verification=summary['verification']
    print(f"OK: CPython {verification['python']} проверил эталоны: {verification['checked']}")


if __name__ == "__main__":
    if sys.argv[1:]==['--task-banks-only']:
        topics=parse();verification=verify_mobile_tasks(topics)
        public=build_task_banks(topics,SOURCE_RULES.read_text(encoding='utf8'))
        for name,data in public.items():content_generation.atomic_write(content_generation.safe_file(OUT.parent,name),data)
        index=OUT.parent/'index.html';content_generation.atomic_write(index,task_bank_declarations(index.read_text(encoding='utf8'),public).encode('utf8'))
        print(f'OK: {len(topics)} task banks, CPython {verification["python"]}; active generation unchanged')
    elif sys.argv[1:]==['--workshop-only']:
        content_generation.atomic_write(OUT.parent.parent/'workshop_catalog.py',build_workshop_catalog())
        print('OK: мастерская проверена в CPython 3.14 и собрана; активная публикация не менялась')
    elif sys.argv[1:]:
        raise SystemExit('Usage: python build_tasks.py [--workshop-only|--task-banks-only]')
    else:main()
