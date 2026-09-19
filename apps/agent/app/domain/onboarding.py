from dataclasses import dataclass


@dataclass(frozen=True)
class Refused:
    address: str
    reason: str


@dataclass(frozen=True)
class Created:
    slug: str
    added: tuple[str, ...] = ()
    refused: tuple[Refused, ...] = ()
    anonymous: bool = False
