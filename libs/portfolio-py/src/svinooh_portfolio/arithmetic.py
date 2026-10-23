import ast
import operator
from decimal import Decimal, localcontext

_OPERATIONS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
}


def evaluate(expression: str) -> Decimal:
    source = expression.replace(",", "").replace("$", "").strip()
    tree = ast.parse(source, mode="eval")
    with localcontext() as context:
        context.prec = 50
        return _value(tree.body, source)


def _value(node: ast.expr, source: str) -> Decimal:
    if isinstance(node, ast.Constant) and type(node.value) in (int, float):
        return Decimal(ast.get_source_segment(source, node) or str(node.value))
    if isinstance(node, ast.BinOp) and type(node.op) in _OPERATIONS:
        return _OPERATIONS[type(node.op)](_value(node.left, source), _value(node.right, source))
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
        return -_value(node.operand, source)
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.UAdd):
        return _value(node.operand, source)
    raise ValueError("Only numbers, + - * / and brackets can be calculated.")
