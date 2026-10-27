from datetime import UTC, datetime, timedelta

from svinooh_portfolio import testing as fx
from svinooh_portfolio import wire
from svinooh_portfolio.format import usd
from svinooh_portfolio.portfolio import exposure_of, total_of
from svinooh_portfolio.reading import (
    MAX_MATCHES,
    calculated,
    describe_exposure,
    find_positions,
    named_position,
    portfolio_context,
    position_line,
    scanned_ago,
    summarize_history,
)

WEEK = [
    ("2026-07-28T12:00:00Z", 60_000.00),
    ("2026-08-20T12:00:00Z", 70_000.00),
    ("2026-08-31T20:00:00Z", 84_657.50),
    ("2026-09-03T12:00:00Z", 82_247.82),
    ("2026-09-07T18:00:00Z", 83_560.55),
]


class TestHistory:
    def test_measures_the_asked_for_window_not_the_whole_series(self):
        out = summarize_history(fx.as_history(WEEK), "7d")
        assert "$84,657.50" in out, "the week starts at its first reading"
        assert "$60,000.00" not in out, "a six-week-old point is not last Monday"

    def test_change_is_computed_over_that_window(self):
        out = summarize_history(fx.as_history(WEEK), "7d")
        assert "-1,096.95 USD" in out and "-1.3%" in out

    def test_reports_the_low_and_the_high_of_the_window(self):
        out = summarize_history(fx.as_history(WEEK), "7d")
        assert "Low $82,247.82" in out and "high $84,657.50" in out

    def test_says_the_last_reading_is_not_the_live_total(self):
        assert "behind the live total" in summarize_history(fx.as_history(WEEK), "7d")

    def test_all_has_no_window_to_slice(self):
        out = summarize_history(fx.as_history(WEEK, "all"), "all")
        assert "$60,000.00" in out, "'all' means all of it"

    def test_a_window_with_one_reading_falls_back_to_the_series(self):
        out = summarize_history(fx.as_history(WEEK), "1h")
        assert "5 readings" in out

    def test_too_little_history_says_so_rather_than_dividing_by_nothing(self):
        out = summarize_history(fx.as_history([("2026-09-07T18:00:00Z", 100.0)]), "7d")
        assert "Not enough history" in out

    def test_unreadable_and_missing_values_are_skipped(self):
        series = wire.history(
            {
                "points": [
                    {"t": "2026-09-01T00:00:00Z", "usd": None},
                    {"t": "not-a-date", "usd": 10.0},
                    {"t": "2026-09-05T00:00:00Z", "usd": 100.0},
                    {"t": "2026-09-07T00:00:00Z", "usd": 110.0},
                ]
            }
        )
        out = summarize_history(series, "7d")
        assert "+10.00 USD" in out and "n/a" not in out

    def test_a_zero_start_does_not_divide_by_zero(self):
        out = summarize_history(
            fx.as_history([("2026-09-06T00:00:00Z", 0.0), ("2026-09-07T00:00:00Z", 50.0)]), "7d"
        )
        assert "+0.0%" in out

    def test_a_window_keeps_order_and_bounds(self):
        series = fx.as_history(WEEK)
        assert series.window("30d").readings[0].usd == 70_000.00
        assert series.window("all").readings == series.readings


class TestSearch:
    def test_finds_a_pool_by_its_protocol_not_its_symbol(self):
        out = find_positions(fx.as_portfolio(), "uniswap")
        assert out.startswith('1 position(s) match "uniswap", $3,600.00 in total')
        assert "cbBTC/USDC" in out

    def test_finds_by_network(self):
        assert '1 position(s) match "base"' in find_positions(fx.as_portfolio(), "base")

    def test_finds_by_category(self):
        out = find_positions(fx.as_portfolio(), "defi")
        assert out.startswith('2 position(s) match "defi", $16,200.00 in total')

    def test_is_case_insensitive(self):
        assert find_positions(fx.as_portfolio(), "UNISWAP").startswith("1 position")

    def test_shows_composition_so_a_pool_answer_has_its_legs(self):
        out = find_positions(fx.as_portfolio(), "aave")
        assert "borrow USDC $5,200.00" in out

    def test_searches_every_wallet(self):
        out = find_positions(fx.as_portfolio(fx.two_wallet_portfolio()), "sol")
        assert "1 position(s)" in out and "SOL" in out

    def test_a_headline_the_model_could_quote_is_the_right_number(self):
        held = fx.as_portfolio(
            fx.portfolio(
                [
                    fx.wallet(
                        fx.EVM_ADDRESS,
                        [
                            fx.position("Thena", 100.0, platform="bsc_thena"),
                            fx.position("Ethena", 900.0, platform="ethena"),
                        ],
                    )
                ]
            )
        )
        out = find_positions(held, "Thena")
        assert out.startswith('1 position(s) match "Thena", $100.00 in total')
        assert "Ethena" not in out

    def test_a_miss_names_the_protocols_that_are_there(self):
        out = find_positions(fx.as_portfolio(), "curve")
        assert "No position matches" in out and "uniswap3" in out and "aave3" in out

    def test_an_empty_query_is_refused_not_guessed(self):
        assert find_positions(fx.as_portfolio(), "   ") == "Empty query."

    def test_reports_the_full_total_even_when_the_list_is_capped(self):
        out = find_positions(fx.as_portfolio(tail=MAX_MATCHES + 10), "small")
        assert f"{MAX_MATCHES + 10} position(s) match" in out
        assert f"showing the largest {MAX_MATCHES}" in out
        assert len(out.splitlines()) == MAX_MATCHES + 1


def breakdown(*positions: dict) -> str:
    portfolio = fx.as_portfolio(fx.portfolio([fx.wallet(fx.EVM_ADDRESS, list(positions))]))
    return describe_exposure(exposure_of(portfolio.positions, named_position))


class TestAssetBreakdown:
    def test_the_stablecoin_half_of_a_pool_counts_as_stablecoins(self):
        out = breakdown(fx.UNISWAP)
        assert "Stablecoins: $1,676.00 held, $0.00 owed, $1,676.00 net — 46.56%" in out
        assert "Volatile assets: $1,924.00 held" in out

    def test_a_stablecoin_debt_is_subtracted_where_it_belongs(self):
        out = breakdown(fx.AAVE)
        assert "Stablecoins: $0.00 held, $5,200.00 owed, -$5,200.00 net" in out
        assert "Volatile assets: $12,500.00 held, $0.00 owed, $12,500.00 net" in out
        assert "Counted total $7,300.00" in out

    def test_a_vault_named_by_its_stablecoin_counts_without_legs(self):
        vault = fx.position("sUSDe", 1_000.0, platform="ethena", category="defi")
        assert "Stablecoins: $1,000.00 held" in breakdown(vault, fx.ETH)

    def test_a_position_with_unknown_contents_is_in_neither_figure(self):
        pool = fx.position(
            "UNI-V3",
            500.0,
            name="Uniswap V3 (Liquidity Pool)",
            platform="uniswap3",
            category="defi",
        )
        out = breakdown(pool, fx.ETH)
        assert "Volatile assets: $16,683.65 held" in out
        assert "in neither figure above: $500.00" in out
        assert "UNI-V3 (Uniswap V3 (Liquidity Pool)) on eth $500.00" in out

    def test_the_token_list_is_net_of_debt(self):
        out = breakdown(fx.AAVE, fx.UNISWAP)
        assert "USDC -$3,524.00" in out


class TestCalculate:
    def test_answers_exactly(self):
        assert calculated("0.1 + 0.2") == "0.1 + 0.2 = 0.3 (rounded to cents: 0.30)"

    def test_a_share_is_rounded_for_reading_and_kept_exact(self):
        out = calculated("21327.72 / 85109.6 * 100")
        assert "= 25.0591237651" in out and "rounded to cents: 25.06" in out

    def test_says_it_could_not_rather_than_guessing(self):
        assert calculated("1 / 0").startswith("Could not calculate")
        assert calculated("open('x')").startswith("Could not calculate")


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


def test_gmx_fees_earned_are_shown_as_all_time():
    line = position_line(fx.as_position({**fx.UNISWAP, "feesEarnedUsd": 32.62}))
    assert "fees earned in GMX $32.62 all time" in line


def test_a_position_without_gmx_fees_says_nothing_about_them():
    assert "fees earned" not in position_line(fx.as_position(fx.UNISWAP))


class TestWhatTheDataDoesNotName:
    def test_a_position_without_a_symbol_is_said_to_have_none(self):
        line = position_line(fx.as_position(fx.NAMELESS))
        assert line.startswith("unnamed position: $1,003.15")
        assert "?" not in line


class TestHowFreshTheNumbersAre:
    NOW = datetime(2026, 1, 1, 12, 30, tzinfo=UTC)

    def test_the_header_says_how_old_the_oldest_scan_is(self):
        read = fx.as_portfolio(
            fx.portfolio(
                [
                    fx.wallet(fx.EVM_ADDRESS, [fx.ETH], last_synced_at="2026-01-01T12:27:00Z"),
                    fx.wallet(
                        fx.SOL_ADDRESS,
                        [fx.SOL_TOKEN],
                        chain="SOL",
                        last_synced_at="2026-01-01T12:05:00Z",
                    ),
                ]
            )
        )
        block = portfolio_context(read, 12, now=self.NOW)
        assert "oldest wallet scanned 25 min ago." in block.splitlines()[0]
        assert "scanned 3 min ago:" in block
        assert "scanned 25 min ago:" in block

    def test_a_wallet_never_scanned_says_so(self):
        read = fx.as_portfolio(fx.portfolio([fx.wallet(fx.EVM_ADDRESS, [], last_synced_at=None)]))
        block = portfolio_context(read, 12, now=self.NOW)
        assert "not scanned yet." in block.splitlines()[0]
        assert "never scanned:" in block

    def test_ages_read_in_the_unit_a_person_would_use(self):
        at = datetime(2026, 1, 1, tzinfo=UTC)
        assert scanned_ago(at, at + timedelta(seconds=30)) == "scanned just now"
        assert scanned_ago(at, at + timedelta(minutes=90)) == "scanned 90 min ago"
        assert scanned_ago(at, at + timedelta(hours=5)) == "scanned 5 h ago"
        assert scanned_ago(at, at + timedelta(days=3)) == "scanned 3 days ago"
