from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import sqlite3
import pytest
from test_platform import client, register

def send(client,score=5,game='blitz',request_id='a'*32):
    return client.post('/api/game/result',json=dict(score=score,game=game,request_id=request_id))

def test_same_round_is_credited_only_once(client):
    register(client)
    first=send(client);second=send(client)
    assert first.status_code==second.status_code==200
    assert client.get('/api/wallet').get_json()['drops']==5
    assert first.get_json()['awarded']==second.get_json()['awarded']==5
    assert not first.get_json()['replayed'] and second.get_json()['replayed']

def test_receipt_survives_midnight_and_other_games_are_distinct(client,monkeypatch):
    import server
    register(client);moment=['2026-10-28T23:59:59+00:00'];monkeypatch.setattr(server,'now',lambda:moment[0])
    first=send(client).get_json();moment[0]='2026-10-29T00:00:01+00:00'
    second=send(client).get_json();assert second['day']==first['day']=='2026-10-28'
    assert second['replayed'] and client.get('/api/wallet').get_json()['drops']==5
    assert send(client,game='trace',request_id='b'*32).get_json()['day']=='2026-10-29'
    assert client.get('/api/wallet').get_json()['drops']==10

def test_reused_id_with_changed_payload_rejects_and_owners_do_not_share_receipts(client):
    register(client);assert send(client).status_code==200
    assert send(client,score=6).status_code==409
    assert send(client,game='match').status_code==409
    assert client.get('/api/wallet').get_json()['drops']==5
    register(client,'other');assert not send(client).get_json()['replayed']
    assert client.get('/api/wallet').get_json()['drops']==5

def test_parallel_same_round_has_one_award(client):
    import server
    register(client)
    with client.session_transaction() as session:uid=session['uid']
    barrier=Barrier(2)
    def submit(_):
        with server.app.test_client() as player:
            with player.session_transaction() as session:session['uid']=uid
            barrier.wait(timeout=5);response=send(player,score=12)
            assert response.status_code==200;return response.get_json()
    with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(submit,range(2)))
    assert sorted(r['replayed'] for r in results)==[False,True]
    assert client.get('/api/wallet').get_json()['drops']==12

@pytest.mark.parametrize('body',[{'score':'bad'},{'score':[]},{'score':5,'request_id':'wrong'},{'score':5,'request_id':None},{'score':True,'request_id':'a'*32},{'score':1.5,'request_id':'a'*32}])
def test_invalid_result_never_awards(client,body):
    register(client);assert client.post('/api/game/result',json=body).status_code==400
    assert client.get('/api/wallet').get_json()['drops']==0

def test_zero_score_is_saved_without_claiming_cap_exhaustion(client):
    register(client);data=send(client,score=0).get_json()
    assert data['awarded']==0 and data['cap_left']==30
    assert send(client,score=0).get_json()['replayed']

def test_failure_before_commit_rolls_back_receipt_and_money(client,monkeypatch):
    import server
    register(client);original=server.wallet_add
    def fail(*args,**kwargs):raise RuntimeError('synthetic write failure')
    monkeypatch.setattr(server,'wallet_add',fail)
    with pytest.raises(RuntimeError):send(client)
    with sqlite3.connect(server.DB_PATH) as connection:
        assert connection.execute('SELECT COUNT(*) FROM game_round_receipts').fetchone()[0]==0
        assert connection.execute('SELECT COUNT(*) FROM game_log').fetchone()[0]==0
    monkeypatch.setattr(server,'wallet_add',original);assert not send(client).get_json()['replayed']
    assert client.get('/api/wallet').get_json()['drops']==5
