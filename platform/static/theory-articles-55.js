/* pytest: independent examples, CPython 3.14 verified. */
window.THEORY_ARTICLES = Object.assign(window.THEORY_ARTICLES || {}, {
  "55": {
    "id": 55,
    "title": "pytest: тесты, которые находят ошибки",
    "lead": "Проверка кода — самостоятельный навык. Научимся задавать ожидание, читать провал, проверять исключения и границы, создавать собственные файлы и замечать наборы, которые ничего не проверяют. Функции для тестирования даны готовыми; ваша задача — написать полезные тесты.",
    "sections": [
      {
        "title": "1. Тест задаёт ожидаемое поведение",
        "text": "Тест вызывает функцию с выбранными данными и сравнивает результат с независимым ожиданием. assert ничего не печатает при успехе и вызывает AssertionError при ложном условии. Сам вызов функции без сравнения может пропустить неправильный ответ. В этой теме проверяются небольшие готовые функции: вы учитесь проверять чужую реализацию, а не исправлять её одновременно с тестом. Начните с обычного случая и объясните, откуда известно ожидание.",
        "examples": [
          {
            "code": "def add(a, b):\n    return a + b\nassert add(2, 3) == 5\nprint(\"Ожидание выполнено\")",
            "output": "Ожидание выполнено"
          }
        ]
      },
      {
        "title": "2. Имя test_ позволяет pytest найти функцию",
        "text": "pytest — сторонняя библиотека и инструмент запуска. В терминале проекта используйте python -m pytest: это связывает запуск с выбранным интерпретатором. Обычно тесты лежат в test_*.py, функции называются test_*. Обычный запуск Python-файла создаёт функции и не выполняет их автоматически. На платформе pytest уже установлен на сервере; кнопка проверки запускает тесты, а обычный запуск может ничего не вывести. На своём компьютере установите pytest в окружение проекта: python -m pip install pytest. Не нужно ставить пакет после каждого запуска.",
        "examples": [
          {
            "code": "seen = []\ndef test_add():\n    seen.append(\"запущен\")\n    assert 2 + 3 == 5\nprint(seen)\ntest_add()\nprint(seen)",
            "output": "[]\n['запущен']"
          }
        ]
      },
      {
        "title": "3. Настоящий запуск тестового файла",
        "text": "В обычном проекте сохраните функцию и test_… в test_sample.py и выполните python -m pytest -q из папки проекта. Ниже самодостаточный пример делает это в собственной временной папке: создаёт маленький файл и запускает pytest через тот же Python. subprocess возвращает код завершения, capture_output сохраняет отчёт в result.stdout. Код 0 означает успешный запуск. Большинство служебных строк нужны только этому автономному примеру: в IDE достаточно файла и команды в терминале.",
        "examples": [
          {
            "code": "import os, subprocess, sys, tempfile\nfrom pathlib import Path\nwith tempfile.TemporaryDirectory() as folder:\n    root = Path(folder)\n    (root / 'test_sample.py').write_text('def add(a, b):\\n    return a + b\\ndef test_add():\\n    assert add(2, 3) == 5\\n', encoding='utf-8')\n    (root / 'pytest.ini').write_text('[pytest]\\naddopts =\\n', encoding='utf-8')\n    result = subprocess.run([sys.executable, '-m', 'pytest', '-q', '--noconftest', '-p', 'no:cacheprovider', '-c', str(root / 'pytest.ini'), str(root / 'test_sample.py')], cwd=root, env={**os.environ, 'PYTEST_DISABLE_PLUGIN_AUTOLOAD':'1', 'PYTEST_ADDOPTS':''}, capture_output=True, text=True)\n    print(result.returncode)",
            "output": "0"
          }
        ]
      },
      {
        "title": "4. Красный тест объясняет несоответствие",
        "text": "Намеренно неверное ожидание заставляет pytest завершиться кодом 1. Прочитайте имя упавшего теста, строку assert, ожидаемое и полученное значение. Не меняйте ожидание только ради зелёного цвета: сначала сверяйтесь с контрактом функции. Одна правильная реализация должна пройти ваши тесты. Посмотреть подробный отчёт автономного примера можно через print(result.stdout).",
        "examples": [
          {
            "code": "import os, subprocess, sys, tempfile\nfrom pathlib import Path\nwith tempfile.TemporaryDirectory() as folder:\n    root = Path(folder)\n    (root / 'test_sample.py').write_text('def add(a, b):\\n    return a + b\\ndef test_add():\\n    assert add(2, 3) == 9\\n', encoding='utf-8')\n    (root / 'pytest.ini').write_text('[pytest]\\naddopts =\\n', encoding='utf-8')\n    result = subprocess.run([sys.executable, '-m', 'pytest', '-q', '--noconftest', '-p', 'no:cacheprovider', '-c', str(root / 'pytest.ini'), str(root / 'test_sample.py')], cwd=root, env={**os.environ, 'PYTEST_DISABLE_PLUGIN_AUTOLOAD':'1', 'PYTEST_ADDOPTS':''}, capture_output=True, text=True)\n    print(result.returncode)",
            "output": "1"
          }
        ]
      },
      {
        "title": "5. approx для результатов с плавающей точкой",
        "text": "Дробные числа хранятся приближённо: арифметика может дать значение очень близко к ожидаемому. pytest.approx сравнивает с абсолютной/относительной погрешностью; при специальных требованиях задавайте abs и rel явно. Для идентификаторов, целых счётчиков и точных строк погрешность не нужна. Приближённое сравнение не должно маскировать серьёзную ошибку масштаба.",
        "examples": [
          {
            "code": "import pytest\nprint(0.1 + 0.2 == 0.3)\nprint(0.1 + 0.2 == pytest.approx(0.3))\nprint(0.1 + 0.2 == pytest.approx(0.4))",
            "output": "False\nTrue\nFalse"
          }
        ]
      },
      {
        "title": "6. raises проверяет ожидаемый тип ошибки",
        "text": "Контекст with pytest.raises(ValueError) требует ValueError или его подкласс внутри блока. Если ошибка отсутствует или возникает другой тип, тест падает. Не используйте except Exception: pass для проверки всех ошибок подряд. В блок помещайте вызов проверяемой функции, а подготовку данных — перед ним, иначе ошибка подготовки может создать ложный успех. match может проверять существенную часть сообщения, когда это часть контракта.",
        "examples": [
          {
            "code": "import pytest\nwith pytest.raises(ValueError) as caught:\n    int(\"не число\")\nprint(caught.type.__name__)",
            "output": "ValueError"
          }
        ]
      },
      {
        "title": "7. parametrize запускает несколько случаев",
        "text": "Декоратор parametrize получает имена аргументов и набор независимых ожиданий. pytest создаёт отдельную проверку для каждой строки таблицы. Не вычисляйте expected той же функцией, которую проверяете: это сравнение ответа с самим собой. Для границы выбирайте значения по обе стороны перехода, для пустоты и исключений — отдельные случаи. В примере pytest действительно выполняет три проверки, а не один цикл вручную.",
        "examples": [
          {
            "code": "import os, subprocess, sys, tempfile\nfrom pathlib import Path\nwith tempfile.TemporaryDirectory() as folder:\n    root = Path(folder)\n    (root / 'test_sample.py').write_text('import pytest\\n@pytest.mark.parametrize(\"number, expected\", [(0,True),(2,True),(3,False)])\\ndef test_even(number, expected):\\n    assert (number % 2 == 0) is expected\\n', encoding='utf-8')\n    (root / 'pytest.ini').write_text('[pytest]\\naddopts =\\n', encoding='utf-8')\n    result = subprocess.run([sys.executable, '-m', 'pytest', '-q', '--noconftest', '-p', 'no:cacheprovider', '-c', str(root / 'pytest.ini'), str(root / 'test_sample.py')], cwd=root, env={**os.environ, 'PYTEST_DISABLE_PLUGIN_AUTOLOAD':'1', 'PYTEST_ADDOPTS':''}, capture_output=True, text=True)\n    print(result.returncode)",
            "output": "0"
          }
        ]
      },
      {
        "title": "8. Фикстура готовит данные по имени аргумента",
        "text": "Фикстура — функция с @pytest.fixture. pytest вызывает её, когда тест просит одноимённый аргумент. Так тест получает подготовленные данные без глобальных переменных. Встроенная tmp_path возвращает отдельную временную папку типа pathlib.Path. Запишите туда небольшой файл с известным содержимым; тест не должен зависеть от личного рабочего файла или интернета. Фикстура может зависеть от другой фикстуры, например tmp_path.",
        "examples": [
          {
            "code": "import os, subprocess, sys, tempfile\nfrom pathlib import Path\nwith tempfile.TemporaryDirectory() as folder:\n    root = Path(folder)\n    (root / 'test_sample.py').write_text('import pytest\\n@pytest.fixture\\ndef text_file(tmp_path):\\n    path=tmp_path/\"message.txt\"\\n    path.write_text(\"Привет\",encoding=\"utf-8\")\\n    return path\\ndef test_file(text_file):\\n    assert text_file.read_text(encoding=\"utf-8\")==\"Привет\"\\n', encoding='utf-8')\n    (root / 'pytest.ini').write_text('[pytest]\\naddopts =\\n', encoding='utf-8')\n    result = subprocess.run([sys.executable, '-m', 'pytest', '-q', '--noconftest', '-p', 'no:cacheprovider', '-c', str(root / 'pytest.ini'), str(root / 'test_sample.py')], cwd=root, env={**os.environ, 'PYTEST_DISABLE_PLUGIN_AUTOLOAD':'1', 'PYTEST_ADDOPTS':''}, capture_output=True, text=True)\n    print(result.returncode)",
            "output": "0"
          }
        ]
      },
      {
        "title": "9. Изменяемые данные требуют изоляции",
        "text": "По умолчанию фикстура живёт один тест (scope=function). При scope=module один изменяемый объект разделяется несколькими тестами. Если первый тест меняет список, следующий видит изменение: результат зависит от порядка запуска. Общая дорогая неизменяемая подготовка бывает полезна, но для обычного изменяемого набора проще новая фикстура на каждый тест. В этом примере общий список приводит к одному провалу; уберите scope=module и повторите.",
        "examples": [
          {
            "code": "import os, subprocess, sys, tempfile\nfrom pathlib import Path\nwith tempfile.TemporaryDirectory() as folder:\n    root = Path(folder)\n    (root / 'test_sample.py').write_text('import pytest\\n@pytest.fixture(scope=\"module\")\\ndef items():\\n    return []\\ndef test_first(items):\\n    items.append(1)\\n    assert items==[1]\\ndef test_second(items):\\n    assert items==[]\\n', encoding='utf-8')\n    (root / 'pytest.ini').write_text('[pytest]\\naddopts =\\n', encoding='utf-8')\n    result = subprocess.run([sys.executable, '-m', 'pytest', '-q', '--noconftest', '-p', 'no:cacheprovider', '-c', str(root / 'pytest.ini'), str(root / 'test_sample.py')], cwd=root, env={**os.environ, 'PYTEST_DISABLE_PLUGIN_AUTOLOAD':'1', 'PYTEST_ADDOPTS':''}, capture_output=True, text=True)\n    print(result.returncode)",
            "output": "1"
          }
        ]
      },
      {
        "title": "10. capsys отличает вывод от возвращённого значения",
        "text": "Фикстура capsys собирает текст, напечатанный проверяемой программой. readouterr() возвращает out и err и очищает текущий буфер. Это полезно для небольшой консольной функции. Не подменяйте проверку return проверкой print: это разные результаты. Когда функция должна только вернуть значение, лишний вывод тоже можно проверить через capsys.",
        "examples": [
          {
            "code": "import os, subprocess, sys, tempfile\nfrom pathlib import Path\nwith tempfile.TemporaryDirectory() as folder:\n    root = Path(folder)\n    (root / 'test_sample.py').write_text('def greet(name):\\n    print(\"Привет, \" + name)\\ndef test_greet(capsys):\\n    greet(\"Аня\")\\n    assert capsys.readouterr().out==\"Привет, Аня\\\\n\"\\n', encoding='utf-8')\n    (root / 'pytest.ini').write_text('[pytest]\\naddopts =\\n', encoding='utf-8')\n    result = subprocess.run([sys.executable, '-m', 'pytest', '-q', '--noconftest', '-p', 'no:cacheprovider', '-c', str(root / 'pytest.ini'), str(root / 'test_sample.py')], cwd=root, env={**os.environ, 'PYTEST_DISABLE_PLUGIN_AUTOLOAD':'1', 'PYTEST_ADDOPTS':''}, capture_output=True, text=True)\n    print(result.returncode)",
            "output": "0"
          }
        ]
      },
      {
        "title": "11. monkeypatch задаёт контролируемую зависимость",
        "text": "Тесту нужны воспроизводимые условия. monkeypatch временно меняет переменную окружения, атрибут или элемент словаря и восстанавливает состояние после теста. В примере функция читает настройку из окружения, а тест сам задаёт её. Для сети и часов применяют тот же принцип: подставить управляемую зависимость, не обращаться к случайному внешнему состоянию. Не подменяйте саму проверяемую функцию: иначе её ошибка останется невидимой.",
        "examples": [
          {
            "code": "import os, subprocess, sys, tempfile\nfrom pathlib import Path\nwith tempfile.TemporaryDirectory() as folder:\n    root = Path(folder)\n    (root / 'test_sample.py').write_text('import os\\ndef limit():\\n    return int(os.environ.get(\"DEMO_LIMIT\",\"5\"))\\ndef test_limit(monkeypatch):\\n    monkeypatch.setenv(\"DEMO_LIMIT\",\"12\")\\n    assert limit()==12\\n', encoding='utf-8')\n    (root / 'pytest.ini').write_text('[pytest]\\naddopts =\\n', encoding='utf-8')\n    result = subprocess.run([sys.executable, '-m', 'pytest', '-q', '--noconftest', '-p', 'no:cacheprovider', '-c', str(root / 'pytest.ini'), str(root / 'test_sample.py')], cwd=root, env={**os.environ, 'PYTEST_DISABLE_PLUGIN_AUTOLOAD':'1', 'PYTEST_ADDOPTS':''}, capture_output=True, text=True)\n    print(result.returncode)",
            "output": "0"
          }
        ]
      },
      {
        "title": "12. Зелёный набор должен быть чувствителен к ошибке",
        "text": "Тесты полезны, когда принимают правильное поведение и отвергают неправильное. Если убрать assert, проверять только один счастливый случай или использовать skip, зелёный отчёт мало что скажет. В заданиях этой темы набор запускается заново на нескольких реализациях: правильных и с независимыми дефектами. Не нужно угадывать текст функций; нужны случаи, которые следуют из контракта. Код 5 означает отсутствие найденных тестов и не засчитывается как успех. Настройка IDE и выполнение команды на вашем компьютере остаются отдельной практикой.",
        "examples": [
          {
            "code": "import pytest\nprint(int(pytest.ExitCode.OK))\nprint(int(pytest.ExitCode.TESTS_FAILED))\nprint(int(pytest.ExitCode.NO_TESTS_COLLECTED))",
            "output": "0\n1\n5"
          }
        ]
      }
    ],
    "mistakes": [
      {
        "title": "Тесты не найдены",
        "text": "Проверьте имена test_*.py и test_… и строку collected. Код 5 не означает успешную проверку."
      },
      {
        "title": "Правильная функция отвергается",
        "text": "Сверьте ожидание с контрактом, погрешность дробных чисел и свежесть данных фикстуры."
      },
      {
        "title": "Ошибка остаётся зелёной",
        "text": "Проверьте наличие assert, разные группы входов и границы. Убедитесь, что тест вызывает настоящую проверяемую функцию."
      }
    ],
    "applications": [
      "Проверка своих функций перед изменением готового проекта.",
      "Регрессии для расчётов тарифов, чтения файлов и обработки некорректного ввода."
    ],
    "summary": [
      "Ожидание следует из контракта, а не из ответа проверяемой функции.",
      "Проверяйте обычные, граничные и ошибочные входы; изолируйте изменяемые данные.",
      "Провал на дефектной реализации и успех на правильной показывают полезность набора."
    ]
  }
});
