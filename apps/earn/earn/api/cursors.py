"""A `Resume` written down as an opaque string, and read back.

Opaque on purpose: clients must treat it as a token, not as a place to edit an
offset. The encoding is base64url of a tiny JSON object — enough that a bad one
is detected rather than misread, and cheap enough that no state is stored to
support it.

Why a cursor at all: the list is sorted by a number that changes all day. With
`skip=20`, a pool that was 19th when the client read page one can be 21st when
it asks for page two — the client sees it twice and never sees whatever took
its place. Offset paging is correct only over data that does not move.
"""
from __future__ import annotations

import base64
import binascii
import json

from earn.application.queries import Resume


class MalformedCursor(Exception):
    """Not a cursor this service issued."""


def encode(resume: Resume) -> str:
    raw = json.dumps(
        {"v": resume.catalog_version, "o": resume.offset, "q": resume.fingerprint},
        separators=(",", ":"),
    )
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def decode(cursor: str) -> Resume:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        data = json.loads(base64.urlsafe_b64decode(padded.encode()))
        return Resume(
            catalog_version=int(data["v"]), offset=int(data["o"]), fingerprint=str(data["q"])
        )
    except (KeyError, ValueError, TypeError, binascii.Error) as error:
        raise MalformedCursor from error
