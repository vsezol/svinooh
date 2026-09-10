"""The dependency arrow, enforced rather than documented.

    api  ──▶  application  ──▶  domain  ◀──  infrastructure

Architecture that lives only in a README is architecture that lasts until the
first hurried import. This walks the source and fails the build instead.
"""
import ast
from pathlib import Path

import pytest

PACKAGE = Path(__file__).resolve().parent.parent / "earn"

#: Which of our own layers each layer may import from.
ALLOWED: dict[str, set[str]] = {
    "domain": {"domain"},
    "application": {"domain", "application"},
    "infrastructure": {"domain", "application", "infrastructure"},
    "api": {"domain", "application", "infrastructure", "api"},
}

#: Third-party packages each layer may not touch. The domain may not know that
#: anything is served over HTTP or validated by pydantic; the application may
#: know there is a port, but not what is on the other side of it.
FORBIDDEN: dict[str, set[str]] = {
    "domain": {"fastapi", "starlette", "httpx", "pydantic", "pydantic_settings"},
    "application": {"fastapi", "starlette", "httpx", "pydantic_settings"},
    "infrastructure": {"fastapi", "starlette"},
    "api": set(),
}


def modules() -> list[tuple[str, Path]]:
    return [
        (path.relative_to(PACKAGE).parts[0], path)
        for path in sorted(PACKAGE.rglob("*.py"))
        if path.relative_to(PACKAGE).parts[0] in ALLOWED
    ]


def imported_roots(source: Path) -> set[str]:
    roots: set[str] = set()
    for node in ast.walk(ast.parse(source.read_text())):
        if isinstance(node, ast.Import):
            roots.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            roots.add(node.module.split(".")[0])
    return roots


def imported_layers(source: Path) -> set[str]:
    layers: set[str] = set()
    for node in ast.walk(ast.parse(source.read_text())):
        if isinstance(node, ast.ImportFrom) and node.module and node.module.startswith("earn."):
            parts = node.module.split(".")
            if len(parts) > 1 and parts[1] in ALLOWED:
                layers.add(parts[1])
        elif isinstance(node, ast.Import):
            for alias in node.names:
                parts = alias.name.split(".")
                if parts[0] == "earn" and len(parts) > 1 and parts[1] in ALLOWED:
                    layers.add(parts[1])
    return layers


@pytest.mark.parametrize("layer,source", modules(), ids=lambda value: str(value))
def test_a_layer_imports_only_inwards(layer: str, source: Path):
    forbidden = imported_layers(source) - ALLOWED[layer]
    assert not forbidden, f"{source.name} is in `{layer}` and imports {sorted(forbidden)}"


@pytest.mark.parametrize("layer,source", modules(), ids=lambda value: str(value))
def test_a_layer_stays_out_of_frameworks_it_has_no_business_knowing(layer: str, source: Path):
    intruders = imported_roots(source) & FORBIDDEN[layer]
    assert not intruders, f"{source.name} is in `{layer}` and imports {sorted(intruders)}"


def test_the_domain_is_reachable_without_installing_a_web_framework():
    """The point of the arrow: the rules can be exercised with nothing running."""
    assert any(layer == "domain" for layer, _ in modules())
