"""30 launches per pack using the real server sampler, without importing Flask or touching a wallet."""
import ast
import json
import math
import secrets
import statistics
from collections import Counter
from pathlib import Path


def simulate():
    source = ast.parse((Path(__file__).resolve().parents[1] / 'server.py').read_text(encoding='utf-8'))
    nodes = [n for n in source.body if
             (isinstance(n, ast.FunctionDef) and n.name == '_roll_chest') or
             (isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in ('CHEST_BOARD', 'CHEST_PACKS') for t in n.targets))]
    assert len(nodes) == 3
    namespace = {'secrets': secrets}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), 'server.py:chest', 'exec'), namespace)
    board, packs, roll = (namespace[k] for k in ('CHEST_BOARD', 'CHEST_PACKS', '_roll_chest'))
    weights = Counter()
    for slot, reward in enumerate(board['rewards']):
        weights[reward] += math.comb(board['rows'], slot)
    denominator = 2 ** board['rows']
    mean = sum(value * weight for value, weight in weights.items()) / denominator
    variance = sum((value - mean) ** 2 * weight for value, weight in weights.items()) / denominator
    exact, results, hits = {0: 1}, [], Counter()
    for count in range(1, max(packs) + 1):
        next_distribution = Counter()
        for total, weight in exact.items():
            for value, value_weight in weights.items():
                next_distribution[total + value] += weight * value_weight
        exact = next_distribution
        if count not in packs:
            continue
        launches = [roll(count) for _ in range(30)]
        amounts = [launch['amount'] for launch in launches]
        for launch in launches:
            assert len(launch['paths']) == count
            assert all(len(p) == board['rows'] and set(p) <= {0, 1} for p in launch['paths'])
            values = [board['rewards'][sum(p)] for p in launch['paths']]
            assert sum(values) == launch['amount']
            hits.update(values)
        results.append({
            'count': count, 'launches': 30, 'price': packs[count], 'amounts': amounts,
            'mean': statistics.mean(amounts), 'median': statistics.median(amounts),
            'min': min(amounts), 'max': max(amounts), 'sample_stdev': statistics.stdev(amounts),
            'mean_net_paid': statistics.mean(amounts) - packs[count],
            'profitable_launches': sum(value > packs[count] for value in amounts),
            'break_even_launches': amounts.count(packs[count]),
            'expected_reward': count * mean, 'expected_net_paid': count * mean - packs[count],
            'exact_profit_probability': sum(weight for value, weight in exact.items() if value > packs[count]) / denominator ** count,
            'mean_standard_error': math.sqrt(count * variance / 30),
        })
    total_balls = 30 * sum(packs)
    assert sum(hits.values()) == total_balls == 4080
    return {'rewards': board['rewards'], 'balls': total_balls, 'sampler': 'server._roll_chest / secrets.randbelow',
            'reward_hits': dict(sorted(hits.items())), 'exact_per_ball': mean, 'packs': results,
            'warning': '30 launches per pack is a small sample; recommendation must use the exact distribution too.'}


if __name__ == '__main__':
    print(json.dumps(simulate(), ensure_ascii=False, indent=2))
