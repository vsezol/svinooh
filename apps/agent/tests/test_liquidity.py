from dataclasses import replace
from decimal import Decimal

from app.agent.context import placed_lines, replayed
from app.agent.tools import liquidity_tools
from app.api.routes import _deposit_card
from app.domain.conversation import Turn
from app.domain.earn import LiquidityPosition, PairPool, Placement
from tests import fixtures as fx
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


def tools(catalog: Catalog, prepared: list, range_known: bool = True) -> dict:
    return {
        one.name: one for one in liquidity_tools(catalog, catalog.placed, prepared, range_known)
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
