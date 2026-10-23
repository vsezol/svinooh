from dataclasses import replace
from decimal import Decimal

from svinooh_portfolio import testing as fx

from app.adapters.memory import MemoryStrategies
from app.agent.prompts import LPDOWN
from app.agent.tools import liquidity_tools, lpdown_tools
from app.domain import lpdown
from app.domain.conversation import Turn
from app.domain.earn import LiquidityPosition, PairPool, Placement, Settled
from app.ports import Ask
from tests.support import Catalog, Intents, agent
from tests.test_graph import Api, Model

SOL = "So11111111111111111111111111111111111111112"
CBBTC = "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij"
XBTC = "2zCo6bUowJMvr89ajxuWsPadAqJ2F9akCkxumNsSdgsL"

POOL = PairPool(
    id="sol:meteora:dlmm:5rCf1D",
    name="SOL-USDC",
    x="SOL",
    y="USDC",
    x_mint=SOL,
    y_mint=lpdown.USDC,
    bin_step=4,
    fee_apr=Decimal("1.26"),
    tvl_usd=Decimal("3997422"),
    price=Decimal("120"),
    url="https://app.meteora.ag/dlmm/5rCf1D",
    range_bins=27,
    active_usd=Decimal("645338"),
    fee_active=Decimal("0.019"),
)
BTC = replace(
    POOL,
    id="sol:meteora:dlmm:7ubS3G",
    name="cbBTC-USDC",
    x="cbBTC",
    x_mint=CBBTC,
    price=Decimal("77200"),
    active_usd=Decimal("156129"),
    fee_active=Decimal("0.0053"),
)
XBTC_POOL = replace(
    POOL,
    id="sol:meteora:dlmm:4m1WVt",
    name="xBTC-USDC",
    x="xBTC",
    x_mint=XBTC,
    fee_active=Decimal("0.03"),
)
UNREAD = replace(POOL, id="sol:meteora:dlmm:UNREAD", fee_active=None, active_usd=None)
EMPTY = replace(
    POOL, id="sol:meteora:dlmm:EMPTY", fee_active=Decimal("0.4"), active_usd=Decimal("48")
)
TOO_FINE = replace(POOL, id="sol:meteora:dlmm:FINE", bin_step=1, why_not="too many bins")
BACKWARDS = replace(
    POOL, id="sol:meteora:dlmm:BACK", x="USDC", y="SOL", x_mint=lpdown.USDC, y_mint=SOL
)

MINE = "Def4KLpb8HGYtQK3zfHricbhiWbCamfVjKB4j1PEejmA"
OTHER = "99stbBgutZf1DsT6YeYJWpaE2b9gMJuKzwrUwPch1yXu"


def placed(price: str, address: str = MINE, lower: str = "118.8", upper: str = "120"):
    return LiquidityPosition(
        address=address,
        pool=replace(POOL, price=Decimal(price)),
        lower_price=Decimal(lower),
        upper_price=Decimal(upper),
        in_range=Decimal(lower) <= Decimal(price) <= Decimal(upper),
        amount_x=Decimal("0"),
        amount_y=Decimal("1500"),
        value_usd=Decimal("1500"),
        fees_usd=Decimal("0.4"),
    )


class TestTheCommand:
    def test_is_the_command_alone(self):
        assert lpdown.is_command("/lpdown")
        assert lpdown.is_command(" /LPDOWN ")
        assert not lpdown.is_command("/lpdownx")
        assert not lpdown.is_command("rebalance my position")

    def test_a_conversation_it_started_stays_its_own(self):
        history = (Turn(q="/lpdown", a="pick a pool", at=0),)
        assert lpdown.started("SOL-USDC", history)
        assert not lpdown.started("SOL-USDC", ())


class TestWhereThePriceIs:
    def test_over_the_top_by_more_than_a_quarter_percent_moves_it(self):
        assert lpdown.reading(placed("120.36")).where == "move"

    def test_over_the_top_by_less_waits(self):
        assert lpdown.reading(placed("120.24")).where == "waiting"

    def test_inside_waits(self):
        assert lpdown.reading(placed("119.5")).where == "waiting"

    def test_under_the_range_waits_holding_what_it_bought(self):
        assert lpdown.reading(placed("118")).where == "below"


def shelf(*pools: PairPool, usdc: str | None = "500") -> Catalog:
    catalog = Catalog()
    catalog.pairs = pools or (POOL, BTC, XBTC_POOL, UNREAD, EMPTY, TOO_FINE, BACKWARDS)
    if usdc is not None:
        catalog.wallet = {lpdown.USDC: Decimal(usdc)}
    return catalog


def its_tools(catalog: Catalog, prepared: list) -> dict:
    return {one.name: one for one in lpdown_tools(catalog, prepared, ("OWNER",))}


class TestThePoolsItOffers:
    async def test_sol_and_btc_pools_the_best_paying_first(self):
        catalog = shelf()
        said = await its_tools(catalog, [])["lpdown_pools"].ainvoke({})
        order = [line.split(" id ")[-1] for line in said.splitlines() if line.startswith("- ")]
        assert order == [POOL.id, BTC.id, UNREAD.id, EMPTY.id]
        assert "1.90% a day in fees on the $645k within 1% of the price" in said
        assert "id sol:meteora:dlmm:5rCf1D" in said
        assert "FINE" not in said and "BACK" not in said
        assert catalog.near_asked == lpdown.NEAR_PCT

    async def test_a_coin_named_like_btc_is_not_btc(self):
        said = await its_tools(shelf(), [])["lpdown_pools"].ainvoke({})
        assert "xBTC" not in said
        assert not lpdown.takes(XBTC_POOL)
        assert lpdown.takes(BTC)

    async def test_a_pool_with_next_to_nothing_near_the_price_is_not_ranked_on_it(self):
        said = await its_tools(shelf(), [])["lpdown_pools"].ainvoke({})
        assert "only $48 within 1% of the price, too little" in said

    async def test_it_says_what_they_hold_to_place(self):
        said = await its_tools(shelf(), [])["lpdown_pools"].ainvoke({})
        assert "out of the 500 they hold free" in said


class TestPlacingIt:
    async def test_the_card_is_usdc_from_one_percent_under_the_price_up_to_it(self):
        prepared: list = []
        said = await its_tools(shelf(), prepared)["propose_lpdown"].ainvoke(
            {"pool_id": POOL.id, "amount": "100"}
        )
        [card] = prepared
        assert isinstance(card, Placement)
        assert (card.action, card.pool.id, card.amount) == ("provide", POOL.id, Decimal("100"))
        assert (card.below_pct, card.above_pct) == (Decimal(1), Decimal(0))
        assert card.pay_with is not None and card.pay_with.mint == lpdown.USDC
        assert card.strategy == "lpdown"
        assert "Ready for the user to sign: 100 USDC into SOL-USDC" in said

    async def test_all_is_all_the_usdc_held(self):
        prepared: list = []
        await its_tools(shelf(usdc="321.5"), prepared)["propose_lpdown"].ainvoke(
            {"pool_id": BTC.id, "amount": "all"}
        )
        [card] = prepared
        assert card.amount == Decimal("321.5")

    async def test_more_than_is_held_is_not_placed(self):
        prepared: list = []
        said = await its_tools(shelf(), prepared)["propose_lpdown"].ainvoke(
            {"pool_id": POOL.id, "amount": "900"}
        )
        assert prepared == []
        assert "less than 900" in said

    async def test_a_pool_it_does_not_run_in_is_refused(self):
        prepared: list = []
        said = await its_tools(shelf(), prepared)["propose_lpdown"].ainvoke(
            {"pool_id": BACKWARDS.id, "amount": "100"}
        )
        assert prepared == []
        assert "No pool /lpdown can use" in said


def rebalance(position: LiquidityPosition, prepared: list, adopted: frozenset[str]):
    catalog = Catalog()
    catalog.pairs = (POOL,)
    catalog.placed = (position,)
    tools = liquidity_tools(catalog, catalog.placed, prepared, lpdown=adopted)
    return next(one for one in tools if one.name == "propose_rebalance")


class TestARebalance:
    async def test_the_position_it_opened_goes_back_under_the_price(self):
        prepared: list = []
        said = await rebalance(placed("121"), prepared, frozenset({MINE})).ainvoke(
            {"position": MINE}
        )
        [card] = prepared
        assert (card.below_pct, card.above_pct, card.strategy) == (
            Decimal(1),
            Decimal(0),
            "lpdown",
        )
        assert "by the /lpdown rules" in said

    async def test_under_its_range_nothing_is_sold(self):
        prepared: list = []
        said = await rebalance(placed("117"), prepared, frozenset({MINE})).ainvoke(
            {"position": MINE}
        )
        assert prepared == []
        assert "holds the SOL it bought on the way down" in said

    async def test_just_over_the_top_it_waits_for_the_quarter_percent(self):
        prepared: list = []
        said = await rebalance(placed("120.1"), prepared, frozenset({MINE})).ainvoke(
            {"position": MINE}
        )
        assert prepared == []
        assert "0.08% over now" in said

    async def test_any_other_position_keeps_its_width_as_before(self):
        prepared: list = []
        await rebalance(placed("121"), prepared, frozenset({OTHER})).ainvoke({"position": MINE})
        [card] = prepared
        assert (card.below_pct, card.above_pct, card.strategy) == (None, None, None)

    async def test_a_range_they_name_is_theirs(self):
        prepared: list = []
        await rebalance(placed("121"), prepared, frozenset({MINE})).ainvoke(
            {"position": MINE, "below_pct": "2", "above_pct": "2"}
        )
        [card] = prepared
        assert (card.below_pct, card.above_pct, card.strategy) == (Decimal(2), Decimal(2), None)


def solana(slug: str = "sol-pf") -> Api:
    wallet = fx.wallet(fx.SOL_ADDRESS, [fx.USDC_SOL], chain="SOL")
    return Api(owned=[slug], portfolio=fx.as_portfolio(fx.portfolio([wallet], slug=slug)))


async def run(ask: Ask, catalog: Catalog, strategies: MemoryStrategies, intent: str = "portfolio"):
    model = Model(text="told")
    answered = agent(
        model=model,
        portfolio=solana(),
        catalog=catalog,
        intents=Intents(intent),
        strategies=strategies,
    )
    return await answered.run(ask), model


def asked(question: str, *history: Turn) -> Ask:
    return Ask(question=question, history=history, portfolio="sol-pf", authorization="t")


class TestInAChat:
    async def test_the_command_is_placing_whatever_it_reads_as(self):
        _, model = await run(asked("/lpdown"), shelf(), MemoryStrategies())
        assert {"lpdown_pools", "propose_lpdown"} <= set(model.tools_bound)
        assert LPDOWN in model.prompts[-1]

    async def test_the_answers_that_follow_it_keep_its_tools(self):
        started = Turn(q="/lpdown", a="Which pool?", at=0)
        _, model = await run(asked("xBTC-USDC", started), shelf(), MemoryStrategies(), "general")
        assert "propose_lpdown" in model.tools_bound

    async def test_a_conversation_without_it_has_none_of_them(self):
        _, model = await run(
            asked("Rebalance my SOL-USDC position"), shelf(), MemoryStrategies(), "earn"
        )
        assert "propose_lpdown" not in model.tools_bound


def landed(**over) -> Ask:
    settled = Settled(
        amount="100",
        token="USDC",
        pool="SOL-USDC",
        status="landed",
        signature="SIG1",
        action="provide",
        strategy="lpdown",
    )
    return Ask(
        question="a deposit came back from the network",
        history=(Turn(q="/lpdown", a="ready to sign", at=0),),
        portfolio="sol-pf",
        authorization="t",
        settled=replace(settled, **over),
    )


class TestWhatItOpened:
    async def test_the_position_its_card_opened_is_its_own(self):
        catalog = shelf()
        catalog.opened = {("SIG1", fx.SOL_ADDRESS): (MINE,)}
        strategies = MemoryStrategies()
        await run(landed(), catalog, strategies)
        assert await strategies.lpdown("sol-pf") == frozenset({MINE})

    async def test_a_rebalance_it_made_hands_it_on_to_the_new_position(self):
        catalog = shelf()
        catalog.opened = {("SIG2", fx.SOL_ADDRESS): (OTHER,)}
        strategies = MemoryStrategies()
        await strategies.adopt("sol-pf", MINE)
        await run(landed(signature="SIG2", action="rebalance", position=MINE), catalog, strategies)
        assert await strategies.lpdown("sol-pf") == frozenset({OTHER})

    async def test_a_rebalance_to_a_range_of_their_own_leaves_it(self):
        catalog = shelf()
        catalog.opened = {("SIG3", fx.SOL_ADDRESS): (OTHER,)}
        strategies = MemoryStrategies()
        await strategies.adopt("sol-pf", MINE)
        await run(
            landed(signature="SIG3", action="rebalance", position=MINE, strategy=None),
            catalog,
            strategies,
        )
        assert await strategies.lpdown("sol-pf") == frozenset()

    async def test_ordinary_liquidity_is_not_its_own(self):
        catalog = shelf()
        catalog.opened = {("SIG4", fx.SOL_ADDRESS): (MINE,)}
        strategies = MemoryStrategies()
        await run(landed(signature="SIG4", strategy=None), catalog, strategies)
        assert await strategies.lpdown("sol-pf") == frozenset()
