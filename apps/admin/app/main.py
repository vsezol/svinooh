"""The admin panel.

Its own service, on its own domain, with one operator and one password. It is
not part of the public site and must never become reachable from it: it can
change how hard the whole system pushes, and it sits on a database where a
balance and the person holding it are one join apart.

SQLAdmin supplies the sign-in page, the session and the chrome; everything this
panel actually does is the throughput page, which is generated from the registry
the services read.
"""

from __future__ import annotations

import logging
import os

from fastapi import FastAPI
from sqladmin import Admin, ModelView

from .auth import AdminAuth, configured
from .db import Setting, engine
from .settings_view import ThroughputView

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
log = logging.getLogger("admin")

app = FastAPI(title="svinooh admin", docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/health")
async def health() -> dict[str, bool]:
    return {"ok": True}


class SettingAdmin(ModelView, model=Setting):
    """The raw rows, for reading and for the occasional escape hatch.

    The throughput page is how these are meant to be changed — it validates a
    value against its own bounds and against the other knobs. This view does
    neither, so it is here to show what is stored and to delete a row that
    should never have been written.
    """

    name = "Stored value"
    name_plural = "Stored values"
    icon = "fa-solid fa-sliders"
    column_list = [Setting.key, Setting.value, Setting.updatedBy, Setting.updatedAt]
    column_default_sort = [(Setting.key, False)]
    can_create = False
    can_edit = False
    page_size = 50


SESSION_SECRET = os.environ.get("ADMIN_SESSION_SECRET", "")
if not SESSION_SECRET:
    # A generated secret means every restart signs everybody out, which is
    # inconvenient and safe. An empty one would mean unsigned cookies.
    import secrets

    SESSION_SECRET = secrets.token_hex(32)
    log.warning("ADMIN_SESSION_SECRET is not set — sessions will not survive a restart")

if not configured():
    log.error("Neither ADMIN_PASSWORD_HASH nor ADMIN_PASSWORD is set — nobody can sign in")

admin = Admin(
    app=app,
    engine=engine,
    title="svinooh",
    authentication_backend=AdminAuth(secret_key=SESSION_SECRET),
    templates_dir=os.path.join(os.path.dirname(__file__), "templates"),
)
admin.add_view(ThroughputView)
admin.add_view(SettingAdmin)
