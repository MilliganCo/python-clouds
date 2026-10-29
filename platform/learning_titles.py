"""Learning titles and frames derive from server progress, never claims or balance."""

TITLE_REWARDS = {
    'title_pioneer': ('Первопроходец', 'topics', 1, 'Завершите одну тему'),
    'title_pathfinder': ('Первооткрыватель', 'topics', 3, 'Завершите 3 темы'),
    'title_craftsman': ('Мастер маленьких шагов', 'topics', 5, 'Завершите 5 тем'),
    'title_experimenter': ('Исследователь', 'xp', 1000, 'Наберите 1 000 XP'),
    'title_pythonista': ('Питонист', 'xp', 3000, 'Наберите 3 000 XP'),
    'title_cloudsmith': ('Облачный мастер', 'xp', 10000, 'Наберите 10 000 XP'),
    'title_cloud_architect': ('Архитектор облаков', 'xp', 20000, 'Наберите 20 000 XP'),
    'title_architect': ('Архитектор кода', 'topic_ids', (32, 33, 35, 36), 'Завершите темы о классах, наследовании, свойствах и dataclasses'),
    'title_data_whisperer': ('Повелитель таблиц', 'topic_ids', (49, 52, 53), 'Завершите CSV и обе темы pandas'),
    'title_debugger': ('Укротитель багов', 'topic_ids', (18, 39, 55), 'Завершите исключения, пользовательские исключения и pytest'),
    'title_automator': ('Мастер автоматизации', 'topic_ids', (17, 46, 50), 'Завершите файлы, pathlib и argparse'),
    'title_test_pilot': ('Испытатель кода', 'topic_ids', (55,), 'Завершите тему pytest'),
    'title_foundation': ('Крепкий фундамент', 'level', 'beginner', 'Завершите начальный уровень'),
    'title_confident': ('Уверенный разработчик', 'level', 'intermediate', 'Завершите средний уровень'),
    'title_advanced': ('Мастер Python', 'level', 'advanced', 'Завершите продвинутый уровень'),
    'title_expert': ('Эксперт облаков', 'level', 'expert', 'Завершите экспертный уровень'),
}

FRAME_REWARDS = {
    'frame_sunbeam': ('Солнечный луч', 'topics', 1, 'Завершите одну тему'),
    'frame_orbit': ('Орбита', 'xp', 500, 'Наберите 500 XP'),
    'frame_constellation': ('Созвездие', 'topics', 5, 'Завершите 5 тем'),
    'frame_aurora': ('Полярное сияние', 'level', 'advanced', 'Завершите продвинутый уровень'),
    'frame_terminal': ('Строка кода', 'topic_ids', (13, 55), 'Завершите «Функции подробнее» и pytest'),
    'frame_circuit': ('Микросхема', 'topic_ids', (32, 33), 'Завершите классы и наследование'),
    'frame_paper': ('Блокнот', 'topic_ids', (17, 46), 'Завершите файлы и pathlib'),
    'frame_glacier': ('Ледяная грань', 'level', 'expert', 'Завершите экспертный уровень'),
    'frame_ember': ('Тёплый контур', 'xp', 3000, 'Наберите 3 000 XP'),
}

def evaluate(solved_ids, task_meta, task_xp):
    solved = set(solved_ids)
    topics = {}
    for task_id in task_meta:
        topics.setdefault(int(task_id.split('.')[0]), set()).add(task_id)
    completed = {topic for topic, tasks in topics.items() if tasks and tasks <= solved}
    xp = sum(task_xp.get(task_id, 0) for task_id in solved)
    result = {}
    for key, (name, kind, goal, requirement) in {**TITLE_REWARDS, **FRAME_REWARDS}.items():
        if kind == 'topics': current, target = len(completed), goal
        elif kind == 'xp': current, target = xp, goal
        elif kind == 'topic_ids': current, target = len(completed & set(goal)), len(goal)
        else:
            tasks = {task_id for task_id, level in task_meta.items() if level == goal}
            current, target = len(tasks & solved), len(tasks)
        reward_kind = 'frame' if key.startswith('frame_') else 'title'
        result[key] = dict(kind=reward_kind, title=('Рамка: ' if reward_kind=='frame' else 'Титул: ')+name, requirement=requirement,
                           current=min(current, target), target=target,
                           eligible=target > 0 and current >= target)
    return result
