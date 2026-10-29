window.THEORY_ARTICLES=Object.assign(window.THEORY_ARTICLES || {},{
  "59": {
    "id": 59,
    "title": "HTTP и requests: предсказуемый клиент",
    "lead": "HTTP-клиент должен различать ответ сервера, неверные данные и ошибку соединения. Научимся передавать параметры и JSON, задавать таймауты и контролировать размер/адрес следующего запроса. Все реальные запросы учебных проверок идут к своему серверу на loopback внутри контейнера; внешняя сеть и настоящие API-ключи не нужны.",
    "sections": [
      {
        "title": "1. Запрос состоит из метода, адреса, заголовков и тела",
        "text": "HTTP разделяет метод, URL, заголовки и тело. GET обычно читает данные, POST передаёт действие или объект. Query — часть URL, а JSON — один из возможных форматов тела. Request.prepare строит запрос без отправки, поэтому можно отдельно проверить кодирование. В этой теме нет внешних сайтов: реальные запросы идут только к собственному учебному серверу в той же временной среде.",
        "examples": [
          {
            "code": "import requests\nfrom urllib.parse import urlsplit,parse_qs\nrequest=requests.Request('GET','https://learn.example/items',params={'q':'A&B +','limit':2}).prepare()\nprint(request.method)\nprint(parse_qs(urlsplit(request.url).query))",
            "output": "GET\n{'q': ['A&B +'], 'limit': ['2']}"
          }
        ]
      },
      {
        "title": "2. Настоящий HTTP внутри одной программы",
        "text": "Ниже маленький сервер слушает только 127.0.0.1 на свободном порту и обслуживает один GET. Клиент requests получает реальный Response. На платформе loopback принадлежит отдельному namespace контейнера; это не доступ к компьютеру ученика или интернету. Session.trust_env=False здесь делает локальную проверку независимой от proxy/netrc окружения. В корпоративной среде параметры proxy могут быть нужны: не отключайте их вслепую в рабочем клиенте. Код сервера нужен только этому автономному примеру, переписывать его для каждого запроса не требуется.",
        "examples": [
          {
            "code": "from http.server import BaseHTTPRequestHandler,HTTPServer\nfrom threading import Thread\nimport requests\nclass Handler(BaseHTTPRequestHandler):\n    def log_message(self,*args):pass\n    def do_GET(self):\n        body=b'{\"count\": 0}'\n        self.send_response(200)\n        self.send_header('Content-Type','application/json; charset=utf-8')\n        self.send_header('Content-Length',str(len(body)))\n        self.end_headers();self.wfile.write(body)\nserver=HTTPServer(('127.0.0.1',0),Handler)\nthread=Thread(target=server.handle_request,daemon=True);thread.start()\ntry:\n    with requests.Session() as session:\n        session.trust_env=False\n        response=session.get('http://127.0.0.1:'+str(server.server_port),timeout=(1,2),allow_redirects=False)\n        response.raise_for_status()\n        data=response.json()\n        print(response.status_code)\n        print(data['count'])\n\nfinally:\n    thread.join(1);server.server_close()",
            "output": "200\n0"
          }
        ]
      },
      {
        "title": "3. Успешный разбор JSON не доказывает успех HTTP",
        "text": "Ответ 404 или 503 может содержать совершенно корректный JSON с описанием ошибки. raise_for_status проверяет коды 4xx/5xx; json разбирает тело. Это независимые шаги. Не проверяйте Response через if response, если хотите узнать, существует ли объект: HTTP-ошибка делает его ложным в логическом контексте. Для наличия используйте is not None.",
        "examples": [
          {
            "code": "import requests\nr=requests.Response();r.status_code=404;r.url='https://learn.example/x';r._content=b'{\"error\":\"missing\"}'\nprint(bool(r),r is not None)\ntry:r.raise_for_status()\nexcept requests.HTTPError as error:print(error.response.status_code)\nprint(r.json()['error'])",
            "output": "False True\n404\nmissing"
          }
        ]
      },
      {
        "title": "4. json и data имеют разный смысл",
        "text": "json=payload сериализует структуру Python и задаёт Content-Type application/json. data со словарём обычно означает form-encoding; строка data сама по себе не сообщает серверу, что это JSON. Типы False, None и 0 не должны превратиться в текстовые значения. Подготовленный запрос позволяет проверить тело до отправки. Для больших файлов и потоков действуют отдельные правила, в этой теме payload небольшой.",
        "examples": [
          {
            "code": "import requests,json\nr=requests.Request('POST','https://learn.example/echo',json={'count':0,'active':False,'note':None}).prepare()\nprint(r.headers['Content-Type'])\nprint(json.loads(r.body))",
            "output": "application/json\n{'count': 0, 'active': False, 'note': None}"
          }
        ]
      },
      {
        "title": "5. Заголовок Content-Type — ещё одна часть контракта",
        "text": "Заголовки Response доступны через case-insensitive mapping. Content-Type может содержать параметры charset; для сравнения media type отделяют часть до ; и нормализуют регистр. Заголовок не делает произвольные bytes корректным JSON — синтаксис проверяется отдельно. Не принимайте application/json.evil за application/json по одному startswith.",
        "examples": [
          {
            "code": "import requests\nr=requests.Response();r.headers['Content-Type']='Application/JSON; charset=utf-8'\nprint(r.headers.get('content-type').split(';',1)[0].strip().lower())",
            "output": "application/json"
          }
        ]
      },
      {
        "title": "6. Session переиспользует настройки и соединения",
        "text": "Session хранит общие заголовки, cookies и connection pool. Переданная зависимость облегчает тестирование и не требует создавать новый клиент в каждой функции. Контекст with закрывает ресурсы. В примере запрос только подготавливается, секретов и отправки нет. Настоящие токены не печатайте и не записывайте в учебный код; для первого клиента они не нужны.",
        "examples": [
          {
            "code": "import requests\nwith requests.Session() as session:\n    session.headers['X-Course']='learn'\n    request=session.prepare_request(requests.Request('GET','https://learn.example/data'))\n    print(request.headers['X-Course'])",
            "output": "learn"
          }
        ]
      },
      {
        "title": "7. Два таймаута не являются общим секундомером",
        "text": "timeout=(connect,read) ограничивает установление соединения и ожидание новых данных, а не обязательно полную продолжительность всех действий. Общий лимит программы на платформе действует отдельно. Timeout и ConnectionError не равны успешному ответу с пустым списком. В этом примере adapter воспроизводит ошибку без настоящей задержки или сети.",
        "examples": [
          {
            "code": "import requests\nfrom requests.adapters import BaseAdapter\nclass TimeoutAdapter(BaseAdapter):\n    def send(self,*args,**kwargs):raise requests.Timeout('synthetic')\n    def close(self):pass\nwith requests.Session() as session:\n    session.trust_env=False;session.mount('https://learn.example/',TimeoutAdapter())\n    try:session.get('https://learn.example/data',timeout=(1,2))\n    except requests.Timeout:print('ошибка ожидания')",
            "output": "ошибка ожидания"
          }
        ]
      },
      {
        "title": "8. Redirect не является HTTP-ошибкой 4xx/5xx",
        "text": "GET requests обычно следует redirect автоматически. Для контроля адреса используйте allow_redirects=False и проверяйте Location отдельно. raise_for_status сам по себе не отвергает все 3xx. Если интерфейс требует ровно 200, это дополнительное правило программы. Схема/hostname/эффективный порт и credentials важнее подстроки в URL; проверенный адрес всё равно не является разрешением обращаться к произвольным внутренним сервисам.",
        "examples": [
          {
            "code": "import requests\nfrom urllib.parse import urljoin\nr=requests.Response();r.status_code=302;r.url='https://learn.example/start';r.headers['Location']='/next'\nr.raise_for_status()\nprint(r.status_code,r.is_redirect)\nprint(urljoin(r.url,r.headers['Location']))",
            "output": "302 True\nhttps://learn.example/next"
          }
        ]
      },
      {
        "title": "9. Лимит проверяется при чтении",
        "text": "stream=True откладывает загрузку тела. iter_content выдаёт блоки, размер которых учитывается фактически; Content-Length может отсутствовать или не отражать объём после декодирования. Проверка len(response.content) после полной загрузки не ограничивает само чтение. Закрывайте Response и при превышении лимита. В автономном примере raw — учебный поток памяти, не сокет.",
        "examples": [
          {
            "code": "from io import BytesIO\nimport requests\nr=requests.Response();r.raw=BytesIO(b'abcde');r.status_code=200\nsize=0\nfor block in r.iter_content(chunk_size=2):\n    if size+len(block)>4:\n        print('превышен лимит');break\n    size+=len(block)\nr.close()\nprint(size,r.raw.closed)",
            "output": "превышен лимит\n4 True"
          }
        ]
      },
      {
        "title": "10. Схема данных отличает ноль от пустоты",
        "text": "После транспорта и JSON нужен контракт предметных данных. Тип bool в Python связан с int, но в поле количества обычно не означает число штук. None и отсутствие ключа тоже могут иметь другой смысл. В функциях урока допустимые типы и границы объявлены явно; Pydantic из предыдущей темы может описать такой контракт, но сам факт JSON-ответа не гарантирует правильность значений.",
        "examples": [
          {
            "code": "for value in [0,None,True,'0']:\n    print(repr(value),type(value) is int)",
            "output": "0 True\nNone False\nTrue False\n'0' False"
          }
        ]
      },
      {
        "title": "11. Повтор POST может повторить действие",
        "text": "Timeout не доказывает, что сервер ничего не сделал: ответ мог потеряться после обработки. Автоматический повтор POST без продуманной идемпотентности опасен. У учебного adapter нет сети и реального действия; он показывает, что requests без дополнительной retry-настройки не обязан повторять такой вызов за вас. Для настоящего API правила повторов и idempotency key определяет его контракт.",
        "examples": [
          {
            "code": "import requests\nfrom requests.adapters import BaseAdapter\nclass UnknownOutcome(BaseAdapter):\n    calls=0\n    def send(self,*args,**kwargs):\n        self.calls+=1;raise requests.Timeout('outcome unknown')\n    def close(self):pass\nadapter=UnknownOutcome()\nwith requests.Session() as session:\n    session.trust_env=False;session.mount('https://learn.example/',adapter)\n    try:session.post('https://learn.example/action',json={'qty':2},timeout=(1,2))\n    except requests.Timeout:print(adapter.calls)",
            "output": "1"
          }
        ]
      },
      {
        "title": "12. Клиент сообщает данные, а не выдумывает ответ",
        "text": "Полный клиент соединяет транспорт, статус, media type, размер, JSON, схему и формат результата. Нулевое измерение не заменяется отсутствием, а сетевой отказ не превращается в правдоподобный прогноз. Ниже настоящий локальный HTTP возвращает вымышленные учебные данные. Для внешнего погодного сервиса позже потребуются его контракт, политика запросов и доступность; этот пример не сообщает реальную погоду.",
        "examples": [
          {
            "code": "from http.server import BaseHTTPRequestHandler,HTTPServer\nfrom threading import Thread\nimport requests\nclass Handler(BaseHTTPRequestHandler):\n    def log_message(self,*args):pass\n    def do_GET(self):\n        body=b'{\"city\": \"\\xd0\\xa3\\xd1\\x87\\xd0\\xb5\\xd0\\xb1\\xd0\\xbd\\xd1\\x8b\\xd0\\xb9\", \"temperature_c\": 0, \"condition\": \"\\xd1\\x8f\\xd1\\x81\\xd0\\xbd\\xd0\\xbe\"}'\n        self.send_response(200)\n        self.send_header('Content-Type','application/json; charset=utf-8')\n        self.send_header('Content-Length',str(len(body)))\n        self.end_headers();self.wfile.write(body)\nserver=HTTPServer(('127.0.0.1',0),Handler)\nthread=Thread(target=server.handle_request,daemon=True);thread.start()\ntry:\n    with requests.Session() as session:\n        session.trust_env=False\n        response=session.get('http://127.0.0.1:'+str(server.server_port),timeout=(1,2),allow_redirects=False)\n        response.raise_for_status()\n        data=response.json()\n        print(f\"{data['city']}: {data['temperature_c']:.1f} °C, {data['condition']}\")\n\nfinally:\n    thread.join(1);server.server_close()",
            "output": "Учебный: 0.0 °C, ясно"
          }
        ]
      }
    ],
    "summary": [
      "Разделяйте сетевой исход, HTTP-статус, формат тела и предметную схему.",
      "Параметры/JSON/таймаут/redirect/размер задаются явно; Response и Session закрываются.",
      "Учебные запросы идут только на свой loopback; реальные сайты и ключи не используются."
    ],
    "mistakes": [
      {
        "title": "Ошибку выдали за пустые данные",
        "text": "HTTPError/Timeout/ConnectionError и успешный [] — разные результаты."
      },
      {
        "title": "Размер проверили после загрузки",
        "text": "Считайте блоки iter_content до накопления всего тела."
      },
      {
        "title": "Слепо пошли по next/redirect",
        "text": "Проверьте адрес, origin, visited и число страниц до следующего запроса."
      }
    ],
    "applications": [
      "Учебный клиент пагинированного каталога с точными правилами.",
      "Погодный клиент на вымышленном локальном API с честной обработкой ошибок."
    ]
  }
});
