from app.agent.context import (
    earning_lines,
    idle_lines,
    portfolio_context,
    position_line,
    positions_read,
    usd,
)
from app.domain.portfolio import total_of
from tests import fixtures as fx

SOL_MINT = "So11111111111111111111111111111111111111112"


def test_header_counts_wallets_and_positions():
    block = portfolio_context(fx.as_portfolio(tail=20), 12)
    assert 'Portfolio "Main portfolio"' in block
    assert "1 wallet(s), 25 position(s)" in block


def test_falls_back_to_the_slug_when_a_portfolio_is_unnamed():
    unnamed = fx.as_portfolio(fx.portfolio([fx.wallet(fx.EVM_ADDRESS, [fx.ETH])], slug="abc123"))
    assert 'Portfolio "abc123"' in portfolio_context(unnamed, 12)


def test_breakdowns_cover_every_position_not_just_the_printed_ones():
    block = portfolio_context(fx.as_portfolio(tail=40), 12)
    by_network = next(row for row in block.splitlines() if row.startswith("By network"))
    assert "eth" in by_network and "base" in by_network and "bsc" in by_network
    assert "By type" in block and "token" in block and "defi" in block
    assert "In protocols" in block and "uniswap3" in block and "aave3" in block


def test_protocol_line_excludes_plain_wallet_holdings():
    line = next(
        row
        for row in portfolio_context(fx.as_portfolio(), 12).splitlines()
        if row.startswith("In protocols")
    )
    assert "wallet" not in line


def test_the_hidden_tail_carries_its_value():
    portfolio = fx.as_portfolio(tail=30)
    block = portfolio_context(portfolio, 12)
    hidden = portfolio.wallets[0].largest_first[12:]
    assert f"…and {len(hidden)} smaller positions worth {usd(total_of(hidden))}" in block


def test_positions_are_printed_largest_first():
    block = portfolio_context(fx.as_portfolio(tail=5), 12)
    printed = [line for line in block.splitlines() if line.startswith("  - ")]
    symbols = [line.removeprefix("  - ").split(":")[0].split(" ")[0] for line in printed]
    assert symbols[:4] == ["ETH", "MICRO", "TRUE", "AAVE-V3"]


def test_every_wallet_appears_with_its_chain_and_status():
    block = portfolio_context(fx.as_portfolio(fx.two_wallet_portfolio()), 12)
    assert "[EVM]" in block and "[SOL]" in block and "status ok" in block


def test_stale_data_is_flagged():
    stale = fx.as_portfolio(fx.portfolio([fx.wallet(fx.EVM_ADDRESS, [fx.ETH], stale=True)]))
    assert "stale data" in portfolio_context(stale, 12)


class TestWhatIsAlreadyEarning:
    def test_a_plain_deposit_is_a_rate_and_nothing_else(self):
        held = fx.as_portfolio(fx.portfolio([fx.wallet(fx.EVM_ADDRESS, [fx.FLUID])]))
        line = earning_lines(held)
        assert "Fluid (Yield) on fluid: $10,187.88 at 4.20%" in line
        assert "collateral" not in line

    def test_collateral_is_named_leg_by_leg_with_the_loan_against_it(self):
        held = fx.as_portfolio(fx.portfolio([fx.wallet(fx.SOL_ADDRESS, [fx.KAMINO])]))
        line = earning_lines(held)
        assert "supplied cbBTC $10,743.16 at <0.01%, SOL $4,490.13 at 4.52%" in line
        assert "borrowed USDT $4,202.27 at 5.27%, health 2.98" in line
        assert "collateral for that loan, not idle money" in line
        assert "repaid" in line

    def test_a_rate_that_is_small_is_not_rounded_away_to_nothing(self):
        held = fx.as_portfolio(fx.portfolio([fx.wallet(fx.SOL_ADDRESS, [fx.KAMINO])]))
        assert "cbBTC $10,743.16 at <0.01%" in earning_lines(held)

    def test_no_average_rate_is_invented_for_a_position_that_has_none(self):
        held = fx.as_portfolio(fx.portfolio([fx.wallet(fx.SOL_ADDRESS, [fx.KAMINO])]))
        assert "at 0.00%;" not in earning_lines(held)
        assert fx.as_position(fx.KAMINO).apy is None

    def test_a_position_paying_nothing_anywhere_is_not_listed(self):
        held = fx.as_portfolio(fx.portfolio([fx.wallet(fx.EVM_ADDRESS, [fx.ETH])]))
        assert earning_lines(held) == ""


class TestWhatAReadOfThePortfolioSays:
    def test_it_names_the_networks_it_found(self):
        said = positions_read(fx.as_portfolio())
        assert said.startswith(f"{len(fx.as_portfolio().positions)} positions · ")
        assert "eth" in said

    def test_a_long_list_of_networks_is_cut_with_a_count(self):
        said = positions_read(fx.as_portfolio(tail=40), name_at_most=2)
        assert said.endswith("+1") or "+" in said

    def test_an_empty_portfolio_says_so_rather_than_counting_to_zero(self):
        empty = fx.as_portfolio(fx.portfolio([fx.wallet(fx.EVM_ADDRESS, [])], slug="abc123"))
        assert positions_read(empty) == "nothing held"


class TestPositionLine:
    def test_holding_shows_amount_at_price(self):
        assert position_line(fx.as_position(fx.ETH)) == "ETH: $16,683.65, 6.7122 @ $2,485.59, eth"

    def test_micro_price_is_not_rounded_to_zero(self):
        line = position_line(fx.as_position(fx.DUST))
        assert "@ $0," not in line and "6.30e-08" in line

    def test_lending_shows_health_and_borrow_rate(self):
        line = position_line(fx.as_position(fx.AAVE))
        assert "health 2.14" in line and "borrow 3.2%" in line and "aave3" in line

    def test_pool_shows_its_pair_fee_and_range(self):
        line = position_line(fx.as_position(fx.UNISWAP))
        assert "[cbBTC/USDC 0.05% fee]" in line
        assert "APY 47.8%" in line and "range in" in line

    def test_composition_is_detail_only(self):
        assert "WETH" not in position_line(fx.as_position(fx.AAVE))
        detailed = position_line(fx.as_position(fx.AAVE), detail=True)
        assert "WETH $12,500.00" in detailed and "borrow USDC $5,200.00" in detailed

    def test_missing_fields_are_simply_absent(self):
        bare = fx.as_position(fx.position("X", 1.0, network="", platform=""))
        assert position_line(bare) == "X: $1.00"


class TestWhatTheDataDoesNotName:
    def test_a_leg_without_a_symbol_is_said_to_have_none(self):
        held = fx.as_portfolio(fx.portfolio([fx.wallet(fx.EVM_ADDRESS, [fx.AAVE_NAMELESS])]))
        line = earning_lines(held)
        assert "unnamed token $1,003.15 at 0.00%" in line
        assert "? $1,003.15" not in line

    def test_a_position_without_a_symbol_is_said_to_have_none(self):
        line = position_line(fx.as_position(fx.NAMELESS))
        assert line.startswith("unnamed position: $1,003.15")
        assert "?" not in line

    def test_a_position_that_pays_without_a_rate_of_its_own_quotes_no_rate(self):
        rewarding = fx.position(
            "REWARD",
            500.0,
            platform="somewhere",
            tokens=[{"role": "reward", "symbol": "ARB", "valueUsd": 5.0, "apy": 0.1}],
        )
        held = fx.as_portfolio(fx.portfolio([fx.wallet(fx.EVM_ADDRESS, [rewarding])]))
        assert "at 0.00%" not in earning_lines(held)


class TestWhenTheBlockRunsOutOfRoom:
    def test_the_last_line_is_a_whole_line(self):
        block = portfolio_context(fx.as_portfolio(tail=300), 400)
        assert len(block) <= 6000
        assert block.splitlines()[-1].startswith("…and ")

    def test_every_printed_position_is_printed_whole(self):
        block = portfolio_context(fx.as_portfolio(tail=300), 400)
        printed = [line for line in block.splitlines() if line.startswith("  - SMALL")]
        assert printed
        assert all(line.endswith(", eth") for line in printed)


class TestWhatIsLyingAround:
    def test_a_plain_holding_is_named_with_what_there_is_of_it(self):
        held = fx.as_portfolio(
            fx.portfolio([fx.wallet(fx.SOL_ADDRESS, [fx.USDC_SOL], chain="SOL")])
        )
        line = idle_lines(held)
        assert "USDC" in line and "12.0014" in line and "$12.00" in line
        assert "on sol" in line

    def test_money_already_earning_is_not_lying_around(self):
        held = fx.as_portfolio(fx.portfolio([fx.wallet(fx.EVM_ADDRESS, [fx.FLUID])]))
        assert "nothing idle" in idle_lines(held)

    def test_nothing_idle_says_so_rather_than_saying_nothing(self):
        held = fx.as_portfolio(fx.portfolio([fx.wallet(fx.SOL_ADDRESS, [fx.KAMINO])]))
        said = idle_lines(held)
        assert said.startswith("nothing idle")
        assert "collateral" in said


class TestAPastTurnAsTheModelsSeeIt:
    def test_the_question_it_put_on_screen_is_part_of_what_it_said(self):
        from app.agent.context import replayed
        from app.domain.conversation import Turn

        turn = Turn(
            q="move my money somewhere better",
            a="Pick one.",
            at=0,
            blocks=[
                {"kind": "trace", "steps": []},
                {"kind": "text", "text": "Pick one."},
                {
                    "kind": "choice",
                    "header": "Risk",
                    "question": "How much risk?",
                    "options": ["Low — 8.52%", "High — 11.96%"],
                },
            ],
        )
        asked, answered = replayed(turn)
        assert asked == "move my money somewhere better"
        assert answered.startswith("Pick one.")
        assert "How much risk? Options: Low — 8.52% / High — 11.96%" in answered

    def test_a_card_it_prepared_is_named_with_both_ends(self):
        from app.agent.context import replayed
        from app.domain.conversation import Turn

        turn = Turn(
            q="Risk: low",
            a="",
            at=0,
            blocks=[
                {
                    "kind": "deposit",
                    "action": "move",
                    "amount": "all",
                    "shown": "12.0015",
                    "token": "USDC",
                    "pool": "Kamino Institutional",
                    "fromPool": "USDC Prime",
                }
            ],
        )
        _, answered = replayed(turn)
        assert "a move of 12.0015 USDC from USDC Prime into Kamino Institutional" in answered

    def test_a_card_that_swaps_is_named_with_what_it_spends_and_becomes(self):
        from app.agent.context import replayed
        from app.domain.conversation import Turn

        turn = Turn(
            q="Risk: low",
            a="",
            at=0,
            blocks=[
                {
                    "kind": "deposit",
                    "action": "deposit",
                    "amount": "0.5",
                    "token": "USDC",
                    "pool": "Allez USDC",
                    "payWith": {"mint": SOL_MINT, "symbol": "SOL"},
                }
            ],
        )
        _, answered = replayed(turn)
        assert "a deposit of 0.5 SOL into Allez USDC, swapped to USDC" in answered

    def test_no_message_goes_to_a_model_empty(self):
        from app.agent.context import replayed
        from app.domain.conversation import Turn

        asked, answered = replayed(Turn(q="", a="", at=0, blocks=[]))
        assert asked and answered, "an empty message is one some model APIs refuse outright"


class TestTheGasTheWalletSignsWith:
    def portfolio_with_sol(self, amount: float):
        from app.domain.portfolio import Portfolio, Position, Wallet

        sol = Position(
            symbol="SOL",
            value_usd=amount * 118.0,
            network="sol",
            platform="wallet",
            category="token",
            amount=amount,
            price_usd=118.0,
        )
        return Portfolio(
            slug="p",
            total_usd=sol.value_usd,
            wallets=(Wallet(address="A", chain="SOL", status="ok", positions=(sol,)),),
        )

    def test_what_is_only_gas_is_not_offered_as_idle(self):
        from app.agent.context import idle_lines

        said = idle_lines(self.portfolio_with_sol(0.0137))
        assert "SOL" not in said, "all of it would have left the wallet unable to sign"

    def test_above_the_gas_only_the_rest_is_offered(self):
        from app.agent.context import idle_lines

        said = idle_lines(self.portfolio_with_sol(1.5))
        assert "SOL 1.48" in said
        assert "0.02 SOL more is kept back for network fees" in said
