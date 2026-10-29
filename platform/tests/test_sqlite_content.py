"""Real temporary SQLite, bindings and transaction ownership, not mocked query results."""
import contextlib
import io
from pathlib import Path
import sqlite3
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import build_tasks


@pytest.fixture(scope='module')
def sqlite_tasks():
    tasks = {t['id']: t for p in build_tasks.parse() if p['id'] == 51 for t in p['tasks']}
    checks = build_tasks._load_support_content()['checks']
    for task_id, task in tasks.items():
        if 'check' not in task and task_id in checks:
            task['check'] = checks[task_id]
    assert len(tasks) == 9
    return tasks


@pytest.mark.parametrize(('task_id', 'code'), [
    ('51.2', "def count_items(con):\n    return con.execute('SELECT COUNT(title) FROM items').fetchone()[0]"),
    ('51.2', "def count_items(con):\n    con.commit()\n    return con.execute('SELECT COUNT(*) FROM items').fetchone()[0]"),
    ('51.2', "def count_items(con):\n    count = con.execute('SELECT COUNT(*) FROM items').fetchone()[0]\n    con.execute('UPDATE items SET title = upper(title)')\n    return count"),
    ('51.4', "def add_user(con, name, score):\n    safe = name.replace(\"'\", \"''\")\n    con.execute(f\"INSERT INTO users(name, score) VALUES ('{safe}', {score})\")"),
    ('51.4', "def add_user(con, name, score):\n    con.execute('DELETE FROM users WHERE name = ?', (name,))\n    con.execute('INSERT INTO users(name, score) VALUES (?, ?)', (name, score))"),
    ('51.8', "def find_users(connection, name):\n    safe = name.replace(\"'\", \"''\")\n    return [r[0] for r in connection.execute(f\"SELECT id FROM users WHERE name = '{safe}' ORDER BY id\")]"),
    ('51.8', "def find_users(connection, name):\n    return [r[0] for r in connection.execute('SELECT id FROM users WHERE lower(name) = lower(?) ORDER BY id', (name,))]"),
    ('51.8', "def find_users(connection, name):\n    return [r[0] for r in connection.execute('SELECT DISTINCT id FROM users WHERE name = ? ORDER BY id', (name,))]"),
    ('51.8', "def find_users(connection, name):\n    connection.commit()\n    return [r[0] for r in connection.execute('SELECT id FROM users WHERE name = ? ORDER BY id', (name,))]"),
    ('51.9', 'commit-between'),
    ('51.9', 'hide-error'),
])
def test_sqlite_checks_reject_old_false_accepts(sqlite_tasks, task_id, code):
    if code == 'commit-between':
        code = build_tasks._reference_program(sqlite_tasks[task_id]).replace(
            '        connection.execute("UPDATE accounts SET balance = balance + ? WHERE id = ?", (amount, target))',
            '        connection.commit()\n        connection.execute("UPDATE accounts SET balance = balance + ? WHERE id = ?", (amount, target))')
    elif code == 'hide-error':
        code = build_tasks._reference_program(sqlite_tasks[task_id]).replace('def transfer(', 'def _transfer(')
        code += '\n\ndef transfer(*args):\n    try:\n        return _transfer(*args)\n    except Exception:\n        return False'
    namespace = {'sqlite3': sqlite3}
    exec(code, namespace)
    with pytest.raises(AssertionError):
        exec(sqlite_tasks[task_id]['check']['append'], namespace)


@pytest.mark.parametrize('task_id', ['51.2', '51.4', '51.8', '51.9'])
def test_sqlite_reference_passes(sqlite_tasks, task_id, capsys):
    namespace = {}
    with contextlib.redirect_stdout(io.StringIO()):
        exec(build_tasks._reference_program(sqlite_tasks[task_id]), namespace)
    exec(sqlite_tasks[task_id]['check']['append'], namespace)
    assert capsys.readouterr().out == 'OK\n'


@pytest.mark.parametrize(('task_id', 'code'), [
    ('51.2', "def count_items(con):\n    return len(con.cursor().execute('SELECT id FROM items').fetchall())"),
    ('51.4', "def add_user(con, name, score):\n    con.cursor().executemany('INSERT INTO users(name, score) VALUES (:person, :points)', [{'person': name, 'points': score}])"),
    ('51.8', "def find_users(connection, name):\n    cursor = connection.cursor()\n    rows = cursor.execute('SELECT id FROM users WHERE name = :person', {'person': name})\n    return sorted(row[0] for row in rows)"),
    ('51.9', '''def transfer(connection, source, target, amount):
    balance = connection.execute('SELECT balance FROM accounts WHERE id = ?', (source,)).fetchone()[0]
    if balance < amount:
        return False
    try:
        connection.execute('UPDATE accounts SET balance = balance - ? WHERE id = ?', (amount, source))
        connection.execute('UPDATE accounts SET balance = balance + ? WHERE id = ?', (amount, target))
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    return True'''),
])
def test_sqlite_equivalent_cursor_named_binding_and_explicit_transaction_pass(sqlite_tasks, task_id, code, capsys):
    namespace = {'sqlite3': sqlite3}
    exec(code, namespace)
    exec(sqlite_tasks[task_id]['check']['append'], namespace)
    assert capsys.readouterr().out == 'OK\n'


def test_sqlite_theory_has_independent_visible_examples_and_all_hints():
    support = build_tasks._load_support_content()
    examples = [e for s in support['theory']['51']['sections'] for e in s['examples']]
    assert len(examples) == 8
    assert all(e.get('output') and not e.get('context') for e in examples)
    assert all(support['hints'].get(f'51.{i}') for i in range(1, 8))
