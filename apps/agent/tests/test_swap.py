from decimal import Decimal

from app.agent.graph import each_once
from app.api.routes import _deposit_card
from app.domain.earn import Coin, Swap
from tests.test_graph import (
    TWELVE_IN_PRIME,
    USDC_COIN,
    Model,
    in_pools,
    moving,
    run,
    wire,
    with_a_solana_wallet,
    with_coins,
)

XBTC = Coin(symbol="xBTC", mint="CtzPWv73Sn1dMGVU3ZtLv9yWSyUAanBni19YWDaznnkn", decimals=6)


def swap(**args: str) -> dict:
    return {"name": "propose_swap", "args": args, "id": "s1"}


def holding(amount: str | None):
    shelf = with_coins(in_pools(), XBTC, USDC_COIN)
    if amount is not None:
        shelf.wallet = {XBTC.mint: Decimal(amount)}
    return shelf


def told(model: Model) -> str:
    return str(model.seen[-1].content)


class TestSwappingOneCoinForAnother:
    async def test_all_of_a_coin_they_hold_is_one_card(self):
        out, model = await moving(holding("5.311297"), swap(from_token="xBTC", to_token="USDC"))
        assert out["deposits"] == (
            Swap(
                pay_with=XBTC,
                receive_as=USDC_COIN,
                amount=Decimal("5.311297"),
                everything=True,
            ),
        )
        assert "all of it, about 5.311297 xBTC swapped to USDC" in told(model)
        assert "a trade" in told(model)

    async def test_a_figure_is_swapped_as_it_was_given(self):
        out, _ = await moving(
            holding("5.311297"), swap(from_token="xBTC", to_token="USDC", amount="2")
        )
        (card,) = out["deposits"]
        assert card.amount == Decimal("2") and not card.everything

    async def test_more_than_they_hold_prepares_nothing(self):
        out, model = await moving(
            holding("5.311297"), swap(from_token="xBTC", to_token="USDC", amount="10")
        )
        assert out["deposits"] == ()
        assert "They hold 5.311297 xBTC free, less than that" in told(model)

    async def test_a_coin_they_hold_none_of_is_nothing_to_swap(self):
        out, model = await moving(holding("0"), swap(from_token="xBTC", to_token="USDC"))
        assert out["deposits"] == ()
        assert "They hold no xBTC free right now" in told(model)

    async def test_all_of_what_could_not_be_read_asks_how_much(self):
        out, model = await moving(holding(None), swap(from_token="xBTC", to_token="USDC"))
        assert out["deposits"] == ()
        assert "could not be read just now" in told(model)

    async def test_a_coin_nobody_trades_prepares_nothing_and_says_so(self):
        out, model = await moving(holding("1"), swap(from_token="NOPE", to_token="USDC"))
        assert out["deposits"] == ()
        assert "No coin called NOPE" in told(model)

    async def test_the_same_coin_at_both_ends_is_nothing_to_swap(self):
        out, model = await moving(holding("1"), swap(from_token="USDC", to_token="usdc"))
        assert out["deposits"] == ()
        assert "That is USDC already" in told(model)

    async def test_it_needs_no_risk(self):
        shelf = holding("5.311297")
        shelf.held = (TWELVE_IN_PRIME,)
        bot, _, _ = wire(
            intent="earn",
            catalog=shelf,
            api=with_a_solana_wallet(),
            model=Model(tool_calls=[swap(from_token="xBTC", to_token="USDC")]),
            asked_to_place=True,
        )
        bot.intents.risk = "unknown"
        out = await run(bot, portfolio="on-screen", authorization="Bearer T")
        assert [card.action for card in out["deposits"]] == ["swap"]

    async def test_the_prompt_says_a_swap_needs_no_pool(self):
        _, model = await moving(holding("1"))
        assert "neither a deposit nor liquidity" in model.prompts[0]


class TestTheSwapCard:
    def test_the_widget_gets_both_coins_and_no_pool(self):
        card = _deposit_card(
            Swap(
                pay_with=XBTC,
                receive_as=USDC_COIN,
                amount=Decimal("5.311297"),
                everything=True,
            )
        ).model_dump(by_alias=True)
        assert (card["action"], card["poolId"], card["poolKind"]) == ("swap", "", "swap")
        assert card["payWith"] == {"mint": XBTC.mint, "symbol": "xBTC"}
        assert card["receiveAs"] == {"mint": USDC_COIN.mint, "symbol": "USDC"}
        assert (card["amount"], card["shown"]) == ("all", "5.311297")

    def test_a_figure_is_the_amount_itself(self):
        card = _deposit_card(Swap(pay_with=XBTC, receive_as=USDC_COIN, amount=Decimal("2")))
        assert (card.amount, card.shown) == ("2", None)

    def test_the_same_swap_prepared_twice_is_one_card(self):
        first = Swap(pay_with=XBTC, receive_as=USDC_COIN, amount=Decimal("1"))
        again = Swap(pay_with=XBTC, receive_as=USDC_COIN, amount=Decimal("2"))
        back = Swap(pay_with=USDC_COIN, receive_as=XBTC, amount=Decimal("1"))
        assert each_once([first, again, back]) == (again, back)
