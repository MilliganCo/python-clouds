/* Shared learner-facing facts; execution stays in PythonExecutionClient. */
window.RuntimeHelp = (() => {
  let fileExports = false;
  let pngPreviews = false;
  function configure(features = {}) {
    fileExports = features.file_exports === true;
    pngPreviews = features.png_previews === true;
    document.querySelectorAll('[data-export-help]').forEach(node => { node.hidden = !fileExports; });
    document.querySelectorAll('[data-preview-help]').forEach(node => { node.hidden = !pngPreviews; });
  }
  function html() {
    return `<details class="runtime-help">
      <summary>Как работает запуск</summary>
      <p>Для каждой программы на сервере создаётся отдельная среда на один запуск. Переменные и созданные файлы не переходят в следующий запуск. Создание файла и его чтение проверяйте одной программой.</p>
      <p>Сохранённый черновик, снимок или работа на Доске — это текст кода, не файлы и состояние запущенной программы. Чтобы файл оставался между запусками на вашем компьютере, выполняйте код в своей новой учебной папке в IDE или терминале.</p>
      <p>Код на платформе не видит личные папки компьютера и не имеет доступа к интернету. Установленный у вас Python в этом запуске не участвует; браузер не скачивает интерпретатор.</p>
      <p data-export-help ${fileExports ? '' : 'hidden'}>Готовый XLSX или PNG можно явно скачать: после сохранения файла вызовите <code>from pycloud import export_file</code> и <code>export_file("report.xlsx")</code> в этой же программе. Допустимы до трёх файлов из папки запуска: 256 КиБ на файл и 512 КиБ всего. Скачайте результат до перехода на другую страницу; новый запуск и выход очищают ссылки.</p>
      <p data-preview-help ${pngPreviews ? '' : 'hidden'}>Обычный статический PNG до 4 миллионов пикселей можно посмотреть под выводом. Добавьте к export_file описание через <code>description="Что показывает график"</code> — оно станет альтернативным текстом. Анимация и неподдерживаемая структура PNG остаются только скачиваемыми файлами.</p>
      <p>На запуск доступны до 256 МиБ памяти и 64 КиБ текстового вывода. Обычный запуск ограничен 10 секундами. В живом терминале допускается до 5 минут вместе с ожиданием input(), но активные вычисления всё равно ограничены 10 секундами процессорного времени.</p>
    </details>`;
  }

  function errorHint(result, { interactive = false, httpStatus } = {}) {
    if (!result?.error || result.cancelled) return "";
    if (result.blocked) {
      if (httpStatus === 401) return "Скопируйте код в отдельный файл и войдите в аккаунт снова. Затем повторите запуск: этот ответ не проверяет правильность решения.";
      if (httpStatus === 429) return "Дождитесь завершения другой программы или повторите через минуту. Не нажимайте «Запустить» много раз подряд: сервер пока не принял запуск, это не ошибка решения.";
      if (httpStatus === 400 || httpStatus === 413) return "Сохраните код отдельно и уменьшите объём отправляемого кода и данных. Если не принимается даже небольшой пример, сообщите администратору: сервер отклонил запрос, а не проверил решение.";
      if (httpStatus === 503) return "Сейчас недоступен Python платформы. Сохраните код и повторите позже; если ошибка повторяется, сообщите администратору. Установка Python на вашем ПК и отключение защитных ограничений это не исправят.";
      return "Ответ Python не получен. Сохраните код, проверьте соединение с платформой и повторите запуск. Если это повторяется, сообщите администратору; по этому ответу нельзя судить о правильности решения.";
    }
    const failure = result.failure;
    if (failure && !["solution", "check"].includes(failure.source)) return "";
    let kind;
    if (failure) {
      if (failure.type === "MemoryError") kind = "memory";
      else if (failure.type === "OutputLimitExceeded") kind = "output";
    } else {
      // shortcut: legacy host results have no reason code; match exact messages until the protocol gains one.
      const messages = {
        "Превышено время выполнения (10 секунд). Проверьте условие выхода.": "time",
        "Превышен лимит памяти Python (256 МиБ).": "memory",
        "Превышен лимит вывода (64 КиБ).": "output",
        "Превышен лимит потока вывода.": "output",
        "Слишком большой поток вывода. Запуск остановлен.": "output",
        "Слишком много событий вывода.": "output",
        "Достигнут лимит времени или ресурсов Python.": "resources",
        "Python остановлен из-за ошибки или ограничения ресурсов.": "resources",
      };
      if (Object.hasOwn(messages, result.error)) kind = messages[result.error];
    }
    if (!kind) return "";
    const prefix = failure?.source === "check" ? "Остановка произошла во время дополнительной проверки, а не на отдельной строке вашего редактора. " : "";
    const steps = {
      time: "Проверьте условие выхода из циклов: меняется ли значение, от которого оно зависит? Начните с маленького набора данных; долгая работа не обязательно означает бесконечный цикл." +
        (interactive ? " Если программа ждала ввода, повторите запуск и введите ответ: ожидание ввода тоже ограничено." : ""),
      memory: "Python не смог получить нужную память. Проверьте размер создаваемых списков, строк и таблиц; начните с небольшого набора данных и, где подходит по задаче, обрабатывайте его частями.",
      output: "Проверьте print внутри циклов. Для отладки выведите длину коллекции и несколько элементов вместо всей коллекции. Уберите лишнюю диагностическую печать, сохранив вывод, который требует задание.",
      resources: "Точная причина остановки не установлена: это может быть время, ресурсы или ошибка процесса. Попробуйте небольшой набор данных; если даже короткий пример останавливается, сообщите администратору. Не меняйте правильный алгоритм наугад.",
    };
    return prefix + steps[kind];
  }
  document.querySelectorAll('[data-python-runtime-help]').forEach(host => { host.innerHTML = html(); });
  const errorText = result => [result.error, result.guidance].filter(Boolean).join('\n\n');
  return Object.freeze({ html, errorHint, errorText, configure });
})();
