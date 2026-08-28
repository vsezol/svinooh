"""The tunables, read from the same file the Node services read.

There is deliberately no second copy of these declarations. A knob is added to
libs/common/settings/registry.json and appears here — with its bounds, its unit
and its default — and in the services, with the same default. Anything this
module knows about a setting, the services know too, because it is the same
bytes.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

def candidates() -> list[Path]:
    """Where to look, nearest first: an explicit path, then the copy the image
    puts beside the app, then the repo itself when running from a checkout.

    Built when it is needed rather than at import. `parents[3]` is only a valid
    index inside the repo — in the container the app sits three levels shallower
    and computing it at import time took the whole process down before any
    candidate had been tried.
    """
    here = Path(__file__).resolve()
    found: list[Path] = []
    explicit = os.environ.get("SETTINGS_REGISTRY")
    if explicit:
        found.append(Path(explicit))
    found.append(here.parent.parent / "registry.json")
    if len(here.parents) > 3:
        found.append(here.parents[3] / "libs" / "common" / "settings" / "registry.json")
    return found


@dataclass(frozen=True)
class Spec:
    key: str
    group: str
    label: str
    about: str
    unit: str | None
    default: int
    minimum: int
    maximum: int
    env: str
    read_by: tuple[str, ...]
    live: bool
    note: str | None


@dataclass(frozen=True)
class Rule:
    id: str
    about: str
    left: str
    left_scale: int
    right: tuple[str, ...]


@dataclass(frozen=True)
class Preset:
    key: str
    label: str
    about: str
    values: dict[str, int]


@dataclass(frozen=True)
class Registry:
    groups: tuple[dict, ...]
    specs: tuple[Spec, ...]
    rules: tuple[Rule, ...]
    presets: tuple[Preset, ...]

    def by_key(self, key: str) -> Spec | None:
        return next((s for s in self.specs if s.key == key), None)

    def in_group(self, group: str) -> list[Spec]:
        return [s for s in self.specs if s.group == group]


@lru_cache(maxsize=1)
def registry() -> Registry:
    looked = candidates()
    for path in looked:
        if path.is_file():
            raw = json.loads(path.read_text())
            break
    else:
        raise RuntimeError(f"registry.json not found; looked in {[str(p) for p in looked]}")

    return Registry(
        groups=tuple(raw["groups"]),
        specs=tuple(
            Spec(
                key=s["key"],
                group=s["group"],
                label=s["label"],
                about=s["about"],
                unit=s.get("unit"),
                default=s["default"],
                minimum=s["min"],
                maximum=s["max"],
                env=s["env"],
                read_by=tuple(s["readBy"]),
                live=s.get("live", True),
                note=s.get("note"),
            )
            for s in raw["settings"]
        ),
        rules=tuple(
            Rule(id=r["id"], about=r["about"], left=r["left"], left_scale=r["leftScale"], right=tuple(r["right"]))
            for r in raw["rules"]
        ),
        presets=tuple(
            Preset(key=p["key"], label=p["label"], about=p["about"], values=p["values"]) for p in raw["presets"]
        ),
    )


def validate(values: dict[str, int]) -> list[str]:
    """Every reason this set of values cannot be saved, or an empty list.

    Two kinds of check, and the second is the one an environment variable could
    never do: a knob against its own bounds, and knobs against each other. A
    lease that expires before the scan it is leasing has finished is a valid
    integer and a broken system.
    """
    reg = registry()
    problems: list[str] = []

    for key, value in values.items():
        spec = reg.by_key(key)
        if spec is None:
            problems.append(f"{key}: not a setting")
        elif value < spec.minimum or value > spec.maximum:
            unit = f" {spec.unit}" if spec.unit else ""
            problems.append(f"{spec.label}: {value}{unit} is outside {spec.minimum}–{spec.maximum}{unit}")

    if problems:
        return problems

    for rule in reg.rules:
        left_spec = reg.by_key(rule.left)
        if left_spec is None:
            continue
        left = values.get(rule.left, left_spec.default) * rule.left_scale
        right = 0
        for key in rule.right:
            spec = reg.by_key(key)
            if spec is not None:
                right += values.get(key, spec.default)
        if left < right:
            problems.append(rule.about)

    return problems
