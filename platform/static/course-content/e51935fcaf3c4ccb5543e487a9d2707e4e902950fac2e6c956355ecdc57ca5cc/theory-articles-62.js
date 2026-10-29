window.THEORY_ARTICLES=Object.assign(window.THEORY_ARTICLES || {},{
  "62": {
    "id": 62,
    "title": "Flask и SQLite: данные между запросами",
    "lead": "В теме Flask данные жили в памяти. Теперь отделим приложение от хранилища: второй экземпляр открывает тот же учебный файл и видит сохранённые записи. Будем проверять откат и конфликт изменений. Test client не открывает порт; БД в примерах временные. Файлы рабочего сервера и личные данные здесь не используются.",
    "sections": [
      {
        "title": "1. Два экземпляра читают один файл",
        "text": "Фабрика создаёт приложение, файл SQLite хранит записи. Закрытый запрос не уничтожает зафиксированные данные. Внешняя TemporaryDirectory здесь удаляет только учебный файл после примера. В контейнере платформы рабочая папка одноразовая: сохранение между экземплярами в одном запуске не обещает хранения файла между разными запусками ученика.",
        "examples": [
          {
            "code": "import sqlite3\nfrom contextlib import closing\nfrom tempfile import TemporaryDirectory\nfrom pathlib import Path\nwith TemporaryDirectory() as folder:\n    path=Path(folder)/'notes.db'\n    with closing(sqlite3.connect(path)) as con:\n        con.execute('CREATE TABLE notes(title TEXT)')\n        with con:con.execute('INSERT INTO notes VALUES (?)',('Сохранено',))\n    with closing(sqlite3.connect(path)) as con:print(con.execute('SELECT title FROM notes').fetchone()[0])",
            "output": "Сохранено"
          }
        ]
      },
      {
        "title": "2. Параметры передают значения, не SQL",
        "text": "Значение передаётся вторым аргументом execute, отдельно от текста SQL. Это сохраняет апостроф и не превращает похожую на запрос строку в условие. Плейсхолдеры не заменяют имена таблиц/столбцов: динамическая структура требует отдельного фиксированного выбора. Для поиска точного названия не нужен LIKE.",
        "examples": [
          {
            "code": "import sqlite3\nfrom contextlib import closing\nwith closing(sqlite3.connect(':memory:')) as con:\n    con.execute('CREATE TABLE notes(title TEXT)')\n    con.executemany('INSERT INTO notes VALUES (?)',[(\"O'Neil\",),(\"' OR 1=1 --\",)])\n    for title in [\"O'Neil\",\"' OR 1=1 --\"]:\n        print(con.execute('SELECT COUNT(*) FROM notes WHERE title=?',(title,)).fetchone()[0])",
            "output": "1\n1"
          }
        ]
      },
      {
        "title": "3. Row нужно превратить в данные ответа",
        "text": "sqlite3.Row позволяет читать колонки по имени. Для JSON сформируйте обычный словарь; done хранится как 0/1, но контракт API требует bool. Настройте row_factory до создания используемого курсора. Точный список полей ограничивает ответ тем, что обещает API.",
        "examples": [
          {
            "code": "import sqlite3\nfrom contextlib import closing\nwith closing(sqlite3.connect(':memory:')) as con:\n    con.row_factory=sqlite3.Row\n    row=con.execute('SELECT 1 AS id,0 AS done').fetchone()\n    print({'id':row['id'],'done':bool(row['done'])})",
            "output": "{'id': 1, 'done': False}"
          }
        ]
      },
      {
        "title": "4. Контекст транзакции и close",
        "text": "with con фиксирует успешную транзакцию или откатывает её при исключении. Само соединение после блока остаётся открытым. closing отвечает за close. В этой теме используется legacy-режим sqlite3 CPython 3.14; не переносите поведение commit в другой autocommit-режим без проверки его контракта.",
        "examples": [
          {
            "code": "import sqlite3\nfrom contextlib import closing\nwith closing(sqlite3.connect(':memory:')) as con:\n    con.execute('CREATE TABLE x(value INTEGER)')\n    with con:con.execute('INSERT INTO x VALUES (0)')\n    print(con.in_transaction)\n    print(con.execute('SELECT value FROM x').fetchone()[0])",
            "output": "False\n0"
          }
        ]
      },
      {
        "title": "5. Исключение откатывает весь блок",
        "text": "Ограничение CHECK страхует правило на уровне БД, но не заменяет понятную валидацию API. Исключение должно пересечь границу транзакционного блока, иначе менеджер может увидеть успешное завершение. В примере ни одна из двух вставок не остаётся.",
        "examples": [
          {
            "code": "import sqlite3\nfrom contextlib import closing\nwith closing(sqlite3.connect(':memory:')) as con:\n    con.execute('CREATE TABLE stock(qty INTEGER CHECK(qty>=0))')\n    try:\n        with con:\n            con.execute('INSERT INTO stock VALUES (3)')\n            con.execute('INSERT INTO stock VALUES (-1)')\n    except sqlite3.IntegrityError:print('откат')\n    print(con.execute('SELECT COUNT(*) FROM stock').fetchone()[0])",
            "output": "откат\n0"
          }
        ]
      },
      {
        "title": "6. Одна транзакция занимает право записи",
        "text": "BEGIN IMMEDIATE получает write-транзакцию до проверки данных. SQLite допускает одного писателя одновременно, поэтому второй может получить SQLITE_BUSY. Это не повод выдавать успешный ответ. Пример не ждёт блокировку: timeout=0 воспроизводит отказ на своём временном файле без сна или внешней нагрузки.",
        "examples": [
          {
            "code": "import sqlite3\nfrom contextlib import closing\nfrom tempfile import TemporaryDirectory\nfrom pathlib import Path\nwith TemporaryDirectory() as folder:\n    path=Path(folder)/'lock.db'\n    with closing(sqlite3.connect(path)) as first,closing(sqlite3.connect(path,timeout=0)) as second:\n        first.execute('CREATE TABLE x(value INTEGER)')\n        first.execute('BEGIN IMMEDIATE')\n        try:second.execute('INSERT INTO x VALUES (1)')\n        except sqlite3.OperationalError as error:print(error.sqlite_errorcode==sqlite3.SQLITE_BUSY)\n        finally:first.rollback()",
            "output": "True"
          }
        ]
      },
      {
        "title": "7. Условный UPDATE проверяет и меняет",
        "text": "Предварительное чтение и последующая запись без общей транзакции могут устареть. В простом уменьшении остатка условие можно включить в UPDATE и проверить rowcount. Ноль изменённых строк требует разбора причины; не превращайте его автоматически в подтверждение действия.",
        "examples": [
          {
            "code": "import sqlite3\nfrom contextlib import closing\nwith closing(sqlite3.connect(':memory:')) as con:\n    con.execute('CREATE TABLE stock(sku TEXT PRIMARY KEY,qty INTEGER)')\n    with con:con.execute('INSERT INTO stock VALUES (?,?)',('A',2))\n    with con:cursor=con.execute('UPDATE stock SET qty=qty-? WHERE sku=? AND qty>=?',(3,'A',3))\n    print(cursor.rowcount)\n    print(con.execute('SELECT qty FROM stock').fetchone()[0])",
            "output": "0\n2"
          }
        ]
      },
      {
        "title": "8. g хранит ресурс одного контекста",
        "text": "Соединение можно открыть лениво и хранить в g до teardown_appcontext. Повторный вызов внутри контекста использует тот же объект, следующий запрос создаёт свой. Не используйте общий Connection с отключённой проверкой потоков ради обхода ошибки: это не модель владения ресурсом.",
        "examples": [
          {
            "code": "from flask import Flask,g\nimport sqlite3\napp=Flask('lesson',static_folder=None)\ndef get_db():\n    if 'db' not in g:g.db=sqlite3.connect(':memory:')\n    return g.db\n@app.teardown_appcontext\ndef close_db(error):\n    db=g.pop('db',None)\n    if db is not None:db.close()\nwith app.app_context():print(get_db() is get_db())",
            "output": "True"
          }
        ]
      },
      {
        "title": "9. HTTP-ответ можно проверить с настоящей SQLite",
        "text": "Test client выполняет обработчик Flask, который обращается к временной SQLite. Это тест совместной работы приложения и хранилища, а не запущенного сетевого сервиса. БД для теста отделяют от рабочей; SQL создаёт только учебную таблицу в памяти.",
        "examples": [
          {
            "code": "from flask import Flask\nimport sqlite3\nfrom contextlib import closing\napp=Flask('lesson',static_folder=None)\n@app.get('/count')\ndef count():\n    with closing(sqlite3.connect(':memory:')) as con:\n        con.execute('CREATE TABLE notes(title TEXT)')\n        return {'count':con.execute('SELECT COUNT(*) FROM notes').fetchone()[0]}\nr=app.test_client().get('/count')\nprint(r.status_code,r.get_json()['count'])",
            "output": "200 0"
          }
        ]
      },
      {
        "title": "10. Автоинкремент не обещает непрерывную последовательность",
        "text": "AUTOINCREMENT не переиспользует максимальный ID ранее зафиксированной и удалённой записи. Обычный INTEGER PRIMARY KEY имеет другие правила. ID — идентификатор, а не число существующих строк; после удаления нельзя выдавать len(items)+1 и ожидать уникальность.",
        "examples": [
          {
            "code": "import sqlite3\nfrom contextlib import closing\nwith closing(sqlite3.connect(':memory:')) as con:\n    con.execute('CREATE TABLE notes(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT)')\n    with con:con.execute('INSERT INTO notes(title) VALUES (?)',('Первая',))\n    with con:con.execute('DELETE FROM notes')\n    with con:cursor=con.execute('INSERT INTO notes(title) VALUES (?)',('Вторая',))\n    print(cursor.lastrowid)",
            "output": "2"
          }
        ]
      },
      {
        "title": "11. Устаревший клиент получает конфликт",
        "text": "Клиент передаёт прочитанную версию. Сервер меняет запись только при совпадении и возвращает новую версию. Конфликт нужно разрешить после чтения актуальных данных; автоматическая перезапись новейшего состояния не является объединением изменений.",
        "examples": [
          {
            "code": "import sqlite3\nfrom contextlib import closing\nwith closing(sqlite3.connect(':memory:')) as con:\n    con.execute('CREATE TABLE notes(id INTEGER PRIMARY KEY,done INTEGER,version INTEGER)')\n    with con:con.execute('INSERT INTO notes VALUES (1,0,1)')\n    for done in [1,0]:\n        with con:cursor=con.execute('UPDATE notes SET done=?,version=version+1 WHERE id=? AND version=?',(done,1,1))\n        print('изменено' if cursor.rowcount==1 else 'конфликт')\n    print(con.execute('SELECT done,version FROM notes').fetchone())",
            "output": "изменено\nконфликт\n(1, 2)"
          }
        ]
      },
      {
        "title": "12. Проверяйте повторное открытие и независимость путей",
        "text": "Для учебного сервиса нужны отдельный путь тестовой БД, инициализация без потери строк, commit/rollback и закрытие ресурса. Два файла должны оставаться независимыми. В браузерном запуске платформа удаляет временную рабочую папку после окончания: чтобы продолжить на компьютере, создайте свой учебный файл в IDE. Тесты не подтверждают резервное восстановление, авторизацию, HTTPS и промышленную конкурентную нагрузку. Справка: docs.python.org/3.14/library/sqlite3.html и flask.palletsprojects.com/en/stable/patterns/sqlite3/.",
        "examples": [
          {
            "code": "import sqlite3\nfrom contextlib import closing\nfrom tempfile import TemporaryDirectory\nfrom pathlib import Path\nwith TemporaryDirectory() as folder:\n    for name,values in [('first.db',[1]),('second.db',[])]:\n        with closing(sqlite3.connect(Path(folder)/name)) as con:\n            con.execute('CREATE TABLE x(value INTEGER)')\n            with con:con.executemany('INSERT INTO x VALUES (?)',[(v,) for v in values])\n    for name in ['first.db','second.db']:\n        with closing(sqlite3.connect(Path(folder)/name)) as con:print(con.execute('SELECT COUNT(*) FROM x').fetchone()[0])",
            "output": "1\n0"
          }
        ]
      }
    ],
    "summary": [
      "Файл БД, Connection, транзакция и Flask-приложение имеют разное время жизни.",
      "Параметры SQL сохраняют текст как данные; Row нужно преобразовать в контракт ответа.",
      "Многочастное изменение фиксируется одной транзакцией; busy, нехватка и конфликт версии различаются.",
      "Тестовый файл и рабочая БД разделены; контейнер не обещает файл между разными запусками."
    ],
    "mistakes": [
      {
        "title": "Ожидали commit от close",
        "text": "Явно завершите транзакцию и отдельно закройте соединение."
      },
      {
        "title": "Сохранили половину изменения",
        "text": "Не делайте commit между связанными UPDATE; исключение должно вызвать rollback."
      },
      {
        "title": "Общий Connection у разных запросов",
        "text": "Храните соединение в контексте запроса или закрывайте собственное в обработчике."
      },
      {
        "title": "Устаревший клиент перезаписал новый результат",
        "text": "Проверяйте версию и запись атомарно, конфликт не считайте успехом."
      }
    ],
    "applications": [
      "Учебное API переноса остатков с атомарной записью.",
      "Заметки с сохранением между экземплярами и контролем версии.",
      "Проверка отката на искусственной ошибке вместо повреждения рабочего хранилища."
    ]
  }
});
