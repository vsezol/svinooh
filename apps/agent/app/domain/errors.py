"""What can go wrong with a turn, said without naming a status code.

Raised by the layers that decide — the caller has no message, the host will
not vouch for their token, they have asked too often, that conversation is
not theirs. Turning each into an HTTP answer is the wire's business
(app/api/errors.py), which is what lets the same rules serve a different
door later without a FastAPI import following them there.
"""


class AgentError(Exception):
    """Anything this service refuses to do, and knows why."""


class EmptyMessageError(AgentError):
    """A turn with nothing in it. Refused before any work is done."""


class UnknownTokenError(AgentError):
    """The host affirmatively rejected the caller's token.

    Only that: a host that cannot answer leaves the caller anonymous, because
    this gate names callers and never guards data (app/application/auth.py).
    """


class RateLimitedError(AgentError):
    """The caller's budget for this window is spent."""

    def __init__(self, retry_after: int) -> None:
        super().__init__(f"rate limited — try again in {retry_after}s")
        self.retry_after = retry_after


class NoSuchConversationError(AgentError):
    """No conversation at that id, or one that belongs to somebody else.

    Deliberately one error for both. A separate "not yours" would confirm the
    conversation exists, and a chat names positions and amounts — the privacy
    rule covers the fact of somebody having asked at all.
    """
