class AgentError(Exception):
    """Anything this service refuses to do, and knows why."""


class EmptyMessageError(AgentError):
    """A turn with nothing in it. Refused before any work is done."""


class MessageTooLongError(AgentError):
    def __init__(self, limit: int) -> None:
        super().__init__(f"message too long — at most {limit} characters")
        self.limit = limit


class TurnTimedOutError(AgentError):
    """The turn ran past its deadline and was given up on.

    An ending, rather than a connection held open on work nobody is waiting
    for any more.
    """


class RateLimitedError(AgentError):
    def __init__(self, retry_after: int) -> None:
        super().__init__(f"rate limited — try again in {retry_after}s")
        self.retry_after = retry_after


class NoSuchConversationError(AgentError):
    """No conversation at that id, or one that belongs to somebody else.

    Deliberately one error for both. A separate "not yours" would confirm the
    conversation exists, and a chat names positions and amounts — the privacy
    rule covers the fact of somebody having asked at all.
    """
