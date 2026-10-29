"""Explicit local operator grants. No HTTP endpoint or learner rewards are involved."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3

SCHEMA = """
CREATE TABLE IF NOT EXISTS operator_wallet_grants (
    operation_id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    amount INTEGER NOT NULL CHECK(amount > 0),
    balance_before INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    granted_at TEXT NOT NULL
);
"""


def grant(db_path, username, amount, operation_id):
    """Credit an existing wallet once; an operation ID cannot change its meaning."""
    if type(amount) is not int or amount <= 0 or not operation_id.strip():
        raise ValueError("A positive integer amount and operation ID are required")
    path = Path(db_path).resolve(strict=True)
    conn = sqlite3.connect(path.as_uri() + "?mode=rw", uri=True, timeout=15)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("BEGIN IMMEDIATE")
        # A single statement keeps table creation inside the same transaction.
        conn.execute(SCHEMA.strip().rstrip(";"))
        user = conn.execute("SELECT id FROM users WHERE username=? COLLATE BINARY", (username,)).fetchone()
        if user is None:
            raise ValueError("Exact existing username required")
        previous = conn.execute("SELECT * FROM operator_wallet_grants WHERE operation_id=?", (operation_id,)).fetchone()
        if previous:
            if previous["user_id"] != user["id"] or previous["amount"] != amount:
                raise ValueError("Operation ID already belongs to another grant")
            return dict(previous, applied=False)
        wallet = conn.execute("SELECT drops FROM wallet WHERE user_id=?", (user["id"],)).fetchone()
        if wallet is None:
            raise ValueError("Existing wallet required; refusing to initialize rewards")
        before = wallet["drops"]
        after = before + amount
        timestamp = datetime.now(timezone.utc).isoformat()
        conn.execute("UPDATE wallet SET drops=drops+? WHERE user_id=?", (amount, user["id"]))
        conn.execute("INSERT INTO operator_wallet_grants VALUES (?,?,?,?,?,?)",
                     (operation_id, user["id"], amount, before, after, timestamp))
        conn.commit()
        return dict(operation_id=operation_id, user_id=user["id"], amount=amount,
                    balance_before=before, balance_after=after, granted_at=timestamp, applied=True)
    finally:
        conn.close()  # Also rolls back any failed or replayed transaction.


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, type=Path)
    parser.add_argument("--user", required=True)
    parser.add_argument("--amount", required=True, type=int)
    parser.add_argument("--operation-id", required=True)
    args = parser.parse_args()
    print(json.dumps(grant(args.db, args.user, args.amount, args.operation_id), ensure_ascii=False))
