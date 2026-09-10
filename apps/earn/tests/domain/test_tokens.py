"""The "what can I do with my USDC" read model."""
from earn.domain.catalog import Catalog
from earn.domain.tokens import token_yields


def test_a_token_row_points_at_its_best_pool(catalog: Catalog):
    rows = token_yields(catalog.listed)
    pyusd = next(row for row in rows if row.token_symbol == "PYUSD")
    # One vault and two reserves take PYUSD; the vault pays best
    assert pyusd.pool_count == 3
    assert pyusd.best.kind == "vault"
    assert pyusd.best.apy.net == max(
        pool.apy.net for pool in catalog.listed if pool.token.symbol == "PYUSD"
    )


def test_rows_are_ordered_by_where_the_market_is(catalog: Catalog):
    """Not by rate: the top of this list should be real depth, not the thinnest pool."""
    rows = token_yields(catalog.listed)
    assert [row.total_tvl for row in rows] == sorted((row.total_tvl for row in rows), reverse=True)
