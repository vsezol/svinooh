from dataclasses import replace
from decimal import Decimal

from svinooh_portfolio import testing as fx

from app.agent.context import placed_lines, replayed
from app.agent.tools import liquidity_tools
from app.api.routes import _deposit_card
from app.domain.conversation import Turn
from app.domain.earn import Coin, Held, LiquidityPosition, PairPool, Placement, YieldPool
from tests.support import Catalog

PAIR = PairPool(
    id="sol:meteora:dlmm:CgqwPL",
    name="SOL-USDC",
    x="SOL",
    y="USDC",
    x_mint="So11111111111111111111111111111111111111112",
    y_mint="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    bin_step=80,
    fee_apr=Decimal("0.1996"),
    tvl_usd=Decimal("683653"),
    price=Decimal("117.25"),
    url="https://app.meteora.ag/dlmm/CgqwPL",
    range_bins=22,
)

NARROW = replace(
    PAIR,
    id="sol:meteora:dlmm:NARROW",
    bin_step=4,
    range_bins=407,
    why_not="10.3% below and 5.5% above is 407 of SOL-USDC's bins, 0.04% each",
)

OUT = LiquidityPosition(
    address="8PBf2k9bvDgWTWs8HjrwDXzhGfwsLgM1AHvHYfLPcCp",
    pool=PAIR,
    lower_price=Decimal("75.05"),
    upper_price=Decimal("110.42"),
    in_range=False,
    amount_x=Decimal("0"),
    amount_y=Decimal("12.15"),
    value_usd=Decimal("12.15"),
    fees_usd=Decimal("0.03"),
)


def shelf(*pools: PairPool, placed: tuple[LiquidityPosition, ...] = ()) -> Catalog:
    catalog = Catalog()
    catalog.pairs = pools or (PAIR,)
    catalog.placed = placed
    return catalog


PRIME = YieldPool(
    id="sol:kamino:vault:9E69U4GzWhryRaPe8DYpco6Z9vTZY6gg8w6W2QsBACEj",
    name="USDC Prime",
    protocol="kamino",
    kind="vault",
    network="sol",
    token="USDC",
    apy_net=Decimal("0.042"),
    apy_base=Decimal("0.042"),
    apy_rewards=Decimal("0"),
    apy_incentives=Decimal("0"),
    tvl_usd=Decimal("9000000"),
    url="https://kamino.com/earn/lend/9E69U4GzWhryRaPe8DYpco6Z9vTZY6gg8w6W2QsBACEj",
)

IN_PRIME = Held(pool=PRIME, amount=Decimal("12.008635"))

OWNER = "5Hb8BfQVmvEhaKsoXBV2g3EExoqTCKsVNXrGsrbadHJS"


def tools(
    catalog: Catalog,
    prepared: list,
    range_known: bool = True,
    free: dict[str, Decimal] | None = None,
    held: tuple[Held, ...] = (),
    owners: tuple[str, ...] = (),
) -> dict:
    return {
        one.name: one
        for one in liquidity_tools(
            catalog, catalog.placed, prepared, range_known, free, held, owners
        )
    }


class TestReadingThePoolsOfAPair:
    async def test_each_pool_says_its_fee_rate_its_bins_and_whether_the_range_fits(self):
        found = await tools(shelf(PAIR, NARROW), [])["liquidity_pools"].ainvoke(
            {"pair": "SOL-USDC", "below_pct": "10.3", "above_pct": "5.5"}
        )
        assert "SOL-USDC (Meteora DLMM, bins 0.8% apart) pays 19.96% a year" in found
        assert "That range is 22 of its bins: one position holds it." in found
        assert "407 of SOL-USDC's bins" in found
        assert "id sol:meteora:dlmm:CgqwPL" in found

    async def test_the_range_reaches_earn_as_percent(self):
        catalog = shelf()
        await tools(catalog, [])["liquidity_pools"].ainvoke(
            {"pair": "usdc/sol", "below_pct": "-10.3%", "above_pct": "+5.5%"}
        )
        assert catalog.pairs_asked == ("usdc", "sol", Decimal("10.3"), Decimal("5.5"))

    async def test_a_pair_is_two_tickers(self):
        said = await tools(shelf(), [])["liquidity_pools"].ainvoke({"pair": "SOL"})
        assert "two tickers joined by a dash" in said


class TestPlacingLiquidity:
    async def test_nothing_is_placed_until_they_have_said_a_range(self):
        prepared: list = []
        said = await tools(shelf(), prepared, range_known=False)["propose_liquidity"].ainvoke(
            {
                "pool_id": PAIR.id,
                "amount": "5",
                "token": "USDC",
                "below_pct": "10.3",
                "above_pct": "5.5",
            }
        )
        assert prepared == []
        assert "Ask it with buttons" in said

    async def test_a_chosen_amount_and_range_is_a_card_paid_in_one_of_the_two_tokens(self):
        prepared: list = []
        said = await tools(shelf(), prepared)["propose_liquidity"].ainvoke(
            {
                "pool_id": PAIR.id,
                "amount": "5",
                "token": "usdc",
                "below_pct": "10.3",
                "above_pct": "5.5",
            }
        )
        (card,) = prepared
        assert isinstance(card, Placement) and card.action == "provide"
        assert card.amount == Decimal("5") and card.pay_with and card.pay_with.symbol == "USDC"
        assert (card.below_pct, card.above_pct) == (Decimal("10.3"), Decimal("5.5"))
        assert "swapped into SOL so both sides of the range fill" in said
        assert "0.057 SOL of rent" in said

    async def test_a_token_the_pool_does_not_take_is_named_back(self):
        prepared: list = []
        said = await tools(shelf(), prepared)["propose_liquidity"].ainvoke(
            {"pool_id": PAIR.id, "amount": "5", "token": "BONK", "below_pct": "5", "above_pct": "5"}
        )
        assert prepared == []
        assert "takes SOL and USDC" in said

    async def test_a_range_the_pool_cannot_hold_is_refused_with_why(self):
        prepared: list = []
        said = await tools(shelf(NARROW), prepared)["propose_liquidity"].ainvoke(
            {
                "pool_id": NARROW.id,
                "amount": "5",
                "token": "USDC",
                "below_pct": "10.3",
                "above_pct": "5.5",
            }
        )
        assert prepared == []
        assert "407 of SOL-USDC's bins" in said


CARD = {
    "pool_id": PAIR.id,
    "amount": "5",
    "token": "USDC",
    "below_pct": "10.3",
    "above_pct": "5.5",
}


class TestPayingWithWhatIsFree:
    async def test_what_the_wallets_do_not_hold_free_is_not_placed(self):
        prepared: list = []
        said = await tools(shelf(), prepared, free={"USDT": Decimal("0.003")})[
            "propose_liquidity"
        ].ainvoke(CARD)
        assert prepared == []
        assert "Their wallets hold 0 USDC free right now" in said
        assert "offer placing what they hold free" in said

    async def test_money_in_one_of_their_pools_is_named_with_the_id_to_place_it_from(self):
        prepared: list = []
        said = await tools(shelf(), prepared, free={"USDC": Decimal("0")}, held=(IN_PRIME,))[
            "propose_liquidity"
        ].ainvoke(CARD)
        assert prepared == []
        assert f"12.008635 USDC in USDC Prime, id {PRIME.id}" in said
        assert "from_pool_id" in said
        assert "one card takes it out and places it" in said

    async def test_a_reading_behind_the_chain_is_checked_on_the_chain_before_a_no(self):
        prepared: list = []
        catalog = shelf()
        catalog.wallet = {PAIR.y_mint: Decimal("12.00764")}
        await tools(catalog, prepared, free={"USDC": Decimal("0")}, owners=(OWNER,))[
            "propose_liquidity"
        ].ainvoke(CARD)
        assert len(prepared) == 1

    async def test_and_the_chain_saying_the_same_keeps_the_no(self):
        prepared: list = []
        catalog = shelf()
        catalog.wallet = {PAIR.y_mint: Decimal("1")}
        said = await tools(catalog, prepared, free={"USDC": Decimal("0")}, owners=(OWNER,))[
            "propose_liquidity"
        ].ainvoke(CARD)
        assert prepared == []
        assert "Their wallets hold 1 USDC free right now" in said

    async def test_what_they_hold_is_placed(self):
        prepared: list = []
        await tools(shelf(), prepared, free={"USDC": Decimal("32.87")})[
            "propose_liquidity"
        ].ainvoke(CARD)
        assert len(prepared) == 1

    async def test_a_wallet_nobody_could_read_is_left_to_the_build_to_judge(self):
        prepared: list = []
        await tools(shelf(), prepared, free=None)["propose_liquidity"].ainvoke(CARD)
        assert len(prepared) == 1


class TestActingOnAPosition:
    async def test_a_position_out_of_range_is_rebalanced_keeping_its_width(self):
        prepared: list = []
        catalog = shelf(placed=(OUT,))
        said = await tools(catalog, prepared, range_known=False)["propose_rebalance"].ainvoke(
            {"position": OUT.address}
        )
        (card,) = prepared
        assert card.action == "rebalance" and card.position == OUT
        assert card.below_pct is None, "no range asked: as wide as it was"
        assert "as wide as it was" in said

    async def test_closing_one_brings_everything_back(self):
        prepared: list = []
        said = await tools(shelf(placed=(OUT,)), prepared)["propose_close_liquidity"].ainvoke(
            {"position": OUT.address}
        )
        assert prepared[0].action == "close"
        assert "back to their wallet" in said

    async def test_a_position_that_is_not_theirs_is_not_touched(self):
        prepared: list = []
        said = await tools(shelf(placed=(OUT,)), prepared)["propose_close_liquidity"].ainvoke(
            {"position": "someone-else"}
        )
        assert prepared == []
        assert "no liquidity position at someone-else" in said


class TestWhatTheAgentReadsAndShows:
    def test_what_is_free_is_the_idle_solana_tokens_and_sol_less_its_gas(self):
        from app.agent.context import free_on_solana

        portfolio = fx.as_portfolio(
            fx.portfolio([fx.wallet(fx.SOL_ADDRESS, [fx.USDC_SOL], chain="SOL")])
        )
        free = free_on_solana(portfolio)
        assert set(free) <= {"USDC", "SOL"}
        assert all(amount >= 0 for amount in free.values())

    def test_a_position_out_of_range_says_so_with_the_address_to_act_by(self):
        line = placed_lines((OUT,))
        assert "OUT OF RANGE, earning nothing." in line
        assert f"position {OUT.address}, pool id {PAIR.id}" in line
        assert "Range 75.05 to 110.42 USDC per SOL, price 117.25" in line

    def test_a_placement_card_carries_the_range_and_the_prices_it_reaches(self):
        card = _deposit_card(
            Placement(
                action="provide",
                pool=PAIR,
                amount=Decimal("5"),
                below_pct=Decimal("10.3"),
                above_pct=Decimal("5.5"),
            )
        ).model_dump(by_alias=True)
        assert card["action"] == "provide" and card["poolKind"] == "dlmm"
        assert (card["belowPct"], card["abovePct"]) == ("10.3", "5.5")
        assert card["lowerPrice"] == "105.17" and card["upperPrice"] == "123.70"
        assert card["apy"] == "19.96%"

    def test_a_rebalance_card_names_the_position(self):
        card = _deposit_card(Placement(action="rebalance", pool=PAIR, position=OUT)).model_dump(
            by_alias=True
        )
        assert card["position"] == OUT.address
        assert card["shown"] == "$12.15"

    def test_a_card_it_prepared_is_replayed_with_its_range(self):
        turn = Turn(
            q="range -10.3 +5.5",
            a="",
            at=0,
            blocks=[
                {
                    "kind": "deposit",
                    "action": "provide",
                    "amount": "5",
                    "token": "USDC",
                    "pool": "SOL-USDC",
                    "belowPct": "10.3",
                    "abovePct": "5.5",
                }
            ],
        )
        _, answered = replayed(turn)
        assert "liquidity of 5 USDC into SOL-USDC across -10.3% / +5.5%" in answered


class TestTheEarnBranchReadsPositions:
    async def test_every_solana_wallet_is_asked_for_its_liquidity_positions(self):
        from tests.test_graph import moving

        catalog = shelf(placed=(OUT,))
        _, model = await moving(catalog)
        said = model.prompts[0]
        assert "Their liquidity positions" in said
        assert "OUT OF RANGE" in said
        assert fx.SOL_ADDRESS


class TestTheRulesForAPair:
    def test_the_pools_are_read_before_anything_is_asked_and_a_price_comes_from_them(self):
        from app.agent.prompts import LIQUIDITY

        assert "Read the pools of the pair first" in LIQUIDITY
        assert "never one you remember" in LIQUIDITY


class TestForgivingTheModel:
    async def test_a_slip_in_copying_an_id_it_was_shown_is_still_that_pool(self):
        prepared: list = []
        listing = tools(shelf(), prepared)
        await listing["liquidity_pools"].ainvoke({"pair": "SOL-USDC"})
        slipped = PAIR.id.replace("Cgqw", "Cgwq")
        await listing["propose_liquidity"].ainvoke({**CARD, "pool_id": slipped})
        (card,) = prepared
        assert card.pool.id == PAIR.id

    async def test_an_id_it_was_never_shown_is_not_guessed_at(self):
        prepared: list = []
        said = await tools(shelf(), prepared)["propose_liquidity"].ainvoke(
            {**CARD, "pool_id": "sol:meteora:dlmm:Cgwq"}
        )
        assert prepared == []
        assert "No pool has the id" in said

    async def test_a_range_one_pool_cannot_hold_names_the_pools_of_the_pair_that_can(self):
        prepared: list = []
        catalog = shelf(NARROW, PAIR)
        said = await tools(catalog, prepared)["propose_liquidity"].ainvoke(
            {**CARD, "pool_id": NARROW.id}
        )
        assert prepared == []
        assert "The pools of the pair that hold it: SOL-USDC with bins 0.8% apart" in said
        assert f"id {PAIR.id}" in said


FROM_PRIME = {
    "pool_id": PAIR.id,
    "amount": "all",
    "token": "",
    "below_pct": "5",
    "above_pct": "5",
    "from_pool_id": PRIME.id,
}


class TestPlacingStraightOutOfALendingPool:
    async def test_all_of_it_comes_out_and_goes_in_on_one_card(self):
        prepared: list = []
        said = await tools(shelf(), prepared, free={"USDC": Decimal("0")}, held=(IN_PRIME,))[
            "propose_liquidity"
        ].ainvoke(FROM_PRIME)
        (card,) = prepared
        assert card.action == "provide" and card.source == PRIME and card.everything
        assert card.amount == Decimal("12.008635")
        assert card.pay_with.symbol == "USDC" and card.pay_with.mint == PAIR.y_mint
        assert "out of USDC Prime" in said
        assert "One button: it comes out of the pool" in said

    async def test_a_slip_in_copying_the_pool_id_is_forgiven(self):
        prepared: list = []
        slipped = {**FROM_PRIME, "from_pool_id": PRIME.id.replace("9E69", "9E96")}
        await tools(shelf(), prepared, held=(IN_PRIME,))["propose_liquidity"].ainvoke(slipped)
        assert prepared[0].source == PRIME

    async def test_a_pool_they_are_not_in_is_not_taken_from(self):
        prepared: list = []
        said = await tools(shelf(), prepared, held=(IN_PRIME,))["propose_liquidity"].ainvoke(
            {**FROM_PRIME, "from_pool_id": "sol:kamino:vault:SOMEWHERE"}
        )
        assert prepared == []
        assert "They have nothing in a pool with the id" in said

    async def test_more_than_is_in_the_pool_is_refused_with_what_is_there(self):
        prepared: list = []
        said = await tools(shelf(), prepared, held=(IN_PRIME,))["propose_liquidity"].ainvoke(
            {**FROM_PRIME, "amount": "500"}
        )
        assert prepared == []
        assert "They have 12.008635 USDC in USDC Prime" in said

    async def test_a_pool_paying_out_another_token_comes_out_as_one_of_the_pair_first(self):
        prepared: list = []
        usds = replace(PRIME, id="sol:kamino:vault:KEEL", name="Keel USDS", token="USDS")
        said = await tools(shelf(), prepared, held=(Held(pool=usds, amount=Decimal("5")),))[
            "propose_liquidity"
        ].ainvoke({**FROM_PRIME, "from_pool_id": usds.id})
        assert prepared == []
        assert "Keel USDS pays out USDS, and SOL-USDC takes SOL and USDC" in said

    async def test_the_card_says_where_the_money_comes_out_of(self):
        card = _deposit_card(
            Placement(
                action="provide",
                pool=PAIR,
                amount=Decimal("12.008635"),
                pay_with=Coin(symbol="USDC", mint=PAIR.y_mint, decimals=0),
                below_pct=Decimal("5"),
                above_pct=Decimal("5"),
                source=PRIME,
                everything=True,
            )
        )
        drawn = card.model_dump(by_alias=True)
        assert drawn["fromPoolId"] == PRIME.id
        assert drawn["fromPool"] == "USDC Prime"
        assert drawn["fromApy"] == "4.20%"
        assert drawn["amount"] == "all"
        assert drawn["shown"] == "12.008635"


class TestARangeGivenAsTwoPrices:
    async def test_the_two_prices_are_the_range_around_the_price(self):
        prepared: list = []
        await tools(shelf(), prepared)["propose_liquidity"].ainvoke(
            {
                "pool_id": PAIR.id,
                "amount": "5",
                "token": "USDC",
                "lower_price": "111.3875",
                "upper_price": "123.1125",
            }
        )
        [card] = prepared
        assert (card.below_pct, card.above_pct) == (Decimal("5.0000"), Decimal("5.0000"))

    async def test_in_whichever_order_they_come(self):
        prepared: list = []
        await tools(shelf(), prepared)["propose_liquidity"].ainvoke(
            {
                "pool_id": PAIR.id,
                "amount": "5",
                "token": "USDC",
                "lower_price": "123,1125",
                "upper_price": "111.3875",
            }
        )
        [card] = prepared
        assert (card.below_pct, card.above_pct) == (Decimal("5.0000"), Decimal("5.0000"))

    async def test_up_to_the_price_is_all_under_it(self):
        prepared: list = []
        await tools(shelf(), prepared)["propose_liquidity"].ainvoke(
            {
                "pool_id": PAIR.id,
                "amount": "5",
                "token": "USDC",
                "lower_price": "116.0775",
                "upper_price": "117.22",
            }
        )
        [card] = prepared
        assert (card.below_pct, card.above_pct) == (Decimal("1.0000"), Decimal(0))

    async def test_bounds_that_miss_the_price_place_nothing(self):
        prepared: list = []
        said = await tools(shelf(), prepared)["propose_liquidity"].ainvoke(
            {
                "pool_id": PAIR.id,
                "amount": "5",
                "token": "USDC",
                "lower_price": "100",
                "upper_price": "110",
            }
        )
        assert prepared == []
        assert "does not hold the price, 117.25 now" in said

    async def test_a_rebalance_takes_them_too(self):
        prepared: list = []
        await tools(shelf(placed=(OUT,)), prepared)["propose_rebalance"].ainvoke(
            {"position": OUT.address, "lower_price": "111.3875", "upper_price": "117.25"}
        )
        [card] = prepared
        assert (card.action, card.below_pct, card.above_pct) == (
            "rebalance",
            Decimal("5.0000"),
            Decimal(0),
        )

    async def test_the_pools_are_asked_about_the_range_the_prices_make(self):
        catalog = shelf()
        await tools(catalog, [])["liquidity_pools"].ainvoke(
            {"pair": "SOL-USDC", "lower_price": "111.3875", "upper_price": "123.1125"}
        )
        assert catalog.pairs_asked == ("SOL", "USDC", Decimal("5.0000"), Decimal("5.0000"))
