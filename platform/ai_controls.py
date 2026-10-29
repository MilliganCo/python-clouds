"""Account AI choices, deletable prose separated from quota, and bounded admission."""
from contextlib import contextmanager
from datetime import datetime,timedelta
from functools import wraps
import threading
from flask import g,jsonify,request,session

SERVER_TABLES=frozenset({'ai_preferences','ai_usage_days'})
SCHEMA='''
CREATE TABLE IF NOT EXISTS ai_preferences (
 user_id INTEGER PRIMARY KEY REFERENCES users(id), enabled INTEGER NOT NULL,
 automatic_review INTEGER NOT NULL, history_context INTEGER NOT NULL,
 retention_days INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_usage_days (
 user_id INTEGER NOT NULL REFERENCES users(id), day TEXT NOT NULL,
 questions INTEGER NOT NULL CHECK(questions>=0), PRIMARY KEY(user_id,day)
);
'''
DEFAULTS=dict(enabled=True,automatic_review=True,history_context=True,retention_days=0,version=0)
SECTIONS=('memory','chat','attempts','project_reviews','riddles')

class AIControlError(ValueError):
    def __init__(self,message,status=400,code='ai_settings_error'):
        super().__init__(message);self.status=status;self.code=code
class AIBusy(AIControlError):
    def __init__(self):super().__init__('Наставник занят. Повторите через несколько секунд. Капли не списаны.',503,'ai_busy')

class Admission:
    def __init__(self,limit=2):
        self.limit=limit;self.guard=threading.Lock();self.active=0;self.accepted=0;self.rejected=0
    @contextmanager
    def slot(self):
        with self.guard:
            if self.active>=self.limit:self.rejected+=1;raise AIBusy()
            self.active+=1;self.accepted+=1
        try:yield
        finally:
            with self.guard:self.active-=1
    def snapshot(self):
        with self.guard:return dict(limit=self.limit,active=self.active,accepted=self.accepted,rejected=self.rejected,queue_limit=0)

admission=Admission(2)
_turn_guard=threading.Lock();_turns={}
@contextmanager
def user_turn(uid):
    tid=threading.get_ident()
    with _turn_guard:
        previous=_turns.get(uid)
        if previous and previous[0]!=tid:raise AIBusy()
        _turns[uid]=(tid,(previous[1] if previous else 0)+1)
    try:yield
    finally:
        with _turn_guard:
            count=_turns[uid][1]-1
            if count:_turns[uid]=(tid,count)
            else:_turns.pop(uid,None)

def request_uid():
    identity=getattr(g,'auth_identity',None)
    return identity[0] if identity else session.get('uid')
def user_request(fn):
    @wraps(fn)
    def wrapped(*args,**kwargs):
        with user_turn(request_uid()):return fn(*args,**kwargs)
    return wrapped

def preferences(conn,uid):
    row=conn.execute('SELECT enabled,automatic_review,history_context,retention_days,version FROM ai_preferences WHERE user_id=?',(uid,)).fetchone()
    if row is None:return dict(DEFAULTS)
    value=dict(zip(DEFAULTS,row))
    for key in ('enabled','automatic_review','history_context'):value[key]=bool(value[key])
    return value
def ensure_enabled(conn,uid):
    if not preferences(conn,uid)['enabled']:raise AIControlError('ИИ отключён в настройках аккаунта. Теория, подсказки и Python доступны.',403,'ai_disabled')
def usage(conn,uid,day):
    row=conn.execute('SELECT questions FROM ai_usage_days WHERE user_id=? AND day=?',(uid,day)).fetchone()
    # Preserve the existing count before the first ledger write or a prose clear.
    messages=conn.execute("SELECT COUNT(*) FROM ai_messages WHERE user_id=? AND role='user' AND created_at>=?",(uid,day)).fetchone()[0]
    return max(messages,row[0] if row else 0)
def save_usage(conn,uid,day,count):
    conn.execute('INSERT INTO ai_usage_days VALUES(?,?,?) ON CONFLICT(user_id,day) DO UPDATE SET questions=MAX(questions,excluded.questions)',(uid,day,count))
def prune(conn,uid,stamp):
    days=preferences(conn,uid)['retention_days']
    if not days:return
    cutoff=(datetime.fromisoformat(stamp)-timedelta(days=days)).isoformat()
    conn.execute('DELETE FROM ai_messages WHERE user_id=? AND created_at<?',(uid,cutoff))
    conn.execute("DELETE FROM ai_memory WHERE user_id=? AND key LIKE 'ai:%' AND updated_at<?",(uid,cutoff))
def counts(conn,uid):
    result={}
    for key,table in [('memory','ai_memory'),('chat','ai_messages'),('attempts','attempts'),('project_reviews','workshop_reviews'),('riddles','riddle_sessions')]:
        extra=" AND report<>''" if key=='project_reviews' else " AND history_json<>'[]'" if key=='riddles' else ''
        result[key]=conn.execute('SELECT COUNT(*) FROM '+table+' WHERE user_id=?'+extra,(uid,)).fetchone()[0]
    return result

def install(srv):
    app=srv.app
    @app.errorhandler(AIControlError)
    def control_error(error):
        response=jsonify(error=str(error),code=error.code);response.status_code=error.status
        response.headers['Cache-Control']='no-store'
        if error.code=='ai_busy':response.headers['Retry-After']='3'
        return response
    @app.after_request
    def control_headers(response):
        if request.path.startswith('/api/ai/') or request.path=='/api/v1/mobile/ai/ask':response.headers['Cache-Control']='no-store'
        if getattr(g,'ai_admission_busy',False):
            response.headers['Retry-After']='3'
            data=response.get_json(silent=True)
            if isinstance(data,dict):
                if response.status_code>=400:data.update(error=str(AIBusy()),code='ai_busy')
                elif data.get('review','sentinel') is None:data.update(reason='ai_busy')
                response.set_data(app.json.dumps(data))
        return response
    def status(uid):
        return dict(preferences=preferences(srv.db(),uid),counts=counts(srv.db(),uid),
            capacity=admission.snapshot(),
            provider_available=bool(srv.AI_REMOTE_ENABLED and srv.AI_MODEL.startswith('codex/') and srv.OPENCODE_BIN),
            usage_today=usage(srv.db(),uid,srv.now()[:10]),free_questions=srv.AI_FREE_QUESTIONS_PER_DAY,
            retention='Срок относится к переписке и заметкам наставника. Очистка происходит при следующем открытии настроек, истории или обращении к наставнику. Попытки и разборы проектов очищаются отдельно.',
            copies='Удаление здесь не стирает резервные копии, скачанные файлы и уже отправленные провайдеру сведения. Отправленный ранее запрос может завершиться после изменения настройки.',
            context='Отключение контекста исключает прежнюю переписку, память и прошлые попытки. Текущий вопрос или код и данные задания остаются необходимы для выбранного обращения.')
    @app.get('/api/ai/settings')
    @srv.login_required
    def get_settings():
        uid=session['uid']
        try:
            with user_turn(uid),srv.db():prune(srv.db(),uid,srv.now())
        except AIBusy:pass # Settings remain readable while a sent request finishes.
        return jsonify(**status(uid))
    @app.patch('/api/ai/settings')
    @srv.login_required
    def set_settings():
        data=request.get_json(silent=True)
        allowed=set(DEFAULTS)|{'confirm_retention'}
        if type(data) is not dict or not set(data)<=allowed or type(data.get('version')) is not int or not(set(data)-{'version','confirm_retention'}):raise AIControlError('Неверные настройки ИИ.')
        for key in ('enabled','automatic_review','history_context'):
            if key in data and type(data[key]) is not bool:raise AIControlError('Неверное значение переключателя.')
        if 'retention_days' in data and (type(data['retention_days']) is not int or data['retention_days'] not in (0,30,90)):raise AIControlError('Выберите ручное удаление, 30 или 90 дней.')
        uid=session['uid'];stamp=srv.now()
        with srv.db():
            srv.db().execute('BEGIN IMMEDIATE');old=preferences(srv.db(),uid)
            if old['version']!=data['version']:raise AIControlError('Настройки изменились в другом окне. Обновите их и повторите выбор.',409,'ai_settings_changed')
            value={**old,**{k:v for k,v in data.items() if k in DEFAULTS}};value['version']+=1
            if value['retention_days'] and (not old['retention_days'] or value['retention_days']<old['retention_days']) and data.get('confirm_retention') is not True:
                raise AIControlError('Подтвердите удаление переписки и заметок старше выбранного срока.',409,'retention_confirmation_required')
            srv.db().execute('INSERT INTO ai_preferences VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET '
                'enabled=excluded.enabled,automatic_review=excluded.automatic_review,history_context=excluded.history_context,retention_days=excluded.retention_days,version=excluded.version,updated_at=excluded.updated_at',
                (uid,int(value['enabled']),int(value['automatic_review']),int(value['history_context']),value['retention_days'],value['version'],stamp))
            prune(srv.db(),uid,stamp)
        return jsonify(**status(uid))
    @app.post('/api/ai/clear')
    @srv.login_required
    def clear_data():
        data=request.get_json(silent=True)
        if type(data) is not dict or set(data)!={'section','confirmed'} or data.get('section') not in SECTIONS or data.get('confirmed') is not True:raise AIControlError('Выберите раздел и подтвердите очистку.')
        uid=session['uid'];section=data['section']
        with user_turn(uid),srv.db():
            srv.db().execute('BEGIN IMMEDIATE')
            if section=='chat':
                day=srv.now()[:10];save_usage(srv.db(),uid,day,usage(srv.db(),uid,day))
                srv.db().execute('DELETE FROM ai_messages WHERE user_id=?',(uid,))
            elif section=='memory':srv.db().execute('DELETE FROM ai_memory WHERE user_id=?',(uid,))
            elif section=='attempts':
                for table in ('review_practice','review_fixes','attempts'):srv.db().execute('DELETE FROM '+table+' WHERE user_id=?',(uid,))
            elif section=='project_reviews':srv.db().execute("UPDATE workshop_reviews SET report='' WHERE user_id=?",(uid,))
            elif section=='riddles':srv.db().execute("UPDATE riddle_sessions SET history_json='[]',asked=CASE WHEN day=? THEN MAX(asked,?) ELSE asked END WHERE user_id=?",(srv.now()[:10],srv.RIDDLE_DAILY_LIMIT,uid))
        return jsonify(ok=True,cleared=section,**status(uid))
