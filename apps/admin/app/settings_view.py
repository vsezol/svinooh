"""The throughput page: an input per knob, and nothing else.

Nothing here is hand-written per knob. The fields, their bounds and their units
come out of the registry, so a knob added to that file turns up here with no
code change — which is the only way a settings page stays true to what the
services actually read.

The three that decide the pacing are the page; everything else is under
Advanced. A page that gives equal weight to "how often do we rescan a portfolio
somebody is watching" and "how many parallel requests per HTTP scan" is a page
nobody reads.
"""

from __future__ import annotations

import datetime as dt

from sqladmin import BaseView, expose
from starlette.requests import Request
from starlette.responses import RedirectResponse

from .db import Session, Setting
from .registry import registry, validate


def stored() -> dict[str, int | str]:
    """Only the keys somebody has actually changed."""
    with Session() as session:
        return {row.key: row.value for row in session.query(Setting).all()}


def effective() -> dict[str, int | str]:
    """What the services are running on: a stored value, or the declared default.

    The environment sits between those two for the services themselves, and this
    page cannot see it — a service's own environment is its own. So a row shows
    the default when nothing is stored, and says so, rather than claiming to know
    what a particular container was started with.
    """
    current = stored()
    return {spec.key: current.get(spec.key, spec.default) for spec in registry().specs}


def write(values: dict[str, int | str], who: str) -> None:
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
            elif row.value != value:
                row.value = value
                row.updatedBy = who
                row.updatedAt = now
        session.commit()


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
            proposed = {}
            for spec in reg.specs:
                raw = str(form.get(spec.key, "")).strip()
                if spec.is_choice:
                    proposed[spec.key] = raw
                    continue
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
                # The pacing model, and the machinery behind it
                "main": reg.in_group("sync"),
                "advanced": [s for s in reg.specs if s.group != "sync"],
                "values": values,
                "problems": problems,
                "saved": saved,
                "refresh_sec": 15,
            },
        )
