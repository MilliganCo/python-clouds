from test_platform import client, register
import learning_titles


def test_title_conditions_require_real_completed_topics_and_levels():
    meta = {'0.1':'beginner','0.2':'beginner','55.1':'intermediate','55.2':'intermediate'}
    xp = {key:10 for key in meta}
    partial = learning_titles.evaluate(['0.1','55.1','999.1'],meta,xp)
    assert not partial['title_pioneer']['eligible']
    assert not partial['title_foundation']['eligible']
    assert not partial['title_test_pilot']['eligible']
    full = learning_titles.evaluate(list(meta),meta,xp)
    assert full['title_pioneer']['eligible'] and full['title_foundation']['eligible']
    assert full['title_test_pilot']['eligible']
    assert not full['title_expert']['eligible'], 'An absent level is never complete'
    assert not full['title_experimenter']['eligible']


def test_xp_title_boundary_uses_server_rewards():
    meta={'0.1':'beginner','0.2':'beginner'}
    xp={'0.1':999,'0.2':1}
    assert not learning_titles.evaluate(['0.1'],meta,xp)['title_experimenter']['eligible']
    assert learning_titles.evaluate(list(meta),meta,xp)['title_experimenter']['eligible']


def test_all_title_goals_are_reachable_in_current_catalogue():
    import server as srv
    result=learning_titles.evaluate(srv.TASK_XP,srv.TASKS_META,srv.TASK_XP)
    assert all(reward['eligible'] for reward in result.values())


def test_wallet_grants_titles_once_without_spending_or_bonus(client):
    import server as srv
    register(client)
    with srv.app.app_context():
        uid=srv.db().execute('SELECT id FROM users').fetchone()[0]
        tasks=[key for key in srv.TASKS_META if key.startswith('55.')]
        for key in tasks:
            srv.db().execute('INSERT INTO progress VALUES(?,?,?)',(uid,key,srv.now()))
        before=srv.wallet_get(uid)['drops'];srv.db().commit()
    first=client.get('/api/wallet').get_json()
    assert first['title_rewards']['title_test_pilot']['owned']
    assert first['title_rewards']['title_pioneer']['owned']
    assert first['drops']==before
    assert all(item['kind'] not in ('title','frame') for item in first['shop'].values())
    second=client.get('/api/wallet').get_json()
    assert first['owned']==second['owned'] and second['drops']==before
    assert client.post('/api/shop/buy',json={'item':'title_test_pilot'}).status_code==400
    with srv.app.app_context():
        assert srv.db().execute('SELECT COUNT(*) FROM purchases WHERE user_id=? AND item_key=?',(uid,'title_test_pilot')).fetchone()[0]==1
        srv.db().execute('DELETE FROM progress WHERE user_id=?',(uid,));srv.db().commit()
    assert 'title_test_pilot' in client.get('/api/wallet').get_json()['owned']


def test_previously_purchased_title_keeps_ownership_and_name(client):
    import server as srv
    register(client)
    with srv.app.app_context():
        uid=srv.db().execute('SELECT id FROM users').fetchone()[0]
        srv.wallet_get(uid);srv.wallet_add(uid,drops=123)
        srv.grant_item(uid,'title_debugger');srv.db().commit()
    wallet=client.get('/api/wallet').get_json()
    assert wallet['drops']==123 and 'title_debugger' in wallet['owned']
    assert wallet['set_items']['title_debugger']=='Титул: Укротитель багов'
    assert wallet['title_rewards']['title_debugger']['owned']
    assert not wallet['title_rewards']['title_debugger']['eligible']


def test_frame_progress_and_legacy_purchase_are_preserved(client):
    import server as srv
    register(client)
    with srv.app.app_context():
        uid=srv.db().execute('SELECT id FROM users').fetchone()[0]
        srv.wallet_get(uid);srv.wallet_add(uid,drops=321);srv.grant_item(uid,'frame_circuit')
        for key in srv.TASKS_META:
            if key.startswith('0.'):
                srv.db().execute('INSERT INTO progress VALUES(?,?,?)',(uid,key,srv.now()))
        before=srv.wallet_get(uid)['drops'];srv.db().commit()
    wallet=client.get('/api/wallet').get_json()
    assert wallet['frame_rewards']['frame_sunbeam']['owned']
    assert wallet['frame_rewards']['frame_circuit']['owned']
    assert not wallet['frame_rewards']['frame_circuit']['eligible']
    assert wallet['drops']==before
    assert client.post('/api/shop/buy',json={'item':'frame_orbit'}).status_code==400
    assert 'frame_sunbeam' in client.get('/api/wallet').get_json()['owned']


def test_frame_xp_boundary_and_category_catalogue(client):
    meta={'0.1':'beginner','0.2':'beginner'};xp={'0.1':499,'0.2':1}
    assert not learning_titles.evaluate(['0.1'],meta,xp)['frame_orbit']['eligible']
    assert learning_titles.evaluate(meta,meta,xp)['frame_orbit']['eligible']
    register(client);shop=client.get('/api/wallet').get_json()['shop']
    assert {kind:sum(item['kind']==kind for item in shop.values()) for kind in ['banner','cursor','sound']}=={'banner':6,'cursor':3,'sound':3}
