"""What the model is told about a portfolio.

These assertions are the anti-hallucination contract: every one of them exists
because a missing or wrong line here became a wrong answer in a chat.
"""

from app.agent.context import portfolio_context, position_line, usd
from tests import fixtures as fx


def test_header_counts_wallets_and_positions():
    block = portfolio_context(fx.rich_portfolio(tail=20), 12)
    assert 'Portfolio "Main portfolio"' in block
    assert "1 wallet(s), 25 position(s)" in block


def test_falls_back_to_the_slug_when_a_portfolio_is_unnamed():
    data = fx.portfolio([fx.wallet(fx.EVM_ADDRESS, [fx.ETH])], slug="abc123")
    assert 'Portfolio "abc123"' in portfolio_context(data, 12)


def test_breakdowns_cover_every_position_not_just_the_printed_ones():
    # 40 dust positions past the cap: their networks must still be counted.
    block = portfolio_context(fx.rich_portfolio(tail=40), 12)
    by_network = next(row for row in block.splitlines() if row.startswith("By network"))
    # eth: ETH + UNI + AAVE + all 40 dust ones; base and bsc from the fixtures.
    assert "eth" in by_network and "base" in by_network and "bsc" in by_network
    assert "By type" in block and "token" in block and "defi" in block
    assert "In protocols" in block and "uniswap3" in block and "aave3" in block


def test_protocol_line_excludes_plain_wallet_holdings():
    line = next(
        row
        for row in portfolio_context(fx.rich_portfolio(), 12).splitlines()
        if row.startswith("In protocols")
    )
    assert "wallet" not in line


def test_the_hidden_tail_carries_its_value():
    data = fx.rich_portfolio(tail=30)
    block = portfolio_context(data, 12)
    positions = data["wallets"][0]["positions"]
    shown = 12  # the cap handed in above
    expected = sum(p["valueUsd"] for p in sorted(positions, key=lambda p: -p["valueUsd"])[shown:])
    assert f"…and {len(positions) - shown} smaller positions worth {usd(expected)}" in block


def test_positions_are_printed_largest_first():
    # Asserted on the symbols, whose order the fixtures fix, rather than by
    # parsing dollars back out of a sentence: a test that re-implements the
    # formatter to check the formatter passes when both are wrong together.
    block = portfolio_context(fx.rich_portfolio(tail=5), 12)
    printed = [line for line in block.splitlines() if line.startswith("  - ")]
    symbols = [line.removeprefix("  - ").split(":")[0].split(" ")[0] for line in printed]
    assert symbols[:4] == ["ETH", "MICRO", "TRUE", "AAVE-V3"]


def test_every_wallet_appears_with_its_chain_and_status():
    block = portfolio_context(fx.two_wallet_portfolio(), 12)
    assert "[EVM]" in block and "[SOL]" in block and "status ok" in block


def test_stale_data_is_flagged():
    data = fx.portfolio([fx.wallet(fx.EVM_ADDRESS, [fx.ETH], stale=True)])
    assert "stale data" in portfolio_context(data, 12)


class TestPositionLine:
    def test_holding_shows_amount_at_price(self):
        assert position_line(fx.ETH) == "ETH: $16,683.65, 6.7122 @ $2,485.59, eth"

    def test_micro_price_is_not_rounded_to_zero(self):
        line = position_line(fx.DUST)
        assert "@ $0," not in line and "6.30e-08" in line

    def test_lending_shows_health_and_borrow_rate(self):
        line = position_line(fx.AAVE)
        assert "health 2.14" in line and "borrow 3.2%" in line and "aave3" in line

    def test_pool_shows_its_pair_fee_and_range(self):
        line = position_line(fx.UNISWAP)
        assert "[cbBTC/USDC 0.05% fee]" in line
        assert "APY 47.8%" in line and "range in" in line

    def test_composition_is_detail_only(self):
        assert "WETH" not in position_line(fx.AAVE)
        detailed = position_line(fx.AAVE, detail=True)
        assert "WETH $12,500.00" in detailed and "borrow USDC $5,200.00" in detailed

    def test_missing_fields_are_simply_absent(self):
        bare = fx.position("X", 1.0, network="", platform="")
        assert position_line(bare) == "X: $1.00"
