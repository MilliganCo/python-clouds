window.THEORY_ARTICLES=Object.assign(window.THEORY_ARTICLES || {},{
  "58": {
    "id": 58,
    "title": "pydantic: проверка входных данных",
    "lead": "Словарь или JSON ещё не гарантирует правильные данные. Pydantic описывает поля и проверяет вход на границе программы. Разберём преобразование и строгий режим, обязательность, вложенные ошибки и экспорт; в финалах проверим пакет каталога и строки JSON с понятным журналом отказов.",
    "sections": [
      {
        "title": "1. Модель описывает поля",
        "text": "Pydantic v2 создаёт модели с проверкой входных данных. BaseModel использует аннотации полей; собственный __init__ для обычной модели писать не требуется. По умолчанию допускаются некоторые преобразования: подходящий текст может стать числом. Это полезная настройка интерфейса, но её нужно выбрать осознанно. На платформе пакет уже установлен; локально установите pydantic в нужный интерпретатор. Эта тема использует API v2: model_validate/model_dump, а не старые примеры v1 с parse_obj/dict.",
        "examples": [
          {
            "code": "from pydantic import BaseModel\nclass Parcel(BaseModel):\n    qty:int\nitem=Parcel(qty='3')\nprint(item.model_dump())\nprint(type(item.qty).__name__)",
            "output": "{'qty': 3}\nint"
          }
        ]
      },
      {
        "title": "2. Строгость задаётся явно",
        "text": "ConfigDict(strict=True) включает строгую проверку Python-типов модели, а Field(strict=True) или StrictInt задают её отдельному полю. Строка \"2\", float 2.0 и bool True не подходят для strict int. Не путайте это с Python isinstance(True,int): правила валидатора специально различают булево и целое. Строгость не означает неизменность объекта и имеет особенности режима JSON для дат, которые рассмотрены ниже.",
        "examples": [
          {
            "code": "from pydantic import BaseModel,ConfigDict,ValidationError\nclass Parcel(BaseModel):\n    model_config=ConfigDict(strict=True)\n    qty:int\ntry:\n    Parcel(qty=True)\nexcept ValidationError as error:\n    print(error.errors(include_url=False)[0]['type'])",
            "output": "int_type"
          }
        ]
      },
      {
        "title": "3. Ограничения отделены от типа",
        "text": "Целое число ещё может быть недопустимым количеством. Field задаёт ge/le для включённых границ и min_length/max_length для длины. Нулевой остаток отличается от отсутствующего поля. Выбирайте единицы заранее: целые копейки не требуют float. Проверяйте не только тип, но и диапазон, который действительно обещает интерфейс.",
        "examples": [
          {
            "code": "from pydantic import BaseModel,Field,ValidationError\nclass Quantity(BaseModel):\n    value:int=Field(strict=True,ge=0,le=10)\nprint(Quantity(value=0).value)\ntry:\n    Quantity(value=-1)\nexcept ValidationError as error:\n    print(error.errors(include_url=False)[0]['type'])",
            "output": "0\ngreater_than_equal"
          }
        ]
      },
      {
        "title": "4. Nullable и default решают разные задачи",
        "text": "str|None допускает None как значение. Чтобы поле можно было не передавать, нужен default, например =None. Поле без default остаётся обязательным даже с nullable-аннотацией. Значение по умолчанию не должно маскировать переданный неверный тип. model_fields позволяет посмотреть структуру модели, но обычная программа чаще просто проверяет вход и обрабатывает ValidationError.",
        "examples": [
          {
            "code": "from pydantic import BaseModel\nclass Settings(BaseModel):\n    required_note:str|None\n    note:str|None=None\nprint(Settings.model_fields['required_note'].is_required(),Settings.model_fields['note'].is_required())\nprint(Settings(required_note=None).model_dump())",
            "output": "True False\n{'required_note': None, 'note': None}"
          }
        ]
      },
      {
        "title": "5. Лишние поля не всегда вызывают ошибку",
        "text": "По умолчанию лишние поля могут игнорироваться. Для строгого внешнего контракта extra=\"forbid\" помогает заметить опечатку или неожиданную структуру, extra=\"allow\" имеет другой смысл. Настройка внешней модели не обязана автоматически менять внутреннюю модель: объявляйте политику на нужном уровне. Проверка типа сама по себе не доказывает корректность бизнес-фактов или безопасность текста для HTML.",
        "examples": [
          {
            "code": "from pydantic import BaseModel,ConfigDict,ValidationError\nclass Normal(BaseModel):\n    qty:int\nclass Closed(BaseModel):\n    model_config=ConfigDict(extra='forbid')\n    qty:int\nprint(Normal(qty=1,debug=True).model_dump())\ntry:\n    Closed(qty=1,debug=True)\nexcept ValidationError as error:\n    print(error.errors(include_url=False)[0]['type'])",
            "output": "{'qty': 1}\nextra_forbidden"
          }
        ]
      },
      {
        "title": "6. Нормализация должна предшествовать проверке длины",
        "text": "field_validator(mode=\"before\") получает вход до проверки типа и ограничений. Поэтому прежде чем вызвать strip, проверьте, что передана строка; другой тип верните валидатору типов без ручного угадывания. Ограничение min_length/max_length затем применяется к нормализованному значению. Валидатор после проверки типа удобен для правил, которым уже нужен известный тип. ValueError обозначает нарушение значения; случайный TypeError программы не нужно скрывать.",
        "examples": [
          {
            "code": "from pydantic import BaseModel,ConfigDict,Field,field_validator\nclass Person(BaseModel):\n    model_config=ConfigDict(strict=True)\n    name:str=Field(min_length=1,max_length=4)\n    @field_validator('name',mode='before')\n    @classmethod\n    def clean(cls,value):\n        return value.strip() if isinstance(value,str) else value\nprint(Person(name='      Аня      ').name)",
            "output": "Аня"
          }
        ]
      },
      {
        "title": "7. TypeAdapter работает без отдельного BaseModel",
        "text": "Когда нужен список, словарь или другой описанный тип, TypeAdapter позволяет проверить его напрямую. Annotated связывает тип с ограничениями. strict=True у проверки контейнера не превращает tuple в list. Ошибка элемента содержит его индекс в loc, поэтому можно указать точное место в наборе. Возвращается проверенный результат; входной контейнер не нужно исправлять на месте.",
        "examples": [
          {
            "code": "from pydantic import TypeAdapter,StrictInt,ValidationError\nadapter=TypeAdapter(list[StrictInt])\nprint(adapter.validate_python([0,2],strict=True))\ntry:\n    adapter.validate_python([0,'2'],strict=True)\nexcept ValidationError as error:\n    print(error.errors(include_url=False)[0]['loc'])",
            "output": "[0, 2]\n(1,)"
          }
        ]
      },
      {
        "title": "8. Вложенная ошибка сохраняет путь",
        "text": "Модель элемента переиспользуется внутри списка другой модели. ValidationError сообщает не только имя поля, но и путь через контейнеры: например items, индекс записи, qty. Это позволяет не гадать, какую из нескольких строк нужно исправить. В финале весь пакет отклоняется при любом нарушении, а в построчном журнале каждая JSON-строка проверяется независимо — политику частичного принятия выбирает программа.",
        "examples": [
          {
            "code": "from pydantic import BaseModel,ConfigDict,ValidationError\nclass Item(BaseModel):\n    model_config=ConfigDict(strict=True)\n    qty:int\nclass Batch(BaseModel):\n    items:list[Item]\ntry:\n    Batch.model_validate({'items':[{'qty':1},{'qty':True}]})\nexcept ValidationError as error:\n    print(error.errors(include_url=False)[0]['loc'])\n    print(error.errors(include_url=False)[0]['type'])",
            "output": "('items', 1, 'qty')\nint_type"
          }
        ]
      },
      {
        "title": "9. Экспорт выбирается под получателя",
        "text": "model_dump возвращает словарь с Python-типами, model_dump(mode=\"json\") — словарь с JSON-совместимыми значениями. model_dump_json возвращает уже сериализованный JSON-текст. Для даты это различие видно сразу: Python date и ISO-строка — разные результаты. Не преобразовывайте всё через str: так легко потерять структуру списков, None и чисел. Для сохранения JSON выбирайте явный режим.",
        "examples": [
          {
            "code": "from datetime import date\nfrom pydantic import BaseModel\nclass Event(BaseModel):\n    day:date\nevent=Event(day=date(2026,10,20))\nprint(type(event.model_dump()['day']).__name__)\nprint(event.model_dump_json())",
            "output": "date\n{\"day\":\"2026-10-20\"}"
          }
        ]
      },
      {
        "title": "10. Strict JSON учитывает представления формата",
        "text": "JSON имеет строки, числа, логические значения, null, массивы и объекты, но не Python date. Поэтому строгая JSON-проверка даты может принять её ISO-строку, тогда как strict Python требует date. Это не общее разрешение преобразовывать любые строки: strict int из JSON по-прежнему отвергает \"2\". При проектировании интерфейса указывайте и тип, и формат входа.",
        "examples": [
          {
            "code": "from datetime import date\nfrom pydantic import TypeAdapter,ValidationError\nprint(TypeAdapter(date).validate_json('\"2026-10-20\"',strict=True).isoformat())\ntry:\n    TypeAdapter(int).validate_json('\"2\"',strict=True)\nexcept ValidationError as error:\n    print(error.errors(include_url=False)[0]['type'])",
            "output": "2026-10-20\nint_type"
          }
        ]
      },
      {
        "title": "11. Проверенная модель не означает вечную неизменность",
        "text": "Обычная проверка выполняется на входе. Если затем менять поля, без validate_assignment изменения могут не проходить те же проверки. ConfigDict(validate_assignment=True) включает проверку присваивания. frozen запрещает присваивания полям, но сам по себе не делает каждый вложенный список глубоко неизменяемым. Не используйте model_construct для недоверенных данных: этот метод намеренно обходит обычную валидацию.",
        "examples": [
          {
            "code": "from pydantic import BaseModel,ConfigDict,Field,ValidationError\nclass Counter(BaseModel):\n    model_config=ConfigDict(validate_assignment=True)\n    value:int=Field(ge=0)\nitem=Counter(value=1)\ntry:\n    item.value=-1\nexcept ValidationError:\n    print('изменение отклонено')\nprint(item.value)",
            "output": "изменение отклонено\n1"
          }
        ]
      },
      {
        "title": "12. Журнал ошибки не обязан копировать исходный ввод",
        "text": "errors() содержит структуру нарушения. Для интерфейса или журнала часто достаточно loc и type. Входные значения, context, URL и полный текст исключения могут быть лишними; они не нужны финалу построчного импорта. JSON-синтаксис даёт json_invalid, отсутствие обязательного поля — missing, неправильный строгий тип — int_type/string_type. Сохраняйте исходный номер строки до пропуска пустоты и обрабатывайте только ValidationError, не скрывая ошибки собственного алгоритма.",
        "examples": [
          {
            "code": "from pydantic import BaseModel,ConfigDict,ValidationError\nclass Row(BaseModel):\n    model_config=ConfigDict(strict=True)\n    qty:int\ntry:\n    Row(qty='секретный текст')\nexcept ValidationError as error:\n    items=error.errors(include_input=False,include_context=False,include_url=False)\n    print([{'field':'.'.join(map(str,item['loc'])),'type':item['type']} for item in items])\n    print('input' in items[0])",
            "output": "[{'field': 'qty', 'type': 'int_type'}]\nFalse"
          }
        ]
      }
    ],
    "summary": [
      "Выбирайте преобразование или строгий режим явно; ограничения и обязательность задаются отдельно.",
      "Нормализуйте до проверки длины, сохраняйте типы и точные строковые идентификаторы.",
      "Ошибки имеют путь и тип; экспорт и состав журнала выбираются под контракт получателя."
    ],
    "mistakes": [
      {
        "title": "Nullable приняли за необязательность",
        "text": "Разрешение None и значение по умолчанию объявляются отдельно."
      },
      {
        "title": "Вложенная модель приняла лишнее поле",
        "text": "Проверьте strict/extra на каждом уровне и тип контейнера."
      },
      {
        "title": "В журнал попали исходные значения",
        "text": "Возвращайте только нужные loc/type и номер строки, не весь ValidationError."
      }
    ],
    "applications": [
      "Проверка пакета каталога на границе программы.",
      "Построчный JSON-импорт с понятным журналом отказов без копирования входных значений."
    ]
  }
});
