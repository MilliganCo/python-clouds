"""Private editor drafts. CAS plus idempotent writes; no learning/economy side effects."""
import re
import sqlite3
from datetime import date

MAX_BYTES=64*1024
MAX_TOTAL_BYTES=32*1024*1024
MAX_SCOPES=5000
MAX_VERSION=2**53-1
_ID=re.compile(r'^[0-9a-f]{32}$')
SCHEMA='''
CREATE TABLE IF NOT EXISTS editor_drafts (
    user_id INTEGER NOT NULL REFERENCES users(id),
    scope TEXT NOT NULL,
    code TEXT,
    starter TEXT NOT NULL,
    version INTEGER NOT NULL CHECK(version>0),
    mutation_id TEXT NOT NULL,
    last_base INTEGER NOT NULL,
    last_base_id TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(user_id,scope)
);
'''


class DraftError(ValueError):
    def __init__(self,code,message,status=400,current=None):
        super().__init__(message)
        self.code,self.status,self.current=code,status,current


def validate_scope(scope,known_tasks):
    if not isinstance(scope,str) or len(scope)>160:
        raise DraftError('invalid_draft','Неизвестный черновик.')
    if scope=='sandbox':return
    if scope.startswith('task:') and scope[5:] in known_tasks:return
    if re.fullmatch(r'atlas:[a-z0-9-]{1,80}',scope):return
    match=re.fullmatch(r'daily:(\d{4}-\d{2}-\d{2}):(intermediate|advanced|expert)(?::[0-9a-f]{64})?',scope)
    if match:
        try:date.fromisoformat(match[1])
        except ValueError:pass
        else:return
    raise DraftError('invalid_draft','Неизвестный черновик.')


def validate_payload(data,known_tasks):
    fields={'scope','code','starter','base_version','base_mutation_id','mutation_id'}
    if type(data) is not dict or set(data)!=fields:
        raise DraftError('invalid_draft','Неверные поля черновика.')
    validate_scope(data['scope'],known_tasks)
    for key in ('code','starter'):
        value=data[key]
        if key=='code' and value is None:continue
        if not isinstance(value,str):raise DraftError('invalid_draft','Код должен быть строкой.')
        try:size=len(value.encode('utf-8'))
        except UnicodeError:raise DraftError('invalid_draft','Некорректный текст.') from None
        if size>MAX_BYTES:raise DraftError('draft_too_large','Черновик больше серверного лимита; локальная копия сохранена.',413)
    version=data['base_version'];base_id=data['base_mutation_id'];mutation=data['mutation_id']
    if (type(version) is not int or not 0<=version<=MAX_VERSION
            or (version==0 and base_id is not None)
            or (version>0 and (not isinstance(base_id,str) or not _ID.fullmatch(base_id)))
            or not isinstance(mutation,str) or not _ID.fullmatch(mutation)):
        raise DraftError('invalid_draft','Неверная версия черновика.')


def _row(connection,uid,scope):
    return connection.execute('SELECT code,starter,version,mutation_id,last_base,last_base_id,updated_at '
                              'FROM editor_drafts WHERE user_id=? AND scope=?',(uid,scope)).fetchone()


def public(scope,row):
    if row is None:
        return dict(scope=scope,code=None,starter=None,version=0,mutation_id=None,updated_at=None)
    return dict(scope=scope,code=row[0],starter=row[1],version=row[2],mutation_id=row[3],updated_at=row[6])


def load(connection,uid,scope):
    return public(scope,_row(connection,uid,scope))


def save(connection,uid,data,stamp):
    """All quotas, idempotency checks and changes share one write transaction."""
    scope=data['scope'];code=data['code'];starter=data['starter']
    with connection:
        connection.execute('BEGIN IMMEDIATE')
        row=_row(connection,uid,scope);current=public(scope,row)
        if row is not None and row[3]==data['mutation_id']:
            if (row[0],row[1],row[4],row[5])==(code,starter,data['base_version'],data['base_mutation_id']):
                return current
            raise DraftError('mutation_reused','Повтор записи содержит другой текст.',409,current)
        if current['version']!=data['base_version'] or current['mutation_id']!=data['base_mutation_id']:
            raise DraftError('draft_conflict','На сервере есть другая версия. Выберите копию явно.',409,current)
        if current['version']>=MAX_VERSION:
            raise DraftError('draft_version_limit','Не удалось продолжить нумерацию версий.',503,current)
        count,total=connection.execute('SELECT COUNT(*),COALESCE(SUM(length(CAST(code AS BLOB))),0)+'
            'COALESCE(SUM(length(CAST(starter AS BLOB))),0) FROM editor_drafts WHERE user_id=?',(uid,)).fetchone()
        old_size=0 if row is None else len((row[0] or '').encode('utf8'))+len(row[1].encode('utf8'))
        size=len((code or '').encode('utf8'))+len(starter.encode('utf8'))
        if (row is None and count>=MAX_SCOPES) or total-old_size+size>MAX_TOTAL_BYTES:
            raise DraftError('draft_quota','Серверный лимит черновиков исчерпан; локальная копия сохранена.',413,current)
        version=current['version']+1
        values=(code,starter,version,data['mutation_id'],data['base_version'],data['base_mutation_id'],stamp,uid,scope)
        if row is None:
            connection.execute('INSERT INTO editor_drafts(code,starter,version,mutation_id,last_base,last_base_id,updated_at,user_id,scope) '
                               'VALUES (?,?,?,?,?,?,?,?,?)',values)
        else:
            connection.execute('UPDATE editor_drafts SET code=?,starter=?,version=?,mutation_id=?,last_base=?,last_base_id=?,updated_at=? '
                               'WHERE user_id=? AND scope=?',values)
        return public(scope,_row(connection,uid,scope))


def is_busy(error):
    return (getattr(error,'sqlite_errorcode',0)&255) in (sqlite3.SQLITE_BUSY,sqlite3.SQLITE_LOCKED)
