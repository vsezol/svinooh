import itertools
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import replace
from datetime import UTC, datetime
from decimal import Decimal

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
from app.domain.earn import (
    CatalogSnapshot,
    Coin,
    DepositTerms,
    Held,
    LiquidityPosition,
    PairPool,
    YieldPool,
)
from app.panel import NOTHING_DECIDED, PanelValues
from app.settings import Settings


class FakeChatModel(GenericFakeChatModel):
    def bind_tools(self, _tools, **_kwargs):
        return self


def fake_model(text: str) -> FakeChatModel:
    return FakeChatModel(messages=itertools.repeat(AIMessage(content=text)))


class Intents:
    def __init__(
        self,
        label: str = "general",
        asked_to_place: bool = False,
        language: str = "English",
        risk: str = "low",
        lp_range: str = "said",
    ):
        self.label = label
        self.asked_to_place = asked_to_place
        self.language = language
        self.risk = risk
        self.lp_range = lp_range
        self.heard: tuple = ()

    async def classify(self, _question: str, history: tuple = ()) -> IntentLabel:
        self.heard = history
        stance = "placing" if self.asked_to_place else "asking"
        return IntentLabel(
            intent=self.label,
            reason="stubbed",
            stance=stance,
            language=self.language,
            risk=self.risk,
            lp_range=self.lp_range,
        )


class Confirmations:
    def __init__(self, decision: str | None = None):
        self.decision = decision

    async def classify(self, _reply: str) -> ConfirmationDecision:
        if self.decision is None:
            raise AssertionError("no confirmation expected on this path")
        return ConfirmationDecision(decision=self.decision, reason="stubbed")


class NoCatalog:
    async def best_pools(self, token, limit):
        raise AssertionError(f"the catalog was asked about {token or 'everything'}")


class Catalog:
    def __init__(self, *pools: YieldPool) -> None:
        self.pools = pools or (
            YieldPool(
                id="sol:kamino:vault:AAA",
                name="Steakhouse USDC",
                protocol="kamino",
                kind="vault",
                network="sol",
                token="USDC",
                apy_net=Decimal("0.0512"),
                apy_base=Decimal("0.0480"),
                apy_rewards=Decimal("0.0032"),
                apy_incentives=Decimal("0"),
                tvl_usd=Decimal("42000000"),
                url="https://kamino.com/earn/lend/AAA",
            ),
        )
        self.asked: list[tuple[str | None, int]] = []
        self.looked_up: list[str] = []
        self.held: tuple[Held, ...] = ()
        self.owners: list[str] = []
        self.coins: dict[str, Coin] = {}
        self.coins_asked: list[tuple[str, tuple[str, ...]]] = []
        self.terms = DepositTerms(
            program_id="KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD",
            address="AAAvaultAAA",
            token_mint="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            token_decimals=6,
            min_amount=Decimal("1"),
            shares_mint="SHARESmintAAA",
            shares_decimals=6,
            token_program="TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
            lending_market="7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF",
        )

    async def best_pools(self, token, limit) -> CatalogSnapshot:
        self.asked.append((token, limit))
        return CatalogSnapshot(pools=self.pools, as_of=datetime(2026, 9, 18, 12, 0, tzinfo=UTC))

    async def pool(self, pool_id: str) -> YieldPool | None:
        self.looked_up.append(pool_id)
        found = next((p for p in self.pools if p.id == pool_id), None)
        return replace(found, terms=self.terms) if found and self.terms else found

    async def positions(self, owner: str) -> tuple[Held, ...]:
        self.owners.append(owner)
        return self.held

    async def coin(self, query: str, owners: tuple[str, ...]) -> Coin | None:
        self.coins_asked.append((query, owners))
        return self.coins.get(query.upper())

    pairs: tuple[PairPool, ...] = ()
    placed: tuple[LiquidityPosition, ...] = ()

    async def pair_pools(self, first, second, below_pct, above_pct) -> tuple[PairPool, ...]:
        self.pairs_asked = (first, second, below_pct, above_pct)
        return self.pairs

    async def pair_pool(self, pool_id: str) -> PairPool | None:
        return next((pool for pool in self.pairs if pool.id == pool_id), None)

    async def liquidity_positions(self, owner: str) -> tuple[LiquidityPosition, ...]:
        return self.placed


class NoHost:
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
    def __init__(self) -> None:
        self.user_id: str | None = None

    async def authenticate(self, _token: str | None) -> Caller | None:
        return Caller(user_id=self.user_id) if self.user_id else None


class Meter:
    def __init__(self) -> None:
        self.charged: list[str] = []
        self.wait: int | None = None

    async def retry_after(self, key: str) -> int | None:
        self.charged.append(key)
        return self.wait


class Purse:
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


def models_of(model, settings: Settings | None = None) -> Models:
    return Models(settings or Settings(), factory=lambda _name, **_kwargs: model)


def agent(
    *,
    model=None,
    portfolio=None,
    intent: str = "general",
    confirmation: str | None = None,
    intents=None,
    confirmations=None,
    catalog=None,
    settings: Settings | None = None,
    panel: PanelValues = NOTHING_DECIDED,
) -> LangGraphAgent:
    settings = settings or Settings()
    config = Config(settings, StaticPanel(panel))
    return LangGraphAgent(
        config,
        portfolio if portfolio is not None else NoHost(),
        catalog if catalog is not None else NoCatalog(),
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
    catalog=None,
    door=None,
    limiter=None,
    allowance=None,
    store=None,
    settings: Settings | None = None,
    asked_to_place: bool = False,
) -> Container:
    settings = settings or Settings()
    panel = StaticPanel()
    config = Config(settings, panel)
    host = portfolio if portfolio is not None else NoHost()
    kept = store if store is not None else MemoryConversationStore()
    counters = rate_limit_storage()
    models = models_of(model if model is not None else fake_model("answered"), settings)
    who = Identity(door if door is not None else Door())
    sessions = SessionStore(kept, settings.history_max_messages, settings.chat_max_turns)
    meter = limiter if limiter is not None else WindowRateLimiter(1000, 60, counters)
    purse = allowance if allowance is not None else WindowAllowance(1000, 60, counters)
    shelf = catalog if catalog is not None else NoCatalog()
    bot = LangGraphAgent(
        config,
        host,
        shelf,
        models,
        Intents(intent, asked_to_place=asked_to_place),
        Confirmations(confirmation),
    )
    return Container(
        settings=settings,
        panel=panel,
        config=config,
        portfolio=host,
        catalog=shelf,
        identity=who,
        store=kept,
        sessions=sessions,
        limiter=meter,
        allowance=purse,
        agent=bot,
        turns=Turns(
            sessions, who, meter, purse, bot, settings.turn_timeout_s, settings.message_max_chars
        ),
        chats=Chats(sessions, who, settings.chat_list_limit),
    )


@asynccontextmanager
async def client_for(wired: Container) -> AsyncIterator[httpx.AsyncClient]:
    app = create_app(wired)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://agent"
    ) as client:
        yield client
