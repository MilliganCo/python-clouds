#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Одноразовая миграция БД под вставку темы 3 «Первые функции» (2026-07-21).

Темы 3..50 сдвинулись на +1 (стали 4..51); три задания старой темы 12
переехали в новую тему 3 (square/is_even/rectangle_area), clamp остался в
теме 13 «Функции подробнее» на новой позиции. Челленджи C7.1/C9.1/C12.1
сдвинулись как C8.1/C10.1/C13.1 (плюс контентные правки, не влияющие на id).

Переписывает task_id/topic_id во всех таблицах прогресса пользователя, чтобы
старые solved/attempts/notes/achievements не «съехали» на чужие темы после
сдвига. Идемпотентна: повторный запуск не ломает уже смигрированные данные
(запись помечается в PRAGMA user_version).

Запуск: python platform/scripts/migrate_topic_shift_2026_07_21.py [путь к app.db]
"""
from __future__ import annotations

import re
import sqlite3
import sys
from pathlib import Path

MIGRATION_VERSION = 1  # bump only if this exact migration needs to run again

# явные overrides для заданий/челленджей, поменявших позицию внутри темы
OVERRIDES = {
    "12.1": "3.3",
    "12.2": "3.5",
    "12.3": "3.6",
    "12.6": "13.4",
    "C7.1": "C8.1",
    "C9.1": "C10.1",
    "C12.1": "C13.1",
}

TASK_ID_RE = re.compile(r"^(\d+)\.(\d+)$")
CHALLENGE_ID_RE = re.compile(r"^C(\d+)\.(\d+)$")


def remap_id(old_id: str) -> str:
    if old_id in OVERRIDES:
        return OVERRIDES[old_id]
    m = CHALLENGE_ID_RE.match(old_id)
    if m:
        topic = int(m.group(1))
        if topic >= 3:
            topic += 1
        return f"C{topic}.{m.group(2)}"
    m = TASK_ID_RE.match(old_id)
    if m:
        topic = int(m.group(1))
        if topic >= 3:
            topic += 1
        return f"{topic}.{m.group(2)}"
    return old_id  # not a topic-scoped id (e.g. daily-ai ids) - leave as-is


def remap_topic_id(old_topic_id: int) -> int:
    return old_topic_id + 1 if old_topic_id >= 3 else old_topic_id


# (table, id_column, extra_pk_columns) — extra_pk_columns are the OTHER primary
# key columns besides id_column, needed to detect/avoid collisions on rename.
TASK_ID_TABLES = [
    ("progress", "task_id", ["user_id"]),
    ("ai_messages", "task_id", None),  # id is its own PK (AUTOINCREMENT), no collision risk
    ("notes", "task_id", ["user_id"]),
    ("attempts", "task_id", None),  # AUTOINCREMENT PK
    ("drop_awards", "task_id", ["user_id"]),
    ("hint_unlocks", "task_id", ["user_id", "level"]),
    ("ai_lessons", "task_id", None),  # task_id itself is PK, single column
]


def migrate(db_path: Path) -> None:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    current_version = cur.execute("PRAGMA user_version").fetchone()[0]
    if current_version >= MIGRATION_VERSION:
        print(f"already migrated (user_version={current_version}) - nothing to do")
        conn.close()
        return

    total_updated = 0
    for table, col, extra_pk in TASK_ID_TABLES:
        select_cols = ["rowid AS _rid", col] + (extra_pk or [])
        rows = cur.execute(f"SELECT {', '.join(select_cols)} FROM {table}").fetchall()
        for row in rows:
            old_id = row[col]
            new_id = remap_id(old_id)
            if new_id == old_id:
                continue
            if extra_pk:
                # composite PK (user_id[, level] + task_id): if the target id
                # already exists for this user, skip renaming to avoid a
                # UNIQUE/PK collision (extremely unlikely - would mean the
                # user already solved the same content under both old and new
                # numbering, which cannot happen for a fresh renumbering).
                pk_cols = extra_pk + [col]
                where = " AND ".join(f"{c} = ?" for c in pk_cols)
                params = [row[c] for c in extra_pk] + [new_id]
                exists = cur.execute(
                    f"SELECT 1 FROM {table} WHERE {where}", params
                ).fetchone()
                if exists:
                    print(f"  SKIP {table}.{old_id} -> {new_id} (target already exists)")
                    continue
            cur.execute(
                f"UPDATE {table} SET {col} = ? WHERE rowid = ?", (new_id, row["_rid"])
            )
            total_updated += 1
        print(f"{table}: checked {len(rows)} row(s)")

    # ai_topic_lessons: topic_id is an INTEGER PK
    topic_rows = cur.execute("SELECT rowid AS _rid, topic_id FROM ai_topic_lessons").fetchall()
    for row in topic_rows:
        old_topic = row["topic_id"]
        new_topic = remap_topic_id(old_topic)
        if new_topic != old_topic:
            cur.execute(
                "UPDATE ai_topic_lessons SET topic_id = ? WHERE rowid = ?",
                (new_topic, row["_rid"]),
            )
            total_updated += 1
    print(f"ai_topic_lessons: checked {len(topic_rows)} row(s)")

    cur.execute(f"PRAGMA user_version = {MIGRATION_VERSION}")
    conn.commit()
    conn.close()
    print(f"done, {total_updated} row(s) remapped, user_version -> {MIGRATION_VERSION}")


if __name__ == "__main__":
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / "instance" / "app.db"
    if not path.exists():
        print(f"no db at {path} - nothing to migrate")
        raise SystemExit(0)
    migrate(path)
