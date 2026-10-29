"""Prepared weekly focus, immutable shared publication and content-credit markers.

No code execution, learner grading, wallet writes, model calls or implicit commits
inside reward operations. The caller holds its existing solve transaction.
"""
from datetime import date,timedelta
import hashlib
import json

REWARD=30
CORE_FIELDS=('title','prompt','func_name','starter','solution','tests')
EDITORIAL_FIELDS=frozenset(('skills','prerequisites','reflection','explanation'))
SCHEMA='''
CREATE TABLE IF NOT EXISTS weekly_assignments (
    week_start TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    content_key TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_weekly_assignment_task ON weekly_assignments(task_id,week_start);
CREATE TABLE IF NOT EXISTS weekly_reward_keys (
    user_id INTEGER NOT NULL REFERENCES users(id),
    content_key TEXT NOT NULL,
    first_source TEXT NOT NULL CHECK(first_source IN ('weekly','legacy_daily','legacy_atlas')),
    source_id TEXT NOT NULL,
    awarded_at TEXT NOT NULL,
    PRIMARY KEY(user_id,content_key)
);
'''


def content_key(task):
    return hashlib.sha256(json.dumps({k:task[k] for k in CORE_FIELDS},sort_keys=True,ensure_ascii=False).encode()).hexdigest()


def immutable_payload(payload):
    """Editorial fields do not redefine a published exercise or its credit."""
    return {k:v for k,v in payload.items() if k not in EDITORIAL_FIELDS}


def display_payload(payload,bank):
    candidate=next((task for task in bank.get('tasks',[]) or []
                    if isinstance(task,dict) and task.get('id')==payload.get('id')),None)
    if candidate is None or immutable_payload(candidate)!=immutable_payload(payload):return payload
    skills,topics=candidate.get('skills'),candidate.get('prerequisites')
    if (type(skills) is not list or not skills or any(type(v) is not str or not v.strip() for v in skills)
            or type(topics) is not list or not topics or any(type(v) is not int or v<0 for v in topics)
            or any(type(candidate.get(k)) is not str or not candidate[k].strip() for k in ('reflection','explanation'))):
        return payload
    return {**payload,**{k:list(candidate[k]) if isinstance(candidate[k],list) else candidate[k] for k in EDITORIAL_FIELDS}}


def week_start(stamp):
    day=date.fromisoformat(stamp[:10])
    return (day-timedelta(days=day.weekday())).isoformat()


def week_end(start):
    return (date.fromisoformat(start)+timedelta(days=6)).isoformat()


def row_dict(row):
    if row is None:return None
    return dict(week_start=row[0],task_id=row[1],content_key=row[2],payload=json.loads(row[3]))


def current(conn,bank,stamp,*,create=True):
    start=week_start(stamp)
    anchor=date.fromisoformat(bank['anchor'])
    offset=(date.fromisoformat(start)-anchor).days//7
    if offset<0 or not bank['tasks']:return None
    def read():
        return row_dict(conn.execute('SELECT week_start,task_id,content_key,payload_json FROM weekly_assignments WHERE week_start=?',(start,)).fetchone())
    found=read()
    if found is not None or not create:return found
    own=not conn.in_transaction
    try:
        if own:conn.execute('BEGIN IMMEDIATE')
        found=read()
        if found is None:
            task=bank['tasks'][offset%len(bank['tasks'])]
            # A published ID is immutable, even when the on-disk bank is edited.
            previous=conn.execute('SELECT payload_json FROM weekly_assignments WHERE task_id=? ORDER BY week_start LIMIT 1',(task['id'],)).fetchone()
            if previous is not None:task=json.loads(previous[0])
            conn.execute('INSERT INTO weekly_assignments(week_start,task_id,content_key,payload_json,created_at) VALUES (?,?,?,?,?)',
                (start,task['id'],content_key(task),json.dumps(task,ensure_ascii=False),stamp))
            found=read()
        if own:conn.commit()
        return found
    except BaseException:
        if own:conn.rollback()
        raise


def published(conn,stamp):
    start=week_start(stamp)
    rows=conn.execute('SELECT week_start,task_id,content_key,payload_json FROM weekly_assignments WHERE week_start<=? ORDER BY week_start',(start,)).fetchall()
    unique={}
    for row in rows:unique.setdefault(row[1],row_dict(row))
    return list(unique.values())


def credit_source(conn,uid,key):
    row=conn.execute('SELECT first_source,source_id FROM weekly_reward_keys WHERE user_id=? AND content_key=?',(uid,key)).fetchone()
    return tuple(row) if row is not None else None


def weekly_paid(conn,uid,key):
    row=credit_source(conn,uid,key)
    return row is not None and row[0]=='weekly'


def remember(conn,uid,key,source,source_id,stamp):
    conn.execute('INSERT OR IGNORE INTO weekly_reward_keys(user_id,content_key,first_source,source_id,awarded_at) VALUES (?,?,?,?,?)',
                 (uid,key,source,source_id,stamp))
