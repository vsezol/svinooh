"""The service, wired for a test: real objects around fakes, in one place.

The same shape as app/container.py's build(), with the outside world
replaced — an in-memory store, a panel that decided nothing, a model that
answers what it is told to, a host that knows nobody. A test names only what
it is about; everything else is the working default. Nothing here patches a
module: what a test wants, it hands in.
"""

import itertools
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage

from app import create_app
from app.adapters.memory import MemoryConversationStore, StaticPanel, rate_limit_storage
from app.agent.graph import LangGraphAgent
from app.agent.intent import IntentLabel
from app.agent.llm import Models
from app.agent.onboarding import ConfirmationDecision
from app.application.auth import Caller
from app.application.chats import Chats
from app.application.identity import Identity
from app.application.limits import WindowAllowance, WindowRateLimiter
from app.application.sessions import SessionStore
from app.application.turns import Turns
from app.config import Config
from app.container import Container
from app.panel import NOTHING_DECIDED, PanelValues
from app.settings import Settings

# ── the fakes ───────────────────────────────────────────────────────────────


class FakeChatModel(GenericFakeChatModel):
    """langchain's stand-in, plus the one thing the graph does to a real model.

    The onboarding branch binds a tool before it asks, and GenericFakeChatModel
    raises on bind_tools. Without this a turn that lands on onboarding fails
    for a reason that exists only in the fake.
    """

    def bind_tools(self, _tools, **_kwargs):
        return self


def fake_model(text: str) -> FakeChatModel:
    """A model that answers `text`, as many times as it is asked."""
    return FakeChatModel(messages=itertools.repeat(AIMessage(content=text)))


class Intents:
    """A classifier that labels every question the same way."""

    def __init__(self, label: str = "general"):
        self.label = label

    async def classify(self, _question: str) -> IntentLabel:
        return IntentLabel(intent=self.label, reason="stubbed")


class Confirmations:
    """A classifier that reads every reply the same way, or objects to being asked."""

    def __init__(self, decision: str | None = None):
        self.decision = decision

    async def classify(self, _reply: str) -> ConfirmationDecision:
        if self.decision is None:
            raise AssertionError("no confirmation expected on this path")
        return ConfirmationDecision(decision=self.decision, reason="stubbed")


class NoHost:
    """The portfolio API in a test that must never reach it."""

    async def me(self, token):
        raise AssertionError("the host was asked who is asking")

    async def portfolio(self, ref, token):
        raise AssertionError(f"the host was asked for portfolio {ref}")

    async def history(self, ref, range_, token):
        raise AssertionError(f"the host was asked for history of {ref}")

    async def create_portfolio(self, token):
        raise AssertionError("the host was asked to create a portfolio")

    async def create_anonymous_portfolio(self, address):
        raise AssertionError("the host was asked to create an anonymous portfolio")

    async def add_wallet(self, slug, address, token):
        raise AssertionError("the host was asked to add a wallet")


class Door:
    """The host's answer to "whose token is this": nobody, until a test says who."""

    def __init__(self) -> None:
        self.user_id: str | None = None

    async def authenticate(self, _token: str | None) -> Caller | None:
        return Caller(user_id=self.user_id) if self.user_id else None


class Meter:
    """A cost lock that lets everybody through and remembers who it charged."""

    def __init__(self) -> None:
        self.charged: list[str] = []
        self.wait: int | None = None

    async def retry_after(self, key: str) -> int | None:
        self.charged.append(key)
        return self.wait


class Purse:
    """The free allowance as a number a test can set. None is unlimited."""

    def __init__(self, questions: int | None = None) -> None:
        self.questions = questions
        self.spent: dict[str, int] = {}

    async def charge(self, key: str) -> bool:
        if self.questions is None:
            return True
        if self.spent.get(key, 0) >= self.questions:
            return False
        self.spent[key] = self.spent.get(key, 0) + 1
        return True


# ── the builders ────────────────────────────────────────────────────────────


def models_of(model, settings: Settings | None = None) -> Models:
    """Models whose every client is this one object, whatever the role."""
    return Models(settings or Settings(), factory=lambda _name, **_kwargs: model)


def agent(
    *,
    model=None,
    portfolio=None,
    intent: str = "general",
    confirmation: str | None = None,
    intents=None,
    confirmations=None,
    settings: Settings | None = None,
    panel: PanelValues = NOTHING_DECIDED,
) -> LangGraphAgent:
    """The real graph over fakes."""
    settings = settings or Settings()
    config = Config(settings, StaticPanel(panel))
    return LangGraphAgent(
        config,
        portfolio if portfolio is not None else NoHost(),
        models_of(model if model is not None else fake_model("answered"), settings),
        intents if intents is not None else Intents(intent),
        confirmations if confirmations is not None else Confirmations(confirmation),
    )


def container(
    *,
    model=None,
    portfolio=None,
    intent: str = "general",
    confirmation: str | None = None,
    door=None,
    limiter=None,
    allowance=None,
    store=None,
    settings: Settings | None = None,
) -> Container:
    """The whole service over fakes, in the shape build() makes it."""
    settings = settings or Settings()
    panel = StaticPanel()
    config = Config(settings, panel)
    host = portfolio if portfolio is not None else NoHost()
    kept = store if store is not None else MemoryConversationStore()
    counters = rate_limit_storage()
    models = models_of(model if model is not None else fake_model("answered"), settings)
    who = Identity(door if door is not None else Door())
    sessions = SessionStore(kept, settings.history_max_messages, settings.chat_max_turns)
    # Generous by default: most tests ask far more than five questions.
    meter = limiter if limiter is not None else WindowRateLimiter(1000, 60, counters)
    purse = allowance if allowance is not None else WindowAllowance(1000, 60, counters)
    bot = LangGraphAgent(config, host, models, Intents(intent), Confirmations(confirmation))
    return Container(
        settings=settings,
        panel=panel,
        config=config,
        portfolio=host,
        identity=who,
        store=kept,
        sessions=sessions,
        limiter=meter,
        allowance=purse,
        agent=bot,
        turns=Turns(sessions, who, meter, purse, bot),
        chats=Chats(sessions, who, settings.chat_list_limit),
    )


@asynccontextmanager
async def client_for(wired: Container) -> AsyncIterator[httpx.AsyncClient]:
    """An HTTP client on the app, over a real ASGI transport."""
    app = create_app(wired)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://agent"
    ) as client:
        yield client
