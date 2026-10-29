"""Validate guest-owned binary results. Never follow guest paths on the host."""
import base64
import binascii
import re
import struct
import zlib

MAX_FILES = 3
MAX_FILE_BYTES = 256 * 1024
MAX_TOTAL_BYTES = 512 * 1024
MIMES = {
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.png': 'image/png',
}
MAX_PREVIEW_PIXELS = 4_000_000


def png_preview(raw):
    """Bounded PNG structure/header inspection, without decompressing pixels."""
    if not raw.startswith(b'\x89PNG\r\n\x1a\n'):
        return None
    offset, dimensions, seen_data, palette, count = 8, None, False, False, 0
    while offset + 12 <= len(raw):
        count += 1
        length = int.from_bytes(raw[offset:offset+4],'big')
        end = offset + 12 + length
        if end > len(raw) or count > 2048:
            return None
        kind = raw[offset+4:offset+8]
        data = raw[offset+8:end-4]
        if zlib.crc32(kind+data) & 0xffffffff != int.from_bytes(raw[end-4:end],'big'):
            return None
        if count == 1:
            if kind != b'IHDR' or length != 13:
                return None
            width,height,depth,color,compression,filtering,interlace = struct.unpack('>IIBBBBB',data)
            depths={0:{1,2,4,8,16},2:{8,16},3:{1,2,4,8},4:{8,16},6:{8,16}}
            if (not 1<=width<=4096 or not 1<=height<=4096 or width*height>MAX_PREVIEW_PIXELS
                    or depth not in depths.get(color,set()) or compression!=0 or filtering!=0 or interlace not in (0,1)):
                return None
            dimensions=dict(width=width,height=height)
        elif kind == b'IHDR' or kind in (b'acTL',b'fcTL',b'fdAT'):
            return None
        elif kind == b'PLTE':
            if seen_data or not length or length%3 or length>768:
                return None
            palette=True
        elif kind == b'IDAT':
            if color==3 and not palette:
                return None
            seen_data=True
        elif kind == b'IEND':
            return dimensions if length==0 and seen_data and end==len(raw) else None
        elif kind and not (kind[0] & 32):
            return None  # Unknown critical chunks do not get a preview.
        offset=end
    return None


def normalize_artifacts(value):
    if not isinstance(value, list) or len(value) > MAX_FILES:
        raise ValueError('Допустимы до трёх файлов результата.')
    total, seen, result = 0, set(), []
    for item in value:
        if not isinstance(item, dict):
            raise ValueError('Некорректный файл результата.')
        name, data = item.get('name'), item.get('data')
        if (not isinstance(name, str) or not 1 <= len(name) <= 100
                or name != name.strip() or re.search(r'[\x00-\x1f\x7f/\\:*?"<>|]', name)
                or name.startswith('.') or name.endswith('.') or name.casefold() in seen):
            raise ValueError('Некорректное имя файла результата.')
        try:
            name.encode('utf-8')
        except UnicodeEncodeError as exc:
            raise ValueError('Имя файла должно быть корректным Unicode.') from exc
        extension = '.' + name.rsplit('.', 1)[-1].lower() if '.' in name else ''
        if extension not in MIMES:
            raise ValueError('Можно скачать только XLSX и PNG.')
        if not isinstance(data, str) or len(data) > 4 * ((MAX_FILE_BYTES + 2) // 3):
            raise ValueError('Файл результата превышает 256 КиБ.')
        try:
            raw = base64.b64decode(data, validate=True)
        except (ValueError, binascii.Error) as exc:
            raise ValueError('Некорректное содержимое файла результата.') from exc
        total += len(raw)
        if not raw or len(raw) > MAX_FILE_BYTES or total > MAX_TOTAL_BYTES:
            raise ValueError('Превышен размер файлов результата: 256 КиБ на файл, 512 КиБ всего.')
        signature = b'PK\x03\x04' if extension == '.xlsx' else b'\x89PNG\r\n\x1a\n'
        if not raw.startswith(signature):
            raise ValueError('Содержимое файла не соответствует расширению.')
        seen.add(name.casefold())
        # MIME/size/ownership never come from the guest. No guest URL/path is retained.
        file=dict(name=name, data=data, mime=MIMES[extension], size=len(raw))
        description=item.get('description')
        if description is not None:
            if not isinstance(description,str) or len(description)>500 or any(ord(c)<32 and c not in '\t\r\n' or ord(c)==127 for c in description):
                raise ValueError('Описание файла должно быть строкой до 500 символов.')
            try:description.encode('utf-8')
            except UnicodeEncodeError as exc:raise ValueError('Некорректный Unicode описания.') from exc
            if description:file['description']=description
        preview=png_preview(raw) if extension=='.png' else None
        if preview:file['preview']=preview
        result.append(file)
    return result
