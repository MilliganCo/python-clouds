"""Signed, account-bound learning archives; transactional preview and additive restore."""
from collections import Counter
from contextlib import contextmanager
import hashlib
import hmac
import json
import secrets
import sqlite3
import time

import project_courses as pc
import weekly_practice as weekly
from workshop import ARCHIVE_TABLES as WORKSHOP_TABLES
from account_security import SERVER_TABLES as ACCOUNT_SECURITY_TABLES
from account_lifecycle import SERVER_TABLES as ACCOUNT_LIFECYCLE_TABLES
from ai_controls import SERVER_TABLES as AI_CONTROL_TABLES

FORMAT = 'pycloud-learning-archive'
VERSION = 3
MAX_BYTES = 16 * 1024 * 1024
REQUEST_BYTES = 20 * 1024 * 1024
MAX_ROWS = 50000
MAX_RECEIPTS = 50
MAX_HISTORY_BYTES = 128 * 1024 * 1024
PREVIEW_SECONDS = 600
CHOICES = ('keep_current', 'use_archive')
SCHEMA = '''
CREATE TABLE IF NOT EXISTS learning_archive_restores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    archive_hash TEXT NOT NULL,
    choice TEXT NOT NULL,
    applied_at TEXT NOT NULL,
    before_json TEXT NOT NULL,
    incoming_json TEXT NOT NULL,
    result_json TEXT NOT NULL,
    UNIQUE(user_id, archive_hash, choice)
);
'''

# SQL identifiers come only from this allowlist or SQLite's own table metadata.
KEYS = {
    'progress': ('task_id',), 'notes': ('task_id',), 'survey': (),
    'review_fixes': ('task_id',), 'review_practice': ('task_id',),
    'project_course_progress': ('course_id',),
    'project_stage_progress': ('course_id', 'stage_id'),
    'daily_ai_solves': ('day', 'difficulty'), 'atlas_tasks': ('id',),
    'atlas_solves': ('task_id',), 'editor_drafts': ('scope',),
    'drop_awards': ('task_id',), 'achievements': ('key',), 'freeze_uses': ('day',),
    'hint_unlocks': ('task_id', 'level'), 'daily_claims': ('day',),
    'chest_grants': ('grant_key',), 'chest_launches': ('request_key',),
    'game_log': ('day',),
    'weekly_reward_keys': ('content_key',),
}
APPEND = {'ai_messages', 'attempts', 'project_code_snapshots', 'project_course_events'}
JOURNALS = {'progress', 'drop_awards', 'achievements', 'freeze_uses', 'hint_unlocks',
            'daily_claims', 'chest_grants', 'chest_launches', 'game_log','weekly_reward_keys'}
READ_ONLY = {'wallet', 'purchases', 'showcase_cards', 'showcase_votes', 'ai_memory', 'riddle_sessions'}
READ_ONLY |= WORKSHOP_TABLES  # Included in exports; project JSON can be imported into a new private workspace.
TABLES = tuple(sorted(set(KEYS) | APPEND | READ_ONLY))
# Credentials, restore receipts and operator grants stay in the private instance
# backup, outside learner-controlled exports. Keep the existing v2 format valid.
SERVER_ONLY_TABLES = frozenset({'mobile_sessions', 'learning_archive_restores', 'operator_wallet_grants', 'game_round_receipts'})
SERVER_ONLY_TABLES |= ACCOUNT_SECURITY_TABLES
SERVER_ONLY_TABLES |= ACCOUNT_LIFECYCLE_TABLES
SERVER_ONLY_TABLES |= AI_CONTROL_TABLES
CONTEXTS = ('daily_ai_tasks', 'daily_ai_candidates','weekly_assignments')


class ArchiveError(ValueError):
    def __init__(self, code, message, status=400):
        super().__init__(message)
        self.code, self.status = code, status


def canonical(value):
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'),
                          allow_nan=False).encode('utf-8')
    except (ValueError, TypeError, UnicodeError, RecursionError):
        raise ArchiveError('invalid_archive', 'Некорректный JSON архива.') from None


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def mac(key, purpose, value):
    if isinstance(key, str): key = key.encode('utf-8')
    return hmac.new(key, purpose.encode('ascii') + b'\0' + canonical(value), hashlib.sha256).hexdigest()


def seal(key, payload):
    result = {'payload': payload, 'signature': mac(key, FORMAT, payload)}
    if len(canonical(result)) > MAX_BYTES:
        raise ArchiveError('archive_too_large', 'Архив превышает 16 МиБ. Данные не обрезаны; нужна административная резервная копия.', 413)
    return result


def owner_column(table):
    return 'owner_id' if table == 'atlas_tasks' else 'user_id'


def columns(conn, table):
    return tuple(row[1] for row in conn.execute(f'PRAGMA table_info("{table}")')
                 if row[1] != owner_column(table))


def owner(conn, uid):
    row = conn.execute('SELECT id,username,created_at FROM users WHERE id=?', (uid,)).fetchone()
    if row is None:
        raise ArchiveError('archive_owner', 'Аккаунт не найден.', 403)
    return dict(zip(('id', 'username', 'created_at'), row))


def rows(conn, table, uid):
    names = columns(conn, table)
    selected = ','.join('"' + col + '"' for col in names)
    return [dict(zip(names, row)) for row in conn.execute(
        f'SELECT {selected} FROM "{table}" WHERE "{owner_column(table)}"=? ORDER BY rowid', (uid,))]


def capture(conn, uid):
    tables = {table: rows(conn, table, uid) for table in TABLES}
    pairs = {(row['day'], row['difficulty']) for row in tables['daily_ai_solves']}
    for row in tables['editor_drafts']:
        parts = row['scope'].split(':')
        if len(parts) >= 3 and parts[0] == 'daily': pairs.add((parts[1], parts[2]))
    contexts = {table: [] for table in CONTEXTS}
    for table in ('daily_ai_tasks','daily_ai_candidates'):
        names = tuple(row[1] for row in conn.execute(f'PRAGMA table_info("{table}")'))
        for day, difficulty in sorted(pairs):
            row = conn.execute(f'SELECT * FROM "{table}" WHERE day=? AND difficulty=?', (day, difficulty)).fetchone()
            if row is not None: contexts[table].append(dict(zip(names, row)))
    weekly_ids={row['task_id'] for row in tables['atlas_solves'] if row['task_id'].startswith('weekly-')}
    weekly_ids.update(row['scope'][6:] for row in tables['editor_drafts'] if row['scope'].startswith('atlas:weekly-'))
    names=tuple(row[1] for row in conn.execute('PRAGMA table_info(weekly_assignments)'))
    for id in sorted(weekly_ids):
        row=conn.execute('SELECT * FROM weekly_assignments WHERE task_id=? ORDER BY week_start LIMIT 1',(id,)).fetchone()
        if row is not None:contexts['weekly_assignments'].append(dict(zip(names,row)))
    return {'tables': tables, 'contexts': contexts}


@contextmanager
def transaction(conn, write=False):
    if conn.in_transaction:
        raise RuntimeError('Archive requires its own transaction')
    with conn:
        conn.execute('BEGIN IMMEDIATE' if write else 'BEGIN')
        yield


def pack(conn, uid, key, stamp, state=None):
    state = capture(conn, uid) if state is None else state
    if sum(len(items) for group in state.values() for items in group.values()) > MAX_ROWS:
        raise ArchiveError('archive_too_large', 'В архиве больше 50 000 записей. Данные не обрезаны.', 413)
    return seal(key, {'format': FORMAT, 'version': VERSION, 'archive_id': secrets.token_hex(16),
                      'created_at': stamp, 'owner': owner(conn, uid), **state})


def export_archive(conn, uid, key, stamp):
    with transaction(conn):
        return pack(conn, uid, key, stamp)


def validate(conn, uid, key, archive):
    if type(archive) is not dict or set(archive) != {'payload', 'signature'}:
        raise ArchiveError('invalid_archive', 'Выберите личный архив учебной работы.')
    if len(canonical(archive)) > MAX_BYTES:
        raise ArchiveError('archive_too_large', 'Архив больше 16 МиБ.', 413)
    data, signature = archive['payload'], archive['signature']
    if (not isinstance(signature, str) or len(signature) != 64 or not signature.isascii()
            or not hmac.compare_digest(signature, mac(key, FORMAT, data))):
        raise ArchiveError('archive_signature', 'Подпись не совпала. Файл изменён или создан другой установкой платформы.')
    if type(data) is not dict or set(data) != {'format', 'version', 'archive_id', 'created_at', 'owner', 'tables', 'contexts'}:
        raise ArchiveError('archive_version', 'Неизвестная версия архива. Исходный файл сохраните без изменений.')
    if data['format'] != FORMAT or type(data['version']) is not int or data['version'] not in (1,2,VERSION):
        raise ArchiveError('archive_version', 'Эта версия архива пока не поддерживается.')
    if data['owner'] != owner(conn, uid):
        raise ArchiveError('archive_owner', 'Архив принадлежит другому аккаунту.', 403)
    if (not isinstance(data['archive_id'], str) or len(data['archive_id']) != 32
            or any(c not in '0123456789abcdef' for c in data['archive_id']) or not isinstance(data['created_at'], str)):
        raise ArchiveError('invalid_archive', 'Неверный заголовок архива.')
    expected_tables=set(TABLES)-({'weekly_reward_keys'} if data['version']==1 else set())
    if data['version']<3:expected_tables-=WORKSHOP_TABLES
    expected_contexts=set(CONTEXTS)-({'weekly_assignments'} if data['version']==1 else set())
    if (type(data['tables']) is not dict or set(data['tables']) != expected_tables
            or type(data['contexts']) is not dict or set(data['contexts']) != expected_contexts):
        raise ArchiveError('archive_version', 'Состав разделов архива отличается от поддерживаемого.')
    total = 0
    for table, items in {**data['tables'], **data['contexts']}.items():
        names = set(columns(conn, table)) if table in TABLES else {r[1] for r in conn.execute(f'PRAGMA table_info("{table}")')}
        if type(items) is not list:
            raise ArchiveError('invalid_archive', 'Раздел архива должен быть списком.')
        total += len(items)
        seen = set()
        for row in items:
            if type(row) is not dict or set(row) != names or any(type(v) not in (str, int, type(None)) for v in row.values()):
                raise ArchiveError('archive_version', 'Поля архива несовместимы с текущей схемой.')
            fields = KEYS.get(table, ('id',) if table in APPEND else None)
            if fields is not None:
                identity = tuple(row[k] for k in fields)
                if identity in seen: raise ArchiveError('invalid_archive', 'Повторяющийся ключ записи.')
                seen.add(identity)
        if total > MAX_ROWS:
            raise ArchiveError('archive_too_large', 'В архиве больше 50 000 записей. Данные не обрезаны.', 413)
    if data['version']<3:
        # Preserve the signed original envelope; normalize only the validated view.
        return {**data,'tables':{**{table:[] for table in WORKSHOP_TABLES},
                    **({'weekly_reward_keys':[]} if data['version']==1 else {}),**data['tables']},
                'contexts':{**({'weekly_assignments':[]} if data['version']==1 else {}),**data['contexts']}}
    return data


def comparable(table, row):
    ignored = {'id'} if table in APPEND else set()
    if table == 'project_code_snapshots': ignored.add('version')
    if table == 'editor_drafts': return {k: row[k] for k in ('scope', 'code', 'starter')}
    return {k: v for k, v in row.items() if k not in ignored}


def record_title(table, row):
    if 'course_id' in row:
        course = pc.get_course(row['course_id'])
        if course:
            stage = pc.get_stage(course, row.get('stage_id')) if row.get('stage_id') else None
            return course.get('short_title', course['title']) + (' / ' + stage['title'] if stage else '')
    if 'task_id' in row: return 'Задание ' + row['task_id']
    if 'scope' in row: return 'Песочница' if row['scope'] == 'sandbox' else row['scope']
    return ' / '.join(str(row[k]) for k in KEYS[table]) or 'Личная запись'


def insert(conn, table, uid, row):
    value = {owner_column(table): uid, **row}
    names = tuple(value)
    conn.execute(f'INSERT INTO "{table}" (' + ','.join('"' + k + '"' for k in names) + ') VALUES (' +
                 ','.join('?' for _ in names) + ')', tuple(value[k] for k in names))


def update(conn, table, uid, row):
    keys = KEYS[table]
    fields = tuple(k for k in row if k not in keys)
    if not fields: return
    conn.execute(f'UPDATE "{table}" SET ' + ','.join('"' + k + '"=?' for k in fields) +
                 f' WHERE "{owner_column(table)}"=?' + ''.join(' AND "' + k + '" IS ?' for k in keys),
                 tuple(row[k] for k in fields) + (uid,) + tuple(row[k] for k in keys))


def _weekly_signature(task_id,key,raw):
    try:
        payload=json.loads(raw)
        if (type(payload) is not dict or payload.get('id')!=task_id
                or any(type(payload.get(k)) is not str for k in weekly.CORE_FIELDS)
                or weekly.content_key(payload)!=key):raise ValueError('Invalid weekly identity')
        return key,canonical(weekly.immutable_payload(payload))
    except (ValueError,TypeError,KeyError,UnicodeError,RecursionError):
        raise ArchiveError('archive_context_changed','Версия практикума повреждена или отличается. Общая задача не заменена.',409) from None


def check_contexts(conn, data, uid):
    for table, items in data['contexts'].items():
        for row in items:
            if table=='weekly_assignments':
                signature=_weekly_signature(row['task_id'],row['content_key'],row['payload_json'])
                prior=conn.execute('SELECT content_key,payload_json FROM weekly_assignments WHERE task_id=? ORDER BY week_start LIMIT 1',(row['task_id'],)).fetchone()
                if prior is not None and _weekly_signature(row['task_id'],prior[0],prior[1])!=signature:
                    raise ArchiveError('archive_context_changed','Опубликованная версия практикума отличается. Общая задача не заменена.',409)
            names = tuple(row)
            query=('week_start=?' if table=='weekly_assignments' else 'day=? AND difficulty=?')
            params=(row['week_start'],) if table=='weekly_assignments' else (row['day'],row['difficulty'])
            current = conn.execute(f'SELECT ' + ','.join('"' + k + '"' for k in names) + f' FROM "{table}" WHERE '+query,params).fetchone()
            def compare(value):
                if table=='weekly_assignments':
                    return value['week_start'],value['task_id'],_weekly_signature(value['task_id'],value['content_key'],value['payload_json'])
                return value
            if current is not None and compare(dict(zip(names,current))) != compare(row):
                subject='Задание недели' if table=='weekly_assignments' else 'Общее задание дня'
                raise ArchiveError('archive_context_changed',subject+' изменилось. Архивная версия не заменяет общую задачу других учеников.',409)
    for row in data['tables']['atlas_tasks']:
        current = conn.execute('SELECT owner_id FROM atlas_tasks WHERE id=?', (row['id'],)).fetchone()
        if current is not None and current[0] != uid:
            raise ArchiveError('archive_identity_conflict', 'Идентификатор архивной задачи уже занят. Нужна проверка администратора.', 409)
        current = conn.execute('SELECT id FROM atlas_tasks WHERE owner_id=? AND request_key=?', (uid, row['request_key'])).fetchone()
        if current is not None and current[0] != row['id']:
            raise ArchiveError('archive_identity_conflict', 'Ключ архивной задачи уже занят. Ничего не восстановлено.', 409)


def plan(conn, uid, data, state, choice):
    check_contexts(conn, data, uid)
    actions, sections, conflicts = [], [], []
    for table in TABLES:
        incoming, current = data['tables'][table], state['tables'][table]
        counts = dict(add=0, update=0, conflict=0, unchanged=0, read_only=0)
        if table in READ_ONLY:
            counts['read_only'] = len(incoming)
        elif table in APPEND:
            existing = Counter(digest(comparable(table, row)) for row in current)
            for row in incoming:
                identity = digest(comparable(table, row))
                if existing[identity]: existing[identity] -= 1; counts['unchanged'] += 1
                else: actions.append(('insert', table, row)); counts['add'] += 1
        else:
            index = {tuple(row[k] for k in KEYS[table]): row for row in current}
            for row in incoming:
                old = index.get(tuple(row[k] for k in KEYS[table]))
                if old is None: actions.append(('insert', table, row)); counts['add'] += 1
                elif comparable(table, old) == comparable(table, row): counts['unchanged'] += 1
                elif table in JOURNALS:
                    merged = dict(old)
                    # A signed weekly payout is an absorbing anti-repay marker.
                    if table=='weekly_reward_keys' and row['first_source']=='weekly' and old['first_source']!='weekly':merged=dict(row)
                    if table == 'chest_grants': merged['used'] = min(old['launches'], max(old['used'], row['used']))
                    if table == 'game_log':
                        for field in ('drops', 'best_score'): merged[field] = max(old[field], row[field])
                    if merged != old: actions.append(('update', table, merged)); counts['update'] += 1
                    else: counts['unchanged'] += 1
                else:
                    counts['conflict'] += 1
                    if len(conflicts) < 20:
                        conflicts.append(dict(section=table, key=[row[k] for k in KEYS[table]], title=record_title(table, row), current=old, incoming=row))
                    if choice == 'use_archive': actions.append(('update', table, row)); counts['update'] += 1
        sections.append(dict(section=table, **counts))
    return actions, dict(sections=sections, conflicts=conflicts,
                         conflict_count=sum(s['conflict'] for s in sections),
                         add=sum(s['add'] for s in sections), update=sum(s['update'] for s in sections))


def preview(conn, uid, key, archive, choice, clock=time.time):
    if choice not in CHOICES: raise ArchiveError('invalid_archive_choice', 'Выберите правило для конфликтов.')
    with transaction(conn):
        data = validate(conn, uid, key, archive)
        state = capture(conn, uid)
        _, result = plan(conn, uid, data, state, choice)
        proof = dict(archive=digest(archive), state=digest(state), owner=data['owner'], choice=choice,
                     expires=int(clock()) + PREVIEW_SECONDS)
        result.update(owner=data['owner']['username'], created_at=data['created_at'], choice=choice,
                      token={'proof': proof, 'signature': mac(key, 'learning-restore-preview-v1', proof)})
        return result


def save_project_copy(conn, uid, row, stamp, kind):
    version = conn.execute('SELECT COALESCE(MAX(version),0)+1 FROM project_code_snapshots WHERE user_id=? AND course_id=? AND stage_id=?',
                           (uid, row['course_id'], row['stage_id'])).fetchone()[0]
    insert(conn, 'project_code_snapshots', uid, dict(course_id=row['course_id'], stage_id=row['stage_id'],
        version=version, kind=kind, code=row['current_code'], template_version=row['template_version'],
        check_json=row['last_check_json'], created_at=stamp))


def restore_archive(conn, uid, key, archive, choice, token, stamp, clock=time.time):
    if choice not in CHOICES: raise ArchiveError('invalid_archive_choice', 'Выберите правило для конфликтов.')
    with transaction(conn, write=True):
        data = validate(conn, uid, key, archive)
        archive_hash = digest(archive)
        previous = conn.execute('SELECT id,result_json FROM learning_archive_restores WHERE user_id=? AND archive_hash=? AND choice=?',
                                (uid, archive_hash, choice)).fetchone()
        if previous is not None:
            return {**json.loads(previous[1]), 'receipt_id': previous[0], 'replayed': True}
        if type(token) is not dict or set(token) != {'proof', 'signature'}:
            raise ArchiveError('archive_preview_required', 'Сначала проверьте архив без записи данных.', 409)
        proof, signature = token['proof'], token['signature']
        if (type(proof) is not dict or set(proof) != {'archive', 'state', 'owner', 'choice', 'expires'}
                or not isinstance(signature, str) or not signature.isascii() or len(signature) != 64
                or not hmac.compare_digest(signature, mac(key, 'learning-restore-preview-v1', proof))
                or proof['archive'] != archive_hash or proof['owner'] != data['owner'] or proof['choice'] != choice
                or type(proof['expires']) is not int or not clock() <= proof['expires'] <= clock() + PREVIEW_SECONDS):
            raise ArchiveError('archive_preview_expired', 'Предпросмотр устарел. Проверьте файл заново.', 409)
        state = capture(conn, uid)
        if proof['state'] != digest(state):
            raise ArchiveError('archive_state_changed', 'После предпросмотра учебная работа изменилась. Проверьте файл заново.', 409)
        actions, result = plan(conn, uid, data, state, choice)
        before = canonical(pack(conn, uid, key, stamp, state)).decode('utf-8')
        incoming = canonical(archive).decode('utf-8')
        count, size = conn.execute('SELECT COUNT(*),COALESCE(SUM(length(CAST(before_json AS BLOB))+length(CAST(incoming_json AS BLOB))),0) '
                                  'FROM learning_archive_restores WHERE user_id=?', (uid,)).fetchone()
        if count >= MAX_RECEIPTS or size + len(before.encode('utf-8')) + len(incoming.encode('utf-8')) > MAX_HISTORY_BYTES:
            raise ArchiveError('archive_history_full', 'Лимит истории восстановления исчерпан. Ничего не изменено; обратитесь к администратору.', 413)
        for table, items in data['contexts'].items():
            for row in items:
                names = tuple(row)
                conn.execute(f'INSERT OR IGNORE INTO "{table}" (' + ','.join('"' + k + '"' for k in names) +
                             ') VALUES (' + ','.join('?' for _ in names) + ')', tuple(row[k] for k in names))
        for action, table, original in actions:
            row = dict(original)
            if table in APPEND: row.pop('id')
            if table == 'project_code_snapshots':
                row['version'] = conn.execute('SELECT COALESCE(MAX(version),0)+1 FROM project_code_snapshots WHERE user_id=? AND course_id=? AND stage_id=?',
                    (uid, row['course_id'], row['stage_id'])).fetchone()[0]
            if table == 'editor_drafts':
                old = next((r for r in state['tables'][table] if r['scope'] == row['scope']), None)
                version = old['version'] if old else 0
                if version >= 2**53-1: raise ArchiveError('draft_version_limit', 'Исчерпаны версии черновика. Ничего не изменено.', 409)
                row.update(version=version+1, mutation_id=secrets.token_hex(16), last_base=version,
                           last_base_id=old['mutation_id'] if old else None, updated_at=stamp)
            if table == 'project_stage_progress' and action == 'update':
                old = next(r for r in state['tables'][table] if (r['course_id'], r['stage_id']) == (row['course_id'], row['stage_id']))
                save_project_copy(conn, uid, old, stamp, 'before_archive_restore')
            if action == 'insert': insert(conn, table, uid, row)
            else: update(conn, table, uid, row)
            if table == 'project_stage_progress' and action == 'update':
                save_project_copy(conn, uid, row, stamp, 'archive_restore')
        # Restored solves cannot pay the ordinary task award for a second time.
        for row in data['tables']['progress']:
            conn.execute('INSERT OR IGNORE INTO drop_awards(user_id,task_id) VALUES (?,?)', (uid, row['task_id']))
        pack(conn, uid, key, stamp)
        # Keep summaries, not duplicated preview code, in the operation result.
        result.pop('conflicts')
        cur = conn.execute('INSERT INTO learning_archive_restores(user_id,archive_hash,choice,applied_at,before_json,incoming_json,result_json) VALUES (?,?,?,?,?,?,?)',
            (uid, archive_hash, choice, stamp, before, incoming, canonical(result).decode('utf-8')))
        return {**result, 'receipt_id': cur.lastrowid, 'replayed': False}


def history(conn, uid):
    return [dict(id=row[0], choice=row[1], applied_at=row[2], result=json.loads(row[3]))
            for row in conn.execute('SELECT id,choice,applied_at,result_json FROM learning_archive_restores WHERE user_id=? ORDER BY id DESC', (uid,))]


def history_archive(conn, uid, receipt_id, which):
    if which not in ('before', 'incoming'):
        raise ArchiveError('invalid_archive', 'Неизвестная копия.')
    row = conn.execute(f'SELECT {which}_json FROM learning_archive_restores WHERE user_id=? AND id=?', (uid, receipt_id)).fetchone()
    if row is None: raise ArchiveError('archive_not_found', 'Копия не найдена.', 404)
    return json.loads(row[0])
