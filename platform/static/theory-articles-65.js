window.THEORY_ARTICLES=Object.assign(window.THEORY_ARTICLES || {},{
  "65": {
    "id": 65,
    "title": "Jinja2: шаблоны и HTML-отчёты",
    "lead": "Jinja2 отделяет разметку отчёта от данных. После первых Flask-страниц разберём самостоятельный Environment, циклы, макросы и наследование шаблонов. Финалы проверяют не только видимый текст, но и экранирование, нулевые значения, ошибки переменных и независимость двух отчётов. Шаблоны в этой теме написаны разработчиком; строки из данных никогда не исполняются как шаблоны. Autoescape защищает HTML-текст, но сам по себе не проверяет URL и не делает безопасным JavaScript.",
    "sections": [
      {
        "title": "1. Строка и контекст",
        "text": "Шаблон и данные передаются раздельно.",
        "examples": [
          {
            "code": "from jinja2 import Environment, DictLoader, StrictUndefined, UndefinedError, TemplateNotFound, select_autoescape\nprint(Environment(autoescape=True).from_string('Привет, {{ name }}!').render(name='Мира'))",
            "output": "Привет, Мира!"
          }
        ]
      },
      {
        "title": "2. Экранирование",
        "text": "Входное имя остаётся текстом внутри доверенного h1.",
        "examples": [
          {
            "code": "from jinja2 import Environment, DictLoader, StrictUndefined, UndefinedError, TemplateNotFound, select_autoescape\nprint(Environment(autoescape=True).from_string('<h1>{{ title }}</h1>').render(title='<A&B>'))",
            "output": "<h1>&lt;A&amp;B&gt;</h1>"
          }
        ]
      },
      {
        "title": "3. Цикл и пустота",
        "text": "У for есть else для пустого списка.",
        "examples": [
          {
            "code": "from jinja2 import Environment, DictLoader, StrictUndefined, UndefinedError, TemplateNotFound, select_autoescape\ntext='{% for x in items %}{{ x }};{% else %}пусто{% endfor %}'\ntemplate=Environment(autoescape=True).from_string(text)\nprint(template.render(items=[2,0]))\nprint(template.render(items=[]))",
            "output": "2;0;\nпусто"
          }
        ]
      },
      {
        "title": "4. Индекс цикла",
        "text": "loop.index начинается с единицы.",
        "examples": [
          {
            "code": "from jinja2 import Environment, DictLoader, StrictUndefined, UndefinedError, TemplateNotFound, select_autoescape\ntext='{% for name in names %}{{ loop.index }}:{{ name }};{% endfor %}'\nprint(Environment(autoescape=True).from_string(text).render(names=['А','Б']))",
            "output": "1:А;2:Б;"
          }
        ]
      },
      {
        "title": "5. Ключ словаря",
        "text": "Квадратные скобки явно обращаются к ключу, в том числе items.",
        "examples": [
          {
            "code": "from jinja2 import Environment, DictLoader, StrictUndefined, UndefinedError, TemplateNotFound, select_autoescape\ntext='{{ row[\"items\"] }} / {{ row[\"qty\"] }}'\nprint(Environment(autoescape=True).from_string(text).render(row={'items':'строки','qty':0}))",
            "output": "строки / 0"
          }
        ]
      },
      {
        "title": "6. Ноль и None",
        "text": "Проверка is none оставляет 0 на месте.",
        "examples": [
          {
            "code": "from jinja2 import Environment, DictLoader, StrictUndefined, UndefinedError, TemplateNotFound, select_autoescape\ntemplate=Environment(autoescape=True).from_string('{{ \"нет\" if qty is none else qty }}')\nprint(template.render(qty=0))\nprint(template.render(qty=None))",
            "output": "0\nнет"
          }
        ]
      },
      {
        "title": "7. Обязательные переменные",
        "text": "StrictUndefined делает пропущенное поле видимой ошибкой.",
        "examples": [
          {
            "code": "from jinja2 import Environment, DictLoader, StrictUndefined, UndefinedError, TemplateNotFound, select_autoescape\nenv=Environment(autoescape=True,undefined=StrictUndefined)\ntry:env.from_string('{{ name }}').render()\nexcept UndefinedError:print('Нет обязательного name')",
            "output": "Нет обязательного name"
          }
        ]
      },
      {
        "title": "8. Макрос",
        "text": "Разметка повторяется, пользовательский аргумент экранируется.",
        "examples": [
          {
            "code": "from jinja2 import Environment, DictLoader, StrictUndefined, UndefinedError, TemplateNotFound, select_autoescape\ntext='{% macro badge(x) %}<b>{{ x }}</b>{% endmacro %}{{ badge(label) }}'\nprint(Environment(autoescape=True).from_string(text).render(label='<new>'))",
            "output": "<b>&lt;new&gt;</b>"
          }
        ]
      },
      {
        "title": "9. Наследование",
        "text": "Дочерний шаблон заполняет block общего каркаса.",
        "examples": [
          {
            "code": "from jinja2 import Environment, DictLoader, StrictUndefined, UndefinedError, TemplateNotFound, select_autoescape\nenv=Environment(loader=DictLoader({'base.html':'<main>{% block body %}{% endblock %}</main>','page.html':'{% extends \"base.html\" %}{% block body %}{{ name }}{% endblock %}'}),autoescape=select_autoescape())\nprint(env.get_template('page.html').render(name='A&B'))",
            "output": "<main>A&amp;B</main>"
          }
        ]
      },
      {
        "title": "10. Расширения шаблонов",
        "text": "HTML и обычный текст имеют разные правила вывода.",
        "examples": [
          {
            "code": "from jinja2 import Environment, DictLoader, StrictUndefined, UndefinedError, TemplateNotFound, select_autoescape\nenv=Environment(loader=DictLoader({'a.html':'{{ x }}','a.txt':'{{ x }}'}),autoescape=select_autoescape())\nprint(env.get_template('a.html').render(x='<b>'))\nprint(env.get_template('a.txt').render(x='<b>'))",
            "output": "&lt;b&gt;\n<b>"
          }
        ]
      },
      {
        "title": "11. Итог заранее вычислен",
        "text": "Бизнес-вычисления остаются в Python, шаблон показывает результат.",
        "examples": [
          {
            "code": "from jinja2 import Environment, DictLoader, StrictUndefined, UndefinedError, TemplateNotFound, select_autoescape\nrows=[{'qty':2},{'qty':0},{'qty':5}]\ntext='Итого: {{ total }}'\nprint(Environment(autoescape=True).from_string(text).render(total=sum(r['qty'] for r in rows)))",
            "output": "Итого: 7"
          }
        ]
      },
      {
        "title": "12. Ошибка имени шаблона",
        "text": "Не выдавайте отсутствие шаблона за пустой успешный отчёт.",
        "examples": [
          {
            "code": "from jinja2 import Environment, DictLoader, StrictUndefined, UndefinedError, TemplateNotFound, select_autoescape\nenv=Environment(loader=DictLoader({}),autoescape=select_autoescape())\ntry:env.get_template('missing.html')\nexcept TemplateNotFound:print('Шаблон не найден')",
            "output": "Шаблон не найден"
          }
        ]
      }
    ],
    "summary": [
      "Шаблон — доверенный код, контекст — данные.",
      "Environment объединяет загрузчик, экранирование и поведение отсутствующих переменных.",
      "Autoescape защищает HTML-текст; для URL и JavaScript нужны отдельные правила.",
      "Ноль и пустой список отличаются от отсутствующего обязательного поля.",
      "Независимые фабрики получают собственные настройки и снимки шаблонов."
    ],
    "mistakes": [
      "Склеить пользовательское имя с кодом шаблона.",
      "Поставить safe на данные вместо исправления разметки.",
      "Заменить 0 через default(...,true).",
      "Не заметить опечатку из-за пустого Undefined.",
      "Разделить между двумя отчётами один глобальный Environment и скрыть ошибки."
    ],
    "applications": [
      "HTML-отчёты из уже проверенных Python-данных.",
      "Общие каркасы нескольких Flask-страниц.",
      "Небольшие шаблоны писем и текстовых отчётов."
    ]
  }
});
