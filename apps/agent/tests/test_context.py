from svinooh_portfolio import testing as fx

from app.agent.context import earning_lines, idle_lines, positions_read

SOL_MINT = "So11111111111111111111111111111111111111112"


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


class TestWhatTheDataDoesNotName:
    def test_a_leg_without_a_symbol_is_said_to_have_none(self):
        held = fx.as_portfolio(fx.portfolio([fx.wallet(fx.EVM_ADDRESS, [fx.AAVE_NAMELESS])]))
        line = earning_lines(held)
        assert "unnamed token $1,003.15 at 0.00%" in line
        assert "? $1,003.15" not in line

    def test_a_position_that_pays_without_a_rate_of_its_own_quotes_no_rate(self):
        rewarding = fx.position(
            "REWARD",
            500.0,
            platform="somewhere",
            tokens=[{"role": "reward", "symbol": "ARB", "valueUsd": 5.0, "apy": 0.1}],
        )
        held = fx.as_portfolio(fx.portfolio([fx.wallet(fx.EVM_ADDRESS, [rewarding])]))
        assert "at 0.00%" not in earning_lines(held)


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
        from svinooh_portfolio.portfolio import Portfolio, Position, Wallet

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
