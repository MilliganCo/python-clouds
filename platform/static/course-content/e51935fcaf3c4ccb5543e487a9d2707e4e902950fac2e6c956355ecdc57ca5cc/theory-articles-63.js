window.THEORY_ARTICLES=Object.assign(window.THEORY_ARTICLES || {},{
  "63": {
    "id": 63,
    "title": "SQLite: резервные копии и восстановление",
    "lead": "Резервная копия полезна, когда её удалось открыть и проверить. На отдельных учебных файлах разберём committed WAL, чтение без создания пустой БД, проверку данных и восстановление в новый путь. Никаких файлов рабочего сервера: в контейнере эта практика живёт только до конца одного запуска. На компьютере используйте свою отдельную учебную папку.",
    "sections": [
      {
        "title": "1. Направление резервирования",
        "text": "source.backup(target) копирует содержимое в target. Обе базы здесь новые и учебные.",
        "examples": [
          {
            "code": "import os\nimport sqlite3\nimport time\nfrom pathlib import Path\nfrom tempfile import TemporaryDirectory\nfrom contextlib import closing\nwith closing(sqlite3.connect(':memory:')) as source,closing(sqlite3.connect(':memory:')) as target:\n    source.execute('CREATE TABLE x(value INTEGER)');source.execute('INSERT INTO x VALUES (7)');source.commit()\n    source.backup(target)\n    print(target.execute('SELECT value FROM x').fetchone()[0])",
            "output": "7"
          }
        ]
      },
      {
        "title": "2. Committed WAL виден SQLite",
        "text": "В WAL зафиксированные страницы могут оставаться отдельно от основного файла. Пример держит writer открытым и запрещает auto-checkpoint, чтобы не зависеть от случайного закрытия.",
        "examples": [
          {
            "code": "import os\nimport sqlite3\nimport time\nfrom pathlib import Path\nfrom tempfile import TemporaryDirectory\nfrom contextlib import closing\nwith TemporaryDirectory() as folder:\n    path=Path(folder)/'live.db'\n    with closing(sqlite3.connect(path)) as writer:\n        print(writer.execute('PRAGMA journal_mode=WAL').fetchone()[0])\n        writer.execute('PRAGMA wal_autocheckpoint=0');writer.execute('CREATE TABLE x(value INTEGER)');writer.commit()\n        writer.execute('INSERT INTO x VALUES (12)');writer.commit()\n        with closing(sqlite3.connect(path.resolve().as_uri()+'?mode=ro',uri=True)) as reader:\n            print(reader.execute('SELECT value FROM x').fetchone()[0])",
            "output": "wal\n12"
          }
        ]
      },
      {
        "title": "3. URI существующего файла",
        "text": "Обычный connect может создать отсутствующий файл. Path.as_uri кодирует пробелы, # и кириллицу; mode=ro запрещает запись. resolve(strict=True) не позволяет придумать пустую базу вместо потерянной.",
        "examples": [
          {
            "code": "import os\nimport sqlite3\nimport time\nfrom pathlib import Path\nfrom tempfile import TemporaryDirectory\nfrom contextlib import closing\nwith TemporaryDirectory() as folder:\n    path=Path(folder)/'Пример # 1.db'\n    with closing(sqlite3.connect(path)) as con:con.execute('CREATE TABLE x(value INTEGER)')\n    uri=path.resolve(strict=True).as_uri()+'?mode=ro'\n    with closing(sqlite3.connect(uri,uri=True)) as con:\n        print(con.execute('SELECT COUNT(*) FROM x').fetchone()[0])\n        try:con.execute('INSERT INTO x VALUES (1)')\n        except sqlite3.OperationalError:print('только чтение')",
            "output": "0\nтолько чтение"
          }
        ]
      },
      {
        "title": "4. Контекст и close",
        "text": "with con управляет транзакцией в используемом legacy-режиме CPython3.14. closing закрывает соединение. Закройте соединения снимка до файловой публикации, особенно на Windows.",
        "examples": [
          {
            "code": "import os\nimport sqlite3\nimport time\nfrom pathlib import Path\nfrom tempfile import TemporaryDirectory\nfrom contextlib import closing\nwith closing(sqlite3.connect(':memory:')) as con:\n    con.execute('CREATE TABLE x(value INTEGER)')\n    with con:con.execute('INSERT INTO x VALUES (2)')\n    print(con.in_transaction)\ntry:con.execute('SELECT 1')\nexcept sqlite3.ProgrammingError:print('закрыто')",
            "output": "False\nзакрыто"
          }
        ]
      },
      {
        "title": "5. Новый путь должен отказать при коллизии",
        "text": "os.link создаёт новое имя существующего подготовленного файла на той же файловой системе, не перезаписывая занятое имя. Это жёсткая, не символическая ссылка. Требуется поддержка файловой системы; ошибку ОС нельзя чинить заменой чужого файла.",
        "examples": [
          {
            "code": "import os\nimport sqlite3\nimport time\nfrom pathlib import Path\nfrom tempfile import TemporaryDirectory\nfrom contextlib import closing\nwith TemporaryDirectory() as folder:\n    root=Path(folder);stage=root/'prepared';target=root/'published'\n    stage.write_text('готово',encoding='utf-8');os.link(stage,target)\n    try:os.link(stage,target)\n    except FileExistsError:print('имя занято')\n    stage.unlink();print(target.read_text(encoding='utf-8'))",
            "output": "имя занято\nготово"
          }
        ]
      },
      {
        "title": "6. Временная подготовка принадлежит операции",
        "text": "Собственная TemporaryDirectory рядом с будущим destination остаётся на той же файловой системе. Она удаляет только свои подготовленные файлы. Не используйте путь рабочей БД как временный и не обещайте физическую crash-durability: здесь проверяется успешный вызов и штатный отказ.",
        "examples": [
          {
            "code": "import os\nimport sqlite3\nimport time\nfrom pathlib import Path\nfrom tempfile import TemporaryDirectory\nfrom contextlib import closing\nwith TemporaryDirectory() as root:\n    root=Path(root)\n    with TemporaryDirectory(dir=root) as temporary:\n        stage=Path(temporary)/'prepared';stage.write_bytes(b'ready')\n        os.link(stage,root/'result')\n    print((root/'result').read_bytes())\n    print(len(list(root.iterdir())))",
            "output": "b'ready'\n1"
          }
        ]
      },
      {
        "title": "7. Целостность не равна правильности данных",
        "text": "PRAGMA integrity_check проверяет внутреннюю структуру SQLite. Значение done=2 может не нарушить её, но нарушает наше правило задачи. Проверяйте ещё прикладную схему и значения, не исправляя их догадками.",
        "examples": [
          {
            "code": "import os\nimport sqlite3\nimport time\nfrom pathlib import Path\nfrom tempfile import TemporaryDirectory\nfrom contextlib import closing\nwith closing(sqlite3.connect(':memory:')) as con:\n    con.execute('CREATE TABLE notes(done INTEGER)');con.execute('INSERT INTO notes VALUES (2)');con.commit()\n    print(con.execute('PRAGMA integrity_check').fetchone()[0])\n    done=con.execute('SELECT done FROM notes').fetchone()[0]\n    print(done in (0,1))",
            "output": "ok\nFalse"
          }
        ]
      },
      {
        "title": "8. Явная ревизия, а не число записей",
        "text": "Данные meta.revision задаёт приложение при создании учебного состояния. Она не вычисляется по mtime или отдельной заметке. Нулевая ревизия и пустая таблица допустимы; ровно одна строка meta исключает неоднозначность.",
        "examples": [
          {
            "code": "import os\nimport sqlite3\nimport time\nfrom pathlib import Path\nfrom tempfile import TemporaryDirectory\nfrom contextlib import closing\nwith closing(sqlite3.connect(':memory:')) as con:\n    con.execute('CREATE TABLE meta(revision INTEGER)');con.execute('INSERT INTO meta VALUES (0)')\n    con.execute('CREATE TABLE notes(title TEXT)');con.commit()\n    print(con.execute('SELECT revision FROM meta').fetchone()[0])\n    print(con.execute('SELECT COUNT(*) FROM notes').fetchone()[0])",
            "output": "0\n0"
          }
        ]
      },
      {
        "title": "9. Свежая пустая копия тоже нужна",
        "text": "Более поздняя версия может честно содержать ноль заметок. В этом отдельном примере выберите максимальную явную revision, сохраняя первый элемент при равенстве. Дата файла и число строк не участвуют.",
        "examples": [
          {
            "code": "snapshots=[{'revision':4,'total':9},{'revision':7,'total':0}]\nbest=max(snapshots,key=lambda item:item['revision'])\nprint(best)",
            "output": "{'revision': 7, 'total': 0}"
          }
        ]
      },
      {
        "title": "10. Категория ошибки, не общий except",
        "text": "Не любой DatabaseError означает испорченную копию. Здесь другая наша транзакция держит EXCLUSIVE-lock, а читатель timeout=0 получает BUSY. Восстановление должно сообщить отказ, а не молча выбрать старую версию.",
        "examples": [
          {
            "code": "import os\nimport sqlite3\nimport time\nfrom pathlib import Path\nfrom tempfile import TemporaryDirectory\nfrom contextlib import closing\nwith TemporaryDirectory() as folder:\n    path=Path(folder)/'locked.db'\n    with closing(sqlite3.connect(path)) as writer:\n        writer.execute('CREATE TABLE x(value INTEGER)');writer.execute('BEGIN EXCLUSIVE')\n        try:\n            with closing(sqlite3.connect(path.resolve().as_uri()+'?mode=ro',uri=True,timeout=0)) as reader:\n                reader.execute('SELECT COUNT(*) FROM x')\n        except sqlite3.OperationalError as error:print((error.sqlite_errorcode&255)==sqlite3.SQLITE_BUSY)\n        finally:writer.rollback()",
            "output": "True"
          }
        ]
      },
      {
        "title": "11. Progress может прервать backup",
        "text": "Timeout connect не ограничивает весь цикл повторов backup. Callback progress получает status/remaining/total; исключение из него прерывает операцию. В рабочем решении сравнивайте monotonic с конечным deadline и используйте короткий sleep. Пример нарочно прерывает собственную учебную копию без публикации.",
        "examples": [
          {
            "code": "import os\nimport sqlite3\nimport time\nfrom pathlib import Path\nfrom tempfile import TemporaryDirectory\nfrom contextlib import closing\nwith closing(sqlite3.connect(':memory:')) as source,closing(sqlite3.connect(':memory:')) as target:\n    source.execute('CREATE TABLE x(value INTEGER)');source.commit()\n    def progress(status,remaining,total):raise TimeoutError('учебная остановка')\n    try:source.backup(target,pages=1,progress=progress)\n    except TimeoutError:print('копия не опубликована')",
            "output": "копия не опубликована"
          }
        ]
      },
      {
        "title": "12. Восстановленная БД независима",
        "text": "Резервный файл открывается read-only, данные копируются SQLite API в новую БД. Для публикации используется подготовленная копия, не hardlink на резервный источник. Файлы контейнера исчезают между разными запусками; реальный учебный проект продолжайте в отдельной локальной папке.",
        "examples": [
          {
            "code": "import os\nimport sqlite3\nimport time\nfrom pathlib import Path\nfrom tempfile import TemporaryDirectory\nfrom contextlib import closing\nwith TemporaryDirectory() as folder:\n    root=Path(folder);archive=root/'archive.db';working=root/'working.db'\n    with closing(sqlite3.connect(archive)) as con:\n        con.execute('CREATE TABLE notes(title TEXT)');con.execute(\"INSERT INTO notes VALUES ('архив')\");con.commit()\n    with closing(sqlite3.connect(archive.resolve().as_uri()+'?mode=ro',uri=True)) as src,closing(sqlite3.connect(working)) as dst:\n        src.backup(dst);dst.execute(\"UPDATE notes SET title='восстановлено'\");dst.commit()\n    with closing(sqlite3.connect(archive)) as con:print(con.execute('SELECT title FROM notes').fetchone()[0])\n    with closing(sqlite3.connect(working)) as con:print(con.execute('SELECT title FROM notes').fetchone()[0])",
            "output": "архив\nвосстановлено"
          }
        ]
      }
    ],
    "summary": [
      "Живую SQLite резервируют через SQLite API, включая committed WAL.",
      "Прежде публикации проверьте фактическую копию и прикладные правила.",
      "Destination только новый: сохраните архивы и поздно появившуюся работу.",
      "Выбирайте снимок по явной ревизии; пустота и ноль не означают ошибку.",
      "Отделяйте повреждение формата от временного lock."
    ],
    "mistakes": [
      "Копировать только db-файл открытой WAL-базы.",
      "Перепутать source.backup(destination) или создать пустой source обычным connect.",
      "Публиковать невалидную копию либо заменять существующий destination.",
      "Делать hardlink непосредственно на архив вместо самостоятельного восстановления.",
      "Выбирать по числу строк/mtime или скрывать BUSY общим except."
    ],
    "applications": [
      "Резервная копия отдельного учебного приложения с заметками.",
      "Проверка восстановления на новом пути до работы с реальными данными."
    ]
  }
});
