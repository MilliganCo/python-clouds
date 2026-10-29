/* openpyxl: independently executable examples, CPython 3.14 verified. */
window.THEORY_ARTICLES=Object.assign(window.THEORY_ARTICLES || {}, {
  "56": {
    "id": 56,
    "title": "openpyxl: отчёты Excel без потери исходника",
    "lead": "Excel-файл — это книга с листами, значениями, формулами и оформлением. Научимся создавать и читать небольшие XLSX, сохранять текстовые артикулы и нули, оформлять результат и проверять новую копию. В финале очистим учебную выгрузку с журналом отказов и построим отчёт с формулами.",
    "sections": [
      {
        "title": "1. Книга, лист и ячейка",
        "text": "openpyxl работает с файлами XLSX без установленного Excel. Workbook — книга, Worksheet — лист, Cell — ячейка. Новая Workbook содержит лист Sheet; active выбирает активный лист. Адрес B2 обозначает второй столбец и вторую строку. Нумерация в cell(row=…, column=…) начинается с 1. В value хранится значение ячейки, title задаёт имя листа. Не путайте имя файла и имя листа. На платформе библиотека уже установлена в серверном Python; в локальном окружении используется python -m pip install openpyxl. Эта тема работает с небольшими учебными книгами без макросов, рисунков и внешних связей.",
        "examples": [
          {
            "code": "from openpyxl import Workbook\nbook = Workbook()\npage = book.active\npage.title = 'Заказы'\npage['B2'] = 9\nprint(book.sheetnames)\nprint(page.cell(row=2,column=2).value)",
            "output": "['Заказы']\n9"
          }
        ]
      },
      {
        "title": "2. append добавляет строку, iter_rows читает диапазон",
        "text": "append принимает последовательность значений и добавляет строку снизу. iter_rows возвращает строки выбранного диапазона; min_row=2 позволяет пропустить заголовок. values_only=True даёт значения, без него приходят объекты Cell. Для учебной таблицы явно задавайте max_col: случайно оформленная пустая ячейка далеко справа может расширить рабочий диапазон. max_row отражает сохранённые ячейки и оформление, а не всегда число содержательных записей. Поэтому правила пустых строк задаются контрактом задачи.",
        "examples": [
          {
            "code": "from openpyxl import Workbook\npage = Workbook().active\npage.append(['Товар','Штук'])\npage.append(['чай',2])\npage.append(['кофе',0])\nprint(list(page.iter_rows(min_row=2,max_col=2,values_only=True)))",
            "output": "[('чай', 2), ('кофе', 0)]"
          }
        ]
      },
      {
        "title": "3. Идентификаторы и текст с =",
        "text": "Артикул 0012 — текстовый код, не число 12. Превращение кода в int теряет ведущие нули; числовой формат потом не восстанавливает исходные данные. openpyxl распознаёт строки, начинающиеся с =, как формулы. Если по контракту это буквальный текст, установите data_type=\"s\" после присваивания. Так текст не становится выражением Excel. Проверяйте тип после сохранения и повторного открытия файла, а не только видимую надпись.",
        "examples": [
          {
            "code": "from io import BytesIO\nfrom openpyxl import Workbook, load_workbook\nbook = Workbook()\nbook.active['A1']='0012'\nbook.active['A2']='=1+1'\nbook.active['A2'].data_type='s'\nstream=BytesIO();book.save(stream)\npage=load_workbook(BytesIO(stream.getvalue())).active\nprint(page['A1'].value,page['A1'].data_type)\nprint(page['A2'].value,page['A2'].data_type)",
            "output": "0012 s\n=1+1 s"
          }
        ]
      },
      {
        "title": "4. Сохраните новую копию и откройте её снова",
        "text": "save записывает книгу в файл или бинарный поток. Обычный save(filename) может перезаписать существующий файл без подтверждения. Для новой копии выбирайте отдельное имя и открывайте его через режим xb: если путь уже существует, создание откажет. Ошибка записи может оставить частичный новый файл — это не гарантия атомарности. BytesIO хранит учебный XLSX в памяти; getvalue() возвращает bytes, которые затем можно передать другой функции или сохранить. Не проверяйте XLSX сравнением всех байтов: служебная структура архива может различаться. Сравнивайте повторно открытые листы и ячейки.",
        "examples": [
          {
            "code": "from io import BytesIO\nfrom openpyxl import Workbook, load_workbook\nbook=Workbook();book.active['A1']='копия'\nstream=BytesIO();book.save(stream)\ndata=stream.getvalue()\nprint(isinstance(data,bytes))\nprint(load_workbook(BytesIO(data)).active['A1'].value)",
            "output": "True\nкопия"
          }
        ]
      },
      {
        "title": "5. Пустота и ноль — разные значения",
        "text": "Пустая ячейка обычно читается как None. Количество 0 означает известное отсутствие остатка, его нельзя терять проверкой if qty. Текст \"0\" и число 0 различаются типом. bool тоже не всегда допустим в числовой колонке: isinstance(True, int) истинно, поэтому при строгом контракте используется type(value) is int. В Excel числовые ячейки не имеют отдельного типа Python int/float: целое значение 2.0 после сохранения может читаться как int. Проверяйте загруженные значения и не угадывайте данные по оформлению.",
        "examples": [
          {
            "code": "from openpyxl import Workbook\npage=Workbook().active\npage.append(['A',0])\npage.append(['B',None])\nprint([(sku,qty) for sku,qty in page.values if qty is not None])\nprint(isinstance(True,int),type(True) is int)",
            "output": "[('A', 0)]\nTrue False"
          }
        ]
      },
      {
        "title": "6. Формула и сохранённый результат",
        "text": "Формула записывается строкой с =, названия функций в файле используются на английском, например SUM. openpyxl не является вычислительным движком Excel: новая формула не получает рассчитанный результат. data_only=False читает выражение, data_only=True — последний сохранённый кэш. Он может отсутствовать или быть устаревшим. Для изменения и сохранения книги с формулами загружайте выражения, а копию для чтения кэша не записывайте поверх исходника. Открытие в Excel/LibreOffice может пересчитать формулы, но это отдельное действие вне Python.",
        "examples": [
          {
            "code": "from io import BytesIO\nfrom openpyxl import Workbook, load_workbook\nbook=Workbook();book.active['A1']=2;book.active['A2']=3\nbook.active['A3']='=SUM(A1:A2)'\nstream=BytesIO();book.save(stream);data=stream.getvalue()\nprint(load_workbook(BytesIO(data),data_only=False).active['A3'].value)\nprint(load_workbook(BytesIO(data),data_only=True).active['A3'].value)",
            "output": "=SUM(A1:A2)\nNone"
          }
        ]
      },
      {
        "title": "7. Формат меняет показ, шрифт копируется перед изменением",
        "text": "number_format=\"0.00\" задаёт показ двух десятичных знаков. Само value не округляется и не превращается в строку. Для сумм в целых копейках можно использовать #,##0: разделитель тысяч без дробной части. Компоненты стиля разделяются ячейками и защищены от изменения на месте. Скопируйте font, измените нужное свойство и присвойте новый объект. Это сохраняет другие свойства шрифта, например italic или цвет. Не назначайте весь новый Font, когда требуется изменить только bold и сохранить оформление.",
        "examples": [
          {
            "code": "from copy import copy\nfrom openpyxl import Workbook\nfrom openpyxl.styles import Font\npage=Workbook().active;page['A1']='Цена'\npage['A1'].font=Font(italic=True)\nfont=copy(page['A1'].font);font.bold=True;page['A1'].font=font\npage['A2']=12.5;page['A2'].number_format='0.00'\nprint(page['A1'].font.bold,page['A1'].font.italic)\nprint(page['A2'].value,page['A2'].number_format)",
            "output": "True True\n12.5 0.00"
          }
        ]
      },
      {
        "title": "8. Закрепление заголовка и диапазон фильтра",
        "text": "freeze_panes=\"A2\" оставляет строку 1 над прокруткой. auto_filter.ref указывает диапазон с заголовком и данными, например A1:C5. Настройка фильтра не меняет список записей в Python: она даёт Excel возможность отфильтровать строки при просмотре. Итоговую строку обычно выносят за диапазон данных. Если записей нет, диапазон включает только заголовок. Убедитесь, что итоговая формула не включает свою собственную ячейку.",
        "examples": [
          {
            "code": "from openpyxl import Workbook\npage=Workbook().active\npage.append(['Товар','Штук']);page.append(['чай',2])\npage.freeze_panes='A2';page.auto_filter.ref='A1:B2'\nprint(page.freeze_panes,page.auto_filter.ref)\nprint(list(page.values))",
            "output": "A2 A1:B2\n[('Товар', 'Штук'), ('чай', 2)]"
          }
        ]
      },
      {
        "title": "9. Копирование листа имеет границы",
        "text": "copy_worksheet создаёт копию обычного листа внутри той же книги. Оно не переносит произвольный лист в другую Workbook и не гарантирует копирование рисунков или диаграмм. Сложные исходники с VBA, внешними связями, сводными объектами и расширенным оформлением требуют отдельной проверки. Для учебных функций ниже используются обычные листы, значения, формулы и базовые стили. Всегда работайте с новой копией исходного файла и проверяйте результат после сохранения. Не выдавайте этот учебный сценарий за универсальное безупречное редактирование любых Excel-файлов.",
        "examples": [
          {
            "code": "from openpyxl import Workbook\nbook=Workbook();page=book.active;page.title='Данные';page['A1']=7\ncopy=book.copy_worksheet(page);copy.title='Копия';copy['A1']=9\nprint(book.sheetnames)\nprint(book['Данные']['A1'].value,book['Копия']['A1'].value)",
            "output": "['Данные', 'Копия']\n7 9"
          }
        ]
      },
      {
        "title": "10. Даты тоже имеют тип",
        "text": "В ячейку можно записать datetime.date или datetime.datetime и задать числовой формат даты. После сохранения и открытия значение может стать datetime с полуночью. Не определяйте дату только по надписи на экране и не сортируйте даты как произвольные строки. В этой теме используется обычная календарная дата без часовых поясов; она не обозначает момент времени в конкретной стране. Для файлов с другой системой дат или сложными временными данными нужны дополнительные проверки.",
        "examples": [
          {
            "code": "from datetime import date\nfrom io import BytesIO\nfrom openpyxl import Workbook, load_workbook\nbook=Workbook();book.active['A1']=date(2026,10,20)\nbook.active['A1'].number_format='yyyy-mm-dd'\nstream=BytesIO();book.save(stream)\ncell=load_workbook(BytesIO(stream.getvalue())).active['A1']\nprint(cell.value.date().isoformat())\nprint(cell.number_format)",
            "output": "2026-10-20\nyyyy-mm-dd"
          }
        ]
      },
      {
        "title": "11. Собственная папка и явное скачивание",
        "text": "На платформе файл живёт только в своём одноразовом контейнере. Создайте и сохраните его одной программой, затем явно вызовите <code>from pycloud import export_file</code> и <code>export_file(\"report.xlsx\")</code>. Ссылка «Скачать» появится под выводом. Можно передать до трёх XLSX/PNG: 256 КиБ на файл и 512 КиБ всего. Переход на другую страницу, выход и новый запуск очищают ссылки, поэтому скачайте результат сразу. Помощник pycloud существует только на платформе; в локальной IDE достаточно сохранить новый файл и открыть свою копию. Это скачивание результата, не загрузка ваших личных файлов в контейнер.",
        "examples": [
          {
            "code": "from pathlib import Path\nfrom openpyxl import Workbook, load_workbook\nbook=Workbook();book.active['A1']='готово'\npath=Path('report.xlsx')\nwith path.open('xb') as file:\n    book.save(file)\nprint(path.exists())\nprint(load_workbook(path).active['A1'].value)",
            "output": "True\nготово"
          }
        ]
      },
      {
        "title": "12. Проверка отчёта после сохранения",
        "text": "Хорошая проверка XLSX открывает сохранённые bytes заново и сравнивает смысл: имена листов, типы, значения, выражения формул, диапазоны и стили. Один красивый print не доказывает качество файла. Для очистки полезны ноль, пропуск, неверный тип, пустая таблица, повторный артикул и текстовый код с ведущими нулями. В журнале отказов сохраняйте исходный номер строки и понятную причину. Для отчёта отдельно проверьте строку итога и отсутствие круговой ссылки. Готовый результат можно скачать и посмотреть в Excel/LibreOffice, сохраняя исходную книгу отдельно.",
        "examples": [
          {
            "code": "from io import BytesIO\nfrom openpyxl import Workbook, load_workbook\nbook=Workbook();page=book.active;page.title='Отчёт'\npage.append(['Количество','Цена, коп.','Стоимость, коп.'])\npage.append([2,350,'=A2*B2']);page.append(['Итого',None,'=SUM(C2:C2)'])\nstream=BytesIO();book.save(stream)\npage=load_workbook(BytesIO(stream.getvalue()),data_only=False)['Отчёт']\nassert page['C2'].value=='=A2*B2'\nassert page['C3'].value=='=SUM(C2:C2)'\nprint(page.max_row,page.max_column)\nprint(page['C2'].data_type)",
            "output": "3 3\nf"
          }
        ]
      }
    ],
    "mistakes": [
      {
        "title": "Артикул стал числом или формулой",
        "text": "Идентификатор хранится текстом; при буквальной строке с = задайте data_type=s."
      },
      {
        "title": "data_only приняли за вычисление",
        "text": "Эта настройка читает сохранённый кэш. openpyxl не вычисляет формулы; у новой формулы кэша может не быть."
      },
      {
        "title": "Изменили исходник вместо новой копии",
        "text": "Не сохраняйте поверх оригинала. Для нового файла используйте исключительное создание и проверяйте повторно открытую книгу."
      }
    ],
    "applications": [
      "Очистка выгрузки остатков с понятным журналом строк, которые требуют исправления.",
      "Новая версия отчёта с формулами, читаемым оформлением и отдельным сохранённым исходником."
    ],
    "summary": [
      "Различайте книгу, лист, Cell и value. Строковые коды и нули сохраняются по контракту.",
      "Формула хранит выражение, формат меняет отображение; data_only не является калькулятором.",
      "Проверяйте сохранённую новую копию; реальные сложные книги требуют отдельной проверки."
    ]
  }
});
