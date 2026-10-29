window.THEORY_ARTICLES=Object.assign(window.THEORY_ARTICLES || {},{
  "61": {
    "id": 61,
    "title": "Flask: своё небольшое веб-приложение",
    "lead": "После HTTP-клиента посмотрим на другую сторону запроса. Flask выбирает обработчик, читает вход и формирует ответ. Здесь настоящее приложение вызывается через test_client: порт не открывается и app.run не нужен. Два самостоятельных финала собирают небольшие API; данные живут только в памяти одного временного приложения.",
    "sections": [
      {
        "title": "1. Приложение можно вызвать без порта",
        "text": "Flask — WSGI-приложение: путь и метод выбирают функцию, а результат превращается в ответ. Test client делает запрос внутри процесса. Он проверяет поведение приложения, но не сетевую инфраструктуру. Во всех заданиях возвращайте объект фабрики; app.run заблокировал бы выполнение, а debug-сервер не нужен проверке.",
        "examples": [
          {
            "code": "from flask import Flask\napp=Flask('lesson',static_folder=None)\n@app.get('/hello')\ndef hello():return {'message':'Привет'}\nr=app.test_client().get('/hello')\nprint(r.status_code,r.mimetype)\nprint(r.get_json()['message'])",
            "output": "200 application/json\nПривет"
          }
        ]
      },
      {
        "title": "2. Метод и форма пути различаются",
        "text": "Маршрут задаёт адрес и допустимые методы. int-конвертер выдаёт число, поэтому не подходит для текстового артикула с ведущими нулями. 404 говорит, что путь не найден; 405 — что для найденного пути не разрешён этот метод. Базовые GET-маршруты также поддерживают HEAD/OPTIONS, но не превращаются автоматически в POST.",
        "examples": [
          {
            "code": "from flask import Flask\napp=Flask('lesson',static_folder=None)\n@app.get('/sku/<sku>')\ndef read(sku):return {'sku':sku}\nc=app.test_client()\nprint(c.get('/sku/0012').get_json()['sku'])\nprint(c.post('/sku/0012').status_code)\nprint(c.get('/other').status_code)",
            "output": "0012\n405\n404"
          }
        ]
      },
      {
        "title": "3. Query содержит строки и повторы",
        "text": "request.args относится к текущему запросу. get возвращает одно значение, getlist видит повторы. Query не знает бизнес-типа: число 0 приходит строкой «0». Не соединяйте URL вручную из пользовательского ввода; передайте query_string тестовому клиенту или params клиенту requests.",
        "examples": [
          {
            "code": "from flask import Flask,request\napp=Flask('lesson',static_folder=None)\n@app.get('/search')\ndef search():return {'q':request.args.getlist('q')}\nr=app.test_client().get('/search',query_string=[('q','A&B +'),('q','0')])\nprint(r.get_json()['q'])",
            "output": "['A&B +', '0']"
          }
        ]
      },
      {
        "title": "4. Тело, статус и заголовки — отдельные части ответа",
        "text": "Словарь автоматически сериализуется в JSON. Кортеж body, status, headers задаёт статус и заголовки явно. Создание ресурса часто возвращает 201 и Location; пустое успешное удаление — 204 без JSON. Клиенту нужно проверять контракт, а не пытаться вызывать json на любом успешном ответе.",
        "examples": [
          {
            "code": "from flask import Flask\napp=Flask('lesson',static_folder=None)\n@app.post('/items')\ndef create():return {'id':1},201,{'Location':'/items/1'}\nr=app.test_client().post('/items')\nprint(r.status_code,r.headers['Location'])\nprint(r.get_json()['id'])",
            "output": "201 /items/1\n1"
          }
        ]
      },
      {
        "title": "5. Media type не подтверждает JSON-схему",
        "text": "request.is_json принимает application/json и application/*+json. get_json разбирает тело; silent=True позволяет получить None вместо исключения при ошибке синтаксиса. Затем всё равно нужна проверка типа корня, полей и значений. Текст/plain с похожим телом не следует молча принимать за заявленный JSON API.",
        "examples": [
          {
            "code": "from flask import Flask,request\napp=Flask('lesson',static_folder=None)\n@app.post('/inspect')\ndef inspect():return {'is_json':request.is_json,'data':request.get_json(silent=True)}\nc=app.test_client()\nfor body,kind in [('{}','text/plain'),('{','application/json'),('[]','application/json')]:\n    data=c.post('/inspect',data=body,content_type=kind).get_json()\n    print(data['is_json'],data['data'])",
            "output": "False None\nTrue None\nTrue []"
          }
        ]
      },
      {
        "title": "6. Строгая схема сохраняет ноль",
        "text": "JSON допускает числа, логические значения и null. Python bool связан с int, но флаг обычно не является количеством. Для строгого учебного контракта type(value) is int отличает 0 от False. Сначала валидация, потом изменение данных; ошибка не должна оставлять частично изменённый объект.",
        "examples": [
          {
            "code": "for value in [0,False,1.0,'1',None]:\n    print(repr(value),type(value) is int)",
            "output": "0 True\nFalse False\n1.0 False\n'1' False\nNone False"
          }
        ]
      },
      {
        "title": "7. Контекст не заменяет базу данных",
        "text": "g удобно хранит ресурс или промежуточное значение текущего контекста. Следующий отдельный запрос не наследует его автоматически. request вне контекста вызывает RuntimeError. Не создавайте глобальный список всех пользователей ради простого примера: локальная память одного экземпляра — учебная модель, а не обещание долговечности или многопроцессной согласованности.",
        "examples": [
          {
            "code": "from flask import Flask,g\napp=Flask('lesson',static_folder=None)\n@app.get('/counter')\ndef counter():\n    g.value=getattr(g,'value',0)+1\n    return {'value':g.value}\nc=app.test_client()\nprint(c.get('/counter').get_json()['value'])\nprint(c.get('/counter').get_json()['value'])",
            "output": "1\n1"
          }
        ]
      },
      {
        "title": "8. Шаблон и данные передаются раздельно",
        "text": "render_template_string автоматически экранирует HTML в переменных. Статичный шаблон получает имя отдельным параметром; нельзя вставлять ввод в текст шаблона f-строкой. |safe снимает защиту и здесь не нужен. Автоэкранирование HTML не делает произвольный JavaScript, URL или CSS безопасным.",
        "examples": [
          {
            "code": "from flask import Flask,render_template_string\napp=Flask('lesson',static_folder=None)\nwith app.app_context():\n    print(render_template_string('<p>{{ name }}</p>',name='<b>Маша</b>'))\n    print(render_template_string('<p>{{ name }}</p>',name='{{ 7*7 }}'))",
            "output": "<p>&lt;b&gt;Маша&lt;/b&gt;</p>\n<p>{{ 7*7 }}</p>"
          }
        ]
      },
      {
        "title": "9. Обработчик ошибки сохраняет её статус",
        "text": "Стандартная ошибка Flask часто содержит HTML. Если контракт API требует JSON, зарегистрируйте нужный обработчик и верните статус явно: один словарь мог бы случайно превратить отказ в 200. Не ловите все Exception с фиктивным успешным ответом; ошибка сервера и плохой пользовательский ввод имеют разный смысл.",
        "examples": [
          {
            "code": "from flask import Flask\napp=Flask('lesson',static_folder=None)\n@app.errorhandler(404)\ndef missing(error):return {'error':'not_found'},404\nr=app.test_client().get('/unknown')\nprint(r.status_code,r.get_json()['error'])",
            "output": "404 not_found"
          }
        ]
      },
      {
        "title": "10. Фабрика создаёт независимое состояние",
        "text": "В учебной фабрике можно скопировать небольшие входные данные в замыкание. Все клиенты одного экземпляра видят это состояние, а новый экземпляр получает отдельное. Скопируйте вложенные значения, если они могут меняться. Для настоящего сервиса нужны выбранное хранилище, правила доступа и конкуренции; test client не доказывает их наличие.",
        "examples": [
          {
            "code": "from flask import Flask\ndef create_app(value):\n    app=Flask('lesson',static_folder=None)\n    @app.get('/value')\n    def read():return {'value':value}\n    return app\nfirst=create_app(0);second=create_app(8)\nprint(first.test_client().get('/value').get_json()['value'])\nprint(second.test_client().get('/value').get_json()['value'])",
            "output": "0\n8"
          }
        ]
      },
      {
        "title": "11. pytest проверяет запрос как обычное поведение",
        "text": "Сохраните фабрику и тест в отдельные модули, используйте свежий экземпляр для каждого сценария. В коротком независимом примере ниже настоящий pytest запускается в отдельном временном каталоге без сторонних плагинов. Проверяется статус и содержимое, а не только отсутствие исключения. Сетевой сервер не запускается.",
        "examples": [
          {
            "code": "from pathlib import Path\nimport os,subprocess,sys,tempfile\nwith tempfile.TemporaryDirectory() as folder:\n    Path(folder,'test_web.py').write_text(\"from flask import Flask\\ndef test_health():\\n    app=Flask('lesson',static_folder=None)\\n    app.add_url_rule('/health',view_func=lambda:{'ok':True})\\n    r=app.test_client().get('/health')\\n    assert r.status_code==200 and r.get_json()=={'ok':True}\\n\",encoding='utf-8')\n    result=subprocess.run([sys.executable,'-m','pytest','-q','-p','no:cacheprovider',folder],cwd=folder,env={**os.environ,'PYTEST_DISABLE_PLUGIN_AUTOLOAD':'1','PYTHONDONTWRITEBYTECODE':'1'},capture_output=True,text=True,timeout=5)\n    print(result.returncode)",
            "output": "0"
          }
        ]
      },
      {
        "title": "12. Проверка приложения не является развёртыванием",
        "text": "Тестовый клиент способен проверить создание, адрес ресурса и пустое удаление без реальной сети. Он не проверяет HTTPS, reverse proxy, рабочую БД, права доступа и несколько процессов. Для локальной IDE используйте отдельную venv с Flask и pytest; не называйте файл flask.py. Не публикуйте debug-сервер как рабочий сервис. Официальные основы: https://flask.palletsprojects.com/en/stable/quickstart/ и https://flask.palletsprojects.com/en/stable/testing/.",
        "examples": [
          {
            "code": "from flask import Flask\napp=Flask('lesson',static_folder=None)\n@app.post('/notes')\ndef create():return {'id':1},201,{'Location':'/notes/1'}\n@app.delete('/notes/1')\ndef delete():return '',204\nc=app.test_client();created=c.post('/notes')\ndeleted=c.delete(created.headers['Location'])\nprint(created.status_code,created.headers['Location'])\nprint(deleted.status_code,len(deleted.data))",
            "output": "201 /notes/1\n204 0"
          }
        ]
      }
    ],
    "summary": [
      "Разделяйте путь, метод, query, JSON-схему и статус ответа.",
      "Фабрика создаёт свежий экземпляр; тестовый клиент вызывает настоящее приложение без порта.",
      "Шаблон остаётся неизменным, данные передаются отдельно; отказ не изменяет состояние.",
      "Учебная память и зелёные тесты не подтверждают БД, авторизацию, HTTPS или работу нескольких worker."
    ],
    "mistakes": [
      {
        "title": "Ошибка получила 200",
        "text": "Верните подходящий статус явно; JSON с error сам по себе не меняет статус."
      },
      {
        "title": "False приняли за количество",
        "text": "Проверьте точный тип и диапазон, не смешивайте ноль с отсутствием."
      },
      {
        "title": "Ввод стал частью шаблона",
        "text": "Передавайте текст отдельным параметром; не собирайте Jinja из данных."
      },
      {
        "title": "Тесты делят глобальный список",
        "text": "Создавайте экземпляры фабрикой и проверяйте независимость состояния."
      }
    ],
    "applications": [
      "Небольшое API остатков с проверкой изменений до записи.",
      "API заметок: создание, адрес ресурса, изменение флага и удаление.",
      "Локальные тесты маршрутов перед дальнейшей работой с БД и развёртыванием."
    ]
  }
});
