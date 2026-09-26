from dataclasses import replace
from decimal import Decimal

from app.adapters.memory import MemoryStrategies
from app.agent.tools import liquidity_tools
from app.domain import lpdown
from app.domain.earn import LiquidityPosition, PairPool, Placement
from app.ports import Ask
from tests import fixtures as fx
from tests.support import Catalog, Intents, agent
from tests.test_graph import Api, Model

POOL = PairPool(
    id="sol:meteora:dlmm:HTvjzs",
    name="SOL-USDC",
    x="SOL",
    y="USDC",
    x_mint=lpdown.SOL,
    y_mint=lpdown.USDC,
    bin_step=4,
    fee_apr=Decimal("0.42"),
    tvl_usd=Decimal("4200000"),
    price=Decimal("120"),
    url="https://app.meteora.ag/dlmm/HTvjzs",
)

THIN = replace(POOL, id="sol:meteora:dlmm:THIN", tvl_usd=Decimal("90000"))
TOO_FINE = replace(
    POOL, id="sol:meteora:dlmm:FINE", bin_step=1, tvl_usd=Decimal("9000000"), why_not="too many"
)
BACKWARDS = replace(
    POOL, id="sol:meteora:dlmm:BACK", x="USDC", y="SOL", x_mint=lpdown.USDC, y_mint=lpdown.SOL
)


def placed(price: str, lower: str = "118.8", upper: str = "120") -> LiquidityPosition:
    return LiquidityPosition(
        address="Def4KLpb8HGYtQK3zfHricbhiWbCamfVjKB4j1PEejmA",
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
    def test_is_only_the_command(self):
        assert lpdown.command("rebalance my SOL-USDC position") is None
        assert lpdown.command("/lpdownx 10") is None

    def test_says_how_much_or_all_or_off(self):
        assert lpdown.command("/lpdown") == lpdown.Command()
        assert lpdown.command("/LpDown 250") == lpdown.Command(amount=Decimal("250"))
        assert lpdown.command("/lpdown 1,5") == lpdown.Command(amount=Decimal("1.5"))
        assert lpdown.command("/lpdown все") == lpdown.Command(everything=True)
        assert lpdown.command("/lpdown off") == lpdown.Command(off=True)
        assert lpdown.command("/lpdown -5") == lpdown.Command()


class TestWhereThePriceIs:
    def test_over_the_top_by_more_than_a_quarter_percent_moves_it(self):
        assert lpdown.reading(placed("120.36")).where == "move"

    def test_over_the_top_by_less_waits(self):
        assert lpdown.reading(placed("120.24")).where == "waiting"

    def test_inside_waits(self):
        assert lpdown.reading(placed("119.5")).where == "waiting"

    def test_under_the_range_waits_holding_what_it_bought(self):
        assert lpdown.reading(placed("118")).where == "below"


def rebalance_tool(position: LiquidityPosition, prepared: list, running: bool = True):
    catalog = Catalog()
    catalog.pairs = (POOL,)
    catalog.placed = (position,)
    tools = liquidity_tools(catalog, catalog.placed, prepared, lpdown=running)
    return next(one for one in tools if one.name == "propose_rebalance")


class TestARebalanceWhileItRuns:
    async def test_over_the_top_it_goes_back_under_the_price(self):
        prepared: list = []
        said = await rebalance_tool(placed("121"), prepared).ainvoke(
            {"position": "Def4KLpb8HGYtQK3zfHricbhiWbCamfVjKB4j1PEejmA"}
        )
        [card] = prepared
        assert isinstance(card, Placement)
        assert (card.action, card.below_pct, card.above_pct) == (
            "rebalance",
            Decimal(1),
            Decimal(0),
        )
        assert "by the /lpdown rules" in said

    async def test_under_the_range_nothing_is_sold(self):
        prepared: list = []
        said = await rebalance_tool(placed("117"), prepared).ainvoke(
            {"position": "Def4KLpb8HGYtQK3zfHricbhiWbCamfVjKB4j1PEejmA"}
        )
        assert prepared == []
        assert "waits for the price to come back" in said

    async def test_just_over_the_top_it_waits_for_the_quarter_percent(self):
        prepared: list = []
        said = await rebalance_tool(placed("120.1"), prepared).ainvoke(
            {"position": "Def4KLpb8HGYtQK3zfHricbhiWbCamfVjKB4j1PEejmA"}
        )
        assert prepared == []
        assert "0.08% over now" in said

    async def test_a_range_they_name_is_theirs(self):
        prepared: list = []
        await rebalance_tool(placed("121"), prepared).ainvoke(
            {
                "position": "Def4KLpb8HGYtQK3zfHricbhiWbCamfVjKB4j1PEejmA",
                "below_pct": "2",
                "above_pct": "2",
            }
        )
        [card] = prepared
        assert (card.below_pct, card.above_pct) == (Decimal(2), Decimal(2))

    async def test_bounds_they_name_as_prices_are_theirs_too(self):
        prepared: list = []
        await rebalance_tool(placed("121"), prepared).ainvoke(
            {
                "position": "Def4KLpb8HGYtQK3zfHricbhiWbCamfVjKB4j1PEejmA",
                "lower_price": "114.95",
                "upper_price": "127.05",
            }
        )
        [card] = prepared
        assert (card.below_pct, card.above_pct) == (Decimal("5.0000"), Decimal("5.0000"))

    async def test_without_it_a_rebalance_keeps_its_width(self):
        prepared: list = []
        await rebalance_tool(placed("121"), prepared, running=False).ainvoke(
            {"position": "Def4KLpb8HGYtQK3zfHricbhiWbCamfVjKB4j1PEejmA"}
        )
        [card] = prepared
        assert (card.below_pct, card.above_pct) == (None, None)


def solana(slug: str = "sol-pf") -> Api:
    wallet = fx.wallet(fx.SOL_ADDRESS, [fx.USDC_SOL], chain="SOL")
    return Api(owned=[slug], portfolio=fx.as_portfolio(fx.portfolio([wallet], slug=slug)))


def shelf(*placed_: LiquidityPosition, usdc: str | None = "500") -> Catalog:
    catalog = Catalog()
    catalog.pairs = (THIN, TOO_FINE, BACKWARDS, POOL)
    catalog.placed = placed_
    if usdc is not None:
        catalog.wallet = {lpdown.USDC: Decimal(usdc)}
    return catalog


async def run(
    question: str,
    catalog: Catalog,
    strategies: MemoryStrategies | None = None,
    intent: str = "general",
    model: Model | None = None,
):
    model = model if model is not None else Model(text="told")
    strategies = strategies if strategies is not None else MemoryStrategies()
    answered = agent(
        model=model,
        portfolio=solana(),
        catalog=catalog,
        intents=Intents(intent),
        strategies=strategies,
    )
    reply = await answered.run(Ask(question=question, portfolio="sol-pf", authorization="t"))
    return reply, model, strategies


class TestTheCommandInAChat:
    async def test_with_an_amount_it_opens_under_the_price_in_the_pool_with_most_money(self):
        reply, model, strategies = await run("/lpdown 100", shelf())
        [card] = reply.deposits
        assert isinstance(card, Placement)
        assert (card.action, card.pool.id, card.amount) == ("provide", POOL.id, Decimal("100"))
        assert (card.below_pct, card.above_pct) == (Decimal(1), Decimal(0))
        assert card.pay_with is not None and card.pay_with.mint == lpdown.USDC
        assert await strategies.running("sol-pf")
        assert "A card is ready: 100 USDC into SOL-USDC" in model.prompts[-1]

    async def test_all_is_all_the_usdc_held(self):
        reply, _, _ = await run("/lpdown all", shelf(usdc="321.5"))
        [card] = reply.deposits
        assert card.amount == Decimal("321.5")

    async def test_without_an_amount_it_asks_for_one(self):
        reply, model, _ = await run("/lpdown", shelf())
        assert reply.deposits == ()
        assert "They hold 500 USDC free. Ask how much USDC to place" in model.prompts[-1]

    async def test_more_than_is_held_is_not_placed(self):
        reply, model, _ = await run("/lpdown 900", shelf())
        assert reply.deposits == ()
        assert "less than 900" in model.prompts[-1]

    async def test_a_position_over_its_top_is_moved_up(self):
        reply, _, _ = await run("/lpdown", shelf(placed("121")))
        [card] = reply.deposits
        assert isinstance(card, Placement)
        assert (card.action, card.below_pct, card.above_pct) == (
            "rebalance",
            Decimal(1),
            Decimal(0),
        )

    async def test_a_position_under_its_range_is_left_alone(self):
        reply, model, _ = await run("/lpdown", shelf(placed("117")))
        assert reply.deposits == ()
        assert "the strategy waits for the price to come back" in model.prompts[-1]

    async def test_it_is_the_command_whatever_the_question_reads_as(self):
        reply, _, _ = await run("/lpdown 100", shelf(), intent="portfolio")
        assert len(reply.deposits) == 1

    async def test_off_stops_it_and_places_nothing(self):
        strategies = MemoryStrategies()
        await strategies.run("sol-pf", True)
        reply, _, _ = await run("/lpdown off", shelf(placed("121")), strategies)
        assert reply.deposits == ()
        assert not await strategies.running("sol-pf")

    async def test_a_rebalance_asked_in_words_follows_it_once_it_runs(self):
        strategies = MemoryStrategies()
        await strategies.run("sol-pf", True)
        pressed = Model(
            tool_calls=[
                {
                    "name": "propose_rebalance",
                    "args": {"position": "Def4KLpb8HGYtQK3zfHricbhiWbCamfVjKB4j1PEejmA"},
                    "id": "call-1",
                }
            ],
            text="told",
        )
        reply, _, _ = await run(
            "Rebalance my SOL-USDC position", shelf(placed("121")), strategies, "earn", pressed
        )
        [card] = reply.deposits
        assert isinstance(card, Placement)
        assert (card.below_pct, card.above_pct) == (Decimal(1), Decimal(0))
