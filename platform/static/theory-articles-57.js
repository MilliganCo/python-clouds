window.THEORY_ARTICLES=Object.assign(window.THEORY_ARTICLES || {},{
  "57": {
    "id": 57,
    "title": "BeautifulSoup: данные из HTML",
    "lead": "HTML описывает дерево элементов, а не готовый список записей. Научимся выбирать нужные узлы, читать текст и атрибуты, не смешивать соседние карточки и проверять границы входных данных. Все страницы в этой теме — небольшие учебные строки: сеть и выполнение JavaScript не нужны.",
    "sections": [
      {
        "title": "1. Парсер строит дерево, не запускает страницу",
        "text": "BeautifulSoup превращает HTML-строку в дерево узлов. В этой теме явно выбирается встроенный html.parser: другой парсер может иначе восстановить повреждённую разметку. Библиотека не является браузером, не выполняет JavaScript, не рассчитывает CSS-видимость и сама не загружает сайт. Разбор маленькой учебной строки воспроизводим без сети. На платформе пакет установлен; локально устанавливается beautifulsoup4, а импортируется bs4. Различайте имя пакета для pip и имя модуля Python.",
        "examples": [
          {
            "code": "from bs4 import BeautifulSoup\npage=BeautifulSoup('<h1>Каталог</h1><p>Две записи</p>','html.parser')\nprint(page.h1.name)\nprint(page.h1.get_text())",
            "output": "h1\nКаталог"
          }
        ]
      },
      {
        "title": "2. find и select отличаются количеством результатов",
        "text": "find/select_one возвращают один первый узел или None; find_all/select — коллекцию, которая может быть пустой. Отсутствие узла проверяется до вызова его методов. Если по контракту нужен ровно один элемент, первый найденный узел недостаточен: получите коллекцию и проверьте длину. Так дубль цены или заголовка не будет молча принят как однозначная запись.",
        "examples": [
          {
            "code": "from bs4 import BeautifulSoup\npage=BeautifulSoup('<h2>A</h2><h2>B</h2>','html.parser')\nprint(len(page.select('h2')))\nprint(page.select_one('h3') is None)",
            "output": "2\nTrue"
          }
        ]
      },
      {
        "title": "3. CSS-селектор задаёт контекст",
        "text": "article h2 выбирает h2 на любой глубине внутри article, article > h2 — только непосредственного ребёнка. .title выбирает токен класса, #main — id, a[href] — ссылки с атрибутом href. Сначала определите границу нужной области, затем выбирайте поля. Глобальный h2 может включать рекламу, меню и соседний блок. Селектор описывает структуру, а не смысл сайта: если разметка изменилась, результат нужно проверить.",
        "examples": [
          {
            "code": "from bs4 import BeautifulSoup\npage=BeautifulSoup('<h2>Реклама</h2><article><h2>A</h2><div><h2>B</h2></div></article>','html.parser')\nprint([n.get_text() for n in page.select('article h2')])\nprint([n.get_text() for n in page.select('article > h2')])",
            "output": "['A', 'B']\n['A']"
          }
        ]
      },
      {
        "title": "4. get_text управляет разделителями",
        "text": "string подходит для одной текстовой части, но у смешанного содержимого может быть None. get_text собирает дочерний текст. Параметр separator вставляет разделитель между частями, strip убирает пробелы у каждой части. Это может добавить пробел перед пунктуацией; выбирайте правило под контракт данных, а не под красивое предположение о странице. Извлечённый текст не является автоматически безопасной HTML-разметкой.",
        "examples": [
          {
            "code": "from bs4 import BeautifulSoup\np=BeautifulSoup('<p>Чай <b>чёрный</b>!</p>','html.parser').p\nprint(p.string)\nprint(p.get_text(' ',strip=True))\nprint(p.get_text('',strip=True))",
            "output": "None\nЧай чёрный !\nЧайчёрный!"
          }
        ]
      },
      {
        "title": "5. Атрибут может отсутствовать",
        "text": "node[\"href\"] вызывает KeyError, если атрибута нет. node.get(\"href\") возвращает None, а значение по умолчанию можно задать вторым аргументом. Наличие атрибута ещё не гарантирует непустую строку. class обычно представлен списком токенов. Для произвольного data-* атрибута имя передаётся строкой, например get(\"data-sku\"). Не преобразуйте текстовый код в число: leading zero может быть частью идентификатора.",
        "examples": [
          {
            "code": "from bs4 import BeautifulSoup\npage=BeautifulSoup('<a>A</a><div class=\"product active\" data-sku=\"0012\"></div>','html.parser')\nprint(page.a.get('href'))\nprint(page.div['class'])\nprint(page.div.get('data-sku'))",
            "output": "None\n['product', 'active']\n0012"
          }
        ]
      },
      {
        "title": "6. HTML-сущности не нужно разбирать второй раз",
        "text": "Парсер декодирует &amp; в &, &nbsp; в неразрывный пробел и &lt; в <. Декодированный текст не вставляется повторно в дерево как новые теги. Это полезно при чтении названий и query-строк. Неразрывный пробел отличается от обычного символом, даже когда выглядит похоже. При построении собственного HTML экранируйте текст заново: BeautifulSoup не является универсальным санитайзером.",
        "examples": [
          {
            "code": "from bs4 import BeautifulSoup\np=BeautifulSoup('<p>A&amp;B&nbsp;&lt;i&gt;</p>','html.parser').p\nprint(p.get_text().replace('\\xa0',' '))\nprint(len(p.find_all('i')))",
            "output": "A&B <i>\n0"
          }
        ]
      },
      {
        "title": "7. Поля ищутся внутри одной записи",
        "text": "Когда у второй карточки нет цены, нельзя просто соединить общий список заголовков с общим списком цен через zip: поля перестанут соответствовать друг другу. Итерируйте карточки и внутри каждой ищите её поля. Входная строка HTML остаётся прежней, но дерево можно изменять; если вы удаляете узлы, делайте это осознанно. В примере отсутствующая цена видна явно, а не заимствуется у следующего товара.",
        "examples": [
          {
            "code": "from bs4 import BeautifulSoup\npage=BeautifulSoup('<div class=\"product\"><b class=\"title\">A</b><i class=\"price\">1,00</i></div><div class=\"product\"><b class=\"title\">B</b></div>','html.parser')\nfor card in page.select('.product'):\n    price=card.select_one('.price')\n    print(card.select_one('.title').get_text(),price.get_text() if price else None)",
            "output": "A 1,00\nB None"
          }
        ]
      },
      {
        "title": "8. Цена — сначала формат, затем точное число",
        "text": "Извлечённая цена пока является текстом. Укажите разрешённые пробелы, знак валюты, десятичный разделитель и число цифр. В задачах допустима запятая и две цифры копеек, рубли ограничены 30 цифрами. Целочисленное вычисление не теряет копейки у больших чисел. Float удобен для приближённых измерений, но не нужен для точного разбора этой строки. Не удаляйте все нецифровые символы без проверки: так неверный минус или мусор могут превратиться в другую цену.",
        "examples": [
          {
            "code": "from bs4 import BeautifulSoup\ntext=BeautifulSoup('<span class=\"price\">1&nbsp;234,50 ₽</span>','html.parser').span.get_text()\ntext=text.replace(' ','').replace('\\xa0','').removesuffix('₽')\nrubles,kopeks=text.split(',')\nprint(int(rubles)*100+int(kopeks))",
            "output": "123450"
          }
        ]
      },
      {
        "title": "9. urljoin не является проверкой политики адреса",
        "text": "urljoin разрешает относительные пути по базовому URL. urlsplit позволяет отдельно проверить схему, hostname, порт, учётные данные, query и fragment. JavaScript, mailto и data не становятся HTTP только от вызова urljoin. Наличие hostname тоже не означает разрешение на сетевой доступ: внутренние адреса и политика SSRF — отдельная задача будущего клиента. Сейчас мы только обрабатываем строки локально.",
        "examples": [
          {
            "code": "from urllib.parse import urljoin,urlsplit\nurl=urljoin('https://shop.example/catalog/index.html','../p/1?q=2#details')\nparts=urlsplit(url)\nprint(parts.scheme,parts.hostname)\nprint(parts._replace(fragment='').geturl())",
            "output": "https shop.example\nhttps://shop.example/p/1?q=2"
          }
        ]
      },
      {
        "title": "10. Origin включает схему и эффективный порт",
        "text": "Для сравнения origin нужны scheme, hostname и порт. Если порт отсутствует, HTTP использует 80, HTTPS — 443. Явный 443 у HTTPS совпадает с отсутствующим портом; ноль не означает отсутствие. Проверка через подстроку \"shop.example\" пропустила бы shop.example.evil. Регистр hostname нормализуется URL-парсером; путь при этом остаётся чувствительным к регистру. Для неправильного порта свойство .port может вызвать ValueError.",
        "examples": [
          {
            "code": "from urllib.parse import urlsplit\ndef origin(url):\n    p=urlsplit(url)\n    return p.scheme,p.hostname,p.port if p.port is not None else (443 if p.scheme=='https' else 80)\nprint(origin('https://shop.example')==origin('https://shop.example:443/p'))\nprint(origin('https://shop.example:0')==origin('https://shop.example'))",
            "output": "True\nFalse"
          }
        ]
      },
      {
        "title": "11. Таблица имеет собственную структуру",
        "text": "Для простой таблицы сначала проверьте количество столбцов и заголовок. recursive=False позволяет взять только непосредственные ячейки строки и не захватить чужую вложенную структуру. thead/tbody меняют родителей строк, поэтому ищите строки внутри выбранной таблицы, а не только на первом уровне. Rowspan/colspan требуют отдельных правил: в финале неподдерживаемое объединение отклоняется вместо угадывания.",
        "examples": [
          {
            "code": "from bs4 import BeautifulSoup\ntable=BeautifulSoup('<table><thead><tr><th>День</th><th>Часы</th></tr></thead><tbody><tr><td>Пн</td><td>0</td></tr></tbody></table>','html.parser').table\nfor row in table.find_all('tr'):\n    print([c.get_text(strip=True) for c in row.find_all(['th','td'],recursive=False)])",
            "output": "['День', 'Часы']\n['Пн', '0']"
          }
        ]
      },
      {
        "title": "12. Неполная запись и дубль требуют явного решения",
        "text": "Определите политику пропусков: каталог может пропускать плохую карточку, а расписание — отклонять всю неверную таблицу. Для дублей важно, когда ключ попадает в seen. Если добавить его до проверки обязательных полей, неполная запись скрывает следующую хорошую. В проверках нужны отсутствующий средний узел, повтор, ноль, сущность, относительный адрес, другой origin и неверный заголовок. Успешный пример с одной идеальной карточкой не доказывает правильность извлечения.",
        "examples": [
          {
            "code": "seen=set();result=[]\nfor sku,title in [('A',''),('A','Готово'),('A','Позже')]:\n    if not title or sku in seen:continue\n    seen.add(sku);result.append((sku,title))\nprint(result)",
            "output": "[('A', 'Готово')]"
          }
        ]
      }
    ],
    "summary": [
      "Сначала выберите границу записи, затем читайте её поля.",
      "Пропуски, неоднозначность, форматы и дубли проверяются явно.",
      "Локальный HTML-парсер не запускает JS, не санитизирует всё содержимое и не разрешает сетевой доступ."
    ],
    "mistakes": [
      {
        "title": "Смешались поля соседей",
        "text": "Не соединяйте глобальные списки через zip; извлекайте внутри контейнера записи."
      },
      {
        "title": "Первый найденный узел приняли за единственный",
        "text": "Если контракт требует ровно один элемент, проверьте длину коллекции."
      },
      {
        "title": "URL проверили подстрокой",
        "text": "Разберите компоненты; origin включает схему и эффективный порт."
      }
    ],
    "applications": [
      "Извлечение каталога из учебной сохранённой страницы.",
      "Чтение простой таблицы с проверкой структуры и точных значений."
    ]
  }
});
