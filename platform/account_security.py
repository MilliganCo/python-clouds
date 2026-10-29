"""Explicit account recovery and credential rotation; existing users default to generation zero."""
from datetime import datetime,timedelta,timezone
from contextlib import contextmanager
from collections import Counter
import threading
import hashlib,hmac,json,re,secrets
from flask import g,jsonify,request,session
from werkzeug.security import check_password_hash,generate_password_hash

CODE_COUNT=8
CODE_DAYS=180
SETUP_MINUTES=10
PASSWORD_MIN=15
PASSWORD_MAX=128
SERVER_TABLES=frozenset({'account_security_state','account_recovery_codes','account_recovery_setup'})
_operations=Counter();_deleting=set();_operation_lock=threading.Lock()

@contextmanager
def operation(uid):
    with _operation_lock:
        if uid in _deleting:raise SecurityError('Удаление аккаунта уже выполняется.',409,'account_busy')
        _operations[uid]+=1
    try:yield
    finally:
        with _operation_lock:
            _operations[uid]-=1
            if not _operations[uid]:del _operations[uid]

@contextmanager
def exclusive(uid):
    with _operation_lock:
        if uid in _deleting or _operations[uid]!=1:raise SecurityError('Дождитесь завершения других действий этого аккаунта и повторите.',409,'account_busy')
        _deleting.add(uid)
    try:yield
    finally:
        with _operation_lock:_deleting.discard(uid)
SCHEMA='''
CREATE TABLE IF NOT EXISTS account_security_state (
 user_id INTEGER PRIMARY KEY REFERENCES users(id),
 generation INTEGER NOT NULL DEFAULT 0,
 recovery_batch TEXT, activation_hash TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS account_recovery_codes (
 user_id INTEGER NOT NULL REFERENCES users(id), code_hash TEXT NOT NULL,
 expires_at TEXT NOT NULL, PRIMARY KEY(user_id,code_hash)
);
CREATE TABLE IF NOT EXISTS account_recovery_setup (
 user_id INTEGER PRIMARY KEY REFERENCES users(id), generation INTEGER NOT NULL,
 batch TEXT NOT NULL, activation_hash TEXT NOT NULL, code_hashes_json TEXT NOT NULL,
 expires_at TEXT NOT NULL, code_expires_at TEXT NOT NULL
);
'''

class SecurityError(ValueError):
    def __init__(self,message,status=400,code='account_security_error'):
        super().__init__(message);self.status=status;self.code=code

def user(connection,uid=None,username=None):
    field,value=('u.id',uid) if uid is not None else ('u.username',username)
    return connection.execute('SELECT u.*,COALESCE(a.generation,0) AS security_generation '
        'FROM users u LEFT JOIN account_security_state a ON a.user_id=u.id WHERE '+field+'=?',(value,)).fetchone()

def cookie_user(connection,values):
    uid=values.get('uid');generation=values.get('auth_generation',0)
    if type(uid) is not int or type(generation) is not int:return None
    row=user(connection,uid=uid)
    if row is None or row['security_generation']!=generation:return None
    if 'username' in values and values['username']!=row['username']:return None
    return row

def same_actor(connection,actor):
    current=user(connection,uid=actor['id'])
    return bool(current and current['security_generation']==actor['security_generation']
        and secrets.compare_digest(current['password_hash'],actor['password_hash']))

def tag(secret,purpose,uid,value):
    if isinstance(secret,str):secret=secret.encode('utf8')
    return hmac.new(secret,(purpose+'\0'+str(uid)+'\0'+value).encode('utf8'),hashlib.sha256).hexdigest()

def valid_until(value,stamp):
    try:return datetime.fromisoformat(value)>datetime.fromisoformat(stamp)
    except (ValueError,TypeError):return False

def new_password(value):
    if not isinstance(value,str) or not PASSWORD_MIN<=len(value)<=PASSWORD_MAX:
        raise SecurityError(f'Новый пароль: от {PASSWORD_MIN} до {PASSWORD_MAX} символов. Можно использовать длинную фразу.')
    try:value.encode('utf8')
    except UnicodeError:raise SecurityError('Некорректный текст пароля.') from None
    return value

def verify_password(hashed,value):
    if not isinstance(value,str) or len(value)>1_000_000:return False
    try:return check_password_hash(hashed,value)
    except (ValueError,TypeError,UnicodeError):return False

def normalize_code(value):
    if not isinstance(value,str) or len(value)>128:return None
    normalized=re.sub(r'[\s-]','',value).lower()
    return normalized if re.fullmatch(r'[0-9a-f]{32}',normalized) else None

def rotate(connection,uid,stamp,*,password_hash=None,clear_codes=False):
    connection.execute('INSERT INTO account_security_state(user_id,generation,updated_at) VALUES(?,1,?) '
        'ON CONFLICT(user_id) DO UPDATE SET generation=generation+1,updated_at=excluded.updated_at',(uid,stamp))
    if password_hash is not None:connection.execute('UPDATE users SET password_hash=? WHERE id=?',(password_hash,uid))
    connection.execute('UPDATE mobile_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL',(stamp,uid))
    connection.execute('DELETE FROM account_recovery_setup WHERE user_id=?',(uid,))
    if clear_codes:
        connection.execute('DELETE FROM account_recovery_codes WHERE user_id=?',(uid,))
        connection.execute('UPDATE account_security_state SET recovery_batch=NULL,activation_hash=NULL WHERE user_id=?',(uid,))

def install(srv):
    app=srv.app
    def body(fields):
        value=request.get_json(silent=True)
        if type(value) is not dict or set(value)!=set(fields):raise SecurityError('Неверные поля запроса.')
        return value
    def actor(password):
        row=cookie_user(srv.db(),session)
        if row is None:raise SecurityError('Войдите в аккаунт заново.',401,'session_changed')
        if not verify_password(row['password_hash'],password):
            raise SecurityError('Текущий пароль не подошёл.',403,'reauth_failed')
        return row
    def lock_actor(connection,who):
        connection.execute('BEGIN IMMEDIATE')
        if not same_actor(connection,who):raise SecurityError('Аккаунт изменился. Войдите заново.',401,'session_changed')
    @app.errorhandler(SecurityError)
    def security_error(error):return jsonify(error=str(error),code=error.code),error.status
    @app.after_request
    def protect_security_response(response):
        identity=getattr(g,'issued_auth',None) or getattr(g,'auth_identity',None)
        if identity and not getattr(g,'allow_auth_transition',False):
            row=user(srv.db(),uid=identity[0])
            if row is None or row['security_generation']!=identity[1]:
                # A late response must never overwrite a newer browser login cookie.
                session.modified=False
                response=jsonify(error='Сессия истекла или отозвана. Войдите заново.',code='session_changed');response.status_code=401
                if row is None and srv.account_lifecycle.deleted_session(srv.db(),app.secret_key,session):
                    response=jsonify(error='Аккаунт удалён.',code='account_deleted');response.status_code=401
        if request.path.startswith('/api/account/'):
            response.headers['Cache-Control']='no-store';response.headers['Pragma']='no-cache'
        return response

    @app.get('/api/account/security')
    @srv.login_required
    def account_status():
        uid=session['uid'];stamp=srv.now();codes=srv.db().execute('SELECT expires_at FROM account_recovery_codes WHERE user_id=?',(uid,)).fetchall()
        active=[row['expires_at'] for row in codes if valid_until(row['expires_at'],stamp)]
        state=srv.db().execute('SELECT recovery_batch FROM account_security_state WHERE user_id=?',(uid,)).fetchone()
        return jsonify(recovery_codes_remaining=len(active),recovery_expires_at=min(active) if active else None,
            active_batch=state['recovery_batch'] if state and active else None,password_min_length=PASSWORD_MIN,password_max_length=PASSWORD_MAX)

    @app.post('/api/account/recovery-codes')
    @srv.login_required
    @srv.rate_limit(6,300)
    def recovery_setup():
        data=body(['password']);who=actor(data['password']);uid=who['id']
        codes=[secrets.token_hex(16) for _ in range(CODE_COUNT)]
        if len(set(codes))!=CODE_COUNT:raise SecurityError('Не удалось создать набор кодов. Попробуйте снова.',503)
        token=secrets.token_hex(32);batch=secrets.token_hex(16);stamp=srv.now();moment=datetime.fromisoformat(stamp)
        expires=(moment+timedelta(minutes=SETUP_MINUTES)).isoformat();code_expires=(moment+timedelta(days=CODE_DAYS)).isoformat()
        hashes=[tag(app.secret_key,'recovery-code',uid,code) for code in codes]
        with srv.db():
            lock_actor(srv.db(),who)
            srv.db().execute('INSERT INTO account_recovery_setup VALUES(?,?,?,?,?,?,?) '
                'ON CONFLICT(user_id) DO UPDATE SET generation=excluded.generation,batch=excluded.batch,activation_hash=excluded.activation_hash,code_hashes_json=excluded.code_hashes_json,expires_at=excluded.expires_at,code_expires_at=excluded.code_expires_at',
                (uid,who['security_generation'],batch,tag(app.secret_key,'activation',uid,token),json.dumps(hashes),expires,code_expires))
        return jsonify(codes=['-'.join(code[i:i+8] for i in range(0,32,8)).upper() for code in codes],activation_token=token,batch=batch,expires_at=code_expires,activation_expires_at=expires)

    @app.post('/api/account/recovery-codes/activate')
    @srv.login_required
    @srv.rate_limit(20,300)
    def recovery_activate():
        data=body(['activation_token']);token=data['activation_token'];uid=session['uid'];stamp=srv.now()
        if not isinstance(token,str) or not re.fullmatch(r'[0-9a-f]{64}',token):raise SecurityError('Набор кодов устарел. Выпустите новый.',409)
        digest=tag(app.secret_key,'activation',uid,token)
        with srv.db():
            srv.db().execute('BEGIN IMMEDIATE');who=cookie_user(srv.db(),session)
            if who is None:raise SecurityError('Войдите заново.',401,'session_changed')
            state=srv.db().execute('SELECT * FROM account_security_state WHERE user_id=?',(uid,)).fetchone()
            if state and state['activation_hash'] and secrets.compare_digest(state['activation_hash'],digest):
                codes=srv.db().execute('SELECT expires_at FROM account_recovery_codes WHERE user_id=?',(uid,)).fetchall()
                if any(valid_until(row['expires_at'],stamp) for row in codes):return jsonify(ok=True,batch=state['recovery_batch'],replayed=True)
            pending=srv.db().execute('SELECT * FROM account_recovery_setup WHERE user_id=?',(uid,)).fetchone()
            if (pending is None or pending['generation']!=who['security_generation'] or not valid_until(pending['expires_at'],stamp)
                    or not secrets.compare_digest(pending['activation_hash'],digest)):
                raise SecurityError('Набор кодов устарел. Выпустите новый.',409)
            hashes=json.loads(pending['code_hashes_json'])
            if len(hashes)!=CODE_COUNT:raise SecurityError('Набор кодов повреждён. Выпустите новый.',409)
            srv.db().execute('DELETE FROM account_recovery_codes WHERE user_id=?',(uid,))
            srv.db().executemany('INSERT INTO account_recovery_codes VALUES(?,?,?)',[(uid,value,pending['code_expires_at']) for value in hashes])
            srv.db().execute('INSERT INTO account_security_state(user_id,generation,recovery_batch,activation_hash,updated_at) VALUES(?,?,?,?,?) '
                'ON CONFLICT(user_id) DO UPDATE SET recovery_batch=excluded.recovery_batch,activation_hash=excluded.activation_hash,updated_at=excluded.updated_at',
                (uid,who['security_generation'],pending['batch'],digest,stamp))
            srv.db().execute('DELETE FROM account_recovery_setup WHERE user_id=?',(uid,))
        return jsonify(ok=True,batch=pending['batch'],replayed=False)

    @app.post('/api/account/password')
    @srv.login_required
    @srv.rate_limit(6,300)
    def change_password():
        data=body(['password','new_password']);password=new_password(data['new_password']);who=actor(data['password'])
        hashed=generate_password_hash(password)
        with srv.db():
            lock_actor(srv.db(),who);rotate(srv.db(),who['id'],srv.now(),password_hash=hashed,clear_codes=True)
        g.allow_auth_transition=True
        return jsonify(ok=True,reauthenticate=True)

    @app.post('/api/account/revoke-sessions')
    @srv.login_required
    @srv.rate_limit(6,300)
    def revoke_sessions():
        data=body(['password']);who=actor(data['password'])
        with srv.db():lock_actor(srv.db(),who);rotate(srv.db(),who['id'],srv.now())
        g.allow_auth_transition=True
        return jsonify(ok=True,reauthenticate=True)

    @app.post('/api/account/recover')
    @srv.rate_limit(6,300,by_ip=True)
    def recover_account():
        data=body(['username','code','new_password']);password=new_password(data['new_password'])
        username=data['username'];code=normalize_code(data['code'])
        failure=lambda:SecurityError('Не удалось восстановить доступ. Проверьте имя и код восстановления.',400,'recovery_failed')
        if not isinstance(username,str) or not srv.USERNAME_RE.fullmatch(username.strip()) or code is None:raise failure()
        who=user(srv.db(),username=username.strip());uid=who['id'] if who else 0
        digest=tag(app.secret_key,'recovery-code',uid,code)
        code_row=srv.db().execute('SELECT expires_at FROM account_recovery_codes WHERE user_id=? AND code_hash=?',(uid,digest)).fetchone()
        if who is None or code_row is None or not valid_until(code_row['expires_at'],srv.now()):raise failure()
        hashed=generate_password_hash(password)
        with srv.db():
            srv.db().execute('BEGIN IMMEDIATE')
            fresh=srv.db().execute('SELECT expires_at FROM account_recovery_codes WHERE user_id=? AND code_hash=?',(uid,digest)).fetchone()
            if not same_actor(srv.db(),who) or fresh is None or not valid_until(fresh['expires_at'],srv.now()):raise failure()
            rotate(srv.db(),uid,srv.now(),password_hash=hashed,clear_codes=True)
        # Reset is not a login: no session mutation or authentication cookie here.
        return jsonify(ok=True,reauthenticate=True)
