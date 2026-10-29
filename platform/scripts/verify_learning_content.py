"""Run with py -3.14 from any folder. No user DB; each program gets a temporary cwd.

Verifies all theory examples and finale solutions, including print-only counterexamples.
The content is trusted repository code, not a sandbox for arbitrary submissions.
"""
from concurrent.futures import ThreadPoolExecutor
import ast
import json
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
import build_tasks

def run(code):
    with tempfile.TemporaryDirectory(prefix='pycloud-content-check-') as folder:
        try:
            result = subprocess.run([sys.executable, '-I', '-X', 'utf8', '-c', code],
                cwd=folder, stdin=subprocess.DEVNULL, capture_output=True, encoding='utf-8', timeout=6)
            return result.returncode, result.stdout.rstrip('\n'), result.stderr
        except subprocess.TimeoutExpired:
            return -1, '', 'Execution timed out'


def main():
    assert sys.version_info[:2] == (3, 14), 'Use CPython 3.14'
    sys.stdout.reconfigure(encoding='utf-8')
    topics = build_tasks.parse()
    support = build_tasks._load_support_content()
    examples = {f'{tid}:{si}:{ei}': ex
        for tid, article in support['theory'].items()
        for si, section in enumerate(article.get('sections', []))
        for ei, ex in enumerate(section.get('examples', []))}
    assert len(topics) == 66
    for topic in topics:
        assert [t.get('finale') for t in topic['tasks'][-2:]] == [1, 2], topic['id']
    tasks = [t for p in topics for t in p['tasks'] if t.get('finale')]

    def theory_check(item):
        key, example = item
        if example.get('codeLanguage') == 'shell':
            assert example.get('resultNote') and 'output' not in example, key
            return
        assert 'output' in example, key
        assert not example.get('context'), ('Example must run alone, without hidden setup', key)
        status, stdout, stderr = run(example['code'])
        if example.get('error'):
            assert status and stderr.splitlines()[-1] == example['error'], (key, stderr)
        else:
            assert status == 0, (key, stderr)
        if example.get('outputKind') == 'unordered':
            assert example.get('resultNote'), key
            expected = example['output'].splitlines()
            actual = stdout.splitlines()
            assert len(expected) == len(actual), key
            for left, right in zip(expected, actual):
                assert left == right or ast.literal_eval(left) == ast.literal_eval(right), key
        elif example.get('outputKind') in ('sample', 'environment'):
            assert example.get('resultNote'), key
        else:
            assert stdout == example['output'], (key, example['output'], stdout)

    def task_check(task):
        check = task['check']
        assert task.get('hint') and task.get('explanation'), task['id']
        expected = build_tasks._normalized_output(check['expect'])
        code = build_tasks._reference_program(task)
        status, stdout, stderr = run(code + '\n' + build_tasks.compose_check(check, code))
        assert status == 0 and build_tasks._normalized_output(stdout) == expected, (task['id'], stderr, stdout)
        wrong_programs = [task['code']]
        # Source rules now distinguish literal output from the required action in topic0.
        assert check['expect'].splitlines()[-1] == 'OK', task['id']
        answer_only = '\n'.join(check['expect'].splitlines()[:-1])
        wrong_programs.append('print(' + repr(answer_only) + ')')
        for wrong in wrong_programs:
            status, stdout, _ = run(wrong + '\n' + build_tasks.compose_check(check, wrong))
            assert status or build_tasks._normalized_output(stdout) != expected, ('Incorrect accepted', task['id'])
        return len(wrong_programs)

    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(theory_check, examples.items()))
        negative_checks = sum(pool.map(task_check, tasks))
    print(f'PASS: {len(examples)} theory examples; {len(tasks)} finales and {negative_checks} incomplete/print-only counterexamples; CPython {sys.version.split()[0]}')


if __name__ == '__main__':
    main()
