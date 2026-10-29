"""Published icon coverage and outlines, independent of font subset implementation."""
from pathlib import Path
import hashlib,json,re
from fontTools.ttLib import TTFont

STATIC=Path(__file__).resolve().parents[1]/'static'

def test_ui_font_covers_every_declared_icon_with_original_outline_and_metrics():
    css=(STATIC/'nerd-icons.css').read_text(encoding='utf-8')
    icons={int(value,16) for value in re.findall(r'content:\s*"\\([a-fA-F0-9]+)"',css)}
    assert len(icons)>=10
    original=TTFont(STATIC/'vendor/SymbolsNerdFont-Regular.ttf')
    compact=TTFont(STATIC/'vendor/CloudSymbols-UI.woff')
    before,after=original.getBestCmap(),compact.getBestCmap()
    assert icons<=after.keys()
    for cp in icons:
        old,new=before[cp],after[cp]
        assert original['hmtx'][old]==compact['hmtx'][new]
        assert original['glyf'][old].getCoordinates(original['glyf'])==compact['glyf'][new].getCoordinates(compact['glyf'])
    assert compact['name'].getDebugName(0)==original['name'].getDebugName(0)
    assert compact['name'].getDebugName(13).startswith('The MIT License (MIT)')

def test_published_ui_font_is_small_and_matches_provenance():
    info=json.loads((STATIC/'vendor/ui-font-manifest.json').read_text(encoding='utf-8'))
    data=(STATIC/'vendor/CloudSymbols-UI.woff').read_bytes()
    assert len(data)==info['subset_bytes']<20000
    assert hashlib.sha256(data).hexdigest()==info['subset_sha256']
    assert hashlib.sha256((STATIC/'vendor/SymbolsNerdFont-Regular.ttf').read_bytes()).hexdigest()==info['source_sha256']
    assert 'vendor/CloudSymbols-UI.woff' in (STATIC/'nerd-icons.css').read_text(encoding='utf-8')
