"""The one table this service writes, and the connection it writes it through.

Prisma owns the schema. Nothing here migrates anything, and nothing here should
ever be the reason a column exists — `Setting` is mirrored from
libs/db/prisma/schema.prisma, and the migration that creates it lives there with
all the others. This is a reader and a writer, not a second owner.
"""

from __future__ import annotations

import os

from sqlalchemy import DateTime, String, create_engine
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker


def database_url() -> str:
    """Postgres, as psycopg3 wants it spelled.

    Railway hands out `postgresql://…`, which SQLAlchemy resolves to psycopg2 —
    a driver we do not install. Naming the driver is the whole fix.
    """
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        raise RuntimeError("DATABASE_URL is not set")
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+psycopg://", 1)
    return url


class Base(DeclarativeBase):
    pass


class Setting(Base):
    """One tunable, as the admin last set it. See the Prisma model for the why."""

    __tablename__ = "Setting"

    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[dict] = mapped_column(JSONB, nullable=False)
    updatedBy: Mapped[str | None] = mapped_column(String, nullable=True)
    updatedAt: Mapped[object] = mapped_column(DateTime(timezone=False), nullable=False)

    def __str__(self) -> str:  # what SQLAdmin puts in a row heading
        return self.key


engine = create_engine(database_url(), pool_pre_ping=True, pool_size=2, max_overflow=2)
Session = sessionmaker(engine, expire_on_commit=False)
