"""Bounded, non-executing data-flow checks for authored introductory exercises.

Unsupported Python is reported separately, never guessed correct or incorrect.
This is a teaching check, not a security or general anti-cheat boundary.
"""
import ast as _ast
import io as _io
import json as _json
import tokenize as _tokenize


def validate_rule(rule):
    if not isinstance(rule, dict):
        raise ValueError('Правило исходника должно быть объектом')
    kind = rule.get('kind')
    fields = {
        'printed_sum': {'kind', 'terms'},
        'commented_notice': {'kind', 'note', 'lines'},
        'counter_events': {'kind', 'name', 'start', 'deltas'},
    }
    if kind not in fields or set(rule) != fields[kind]:
        raise ValueError('Неизвестное или неполное правило исходника')
    integers = lambda values: isinstance(values, list) and all(type(v) is int and v.bit_length() <= 128 for v in values)
    if kind == 'printed_sum':
        valid = integers(rule['terms']) and len(rule['terms']) == 2
    elif kind == 'commented_notice':
        valid = (isinstance(rule['note'], str) and 0 < len(rule['note']) <= 300
                 and isinstance(rule['lines'], list) and len(rule['lines']) == 2
                 and all(isinstance(v, str) and len(v) <= 300 for v in rule['lines']))
    else:
        valid = (isinstance(rule['name'], str) and rule['name'].isidentifier()
                 and type(rule['start']) is int and rule['start'].bit_length() <= 128
                 and integers(rule['deltas']) and 0 < len(rule['deltas']) <= 20)
    if not valid:
        raise ValueError('Неверные параметры правила исходника')


class _Unsupported(Exception):
    pass


class _Value:
    def __init__(self, value, operation='literal', children=()):
        if isinstance(value, str) and len(value) > 4096:
            raise _Unsupported()
        if type(value) is int and value.bit_length() > 256:
            raise _Unsupported()
        self.value, self.operation, self.children = value, operation, children
        self.counter = 0

    def walk(self):
        pending, seen = [self], set()
        while pending:
            value = pending.pop()
            if id(value) in seen:
                continue
            seen.add(id(value))
            yield value
            pending.extend(value.children)

    def literal(self, number):
        return any(v.operation == 'literal' and type(v.value) in (int, float) and v.value == number for v in self.walk())


class _Flow:
    def __init__(self, rule):
        self.rule, self.names, self.prints = rule, {}, []

    def binary(self, operator, left, right):
        if type(left.value) not in (int, float, str) or type(right.value) not in (int, float, str):
            raise _Unsupported()
        if isinstance(operator, _ast.Add):
            value, name = left.value + right.value, 'add'
        elif isinstance(operator, _ast.Sub):
            value, name = left.value - right.value, 'sub'
        elif isinstance(operator, _ast.Mult):
            if isinstance(left.value, str) or isinstance(right.value, str):
                raise _Unsupported()
            value, name = left.value * right.value, 'mul'
        elif isinstance(operator, _ast.Div):
            value, name = left.value / right.value, 'div'
        else:
            raise _Unsupported()
        return _Value(value, name, (left, right))

    def expression(self, node):
        if isinstance(node, _ast.Constant) and type(node.value) in (int, float, str, bool, type(None)):
            return _Value(node.value)
        if isinstance(node, _ast.Name):
            if node.id in self.names:
                return self.names[node.id]
            if node.id in ('print', 'str', 'int', 'float', 'sum'):
                return _Value(node.id, 'builtin')
            raise _Unsupported()
        if isinstance(node, (_ast.List, _ast.Tuple)):
            parts = tuple(self.expression(v) for v in node.elts)
            return _Value([v.value for v in parts], 'sequence', parts)
        if isinstance(node, _ast.UnaryOp) and isinstance(node.op, (_ast.USub, _ast.UAdd)):
            child = self.expression(node.operand)
            return _Value(-child.value if isinstance(node.op, _ast.USub) else +child.value, 'unary', (child,))
        if isinstance(node, _ast.BinOp):
            return self.binary(node.op, self.expression(node.left), self.expression(node.right))
        if isinstance(node, _ast.JoinedStr):
            parts = tuple(self.expression(v) for v in node.values)
            return _Value(''.join(v.value for v in parts), 'format', parts)
        if isinstance(node, _ast.FormattedValue):
            child = self.expression(node.value)
            value = child.value
            if node.conversion == 114:
                value = repr(value)
            elif node.conversion == 115:
                value = str(value)
            elif node.conversion == 97:
                value = ascii(value)
            spec = self.expression(node.format_spec).value if node.format_spec else ''
            return _Value(format(value, spec), 'format', (child,))
        if isinstance(node, _ast.Call):
            function = self.expression(node.func)
            if function.operation != 'builtin' or any(isinstance(v, _ast.Starred) for v in node.args):
                raise _Unsupported()
            arguments = tuple(self.expression(v) for v in node.args)
            keywords = {v.arg: self.expression(v.value).value for v in node.keywords}
            if function.value == 'print':
                if set(keywords) - {'sep', 'end'}:
                    raise _Unsupported()
                separator = keywords.get('sep', ' ')
                if separator is None:
                    separator = ' '
                if not isinstance(separator, str):
                    raise _Unsupported()
                self.prints.append((arguments, separator.join(str(v.value) for v in arguments)))
                return _Value(None, 'print', arguments)
            if keywords:
                raise _Unsupported()
            if function.value in ('str', 'int', 'float') and len(arguments) == 1:
                conversion = {'str': str, 'int': int, 'float': float}[function.value]
                return _Value(conversion(arguments[0].value), function.value, arguments)
            if function.value == 'sum' and 1 <= len(arguments) <= 2 and arguments[0].operation == 'sequence':
                result = arguments[1] if len(arguments) == 2 else _Value(0)
                for value in arguments[0].children:
                    result = self.binary(_ast.Add(), result, value)
                return result
        raise _Unsupported()

    def store(self, target, value):
        if isinstance(target, (_ast.Tuple, _ast.List)) and value.operation == 'sequence':
            if len(target.elts) != len(value.children):
                raise _Unsupported()
            for part, child in zip(target.elts, value.children):
                self.store(part, child)
            return
        if not isinstance(target, _ast.Name):
            raise _Unsupported()
        if self.rule['kind'] == 'counter_events' and target.id == self.rule['name']:
            previous = self.names.get(target.id)
            if value is previous:
                return
            if value.value == self.rule['start'] and type(value.value) is int and value.literal(self.rule['start']):
                value.counter = 1
            elif previous and previous.counter and previous.counter <= len(self.rule['deltas']):
                delta = self.rule['deltas'][previous.counter - 1]
                if len(value.children) == 2:
                    left, right = value.children
                    matched = ((value.operation == 'sub' and left is previous and right.value == -delta and right.literal(abs(delta)))
                               or (value.operation == 'add' and left is previous and right.value == delta and right.literal(abs(delta)))
                               or (value.operation == 'add' and right is previous and left.value == delta and left.literal(abs(delta))))
                    if matched:
                        value.counter = previous.counter + 1
        self.names[target.id] = value

    def read(self, tree):
        for node in tree.body:
            if isinstance(node, _ast.Assign):
                value = self.expression(node.value)
                for target in node.targets:
                    self.store(target, value)
            elif isinstance(node, _ast.AnnAssign) and node.value:
                self.store(node.target, self.expression(node.value))
            elif isinstance(node, _ast.AugAssign) and isinstance(node.target, _ast.Name) and node.target.id in self.names:
                self.store(node.target, self.binary(node.op, self.names[node.target.id], self.expression(node.value)))
            elif isinstance(node, _ast.Expr):
                self.expression(node.value)
            elif not isinstance(node, _ast.Pass):
                raise _Unsupported()


def inspect_source(source, rule):
    """Read source as data. Never eval, exec, import or call submitted expressions."""
    validate_rule(rule)
    try:
        if not isinstance(source, str) or len(source) > 60000:
            raise _Unsupported()
        tree = _ast.parse(source)
        if sum(1 for _ in _ast.walk(tree)) > 2000:
            raise _Unsupported()
        flow = _Flow(rule)
        flow.read(tree)
        printed = [value for arguments, _ in flow.prints for value in arguments]
        if rule['kind'] == 'printed_sum':
            a, b = rule['terms']
            found = any(value.operation == 'add' and len(value.children) == 2
                        and ((value.children[0].value == a and value.children[1].value == b
                              and value.children[0].literal(a) and value.children[1].literal(b))
                             or (value.children[0].value == b and value.children[1].value == a
                                 and value.children[0].literal(b) and value.children[1].literal(a)))
                        for root in printed for value in root.walk())
            message = 'Передайте в print результат сложения исходных чисел, а не готовый ответ или неиспользованное вычисление.'
        elif rule['kind'] == 'commented_notice':
            comments = [token.string[1:].strip() for token in _tokenize.generate_tokens(_io.StringIO(source).readline)
                        if token.type == _tokenize.COMMENT]
            normalize = lambda text: ' '.join(text.split()).casefold()
            found = any(normalize(rule['note']) == normalize(comment) for comment in comments) and [text for _, text in flow.prints] == rule['lines']
            message = 'Сохраните заметку как комментарий с # и две отдельные команды вывода.'
        else:
            final = flow.names.get(rule['name'])
            phase = len(rule['deltas']) + 1
            found = bool(final and final.counter == phase and any(v is final for root in printed for v in root.walk()))
            message = 'Начните с исходного запаса, отдельно измените эту переменную по каждому событию и выведите её результат.'
        return {'status': 'ok' if found else 'wrong', 'message': '' if found else message}
    except SyntaxError:
        return {'status': 'wrong', 'message': 'Сначала исправьте синтаксис программы.'}
    except (_Unsupported, ArithmeticError, TypeError, ValueError, RecursionError):
        return {'status': 'unsupported', 'message': 'Этот способ пока не удаётся проверить автоматически. Используйте прямые команды и промежуточные переменные из вводной темы; решение не отмечено неверным.'}
