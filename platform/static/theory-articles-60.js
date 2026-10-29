window.THEORY_ARTICLES=Object.assign(window.THEORY_ARTICLES || {},{
  "60": {
    "id": 60,
    "title": "matplotlib: графики с понятным смыслом",
    "lead": "График помогает проверить данные, когда выбран правильный тип и понятны оси. Научимся работать с Figure/Axes, сохранять нули и пропуски, подписывать сравнение и показывать результат PNG. Входные наборы этой темы учебные и заранее описаны; точность рисунка проверяется данными и свойствами объектов, а не совпадением пикселей.",
    "sections": [
      {
        "title": "1. Figure и Axes имеют разное назначение",
        "text": "Figure — целый рисунок, Axes — область с осями, данными и подписями. plt.subplots возвращает оба объекта. Объектный API помогает не рисовать случайно в чужой текущей области. На сервере используется Agg: он сохраняет PNG без окна. Сохраняйте и возвращайте Figure, а show оставьте локальному интерактивному сценарию. На платформе matplotlib установлен; в IDE пакет нужно поставить в выбранное окружение.",
        "examples": [
          {
            "code": "import matplotlib\nmatplotlib.use('Agg')\nimport matplotlib.pyplot as plt\nfig,ax=plt.subplots(figsize=(4,3))\nax.plot([0,1],[2,0])\nprint(len(fig.axes),len(ax.lines))\nprint(fig.get_size_inches().tolist())",
            "output": "1 1\n[4.0, 3.0]"
          }
        ]
      },
      {
        "title": "2. Линия соединяет в исходном порядке",
        "text": "Порядок наблюдений имеет смысл. plot не сортирует X автоматически, поэтому перемешанный временной ряд может создать странный путь. Если задача требует сортировки, сначала явно подготовьте данные и сохраните пары X/Y вместе. Если порядок не означает путь, возможно, нужна scatter, а не линия. Не удаляйте нули как пустые значения.",
        "examples": [
          {
            "code": "import matplotlib\nmatplotlib.use('Agg')\nimport matplotlib.pyplot as plt\nfig,ax=plt.subplots()\nline,=ax.plot([2,0,1],[3,0,5],marker='o')\nprint(line.get_xdata().tolist())\nprint(line.get_ydata().tolist())",
            "output": "[2, 0, 1]\n[3, 0, 5]"
          }
        ]
      },
      {
        "title": "3. Повторная категория может получить ту же координату",
        "text": "При передаче строк прямо в bar одинаковые названия сопоставляются одной координате, столбцы накладываются. Для отдельных наблюдений используйте числовые позиции и подписи оси отдельно. Для сводки по коду сначала агрегируйте данные, затем рисуйте один столбец на код. Это разные задачи: график не должен незаметно выбирать политику дублей.",
        "examples": [
          {
            "code": "import matplotlib\nmatplotlib.use('Agg')\nimport matplotlib.pyplot as plt\nfig,ax=plt.subplots()\nbars=ax.bar(['A','A'],[2,3])\nprint([float(round(p.get_x()+p.get_width()/2,1)) for p in bars])\nfig,ax=plt.subplots();bars=ax.bar([0,1],[2,0]);ax.set_xticks([0,1],['A','A'])\nprint([float(round(p.get_x()+p.get_width()/2,1)) for p in bars])",
            "output": "[0.0, 0.0]\n[0.0, 1.0]"
          }
        ]
      },
      {
        "title": "4. Scatter показывает пары, не маршрут",
        "text": "scatter создаёт коллекцию точек. Соединяющая линия добавляла бы информацию о последовательности, которой может не быть. Подпишите оси и единицы, не объявляйте причинность по одному визуальному совпадению. Alpha помогает видеть наложение точек, но повторные координаты остаются повторными наблюдениями.",
        "examples": [
          {
            "code": "import matplotlib\nmatplotlib.use('Agg')\nimport matplotlib.pyplot as plt\nfig,ax=plt.subplots()\npoints=ax.scatter([1,1,3],[2,2,0],alpha=.7)\nprint(points.get_offsets().tolist())\nprint(len(ax.lines))",
            "output": "[[1.0, 2.0], [1.0, 2.0], [3.0, 0.0]]\n0"
          }
        ]
      },
      {
        "title": "5. Гистограмма зависит от границ интервалов",
        "text": "hist группирует числовые наблюдения. В обычном режиме высота — количество, при density меняется смысл оси Y. Последний интервал включает правую границу; значения за общим диапазоном не учитываются. Смена bins меняет вид распределения, поэтому не выбирайте границы только ради красивого результата. Бар-категории и интервалы гистограммы не взаимозаменяемы.",
        "examples": [
          {
            "code": "import matplotlib\nmatplotlib.use('Agg')\nimport matplotlib.pyplot as plt\nfig,ax=plt.subplots()\ncounts,edges,_=ax.hist([-1,0,1,2,3,4,9],bins=[0,2,4],density=False)\nprint(counts.tolist())\nprint([int(x) for x in edges])",
            "output": "[2.0, 3.0]\n[0, 2, 4]"
          }
        ]
      },
      {
        "title": "6. Пропуск разрывает линию",
        "text": "None/NaN не означают измерение 0. Для линии пропуск можно представить NaN: положение X сохранится, а линия будет разорвана. Удаление точки сжимает индекс и может соединить соседние дни, а замена нулём выдумывает данные. Политику пропусков сначала определяет контракт отчёта, затем код подготовки.",
        "examples": [
          {
            "code": "import matplotlib\nmatplotlib.use('Agg')\nimport matplotlib.pyplot as plt\nimport numpy as np\nfig,ax=plt.subplots()\nline,=ax.plot([0,1,2],[2,np.nan,0])\nprint(line.get_xdata().tolist())\nprint(np.isnan(line.get_ydata()).tolist())",
            "output": "[0, 1, 2]\n[False, True, False]"
          }
        ]
      },
      {
        "title": "7. Подписи объясняют смысл и не должны зависеть только от цвета",
        "text": "Название величины и единицы важнее декоративного градиента. Для двух рядов задайте label, создайте legend и дополнительно различайте их маркерами/стилем линии. Читатель с другим восприятием цвета тоже должен различать данные. У категориального графика подписи значений помогают читать нулевой столбец и точные количества.",
        "examples": [
          {
            "code": "import matplotlib\nmatplotlib.use('Agg')\nimport matplotlib.pyplot as plt\nfig,ax=plt.subplots()\nax.plot([0,1],[2,3],label='Факт',marker='o')\nax.plot([0,1],[3,3],label='План',linestyle='--')\nax.set(xlabel='День',ylabel='Штук');ax.legend()\nprint([text.get_text() for text in ax.get_legend().texts])\nprint(ax.lines[1].get_linestyle())",
            "output": "['Факт', 'План']\n--"
          }
        ]
      },
      {
        "title": "8. Масштаб оси меняет впечатление",
        "text": "Для столбцов количества естественная опорная точка — ноль: отсечённая ось может преувеличить различие высот. Для других задач диапазон выбирается по смыслу и явно сообщается. Не задавайте предел, который случайно прячет часть данных. В этой теме график остатков начинается с 0, а отклонения имеют нулевую линию.",
        "examples": [
          {
            "code": "import matplotlib\nmatplotlib.use('Agg')\nimport matplotlib.pyplot as plt\nfig,ax=plt.subplots()\nax.bar([0,1],[3,4]);ax.set_ylim(bottom=0)\nprint(ax.get_ylim()[0])\nprint([int(p.get_height()) for p in ax.patches])",
            "output": "0.0\n[3, 4]"
          }
        ]
      },
      {
        "title": "9. Размер PNG получается из figsize и dpi",
        "text": "figsize задаётся в дюймах, dpi — в точках на дюйм. Без изменения bbox рисунок 4×3 при dpi=100 даёт 400×300 пикселей. Слишком большой рисунок расходует память ещё до экспорта. Для платформенного превью достаточно небольшого PNG: до 4096 по стороне и 4 миллионов пикселей, файл до 256 КиБ. bbox_inches=\"tight\" может менять итоговый размер, поэтому в задаче сохранения он не применяется.",
        "examples": [
          {
            "code": "import matplotlib\nmatplotlib.use('Agg')\nimport matplotlib.pyplot as plt\nfrom io import BytesIO\nfig,ax=plt.subplots(figsize=(4,3));ax.plot([0,1],[1,0])\nstream=BytesIO();fig.savefig(stream,format='png',dpi=100);data=stream.getvalue()\nprint(data[:4]==bytes([137,80,78,71]))\nprint(int.from_bytes(data[16:20],'big'),int.from_bytes(data[20:24],'big'))",
            "output": "True\n400 300"
          }
        ]
      },
      {
        "title": "10. Несколько представлений могут разделять X",
        "text": "subplots(2,1,sharex=True) связывает ось X двух областей. Сверху удобно показать план/факт, снизу — разницу для тех же позиций. Общая шкала не заменяет проверку соответствия массивов. suptitle относится к Figure, title — к отдельной Axes. tight_layout помогает разместить подписи; для общего заголовка можно оставить отдельное место через rect.",
        "examples": [
          {
            "code": "import matplotlib\nmatplotlib.use('Agg')\nimport matplotlib.pyplot as plt\nfig,(top,bottom)=plt.subplots(2,1,sharex=True,figsize=(4,4))\nfig.suptitle('Отчёт');bottom.set_xlabel('День')\nprint(len(fig.axes),top.get_shared_x_axes().joined(top,bottom))\nprint(fig.get_suptitle())",
            "output": "2 True\nОтчёт"
          }
        ]
      },
      {
        "title": "11. Закрытие освобождает ресурс pyplot",
        "text": "pyplot хранит созданные фигуры. При обработке многих наборов без close они накапливаются. Функция, возвращающая Figure, передаёт владение вызывающему коду; обычно тот сохраняет/показывает результат и закрывает его. На платформе весь контейнер одноразовый, но закрывать временные фигуры всё равно полезно. Не закрывайте чужую Figure внутри save-функции, если контракт этого не требует.",
        "examples": [
          {
            "code": "import matplotlib\nmatplotlib.use('Agg')\nimport matplotlib.pyplot as plt\nfig,ax=plt.subplots();number=fig.number\nprint(plt.fignum_exists(number))\nplt.close(fig)\nprint(plt.fignum_exists(number))",
            "output": "True\nFalse"
          }
        ]
      },
      {
        "title": "12. Сохранение, описание и просмотр результата",
        "text": "После подготовки Figure сохраните новый PNG и в той же платформенной программе вызовите <code>from pycloud import export_file</code> / <code>export_file(\"plot.png\", description=\"Что показывают оси и данные\")</code>. Описание станет альтернативным текстом, а PNG можно посмотреть и скачать. Данные и название не должны вводить читателя в заблуждение. Превью проверяет структуру/размер, но не математическую честность графика; её подтверждают исходные данные и проверки свойств Figure. В локальной IDE pycloud не нужен: сохраните свою копию. Не сравнивайте все PNG-байты между платформами — шрифты/рендеринг могут отличаться.",
        "examples": [
          {
            "code": "import matplotlib\nmatplotlib.use('Agg')\nimport matplotlib.pyplot as plt\nfrom pathlib import Path\nfig,ax=plt.subplots(figsize=(4,3));bars=ax.bar([0,1],[2,0]);ax.set_xticks([0,1],['A','B']);ax.set_ylabel('Штук');ax.bar_label(bars)\nwith Path('plot.png').open('xb') as file:fig.savefig(file,format='png',dpi=100)\nprint(Path('plot.png').exists())\nprint([text.get_text() for text in ax.texts])",
            "output": "True\n['2', '0']"
          }
        ]
      }
    ],
    "summary": [
      "Выберите тип графика по смыслу данных и подпишите оси/ряды.",
      "Порядок, нули, дубли и пропуски не исправляются рисунком автоматически.",
      "Сохраняйте небольшой PNG, дайте альтернативное описание и закройте свои временные Figure."
    ],
    "mistakes": [
      {
        "title": "Категории наложились",
        "text": "Для отдельных строк используйте позиции, а для сводки сначала агрегируйте коды."
      },
      {
        "title": "Пропуск стал нулём",
        "text": "Сохраните позицию и используйте NaN; не придумывайте измерение."
      },
      {
        "title": "Красивый график скрывает данные",
        "text": "Проверьте шкалу, подписи, единицы и соответствие исходному набору."
      }
    ],
    "applications": [
      "Наглядная сводка остатков с текстовыми артикулами.",
      "Составной отчёт плана/факта с честными пропусками и отклонениями."
    ]
  }
});
