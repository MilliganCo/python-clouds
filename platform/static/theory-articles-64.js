window.THEORY_ARTICLES=Object.assign(window.THEORY_ARTICLES || {},{
  "64": {
    "id": 64,
    "title": "Pillow: изображения, миниатюры и PNG",
    "lead": "Pillow читает и создаёт растровые изображения. На маленьких учебных картинках разберём ширину и высоту, прозрачность и сохранение PNG. Фотографии из интернета не нужны: изображения создаются прямо в коде. В финалах соберём функцию подготовки миниатюры и исправим контактный лист. Здесь нет загрузки недоверенных больших файлов или обещания сохранить все метаданные фотографии.",
    "sections": [
      {
        "title": "1. Размер и координаты",
        "text": "Размер задаётся в порядке ширина, высота.",
        "examples": [
          {
            "code": "from PIL import Image, ImageOps\nfrom io import BytesIO\nim=Image.new('RGB',(3,2),(10,20,30))\nprint(im.size,im.mode)\nprint(im.getpixel((2,1)))",
            "output": "(3, 2) RGB\n(10, 20, 30)"
          }
        ]
      },
      {
        "title": "2. Независимая копия",
        "text": "putpixel меняет только копию.",
        "examples": [
          {
            "code": "from PIL import Image, ImageOps\nfrom io import BytesIO\na=Image.new('RGB',(1,1),'white')\nb=a.copy();b.putpixel((0,0),(0,0,0))\nprint(a.getpixel((0,0)),b.getpixel((0,0)))",
            "output": "(255, 255, 255) (0, 0, 0)"
          }
        ]
      },
      {
        "title": "3. Изменение на месте",
        "text": "thumbnail не возвращает новое изображение.",
        "examples": [
          {
            "code": "from PIL import Image, ImageOps\nfrom io import BytesIO\nim=Image.new('RGB',(8,4))\nprint(im.thumbnail((4,4)))\nprint(im.size)",
            "output": "None\n(4, 2)"
          }
        ]
      },
      {
        "title": "4. Без увеличения",
        "text": "Небольшой источник остаётся небольшим.",
        "examples": [
          {
            "code": "from PIL import Image, ImageOps\nfrom io import BytesIO\nim=Image.new('RGB',(2,1))\nim.thumbnail((20,20))\nprint(im.size)",
            "output": "(2, 1)"
          }
        ]
      },
      {
        "title": "5. Прямое resize",
        "text": "resize задаёт точный размер и может исказить пропорции.",
        "examples": [
          {
            "code": "from PIL import Image, ImageOps\nfrom io import BytesIO\nim=Image.new('RGB',(8,4))\nprint(im.resize((4,4)).size)\nprint(im.size)",
            "output": "(4, 4)\n(8, 4)"
          }
        ]
      },
      {
        "title": "6. Заполнить рамку",
        "text": "fit сохраняет пропорции за счёт центральной обрезки.",
        "examples": [
          {
            "code": "from PIL import Image, ImageOps\nfrom io import BytesIO\nim=Image.new('RGB',(6,2),'red');im.paste('green',(2,0,4,2))\nout=ImageOps.fit(im,(2,2))\nprint(out.size,out.getpixel((0,0)))",
            "output": "(2, 2) (0, 128, 0)"
          }
        ]
      },
      {
        "title": "7. Альфа-канал",
        "text": "Не отбрасывайте alpha до смешивания.",
        "examples": [
          {
            "code": "from PIL import Image, ImageOps\nfrom io import BytesIO\nfront=Image.new('RGBA',(1,1),(255,0,0,128))\nback=Image.new('RGBA',(1,1),'white')\nprint(Image.alpha_composite(back,front).convert('RGB').getpixel((0,0)))",
            "output": "(255, 127, 127)"
          }
        ]
      },
      {
        "title": "8. PNG в памяти",
        "text": "Формат для BytesIO задаётся явно.",
        "examples": [
          {
            "code": "from PIL import Image, ImageOps\nfrom io import BytesIO\nstream=BytesIO();Image.new('RGB',(2,3),'blue').save(stream,format='PNG')\nwith Image.open(BytesIO(stream.getvalue())) as im:\n    print(im.format,im.mode,im.size)",
            "output": "PNG RGB (2, 3)"
          }
        ]
      },
      {
        "title": "9. Загрузить до закрытия",
        "text": "load читает пиксели, copy отделяет изображение от потока.",
        "examples": [
          {
            "code": "from PIL import Image, ImageOps\nfrom io import BytesIO\nstream=BytesIO();Image.new('RGB',(1,2),(7,8,9)).save(stream,format='PNG')\nwith Image.open(BytesIO(stream.getvalue())) as opened:\n    opened.load();image=opened.copy()\nprint(image.getpixel((0,1)))",
            "output": "(7, 8, 9)"
          }
        ]
      },
      {
        "title": "10. Ориентация EXIF",
        "text": "Поворот применяется перед вычислением миниатюры.",
        "examples": [
          {
            "code": "from PIL import Image, ImageOps\nfrom io import BytesIO\nim=Image.new('RGB',(4,2),'blue');exif=im.getexif();exif[274]=6\nstream=BytesIO();im.save(stream,format='JPEG',exif=exif)\nwith Image.open(BytesIO(stream.getvalue())) as opened:\n    corrected=ImageOps.exif_transpose(opened)\n    print(corrected.size,corrected.getexif().get(274))",
            "output": "(2, 4) None"
          }
        ]
      },
      {
        "title": "11. Неполный ряд",
        "text": "Число строк округляется вверх, gap находится между ячейками.",
        "examples": [
          {
            "code": "count,columns,w,h,gap=5,3,20,10,2\nrows=(count+columns-1)//columns\nprint(rows,columns*w+(columns-1)*gap,rows*h+(rows-1)*gap)",
            "output": "2 64 22"
          }
        ]
      },
      {
        "title": "12. PNG для скачивания",
        "text": "В учебном запуске можно явно экспортировать небольшой файл. Здесь проверим повторное открытие байтов; для файла используйте image.save(\"preview.png\"), затем pycloud.export_file(\"preview.png\").",
        "examples": [
          {
            "code": "from PIL import Image, ImageOps\nfrom io import BytesIO\nimage=Image.new('RGB',(2,2),'white')\nstream=BytesIO();image.save(stream,format='PNG')\nwith Image.open(BytesIO(stream.getvalue())) as again:\n    print(again.format,again.size)",
            "output": "PNG (2, 2)"
          }
        ]
      }
    ],
    "summary": [
      "size — (ширина, высота), координаты начинаются с нуля.",
      "thumbnail меняет объект и не увеличивает его; copy сохраняет источник.",
      "fit обрезает, resize может исказить пропорции.",
      "Для RGB-результата прозрачность сначала смешивается с фоном.",
      "Повторное открытие PNG проверяет реальные байты, а не имя файла."
    ],
    "mistakes": [
      "Перепутать x/y и width/height.",
      "Присвоить результат thumbnail, получив None.",
      "Уменьшить исходное фото вместо копии.",
      "Выкинуть alpha через convert(\"RGB\") и получить неверный фон.",
      "Забыть EXIF Orientation или неполный последний ряд."
    ],
    "applications": [
      "Миниатюры для небольшого отчёта.",
      "Контактный лист учебных картинок.",
      "Подготовка PNG для скачивания без сети."
    ]
  }
});
