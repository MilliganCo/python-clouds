"""Account erasure, private receipts and explicit reconciliation of older backups."""
from datetime import datetime,timedelta
import re,secrets
from flask import g,jsonify,request,session
import account_security as security

SERVER_TABLES=frozenset({'account_deletion_intents','account_deletions'})
SCHEMA='''
CREATE TABLE IF NOT EXISTS account_deletion_intents (
 user_id INTEGER PRIMARY KEY REFERENCES users(id), generation INTEGER NOT NULL,
 request_id TEXT UNIQUE NOT NULL, token_hash TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS account_deletions (
 user_id INTEGER PRIMARY KEY, username_hash TEXT UNIQUE NOT NULL,
 deleted_at TEXT NOT NULL, request_id TEXT UNIQUE NOT NULL,
 token_hash TEXT NOT NULL, receipt_expires_at TEXT NOT NULL
);
'''
COPY_POLICY={
 'version':1,'automatic_backup_retention_days':None,
 'active_database':'Удалятся аккаунт, учебная история, черновики, проекты, переписка, покупки и публикации на доске.',
 'backups':'Прежние резервные копии хранятся отдельно. Автоматический срок их удаления пока не настроен; за эти копии отвечает владелец сервера.',
 'devices':'Копии этого аккаунта в текущем браузере будут очищены после подтверждения. Другие устройства, скачанные файлы и уже отправленные внешнему ИИ данные автоматически не стираются.',
 'reservation':'Имя нельзя будет зарегистрировать заново: это защищает старые локальные черновики. Сохранится служебная отметка удаления без имени, пароля и учебной работы.',
 'restore':'Восстановление старой резервной копии требует свежего журнала удалений. Учебный архив не возвращает удалённый аккаунт.',
}

def name_hash(key,name):return security.tag(key,'deleted-account-name',0,name)
def reserved(conn,key,name):
    return conn.execute('SELECT 1 FROM account_deletions WHERE username_hash=?',(name_hash(key,name),)).fetchone() is not None
def deleted_session(conn,key,values):
    uid=values.get('uid');name=values.get('username')
    if type(uid) is not int or not isinstance(name,str):return False
    row=conn.execute('SELECT username_hash FROM account_deletions WHERE user_id=?',(uid,)).fetchone()
    return bool(row and secrets.compare_digest(row[0],name_hash(key,name)))
def quote(value):return '"'+value.replace('"','""')+'"'

def owned_tables(conn):
    """Fail closed on an unclassified owner column; identifiers come from SQLite."""
    result={}
    for name, in conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall():
        columns={r[1] for r in conn.execute('PRAGMA table_info('+quote(name)+')')}
        owners={r[3] for r in conn.execute('PRAGMA foreign_key_list('+quote(name)+')') if r[2]=='users' and r[4]=='id'}
        if owners:
            if len(owners)!=1:raise security.SecurityError('Удаление пока недоступно: требуется проверка связей данных.',503)
            result[name]=owners.pop()
        elif name!='account_deletions' and {'user_id','owner_id'}&columns:
            raise security.SecurityError('Удаление пока недоступно: требуется проверка связей данных.',503)
    return result

def erase(conn,uid):
    """Caller holds a write transaction; keep shared content and other owners."""
    tables=owned_tables(conn)
    if 'showcase_cards' in tables and 'showcase_votes' in tables:
        conn.execute('DELETE FROM showcase_votes WHERE card_id IN (SELECT id FROM showcase_cards WHERE user_id=?)',(uid,))
    remaining=set(tables)
    while remaining:
        parents={r[2] for name in remaining for r in conn.execute('PRAGMA foreign_key_list('+quote(name)+')') if r[2] in remaining}
        leaves=remaining-parents
        if not leaves:raise security.SecurityError('Удаление пока недоступно: требуется проверка связей данных.',503)
        for name in sorted(leaves):conn.execute('DELETE FROM '+quote(name)+' WHERE '+quote(tables[name])+'=?',(uid,))
        remaining-=leaves
    conn.execute('DELETE FROM users WHERE id=?',(uid,))

def reconcile(conn,key,records):
    """Apply a trusted current ledger to a staged restore, before it can be served."""
    for record in records:
        uid=record['user_id'];row=conn.execute('SELECT username FROM users WHERE id=?',(uid,)).fetchone()
        if row is not None:
            if not secrets.compare_digest(name_hash(key,row[0]),record['username_hash']):
                raise ValueError('Deletion ledger does not match the restored account identity')
            erase(conn,uid)
        conn.execute('INSERT INTO account_deletions VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET '
            'username_hash=excluded.username_hash,deleted_at=excluded.deleted_at,request_id=excluded.request_id,'
            'token_hash=excluded.token_hash,receipt_expires_at=excluded.receipt_expires_at',
            tuple(record[k] for k in ('user_id','username_hash','deleted_at','request_id','token_hash','receipt_expires_at')))
    # Older backups must not allocate an ID that was deleted later.
    if records and conn.execute("SELECT 1 FROM sqlite_master WHERE name='sqlite_sequence'").fetchone():
        maximum=max(r['user_id'] for r in records)
        conn.execute("UPDATE sqlite_sequence SET seq=MAX(seq,?) WHERE name='users'",(maximum,))
        conn.execute("INSERT INTO sqlite_sequence(name,seq) SELECT 'users',? WHERE NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name='users')",(maximum,))

def install(srv):
    app=srv.app
    def body(names):
        value=request.get_json(silent=True)
        if type(value) is not dict or set(value)!=set(names):raise security.SecurityError('Неверные поля запроса.')
        return value
    def actor(password):
        who=security.cookie_user(srv.db(),session)
        if who is None:raise security.SecurityError('Войдите заново.',401,'session_changed')
        if not security.verify_password(who['password_hash'],password):raise security.SecurityError('Текущий пароль не подошёл.',403,'reauth_failed')
        return who
    def credentials(data):
        if not isinstance(data.get('request_id'),str) or not re.fullmatch('[0-9a-f]{32}',data['request_id']) or not isinstance(data.get('token'),str) or not re.fullmatch('[0-9a-f]{64}',data['token']):
            raise security.SecurityError('Подтверждение не найдено.',404,'deletion_receipt_unknown')

    @app.get('/api/account/deletion-preview')
    @srv.login_required
    def deletion_preview():
        uid=session['uid'];tables=owned_tables(srv.db())
        counts={name:srv.db().execute('SELECT COUNT(*) FROM '+quote(name)+' WHERE '+quote(column)+'=?',(uid,)).fetchone()[0] for name,column in tables.items()}
        return jsonify(policy=COPY_POLICY,records=sum(counts.values()),publications=counts.get('showcase_cards',0))

    @app.post('/api/account/deletion-prepare')
    @srv.login_required
    @srv.rate_limit(6,300)
    def deletion_prepare():
        who=actor(body(['password'])['password']);token=secrets.token_hex(32);request_id=secrets.token_hex(16)
        expires=(datetime.fromisoformat(srv.now())+timedelta(minutes=10)).isoformat()
        with srv.db():
            srv.db().execute('BEGIN IMMEDIATE')
            if not security.same_actor(srv.db(),who):raise security.SecurityError('Аккаунт изменился.',401,'session_changed')
            srv.db().execute('INSERT INTO account_deletion_intents VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET '
                'generation=excluded.generation,request_id=excluded.request_id,token_hash=excluded.token_hash,expires_at=excluded.expires_at',
                (who['id'],who['security_generation'],request_id,security.tag(app.secret_key,'account-delete',who['id'],token),expires))
        return jsonify(request_id=request_id,token=token,expires_at=expires,policy_version=COPY_POLICY['version'])

    @app.post('/api/account/delete')
    @srv.login_required
    @srv.rate_limit(6,300)
    def delete_account():
        data=body(['password','confirmation','acknowledge_copies','policy_version','request_id','token']);credentials(data);who=actor(data['password']);uid=who['id']
        if data['confirmation']!=who['username'] or data['acknowledge_copies'] is not True or type(data['policy_version']) is not int or data['policy_version']!=COPY_POLICY['version']:
            raise security.SecurityError('Введите точное имя аккаунта и подтвердите условия удаления.')
        with security.exclusive(uid):
            with srv.sandbox.pool.lock:
                if any(job.uid==uid for job in srv.sandbox.pool.jobs.values()):raise security.SecurityError('Сначала завершите или остановите запуск Python.',409,'account_busy')
            with srv.db():
                srv.db().execute('BEGIN IMMEDIATE')
                if not security.same_actor(srv.db(),who):raise security.SecurityError('Аккаунт изменился.',401,'session_changed')
                pending=srv.db().execute('SELECT * FROM account_deletion_intents WHERE user_id=?',(uid,)).fetchone()
                if (pending is None or pending['request_id']!=data['request_id'] or pending['generation']!=who['security_generation']
                    or not security.valid_until(pending['expires_at'],srv.now()) or not secrets.compare_digest(pending['token_hash'],security.tag(app.secret_key,'account-delete',uid,data['token']))):
                    raise security.SecurityError('Подтверждение устарело. Проверьте условия удаления заново.',409)
                stamp=srv.now();expiry=(datetime.fromisoformat(stamp)+timedelta(minutes=30)).isoformat()
                erase(srv.db(),uid)
                srv.db().execute('INSERT INTO account_deletions VALUES(?,?,?,?,?,?)',(uid,name_hash(app.secret_key,who['username']),stamp,pending['request_id'],pending['token_hash'],expiry))
        g.allow_auth_transition=True
        return jsonify(ok=True,deleted=True,request_id=data['request_id'])

    @app.post('/api/account/deletion-status')
    @srv.rate_limit(30,300,by_ip=True)
    def deletion_status():
        data=body(['request_id','token']);credentials(data)
        row=srv.db().execute('SELECT * FROM account_deletions WHERE request_id=?',(data['request_id'],)).fetchone()
        if (row is None or not security.valid_until(row['receipt_expires_at'],srv.now())
                or not secrets.compare_digest(row['token_hash'],security.tag(app.secret_key,'account-delete',row['user_id'],data['token']))):
            raise security.SecurityError('Подтверждение не найдено.',404,'deletion_receipt_unknown')
        return jsonify(ok=True,deleted=True,request_id=data['request_id'])
