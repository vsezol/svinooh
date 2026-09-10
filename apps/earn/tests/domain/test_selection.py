"""Filtering, ordering, and the identity a cursor depends on."""
from decimal import Decimal

from earn.domain.catalog import Catalog
from earn.domain.selection import PoolFilter, PoolSelection, SortKey, SortOrder, paginate
from earn.domain.values import PoolKind, Rate


def test_default_order_is_the_best_rate_first(catalog: Catalog):
    ordered = PoolSelection().apply(catalog.listed)
    rates = [pool.apy.net for pool in ordered]
    assert rates == sorted(rates, reverse=True)
    assert "Sentora" in ordered[0].name


def test_filters_narrow_by_ticker_and_by_kind(catalog: Catalog):
    by_token = PoolSelection(filter=PoolFilter(token="pyusd")).apply(catalog.listed)
    assert {pool.token.symbol for pool in by_token} == {"PYUSD"}

    reserves = PoolSelection(filter=PoolFilter(kind=PoolKind.RESERVE)).apply(catalog.listed)
    assert {pool.kind for pool in reserves} == {PoolKind.RESERVE}

    both = PoolFilter(token="PYUSD", kind=PoolKind.VAULT)
    assert len(PoolSelection(filter=both).apply(catalog.listed)) == 1


def test_a_rate_floor_filters_on_the_net_rate(catalog: Catalog):
    chosen = PoolSelection(filter=PoolFilter(min_apy=Rate(Decimal("0.04")))).apply(catalog.listed)
    assert all(pool.apy.net >= Rate(Decimal("0.04")) for pool in chosen)
    assert chosen


def test_ties_are_broken_so_the_order_is_stable(catalog: Catalog):
    by_name = PoolSelection(sort=SortOrder(SortKey.NAME, descending=False))
    assert by_name.apply(catalog.listed) == by_name.apply(list(reversed(catalog.listed)))


def test_the_fingerprint_names_the_list_not_the_page():
    """Page size may change mid-read; it does not change which list is read."""
    base = PoolSelection(filter=PoolFilter(token="USDC"))
    assert base.fingerprint() == PoolSelection(filter=PoolFilter(token="usdc")).fingerprint()
    assert base.fingerprint() != PoolSelection(filter=PoolFilter(token="PYUSD")).fingerprint()
    assert base.fingerprint() != PoolSelection(
        filter=PoolFilter(token="USDC"), sort=SortOrder(SortKey.NAME)
    ).fingerprint()


def test_paginate_reports_where_to_continue(catalog: Catalog):
    pools = PoolSelection().apply(catalog.listed)
    first = paginate(pools, offset=0, limit=3)
    assert first.total == len(pools)
    assert first.next_offset == 3
    assert paginate(pools, offset=3, limit=3).next_offset is None
