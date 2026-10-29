"""Small learner API inside the disposable container; not a host filesystem API."""
import base64
import os
from pathlib import PurePosixPath
import stat

MAX_FILES = 3
MAX_FILE_BYTES = 256 * 1024
MAX_TOTAL_BYTES = 512 * 1024
_exports = {}


def export_file(path):
    """Include an existing workspace XLSX/PNG in this run's download results."""
    text = os.fspath(path)
    if not isinstance(text, str) or '\x00' in text:
        raise ValueError('Укажите путь к файлу внутри /workspace.')
    selected = PurePosixPath(text)
    if selected.is_absolute():
        try:
            selected = selected.relative_to('/workspace')
        except ValueError:
            raise ValueError('Скачивать можно только свои файлы из /workspace.') from None
    parts = selected.parts
    if not parts or any(p in ('..', '.') for p in parts):
        raise ValueError('Не используйте переходы за пределы папки запуска.')
    name = parts[-1]
    if (len(name) > 100 or name != name.strip() or name.startswith('.') or name.endswith('.')
            or any(ord(c) < 32 or ord(c) == 127 or c in '\\:*?"<>|' for c in name)):
        raise ValueError('Выберите простое имя файла длиной до 100 символов.')
    extension = '.' + name.rsplit('.', 1)[-1].lower() if '.' in name else ''
    if extension not in ('.xlsx', '.png'):
        raise ValueError('Можно скачать только файлы .xlsx и .png.')
    # Directory FDs and O_NOFOLLOW reject symlinks, including parent components.
    directory = os.open('/workspace', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            os.close(directory)
            directory = child
        descriptor = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        try:
            info = os.fstat(descriptor)
            if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_FILE_BYTES:
                raise ValueError('Нужен обычный файл размером не больше 256 КиБ.')
            chunks, length = [], 0
            while chunk := os.read(descriptor, min(65536, MAX_FILE_BYTES + 1 - length)):
                chunks.append(chunk)
                length += len(chunk)
                if length > MAX_FILE_BYTES:
                    raise ValueError('Файл результата превышает 256 КиБ.')
            raw = b''.join(chunks)
        finally:
            os.close(descriptor)
    finally:
        os.close(directory)
    signature = b'PK\x03\x04' if extension == '.xlsx' else b'\x89PNG\r\n\x1a\n'
    if not raw.startswith(signature):
        raise ValueError('Содержимое файла не соответствует расширению.')
    key = name.casefold()
    total = sum(len(base64.b64decode(entry['data'])) for k, entry in _exports.items() if k != key)
    if key not in _exports and len(_exports) >= MAX_FILES:
        raise ValueError('За один запуск можно скачать не больше трёх файлов.')
    if total + len(raw) > MAX_TOTAL_BYTES:
        raise ValueError('Суммарный размер файлов результата превышает 512 КиБ.')
    _exports[key] = dict(name=name, data=base64.b64encode(raw).decode('ascii'))


def _snapshot():
    return [entry.copy() for entry in _exports.values()]
