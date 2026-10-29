from pathlib import Path
import json,re,subprocess,sys
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
import build_tasks

def test_bank_split_covers_every_canonical_field_and_id():
    topics=build_tasks.parse();generated=build_tasks.build_task_banks(topics,build_tasks.SOURCE_RULES.read_text(encoding='utf8'))
    assert len(generated)==67
    html=build_tasks.task_bank_declarations((ROOT/'platform/static/index.html').read_text(encoding='utf8'),generated)
    assert set(re.findall(r'data-course-src="(task-banks/topic-\d+\.js)"',html))==set(generated)-{'task-index.js'}
    for name,data in generated.items():assert (ROOT/'platform/static'/name).read_bytes()==data

def test_real_lazy_bank_loader_and_roundtrip():
    run=subprocess.run(['node','--test',str(ROOT/'platform/scripts/verify_lazy_tasks_unit.cjs')],capture_output=True,text=True,encoding='utf8',timeout=30)
    assert run.returncode==0,run.stdout+run.stderr
    assert 'fail 0' in run.stdout
