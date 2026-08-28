"""The throughput page: the whole registry as one form, and the presets over it.

Nothing here is hand-written per knob. The fields, their bounds, their units and
their help text all come out of the registry, so a knob added to that file turns
up here with no code change — which is the only way a settings page stays true
to what the services actually read.
"""

from __future__ import annotations

import datetime as dt

from sqladmin import BaseView, expose
from starlette.requests import Request
from starlette.responses import RedirectResponse

from .db import Session, Setting
from .registry import Preset, Spec, registry, validate


def stored() -> dict[str, int]:
    """Only the keys somebody has actually changed."""
    with Session() as session:
        return {row.key: int(row.value) for row in session.query(Setting).all()}


def effective() -> dict[str, int]:
    """What the services are running on: a stored value, or the declared default.

    The environment sits between those two for the services themselves, and this
    page cannot see it — a service's own environment is its own. So a row shows
    the default when nothing is stored, and says so, rather than claiming to know
    what a particular container was started with.
    """
    current = stored()
    return {spec.key: current.get(spec.key, spec.default) for spec in registry().specs}


def write(values: dict[str, int], who: str) -> None:
    """Store the ones that differ from the default, delete the ones that do not.

    A row means a decision. Writing every key on every save would turn the table
    into a second copy of the defaults, and then changing a default in the
    registry would silently change nothing.
    """
    now = dt.datetime.now(dt.UTC).replace(tzinfo=None)
    with Session() as session:
        existing = {row.key: row for row in session.query(Setting).all()}
        for spec in registry().specs:
            value = values.get(spec.key, spec.default)
            row = existing.get(spec.key)
            if value == spec.default:
                if row is not None:
                    session.delete(row)
                continue
            if row is None:
                session.add(Setting(key=spec.key, value=value, updatedBy=who, updatedAt=now))
            elif int(row.value) != value:
                row.value = value
                row.updatedBy = who
                row.updatedAt = now
        session.commit()


def matching_preset(values: dict[str, int]) -> str | None:
    for preset in registry().presets:
        if all(values.get(k) == v for k, v in preset.values.items()):
            return preset.key
    return None


class ThroughputView(BaseView):
    name = "Throughput"
    icon = "fa-solid fa-gauge-high"

    @expose("/throughput", methods=["GET", "POST"])
    async def page(self, request: Request):
        reg = registry()
        problems: list[str] = []
        saved = False

        if request.method == "POST":
            form = await request.form()
            preset_key = str(form.get("preset", ""))
            if preset_key:
                preset: Preset | None = next((p for p in reg.presets if p.key == preset_key), None)
                proposed = effective() | (preset.values if preset else {})
            else:
                proposed = {}
                for spec in reg.specs:
                    raw = str(form.get(spec.key, "")).strip()
                    try:
                        proposed[spec.key] = int(raw)
                    except ValueError:
                        problems.append(f"{spec.label}: {raw or 'blank'} is not a whole number")
            if not problems:
                problems = validate(proposed)
            if not problems:
                write(proposed, str(request.session.get("user", "?")))
                saved = True

        values = effective()
        return await self.templates.TemplateResponse(
            request,
            "throughput.html",
            {
                "groups": reg.groups,
                "specs_in": {g["key"]: reg.in_group(g["key"]) for g in reg.groups},
                "values": values,
                "stored": stored(),
                "presets": reg.presets,
                "active_preset": matching_preset(values),
                "problems": problems,
                "saved": saved,
                "refresh_sec": 15,
            },
        )
