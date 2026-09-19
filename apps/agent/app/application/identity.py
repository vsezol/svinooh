from ..domain.identity import Owner, clean_anon_id
from .auth import Authenticator


class Identity:
    def __init__(self, authenticator: Authenticator) -> None:
        self._authenticator = authenticator

    async def resolve(self, authorization: str | None, anon_id: str | None) -> Owner | None:
        caller = await self._authenticator.authenticate(authorization)
        anon = clean_anon_id(anon_id)
        if caller and caller.user_id:
            return Owner.for_user(caller.user_id, anon)
        if anon:
            return Owner.for_browser(anon)
        return None
