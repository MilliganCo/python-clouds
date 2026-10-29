"""Immutable teaching sets, one activation pointer, private pinned process reads.

Only repository teaching assets are handled here. Never learner DB/session keys.
Compatibility flat copies are not the authority used by generation-aware readers.
"""
from contextlib import contextmanager
from dataclasses import dataclass
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path,PurePosixPath
import re
import shutil
import tempfile
import threading
import time
from types import MappingProxyType

PUBLIC_DIR='course-content'
PRIVATE_DIR='.course-content'
POINTER='content-current.json'
LOADER='catalogue-loader.js'
PRIVATE_FILES=('tasks_meta.json','atlas_tasks.json','practice_quests.json','weekly_tasks.json','mobile/content-bundle.json','index.html')
_HEX=re.compile(r'^[0-9a-f]{64}$')
_SAFE=re.compile(r'^[a-zA-Z0-9_][a-zA-Z0-9_./-]*$')
_MEDIA={'.ttf','.woff','.woff2','.otf','.png','.jpg','.jpeg','.webp','.gif','.svg','.ico'}
_CACHE={};_CACHE_LOCK=threading.Lock()


class ContentError(RuntimeError):pass
class BuildBusy(ContentError):pass


def canonical(value):
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode('utf-8')


def sha(data):return hashlib.sha256(data).hexdigest()


def valid_path(name):
    return (type(name) is str and bool(_SAFE.fullmatch(name)) and '\\' not in name
            and not any(part in ('','.', '..') for part in name.split('/')))


def safe_file(root,name):
    root=Path(root).absolute()
    if not valid_path(name):raise ContentError('Invalid content path')
    path=root/name
    if not path.resolve().is_relative_to(root.resolve()):raise ContentError('Content path escaped its root')
    for parent in (path,*path.parents):
        if parent==root.parent:break
        if parent.is_symlink():raise ContentError('Content symlinks are not accepted')
    return path


def atomic_write(path,data):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    fd,temporary=tempfile.mkstemp(prefix='.content-write-',dir=path.parent)
    try:
        with os.fdopen(fd,'wb') as stream:
            stream.write(data);stream.flush();os.fsync(stream.fileno())
        deadline=time.monotonic()+0.25
        while True:
            try:os.replace(temporary,path);break
            except PermissionError:
                if os.name!='nt' or time.monotonic()>=deadline:raise
                time.sleep(0.01)
    finally:
        Path(temporary).unlink(missing_ok=True)


@contextmanager
def writer_lock(base,*,create=True):
    path=Path(base)/'.content-build.lock'
    if create:path.parent.mkdir(parents=True,exist_ok=True)
    try:stream=path.open('a+b' if create else 'r+b')
    except OSError as exc:raise BuildBusy('Cannot acquire the teaching build lock') from exc
    try:
        if create and path.stat().st_size==0:stream.write(b'0');stream.flush()
        if path.stat().st_size==0:raise BuildBusy('Teaching build lock is being initialized')
        stream.seek(0)
        try:
            if os.name=='nt':
                import msvcrt
                msvcrt.locking(stream.fileno(),msvcrt.LK_NBLCK,1)
            else:
                import fcntl
                fcntl.flock(stream.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
        except OSError as exc:raise BuildBusy('Another teaching build is active; no files were changed') from exc
        try:yield
        finally:
            stream.seek(0)
            if os.name=='nt':
                import msvcrt
                msvcrt.locking(stream.fileno(),msvcrt.LK_UNLCK,1)
            else:
                import fcntl
                fcntl.flock(stream.fileno(),fcntl.LOCK_UN)
    finally:stream.close()


class _Assets(HTMLParser):
    def __init__(self):super().__init__();self.scripts=[];self.styles=[]
    def handle_starttag(self,tag,attrs):
        values=dict(attrs)
        if tag=='script':
            source=values.get('data-course-src') or values.get('src')
            if source and source!=LOADER:self.scripts.append(source)
        if tag=='link' and values.get('rel')=='stylesheet':self.styles.append(values.get('href',''))


def collect_public(static,overrides=None):
    """Capture an explicit local asset graph; never glob private/server files."""
    static=Path(static);overrides={} if overrides is None else overrides
    def read(name):
        data=overrides[name] if name in overrides else safe_file(static,name).read_bytes()
        return data.replace(b'\r\n',b'\n') if Path(name).suffix in ('.js','.css','.html') else data
    html=read('index.html');parser=_Assets();parser.feed(html.decode('utf-8'))
    if not parser.scripts or len(set(parser.scripts))!=len(parser.scripts):raise ContentError('Missing or duplicate script declarations')
    files={'index.html':html};pending=[]
    for name in parser.scripts:
        if not valid_path(name) or not name.endswith('.js') or Path(name).name=='runner-worker.js':raise ContentError('Unsupported executable content asset')
        files[name]=read(name)
    if safe_file(static,LOADER).is_file():files[LOADER]=read(LOADER)
    for name in parser.styles:
        if not valid_path(name) or not name.endswith('.css'):raise ContentError('Unsupported stylesheet')
        files[name]=read(name);pending.append(name)
    while pending:
        name=pending.pop();text=files[name].decode('utf-8')
        if re.search(r'@import\b',text,re.I):raise ContentError('Vendor CSS imports locally before publishing')
        for raw in re.findall(r'url\(\s*[\'\"]?([^\)\'\"]+)',text):
            raw=raw.strip()
            if raw.startswith(('data:','#')):continue
            if raw.startswith(('/','\\')) or re.match(r'^[a-z]+:',raw,re.I):raise ContentError('Content CSS resources must be local relative paths')
            path=PurePosixPath(name).parent/PurePosixPath(raw.split('#',1)[0].split('?',1)[0])
            relative=path.as_posix()
            if not valid_path(relative) or Path(relative).suffix.lower() not in _MEDIA|{'.css'}:raise ContentError('Unsafe CSS dependency')
            if relative not in files:
                files[relative]=read(relative)
                if relative.endswith('.css'):pending.append(relative)
    return files,parser.scripts,parser.styles


def _descriptor(public,private,scripts,styles):
    if set(private)!=set(PRIVATE_FILES):raise ContentError('Incomplete private teaching set')
    if not scripts or any(p not in public for p in scripts+styles):raise ContentError('Incomplete public teaching set')
    if any(not valid_path(p) for p in (*public,*private)):raise ContentError('Invalid artifact name')
    for name in public:
        if name.endswith('.js') and name not in [*scripts,LOADER]:raise ContentError('Undeclared script in public set')
        if Path(name).suffix.lower() not in _MEDIA|{'.js','.css'}:raise ContentError('Private or unsupported file in public set')
        if Path(name).name=='runner-worker.js':raise ContentError('Unisolated worker cannot be published')
    return dict(version=1,scripts=scripts,styles=styles,public={p:sha(data) for p,data in sorted(public.items())},
                private={p:sha(data) for p,data in sorted(private.items())})


def _roots(base,generation):
    base=Path(base).resolve()
    if not _HEX.fullmatch(generation):raise ContentError('Invalid generation ID')
    pub=safe_file(base/'static',PUBLIC_DIR+'/'+generation)
    private=safe_file(base/PRIVATE_DIR,generation)
    return pub,private


def public_manifest(base,generation):
    pub,_=_roots(base,generation)
    try:manifest=json.loads(safe_file(pub,'manifest.json').read_text(encoding='utf-8'))
    except (OSError,ValueError,UnicodeError) as exc:raise ContentError('Public generation is unavailable') from exc
    if (type(manifest) is not dict or set(manifest)!={'version','generation','scripts','styles','sha256'}
            or type(manifest['version']) is not int or manifest['version']!=1 or manifest['generation']!=generation
            or type(manifest['sha256']) is not dict or type(manifest['scripts']) is not list or type(manifest['styles']) is not list):
        raise ContentError('Invalid public generation manifest')
    for name,digest in manifest['sha256'].items():
        if not valid_path(name) or type(digest) is not str or not _HEX.fullmatch(digest):raise ContentError('Unsafe public manifest entry')
        if Path(name).suffix.lower() not in _MEDIA|{'.js','.css'} or Path(name).name=='runner-worker.js':raise ContentError('Private file in public manifest')
    if any(type(p) is not str or p not in manifest['sha256'] for p in manifest['scripts']+manifest['styles']):raise ContentError('Missing declared assets')
    return pub,manifest


@dataclass(frozen=True)
class Snapshot:
    base:Path
    generation:str|None
    public:dict
    private:dict
    scripts:tuple=()
    styles:tuple=()

    def __post_init__(self):
        object.__setattr__(self,'public',MappingProxyType(dict(self.public)))
        object.__setattr__(self,'private',MappingProxyType(dict(self.private)))

    def text(self,name,*,public=False):
        try:return (self.public if public else self.private)[name].decode('utf-8')
        except KeyError as exc:raise ContentError('Missing selected teaching artifact: '+name) from exc

    def json(self,name):return json.loads(self.text(name))

    @property
    def identity(self):
        return self.generation or 'legacy:'+sha(canonical({'public':{k:sha(v) for k,v in self.public.items()},'private':{k:sha(v) for k,v in self.private.items()}}))


def capture_generation(base,generation):
    base=Path(base).resolve();pub,private=_roots(base,generation)
    try:descriptor=json.loads(safe_file(private,'manifest.json').read_text(encoding='utf-8'))
    except (OSError,ValueError,UnicodeError) as exc:raise ContentError('Private teaching generation is unavailable') from exc
    if (type(descriptor) is not dict or set(descriptor)!={'version','scripts','styles','public','private'}
            or type(descriptor['version']) is not int or descriptor['version']!=1 or sha(canonical(descriptor))!=generation):
        raise ContentError('Generation manifest hash mismatch')
    if set(descriptor['private'])!=set(PRIVATE_FILES):raise ContentError('Incomplete selected generation')
    _,visible=public_manifest(base,generation)
    if visible!={'version':1,'generation':generation,'scripts':descriptor['scripts'],'styles':descriptor['styles'],'sha256':descriptor['public']}:
        raise ContentError('Public/private generation mismatch')
    def load(root,items):
        result={}
        for name,digest in items.items():
            try:data=safe_file(root,name).read_bytes()
            except OSError as exc:raise ContentError('Missing selected artifact: '+name) from exc
            if sha(data)!=digest:raise ContentError('Selected artifact hash mismatch: '+name)
            result[name]=data
        return result
    return Snapshot(base,generation,load(pub,descriptor['public']),load(private,descriptor['private']),tuple(descriptor['scripts']),tuple(descriptor['styles']))


def read_atomic_bytes(path):
    """Windows readers must share DELETE access with an atomic rename writer."""
    if os.name!='nt':return Path(path).read_bytes()
    import ctypes,msvcrt
    from ctypes import wintypes
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    create=kernel.CreateFileW
    create.argtypes=(wintypes.LPCWSTR,wintypes.DWORD,wintypes.DWORD,wintypes.LPVOID,wintypes.DWORD,wintypes.DWORD,wintypes.HANDLE)
    create.restype=wintypes.HANDLE
    close=kernel.CloseHandle;close.argtypes=(wintypes.HANDLE,);close.restype=wintypes.BOOL
    deadline=time.monotonic()+0.25
    while True:
        handle=create(str(Path(path).absolute()),0x80000000,0x7,None,3,0x80,None)
        if handle!=ctypes.c_void_p(-1).value:break
        error=ctypes.get_last_error()
        if error in (2,3):raise FileNotFoundError(str(path))
        if error not in (5,32,33) or time.monotonic()>=deadline:raise ctypes.WinError(error)
        time.sleep(0.005)
    try:fd=msvcrt.open_osfhandle(handle,os.O_RDONLY|os.O_BINARY)
    except BaseException:close(handle);raise
    with os.fdopen(fd,'rb') as stream:return stream.read()


def _read_pointer(base):
    path=Path(base)/'static'/POINTER
    try:value=json.loads(read_atomic_bytes(path).decode('utf-8'))
    except FileNotFoundError:return None
    except (OSError,ValueError,UnicodeError) as exc:raise ContentError('Active teaching pointer is damaged') from exc
    if type(value) is not dict or set(value)!={'version','generation'} or type(value['version']) is not int or value['version']!=1 or type(value['generation']) is not str or not _HEX.fullmatch(value['generation']):
        raise ContentError('Invalid active teaching pointer')
    return value['generation']


def capture(base):
    """Read-only, fresh disk selection. Invalid pointer never falls back to flat files."""
    base=Path(base).resolve()
    def legacy():
        pub,scripts,styles=collect_public(base/'static');private={'index.html':pub.pop('index.html')}
        for name in PRIVATE_FILES:
            if name=='index.html':continue
            path=safe_file(base.parent,'android/app/src/main/assets/content/content-bundle.json') if name.startswith('mobile/') else safe_file(base,name)
            if path.is_file():private[name]=path.read_bytes()
        return Snapshot(base,None,pub,private,tuple(scripts),tuple(styles))
    for _ in range(3):
        generation=_read_pointer(base)
        if generation is not None:return capture_generation(base,generation)
        lock=base/'.content-build.lock'
        if lock.exists():
            with writer_lock(base,create=False):
                generation=_read_pointer(base)
                return capture_generation(base,generation) if generation else legacy()
        result=legacy()
        if not lock.exists() and _read_pointer(base) is None:return result
    raise BuildBusy('Teaching publication changed while selecting legacy data; retry startup')


def process_snapshot(base):
    base=Path(base).resolve()
    with _CACHE_LOCK:
        if base not in _CACHE:_CACHE[base]=capture(base)
        return _CACHE[base]


def generation_matches(header,snapshot):
    """Optional compatibility guard, not authentication or grading proof."""
    return header is None or (type(header) is str and bool(_HEX.fullmatch(header)) and header==snapshot.generation)


def publish(base,public,private,scripts,styles,mirrors,*,fault=lambda phase:None):
    """Called with writer lock held; pointer is the sole commit/activation point."""
    base=Path(base).resolve();workspace=base.parent
    descriptor=_descriptor(public,private,list(scripts),list(styles));generation=sha(canonical(descriptor))
    pub_dir,private_dir=_roots(base,generation)
    allowed={base/'static'/name:data for name,data in public.items()}
    allowed.update({base/name:data for name,data in private.items() if '/' not in name and name!='index.html'})
    allowed[workspace/'android/app/src/main/assets/content/content-bundle.json']=private['mobile/content-bundle.json']
    for target,data in mirrors.items():
        path=Path(target)
        if not path.resolve().is_relative_to(workspace) or path.is_symlink() or path not in allowed or data!=allowed[path]:
            raise ContentError('Compatibility output is not a declared generated artifact')
    with tempfile.TemporaryDirectory(prefix='.content-stage-',dir=base) as folder:
        stage=Path(folder)
        for kind,files in [('public',public),('private',private)]:
            for name,data in files.items():
                target=safe_file(stage/kind,name);target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
        visible=dict(version=1,generation=generation,scripts=list(scripts),styles=list(styles),sha256=descriptor['public'])
        (stage/'public/manifest.json').write_bytes(canonical(visible))
        (stage/'private/manifest.json').write_bytes(canonical(descriptor))
        fault('staged')
        for target,source in [(private_dir,stage/'private'),(pub_dir,stage/'public')]:
            target.parent.mkdir(parents=True,exist_ok=True)
            if not target.exists():os.rename(source,target)
        selected=capture_generation(base,generation)
        fault('installed')
        backups={Path(p):Path(p).read_bytes() if Path(p).exists() else None for p in mirrors}
        applied=[]
        try:
            for path,data in mirrors.items():
                path=Path(path);atomic_write(path,data);applied.append(path);fault('mirror:'+path.name)
            fault('before_commit')
            atomic_write(base/'static'/POINTER,canonical({'version':1,'generation':generation}))
        except BaseException:
            failures=[]
            for path in reversed(applied):
                try:
                    if backups[path] is None:path.unlink(missing_ok=True)
                    else:atomic_write(path,backups[path])
                except OSError:failures.append(path.name)
            if failures:raise ContentError('Publication aborted; previous generation retained, compatibility recovery needed: '+','.join(failures))
            raise
    return selected


def activate(base,generation):
    """Explicit rollback/selection of an existing fully verified set, no DB mutation."""
    with writer_lock(base):
        selected=capture_generation(base,generation)
        atomic_write(Path(base)/'static'/POINTER,canonical({'version':1,'generation':generation}))
        return selected
