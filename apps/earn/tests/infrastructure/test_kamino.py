"""Kamino's payloads, and what they must become.

These run the real `KaminoApi` and the real mapping against recorded payloads,
so pagination, the per-market fan-out and the joins are all under test.
"""
from collections.abc import Sequence
from decimal import Decimal

from earn.domain.pool import Pool
from earn.domain.values import PoolKind, Rate
from earn.infrastructure.kamino.api import KaminoApi
from earn.infrastructure.kamino.source import KaminoSource
from tests.fixtures.kamino import RecordedKamino


async def test_the_whole_catalog_costs_a_call_per_market_plus_three():
    transport = RecordedKamino()
    await KaminoSource(KaminoApi(transport)).fetch()

    assert transport.calls.count("/kvaults/vaults") == 1
    # Two pages of the batch endpoint, not one call per vault
    assert transport.calls.count("/kvaults/vaults/metrics") == 2
    assert transport.calls.count("/v2/kamino-market") == 1
    assert sum(1 for call in transport.calls if call.startswith("/kamino-market/")) == 2


async def test_a_vaults_apy_is_base_plus_rewards(pools: Sequence[Pool]):
    """Checked against kamino.com, which showed this vault at 5.08%.

    `apy` alone is 2.58% and is what borrowers pay; the farm programme is the
    other half. A caller quoting one of them quotes a number the user cannot
    find on the screen in front of them.
    """
    vault = next(pool for pool in pools if "Sentora" in pool.name)
    assert vault.apy.base == Rate(Decimal("0.02575185788652079"))
    assert vault.apy.rewards == Rate(Decimal("0.025042890119320038"))
    assert round(vault.apy.net.value, 4) == Decimal("0.0508")


async def test_a_vault_carries_what_a_deposit_would_need(pools: Sequence[Pool]):
    vault = next(pool for pool in pools if "Sentora" in pool.name)
    assert str(vault.id) == "sol:kamino:vault:A2wsxhA7pF4B2UKVfXocb6TAAP9ipfPJam6oMKgDE5BK"
    # Resolved from reserve metrics: a vault knows its token by mint alone
    assert vault.token.symbol == "PYUSD"
    assert vault.token.decimals == 6
    assert vault.deposit.shares_mint == "DCqyVY1SFCwq8unnexv9pjujVAC7jsmjfoUWBrNLvbY"
    # 100000 raw at six decimals is 0.1 PYUSD — scaled, not passed through
    assert vault.deposit.min_amount == Decimal("0.1")
    assert vault.fees is not None and vault.fees.performance_bps == 500
    assert vault.url.endswith("/earn/lend/A2wsxhA7pF4B2UKVfXocb6TAAP9ipfPJam6oMKgDE5BK")


async def test_allocations_name_their_reserves_and_drop_the_empty_ones(pools: Sequence[Pool]):
    vault = next(pool for pool in pools if "Sentora" in pool.name)
    # Three in the on-chain strategy, one at weight zero: that one is not where
    # the money is, so it is not part of the described risk
    assert len(vault.allocations) == 2
    first, second = vault.allocations
    assert first.market_name == "Ethena Market"
    assert first.token_symbol == "PYUSD"
    # Weights are renormalised over the live allocations, so they add up
    assert round(first.weight_pct + second.weight_pct) == 100


async def test_a_reserve_is_the_same_shape_of_thing(pools: Sequence[Pool]):
    reserve = next(pool for pool in pools if pool.token.symbol == "SOL")
    assert reserve.kind == PoolKind.RESERVE
    assert reserve.apy.base == Rate(Decimal("0.045123456789"))
    # This endpoint reports no reward programme, so we claim none
    assert reserve.apy.rewards == Rate.ZERO
    assert reserve.borrow_apy == Rate(Decimal("0.0597"))
    assert reserve.deposit.lending_market == "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF"
    assert reserve.liquidity.utilization is not None
    assert round(reserve.liquidity.utilization.value, 2) == Decimal("0.90")


async def test_scientific_notation_and_missing_fields_survive(pools: Sequence[Pool]):
    """Upstream sends "4.65e-16" and omits fields; neither may fail a refresh."""
    tiny = next(pool for pool in pools if pool.token.symbol == "ADRASOL")
    assert tiny.liquidity.available is not None and tiny.liquidity.available > 0

    dormant = next(pool for pool in pools if "Testing" in pool.name)
    assert dormant.apy.net == Rate.ZERO
    assert dormant.deposit.token_program is None


async def test_reserves_can_be_left_out_without_losing_the_tickers():
    """They are read either way: they are the only place a mint's ticker is written."""
    pools = await KaminoSource(KaminoApi(RecordedKamino()), include_reserves=False).fetch()
    assert {pool.kind for pool in pools} == {PoolKind.VAULT}
    assert next(pool for pool in pools if "Sentora" in pool.name).token.symbol == "PYUSD"
