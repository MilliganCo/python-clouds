"""Source-backed editorial map, without automatic teaching scores or learner claims."""
import argparse
from datetime import date
import hashlib,html,json,re,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
import build_tasks
NOTES=ROOT/'platform/docs/curriculum-quality-notes.json'
REPORT=ROOT/'platform/docs/CURRICULUM_QUALITY.md'


def fingerprint(topics,support):
    payload={'topics':topics,'theory':support['theory'],'intros':support['intros'],'hints':support['hints']}
    return hashlib.sha256(json.dumps(payload,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()


def validate(notes,topics,support):
    if type(notes) is not dict or set(notes)!={'version','date','topics'} or type(notes['version']) is not int or notes['version']!=1:
        raise ValueError('Unknown editorial map format')
    if type(notes['date']) is not str or date.fromisoformat(notes['date']).isoformat()!=notes['date']:raise ValueError('Invalid review date')
    records=notes['topics']
    if type(records) is not list or any(type(r) is not dict for r in records):raise ValueError('Expected editorial records')
    ids=[r.get('id') for r in records];expected={t['id'] for t in topics}
    if any(type(i) is not int for i in ids) or len(ids)!=len(set(ids)) or set(ids)!=expected:
        raise ValueError('Editorial map must cover every current topic exactly once')
    order={t['id']:i for i,t in enumerate(topics)};by_id={r['id']:r for r in records}
    keys={'id','prerequisites_editorial','terms','example_section','error_index','finale_note','gap'}
    for topic in topics:
        record=by_id[topic['id']]
        if set(record)!=keys:raise ValueError(f"{topic['id']}: unknown or missing editorial field")
        prerequisites=record['prerequisites_editorial']
        if type(prerequisites) is not list or any(type(p) is not dict or set(p)!={'id','reason'} for p in prerequisites):
            raise ValueError(f"{topic['id']}: invalid foundations")
        refs=[p['id'] for p in prerequisites]
        if (any(type(i) is not int or i not in expected or order[i]>=order[topic['id']] for i in refs)
                or len(refs)!=len(set(refs))):raise ValueError(f"{topic['id']}: foundations must refer to earlier topics, without duplicates")
        if topic.get('prerequisites') and refs!=topic['prerequisites']:
            raise ValueError(f"{topic['id']}: declared prerequisites must be preserved")
        if any(type(p['reason']) is not str or not p['reason'].strip() for p in prerequisites):raise ValueError('Missing foundation evidence')
        terms=record['terms']
        if type(terms) is not list or not 2<=len(terms)<=6 or any(type(t) is not str or not t.strip() for t in terms) or len(terms)!=len(set(terms)):
            raise ValueError(f"{topic['id']}: expected a concise authored concept list")
        article=support['theory'].get(str(topic['id'])) or {}
        si,mi=record['example_section'],record['error_index']
        sections=article.get('sections',[]);mistakes=article.get('mistakes',[])
        if type(si) is not int or not 0<=si<len(sections) or not sections[si].get('examples'):raise ValueError(f"{topic['id']}: invalid example anchor")
        example=sections[si]['examples'][0]
        valid_output=type(example.get('output')) is str
        shell_note=example.get('codeLanguage')=='shell' and type(example.get('resultNote')) is str and example['resultNote'].strip()
        if type(example.get('code')) is not str or not example['code'].strip() or not (valid_output or shell_note):
            raise ValueError(f"{topic['id']}: example needs its actual result or shell note")
        if example.get('outputKind') in ('sample','environment','unordered') and not example.get('resultNote'):
            raise ValueError(f"{topic['id']}: non-exact example needs its declared explanation")
        if type(mi) is not int or not 0<=mi<len(mistakes) or not mistake_text(mistakes[mi]):
            raise ValueError(f"{topic['id']}: invalid common-error anchor")
        finales=[t for t in topic['tasks'] if t.get('finale')]
        if len(finales)!=2 or [t['finale'] for t in finales]!=[1,2] or any(not t.get('check') for t in finales):
            raise ValueError(f"{topic['id']}: missing the two checked finales")
        if type(record['finale_note']) is not str or not record['finale_note'].strip() or type(record['gap']) is not str:
            raise ValueError(f"{topic['id']}: missing editorial observation")
    return by_id


def article_source(topic_id):
    pattern=re.compile(r'^\s*"id"\s*:\s*'+str(topic_id)+r'\s*[,}]',re.M)
    matches=[]
    for path in sorted((ROOT/'platform/static').glob('theory*.js')):
        text=path.read_text(encoding='utf-8');match=pattern.search(text)
        if match:matches.append((path.name,text[:match.start()].count('\n')+1))
    if len(matches)!=1:raise ValueError(f'{topic_id}: ambiguous or absent article source')
    return matches[0]


def mistake_text(value):
    if type(value) is str:return value.strip()
    if type(value) is dict and value.get('title') and value.get('text'):
        return value['title'].rstrip('. ') +'. '+value['text']
    return ''


def plain(value):
    value=html.unescape(re.sub(r'<[^>]+>','',str(value)))
    value=value.replace('\r',' ').replace('\n',' ').strip()
    return re.sub(r'([\\`*_{}\[\]<>])',r'\\\1',value)


def code_span(value):
    text=str(value).replace('\r',' ').replace('\n',' ')
    fence='`'*(max((len(m[0]) for m in re.finditer(r'`+',text)),default=0)+1)
    return fence+' '+text+' '+fence


def render(notes,topics,support,*,source_locator=article_source):
    records=validate(notes,topics,support);names={t['id']:t['title'].replace('`','') for t in topics}
    count=sum(len(t['tasks']) for t in topics)
    examples=sum(len(s.get('examples',[])) for a in support['theory'].values() for s in a.get('sections',[]))
    gaps=[r['id'] for r in records.values() if r['gap']]
    lines=['# Редакторская карта курса', '',
        f"Сверка источников: {notes['date']}. Тем: {len(topics)}; обычных этапов: {count}; примеров теории: {examples}.",
        f'<!-- curriculum-quality-source: {fingerprint(topics,support)} -->','',
        'Карта фиксирует пять опор: основы, ключевые термины и действия, пример с результатом, типичную ошибку и два финала. '
        'Это редакторский указатель к материалам, а не оценка ученика или подтверждение понятности всех объяснений.',
        'Опоры из канонических prerequisites сохранены; остальные — редакторские связи, они не создают новых блокировок курса. '
        'Автоматическая проверка подтверждает наличие и актуальность ссылок, а не педагогическую достаточность.',
        'Термины включают новые и повторно используемые понятия темы; это не автоматический поиск их первого появления. '
        'Новые задачи и пилоты записываются только в IMPROVEMENTS.md, эта карта не является вторым roadmap.',
        'Пример ниже — первый пример выбранного раздела, его вывод и текст ошибки берутся из текущей статьи. '
        'Короткие фрагменты могут быть сокращены; полный материал доступен в указанном исходнике.',
        f"Замечания, внесённые в эту карту: {len(gaps)} тем. Пустое поле не означает отсутствия всех редакторских проблем. "
        'Пилоты на учениках и устройствах остаются в IMPROVEMENTS.md.','']
    for topic in topics:
        tid=topic['id'];record=records[tid];article=support['theory'][str(tid)]
        section=article['sections'][record['example_section']];example=section['examples'][0];mistake=article['mistakes'][record['error_index']]
        path,line=source_locator(tid)
        source=f'[исходник статьи](../static/{path}#L{line})'
        def reason(value):return plain(re.sub(r'^(?:Редакторский вывод|Выведено|Заявлено):\s*','',value)).rstrip('. ')
        foundations='; '.join(f"{p['id']} — {plain(names[p['id']])}: {reason(p['reason'])}" for p in record['prerequisites_editorial']) or 'старт курса, предшествующих тем нет'
        basis='канонические' if topic.get('prerequisites') else 'редакторские'
        output=example.get('output',example.get('resultNote',''))
        preview=repr(output)
        result=preview if len(preview)<=250 else preview[:247]+'…'
        if example.get('error'):result+='; исключение: '+plain(example['error'])
        qualifier={'sample':'образец, не фиксированный результат','environment':'зависит от окружения','unordered':'порядок не фиксирован'}.get(example.get('outputKind'),'')
        if example.get('codeLanguage')=='shell':qualifier='текст команды, не Python-вывод'
        finales=[t for t in topic['tasks'] if t.get('finale')]
        links='; '.join(f"`{t['id']}` — {plain(t['title'])}" for t in finales)
        lines.extend([f'## {tid}. {plain(names[tid])}', '',
            f'- **Основы ({basis}):** {foundations}.',
            '- **Термины:** '+', '.join(code_span(x) for x in record['terms'])+'.',
            f"- **Пример:** раздел {record['example_section']+1} «{plain(section['title'])}», пример 1; результат {code_span(result)}"+(f' ({qualifier})' if qualifier else '')+f'; {source}.',
            f"- **Типичная ошибка:** {plain(mistake_text(mistake))}",
            f"- **Самостоятельные финалы:** {links}. {plain(record['finale_note'])}", ''])
        if record['gap']:lines.extend(['**Редакторское замечание:** '+plain(record['gap']),''])
    return '\n'.join(lines).rstrip()+'\n'


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--check',action='store_true')
    args=parser.parse_args();notes=json.loads(NOTES.read_text(encoding='utf-8'))
    topics=build_tasks.parse();support=build_tasks._load_support_content();text=render(notes,topics,support)
    if args.check:
        if not REPORT.exists() or REPORT.read_text(encoding='utf-8')!=text:raise SystemExit('Editorial map is stale: run curriculum_quality.py and inspect the diff')
    else:REPORT.write_text(text,encoding='utf-8')
    print(f"PASS editorial map: {len(topics)} source-backed topics; no learner score or pilot claim")

if __name__=='__main__':main()
