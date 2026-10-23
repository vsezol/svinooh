from decimal import Decimal

from app.agent.tools import deposit_tools, tool_phrase
from tests.support import Catalog


class TestPuttingADepositInFrontOfSomebody:
    async def test_a_pool_and_an_amount_become_something_to_sign(self):
        shelf, prepared = Catalog(), []
        (tool,) = deposit_tools(shelf, prepared)
        said = await tool.ainvoke({"pool_id": "sol:kamino:vault:AAA", "amount": "250"})
        assert len(prepared) == 1
        deposit = prepared[0]
        assert deposit.amount == Decimal("250") and deposit.pool.token == "USDC"
        assert deposit.terms.program_id and deposit.terms.token_mint
        assert "nothing happens until they sign" in said
        assert "Do not say it is done" in said

    async def test_an_id_that_is_not_a_pool_prepares_nothing(self):
        shelf, prepared = Catalog(), []
        (tool,) = deposit_tools(shelf, prepared)
        said = await tool.ainvoke({"pool_id": "made-up", "amount": "250"})
        assert prepared == [] and "No pool has the id made-up" in said

    async def test_an_amount_that_is_not_a_number_prepares_nothing(self):
        shelf, prepared = Catalog(), []
        (tool,) = deposit_tools(shelf, prepared)
        for amount in ("a lot", "", "-5", "0"):
            assert "not a number" in await tool.ainvoke(
                {"pool_id": "sol:kamino:vault:AAA", "amount": amount}
            )
        assert prepared == []

    async def test_below_the_minimum_is_a_question_not_a_card(self):
        shelf, prepared = Catalog(), []
        (tool,) = deposit_tools(shelf, prepared)
        said = await tool.ainvoke({"pool_id": "sol:kamino:vault:AAA", "amount": "0.5"})
        assert prepared == [] and "takes at least 1 USDC" in said

    async def test_the_trace_says_which_pool_is_being_prepared(self):
        assert tool_phrase("propose_deposit", {"pool_id": "sol:kamino:vault:AAA"}) == (
            "Preparing a deposit · sol:kamino:vault:AAA"
        )


def test_the_trace_says_what_it_went_looking_for():
    assert tool_phrase("earn_options", {"token": "usdc"}) == "Reading lending rates · USDC"
    assert tool_phrase("earn_options", {}) == "Reading lending rates"
