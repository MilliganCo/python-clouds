import sqlite3
from concurrent.futures import ThreadPoolExecutor

import pytest
from wallet_admin import grant


@pytest.fixture
def database(tmp_path):
    path = tmp_path / "wallet.db"
    with sqlite3.connect(path) as conn:
        conn.executescript("CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT);"
                           "CREATE TABLE wallet(user_id INTEGER PRIMARY KEY,drops INTEGER,freezes INTEGER);"
                           "INSERT INTO users VALUES(1,'Cody'),(2,'example_student');"
                           "INSERT INTO wallet VALUES(1,40,3),(2,90,0);")
    return path


def test_grant_is_atomic_and_idempotent(database):
    with ThreadPoolExecutor(max_workers=2) as pool:
        receipts = list(pool.map(lambda _: grant(database, "Cody", 800, "request-1"), range(2)))
    assert sorted(r["applied"] for r in receipts) == [False, True]
    assert all((r["balance_before"], r["balance_after"]) == (40, 840) for r in receipts)
    with sqlite3.connect(database) as conn:
        assert conn.execute("SELECT * FROM wallet ORDER BY user_id").fetchall() == [(1,840,3),(2,90,0)]
        assert conn.execute("SELECT COUNT(*) FROM operator_wallet_grants").fetchone()[0] == 1


def test_grant_rejects_reused_id_or_missing_exact_user(database):
    grant(database, "Cody", 800, "request-1")
    for user, amount in [("example_student",800),("Cody",801),("cody",800),("missing",800)]:
        with pytest.raises(ValueError):
            grant(database,user,amount,"request-1")
    with sqlite3.connect(database) as conn:
        assert conn.execute("SELECT drops FROM wallet WHERE user_id=1").fetchone()[0] == 840


def test_failed_receipt_rolls_back_credit(database):
    grant(database,"Cody",1,"first")
    with sqlite3.connect(database) as conn:
        conn.execute("CREATE TRIGGER refuse_grant BEFORE INSERT ON operator_wallet_grants BEGIN SELECT RAISE(ABORT,'test'); END")
    with pytest.raises(sqlite3.IntegrityError):
        grant(database,"Cody",800,"second")
    with sqlite3.connect(database) as conn:
        assert conn.execute("SELECT drops FROM wallet WHERE user_id=1").fetchone()[0] == 41
