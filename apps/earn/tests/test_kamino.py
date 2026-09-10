"""Normalisation: what Kamino says, and what a caller of ours gets."""
from decimal import Decimal

from app.sources import kamino

from .fixtures import FakeKamino


async def pools():
    return await kamino.fetch_pools(FakeKamino())


async def test_the_whole_catalog_costs_a_call_per_market_plus_three():
    upstream = FakeKamino()
    await kamino.fetch_pools(upstream)
    assert upstream.calls.count("/kvaults/vaults") == 1
    # Two pages of the batch endpoint, not one call per vault
    assert upstream.calls.count("/kvaults/vaults/metrics") == 2
    assert upstream.calls.count("/v2/kamino-market") == 1
    assert sum(1 for call in upstream.calls if call.startswith("/kamino-market/")) == 2


async def test_a_vaults_apy_is_base_plus_rewards():
    """Checked against kamino.com, which showed this vault at 5.08%.

    `apy` alone is 2.58% and is what borrowers pay; the farm programme is the
    other half. A caller that quotes only one of them quotes a number the user
    cannot find on the screen in front of them.
    """
    vault = next(pool for pool in await pools() if pool.kind == "vault" and "Sentora" in pool.name)
    assert vault.apy.base == Decimal("0.02575185788652079")
    assert vault.apy.rewards == Decimal("0.025042890119320038")
    assert round(vault.apy.net, 4) == Decimal("0.0508")


async def test_a_vault_carries_what_a_deposit_would_need():
    vault = next(pool for pool in await pools() if "Sentora" in pool.name)
    assert vault.id == "sol:kamino:vault:A2wsxhA7pF4B2UKVfXocb6TAAP9ipfPJam6oMKgDE5BK"
    assert vault.token.symbol == "PYUSD"  # resolved from reserve metrics, not from the mint
    assert vault.token.decimals == 6
    assert vault.deposit.shares_mint == "DCqyVY1SFCwq8unnexv9pjujVAC7jsmjfoUWBrNLvbY"
    # 100000 raw at six decimals is 0.1 PYUSD — scaled, not passed through
    assert vault.deposit.min_amount == Decimal("0.1")
    assert vault.fees.performance_bps == 500
    assert vault.url.endswith("/earn/lend/A2wsxhA7pF4B2UKVfXocb6TAAP9ipfPJam6oMKgDE5BK")


async def test_allocations_name_their_reserves_and_drop_the_empty_ones():
    vault = next(pool for pool in await pools() if "Sentora" in pool.name)
    # Three in the on-chain strategy, one of them at weight zero: that one is
    # not where the money is, so it is not part of the described risk.
    assert len(vault.allocations) == 2
    first, second = vault.allocations
    assert first.market_name == "Ethena Market"
    assert first.token_symbol == "PYUSD"
    # Weights are renormalised over the live allocations, so they add up
    assert round(first.weight_pct + second.weight_pct) == 100


async def test_a_reserve_is_the_same_shape_of_thing():
    reserve = next(pool for pool in await pools() if pool.token.symbol == "SOL")
    assert reserve.kind == "reserve"
    assert reserve.apy.base == Decimal("0.045123456789")
    assert reserve.apy.rewards == 0  # this endpoint reports none, so we claim none
    assert reserve.borrow_apy == Decimal("0.0597")
    assert reserve.deposit.lending_market == "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF"
    assert round(reserve.liquidity.utilization, 2) == Decimal("0.90")


async def test_scientific_notation_and_missing_fields_survive():
    """Upstream sends "4.65e-16" and omits fields; neither may fail a refresh."""
    every = await pools()
    tiny = next(pool for pool in every if pool.token.symbol == "ADRASOL")
    assert tiny.liquidity.available > 0
    dormant = next(pool for pool in every if "Testing" in pool.name)
    assert dormant.apy.net == 0
    assert dormant.deposit.token_program is None
