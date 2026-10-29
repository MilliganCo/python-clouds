"""Rebuild the local UI icon subset; original vendor TTF remains unchanged.

Requires fontTools in the maintainer environment, never in the web runtime.
Scan current public JS/CSS/HTML for literal and escaped codepoints plus hex constants;
keep every referenced codepoint present in the original cmap, preserving outlines.
"""
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont
import hashlib,json,re,sys

BASE=Path(__file__).resolve().parents[1]
STATIC=BASE/'static';SOURCE=STATIC/'vendor/SymbolsNerdFont-Regular.ttf'
TARGET=STATIC/'vendor/CloudSymbols-UI.woff';MANIFEST=STATIC/'vendor/ui-font-manifest.json'
sys.path.insert(0,str(BASE))
from content_generation import collect_public

def referenced_codepoints():
    points=set()
    sources=[]
    public,_,_=collect_public(STATIC)
    for name,data in sorted(public.items()):
        if Path(name).suffix not in ('.js','.css','.html'):continue
        text=data.decode('utf-8');points.update(map(ord,text))
        for pattern in (r'\\u\{([0-9a-fA-F]{1,6})\}',r'\\u([0-9a-fA-F]{4})',r'\\([0-9a-fA-F]{4,6})(?![0-9a-fA-F])',r'0x([0-9a-fA-F]{4,6})'):
            points.update(int(v,16) for v in re.findall(pattern,text))
        sources.append(name)
    return points,sources

def main():
    font=TTFont(SOURCE,recalcTimestamp=False);cmap=font.getBestCmap()
    points,sources=referenced_codepoints();wanted=sorted(points&cmap.keys())
    assert wanted and len(wanted)<500
    options=subset.Options();options.name_IDs=['*'];options.name_languages=['*'];options.name_legacy=True
    options.notdef_outline=True;options.recalc_timestamp=False
    worker=subset.Subsetter(options=options);worker.populate(unicodes=wanted);worker.subset(font)
    font.flavor='woff'
    for record in font['name'].names:
        value={1:'Cloud Symbols UI',3:'CloudSymbolsUI-Subset',4:'Cloud Symbols UI',6:'CloudSymbolsUI'}.get(record.nameID)
        if value is not None:record.string=value.encode(record.getEncoding())
    license=(STATIC/'vendor/SymbolsNerdFont-LICENSE.txt').read_text(encoding='utf-8')
    font['name'].setName(license,13,3,1,0x409)
    font['name'].setName('https://github.com/ryanoasis/nerd-fonts/tree/master/patched-fonts/NerdFontsSymbolsOnly',14,3,1,0x409)
    font.save(TARGET)
    check=TTFont(TARGET);assert set(check.getBestCmap())==set(wanted)
    for cp in wanted:assert check['glyf'][check.getBestCmap()[cp]].numberOfContours!=0 or cp==32
    info=dict(source=SOURCE.name,source_sha256=hashlib.sha256(SOURCE.read_bytes()).hexdigest(),source_bytes=SOURCE.stat().st_size,
        subset=TARGET.name,subset_sha256=hashlib.sha256(TARGET.read_bytes()).hexdigest(),subset_bytes=TARGET.stat().st_size,
        codepoints=[f'U+{p:04X}' for p in wanted],sources=sources,license='SymbolsNerdFont-LICENSE.txt',
        upstream='https://github.com/ryanoasis/nerd-fonts/tree/master/patched-fonts/NerdFontsSymbolsOnly')
    MANIFEST.write_text(json.dumps(info,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:v for k,v in info.items() if k not in ('sources','codepoints')},indent=2));print('Codepoints:',len(wanted))

if __name__=='__main__':main()
