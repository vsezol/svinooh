"""Which branch a turn takes, and what it is allowed to do there.

The graph decides what the model sees and whether anything is written, so
these tests pin the routes rather than the wording of any answer.
"""

import pytest

import app.agent.graph as graph
from app.agent.intent import IntentLabel
from app.agent.onboarding import ConfirmationDecision, create_portfolio_with_wallets
from tests import fixtures as fx


class Api:
    """The portfolio API, recording what it was asked and by whom."""

    def __init__(self, *, owned=None, portfolio=None, refuse=False, me_fails=False):
        self.calls = []
        self.owned = owned if owned is not None else []
        self.portfolio_data = portfolio or fx.rich_portfolio()
        self.refuse = refuse
        self.me_fails = me_fails
        self.created = 0
        self.wallets = []
        # The ownerless door, kept apart from `created` so a test can say which
        # one a turn went through rather than only that something was made.
        self.created_anonymous = []
        # Who each wallet was added as. None is the interesting value: it is
        # what proves the visitor's path never borrowed a token.
        self.wallet_tokens = []

    async def me(self, token):
        self.calls.append(("me", token))
        if self.me_fails:
            raise RuntimeError("auth is down")
        return {"id": "u1", "portfolios": self.owned}

    async def portfolio(self, ref, token):
        self.calls.append(("portfolio", ref, token))
        if self.refuse:
            raise RuntimeError("403 Forbidden")
        return self.portfolio_data

    async def history(self, ref, range_, token):
        return fx.history([("2026-09-01T00:00:00Z", 1.0), ("2026-09-07T00:00:00Z", 2.0)])

    async def create_portfolio(self, token):
        self.created += 1
        return {"slug": "new-pf"}

    async def create_anonymous_portfolio(self, address):
        self.created_anonymous.append(address)
        return {"slug": "anon-pf"}

    async def add_wallet(self, slug, address, token):
        self.wallets.append((slug, address))
        self.wallet_tokens.append(token)
        return {"id": "w"}


class Model:
    """The answering model: records the prompt, replies with whatever it is given."""

    def __init__(self, tool_calls=None, text="answered"):
        self.prompts = []
        self.bound = 0
        self._tool_calls = tool_calls
        self.text = text

    def bind_tools(self, tools):
        self.bound += 1
        return self

    async def ainvoke(self, messages):
        self.prompts.append(messages[0].content)
        calls, self._tool_calls = self._tool_calls, None

        class Reply:
            content = self.text
            tool_calls = calls or []

        return Reply()


@pytest.fixture
def wired(monkeypatch):
    """Wire the graph to doubles and hand the test both of them."""

    def _wire(*, intent="portfolio", confirmation=None, api=None, model=None):
        api = api or Api()
        model = model or Model()
        monkeypatch.setattr(graph, "portfolio_source", api)
        monkeypatch.setattr(graph, "get_model", lambda: model)

        async def classify(_question):
            return IntentLabel(intent=intent, reason="stubbed")

        async def classify_confirmation(_reply):
            if confirmation is None:
                raise AssertionError("no confirmation expected on this path")
            return ConfirmationDecision(decision=confirmation, reason="stubbed")

        monkeypatch.setattr(graph, "classify", classify)
        monkeypatch.setattr(graph, "classify_confirmation", classify_confirmation)
        graph.agent_graph.cache_clear()
        return api, model

    return _wire


async def run(**state):
    return await graph.agent_graph().ainvoke({"question": "q", "history": [], **state})


class TestRouting:
    async def test_a_general_question_never_touches_the_portfolio(self, wired):
        api, _ = wired(intent="general")
        out = await run(portfolio="p", authorization="Bearer T")
        assert out["answer"] == "answered" and api.calls == []

    async def test_a_portfolio_on_screen_is_the_portfolio_answered_about(self, wired):
        api, model = wired()
        out = await run(portfolio="on-screen", authorization="Bearer T")
        assert out["route"] == "grounded"
        assert ("portfolio", "on-screen", "Bearer T") in api.calls
        assert ("me", "Bearer T") not in api.calls, "a hint skips the identity lookup"
        assert "By network" in model.prompts[0]

    async def test_a_visitor_is_grounded_in_what_they_can_already_read(self, wired):
        api, _ = wired()
        out = await run(portfolio="public-pf")
        assert out["route"] == "grounded"
        assert ("portfolio", "public-pf", None) in api.calls, "no token is not a header"

    async def test_signed_in_with_no_hint_asks_who_is_asking(self, wired):
        api, _ = wired(api=Api(owned=[{"slug": "theirs"}]))
        out = await run(authorization="Bearer T")
        assert out["target_portfolio"] == "theirs"
        assert ("me", "Bearer T") in api.calls

    async def test_owning_nothing_leads_to_onboarding(self, wired):
        _, model = wired(api=Api(owned=[]))
        out = await run(authorization="Bearer T")
        assert out["route"] == "onboard"
        assert "does not own one" in model.prompts[0]

    async def test_signed_out_with_nothing_on_screen_is_asked_to_sign_in(self, wired):
        _, model = wired()
        out = await run()
        assert out["route"] == "onboard" and "not signed" in model.prompts[0]

    async def test_an_identity_outage_is_not_an_empty_portfolio_list(self, wired):
        _, model = wired(api=Api(me_fails=True))
        out = await run(authorization="Bearer T")
        assert out["route"] == "unavailable"
        assert "could not be fetched" in model.prompts[0]
        assert "does not own one" not in model.prompts[0], "a hiccup must not deny ownership"

    async def test_a_refused_portfolio_degrades_instead_of_guessing(self, wired):
        _, model = wired(api=Api(refuse=True))
        await run(portfolio="not-mine", authorization="Bearer T")
        assert "could not be fetched" in model.prompts[0]
        assert "By network" not in model.prompts[0]

    async def test_a_broken_classifier_routes_where_money_is_handled(self, wired, monkeypatch):
        wired()

        async def boom(_q):
            raise RuntimeError("classifier down")

        monkeypatch.setattr(graph, "classify", boom)
        graph.agent_graph.cache_clear()
        out = await run(portfolio="p", authorization="Bearer T")
        assert out["intent"] == "portfolio" and out["route"] == "grounded"


class TestTools:
    async def test_the_model_may_drill_down_and_the_result_comes_back(self, wired):
        model = Model(
            tool_calls=[{"name": "position_details", "args": {"query": "uniswap"}, "id": "c1"}]
        )
        wired(model=model)
        out = await run(portfolio="p", authorization="Bearer T")
        assert out["answer"] == "answered"
        assert model.bound == 1, "tools are offered once per turn"
        assert len(model.prompts) == 2, "the model is asked again with the tool's answer"

    async def test_a_degraded_turn_offers_no_tools_to_drill_with(self, wired):
        model = Model()
        wired(api=Api(refuse=True), model=model)
        await run(portfolio="p", authorization="Bearer T")
        assert model.bound == 0


class TestAVisitorWithNoAccount:
    """The front door's premise: an answer, and a portfolio, without signing up."""

    async def test_a_visitor_is_proposed_to_rather_than_turned_away(self, wired):
        # This branch used to answer and stop, so a visitor's addresses went
        # nowhere. Now the tool is bound for them too, and the turn ends with a
        # proposal waiting on their confirmation.
        model = Model(
            tool_calls=[{"name": "ProposePortfolio", "args": {"addresses": ["0xAAA"]}, "id": "c"}]
        )
        api, _ = wired(api=Api(owned=[]), model=model)
        out = await run()
        assert out["pending_set"] == ["0xAAA"]
        assert api.created == 0 and api.created_anonymous == [], "still only a proposal"

    async def test_the_visitor_is_told_the_portfolio_will_be_public(self, wired):
        # The disclosure has to reach the turn BEFORE the write, because after
        # it the portfolio is already public. The confirmation prompt is that
        # turn, so the fact belongs in it rather than in the created message.
        model = Model(
            tool_calls=[
                {"name": "ProposePortfolio", "args": {"addresses": ["0xAAA", "sol1"]}, "id": "c"}
            ]
        )
        wired(api=Api(owned=[]), model=model)
        await run()
        confirmation = model.prompts[-1]
        assert "public" in confirmation
        assert "held together" in confirmation, "two wallets are linked in the open"

    async def test_an_account_is_not_told_its_portfolio_is_public(self, wired):
        # The owned door makes a private portfolio, so the same caveat there
        # would be a false warning.
        model = Model(
            tool_calls=[{"name": "ProposePortfolio", "args": {"addresses": ["0xAAA"]}, "id": "c"}]
        )
        wired(api=Api(owned=[]), model=model)
        await run(authorization="Bearer T")
        assert "public" not in model.prompts[-1]


class TestTheExecutionItself:
    """`create_portfolio_with_wallets` directly — the two doors, up close."""

    async def test_the_result_says_which_door_it_went_through(self):
        # The caller relays this: a portfolio nobody owns needs saying so, and
        # the answer can only say it if the result carries it.
        api = Api()
        owned = await create_portfolio_with_wallets(api, ["0xAAA"], "Bearer T")
        visitor = await create_portfolio_with_wallets(api, ["0xBBB"], None)
        assert owned["anonymous"] is False and owned["slug"] == "new-pf"
        assert visitor["anonymous"] is True and visitor["slug"] == "anon-pf"

    async def test_the_address_that_opened_it_counts_as_added(self):
        # The ownerless POST both creates and holds the first wallet. Reporting
        # only the ones that went through add_wallet would tell a visitor their
        # first address was dropped.
        api = Api()
        result = await create_portfolio_with_wallets(api, ["0xAAA", "sol1"], None)
        assert result["added"] == ["0xAAA", "sol1"]
        assert api.wallets == [("anon-pf", "sol1")], "only the rest are POSTed"

    async def test_an_empty_proposal_makes_nothing_rather_than_guessing(self):
        # The owned door can make an empty portfolio; the ownerless one is
        # opened BY an address, so there is nothing to open. Failing is the
        # honest outcome — the alternative is an IndexError read as a mystery.
        api = Api()
        with pytest.raises(ValueError, match="at least one address"):
            await create_portfolio_with_wallets(api, [], None)
        assert api.created_anonymous == []

    async def test_one_refused_wallet_does_not_sink_the_visitors_portfolio(self):
        class Picky(Api):
            async def add_wallet(self, slug, address, token):
                if address == "bad":
                    raise RuntimeError("unsupported network")
                return await super().add_wallet(slug, address, token)

        result = await create_portfolio_with_wallets(Picky(), ["0xAAA", "bad", "sol1"], None)
        assert result["added"] == ["0xAAA", "sol1"]
        assert [f["address"] for f in result["failed"]] == ["bad"]
        assert result["slug"] == "anon-pf", "the portfolio still exists"


class TestWrites:
    async def test_a_proposal_creates_nothing_by_itself(self, wired):
        model = Model(
            tool_calls=[
                {
                    "name": "ProposePortfolio",
                    "args": {"addresses": [" 0xAAA ", "0xAAA", "sol1"]},
                    "id": "c",
                }
            ]
        )
        api, _ = wired(api=Api(owned=[]), model=model)
        out = await run(authorization="Bearer T")
        assert out["pending_set"] == ["0xAAA", "sol1"], "trimmed and deduped"
        assert api.created == 0, "nothing is created before a confirmation"

    async def test_a_confirmation_on_a_later_turn_writes(self, wired):
        api, _ = wired(confirmation="confirm")
        out = await run(authorization="Bearer T", pending_addresses=["0xAAA", "sol1"])
        assert api.created == 1
        assert api.wallets == [("new-pf", "0xAAA"), ("new-pf", "sol1")]
        assert out["pending_clear"] is True

    async def test_a_refusal_writes_nothing_and_forgets_the_proposal(self, wired):
        api, _ = wired(confirmation="cancel")
        out = await run(authorization="Bearer T", pending_addresses=["0xAAA"])
        assert api.created == 0 and out["pending_clear"] is True

    async def test_an_unrelated_reply_keeps_the_proposal_waiting(self, wired):
        api, _ = wired(intent="general", confirmation="other")
        out = await run(authorization="Bearer T", pending_addresses=["0xAAA"])
        assert api.created == 0
        assert not out.get("pending_clear") and not out.get("pending_set")

    async def test_a_yes_without_a_token_writes_through_the_ownerless_door(self, wired):
        # The rule this replaces was "a yes without a token cannot write", and
        # it was the sign-in wall the front door exists to remove. A visitor
        # confirms and gets a portfolio; what their missing token changes is
        # WHICH door, never whether the confirmed action happens.
        api, _ = wired(confirmation="confirm")
        out = await run(pending_addresses=["0xAAA", "sol1"])
        assert api.created == 0, "the owned door needs a token and was not used"
        assert api.created_anonymous == ["0xAAA"], "opened by its first address"
        assert out["pending_clear"] is True
        # Named for the route layer to remember on the conversation. Without it
        # the next question re-onboards a visitor who already has a portfolio,
        # because nobody can ask the host what a nameless caller owns.
        assert out["portfolio_created"] == "anon-pf"

    async def test_the_visitors_remaining_wallets_are_added_without_a_token(self, wired):
        # The create spends the first address; the rest go through the host's
        # optional-auth add-wallet, and as nobody — borrowing a token here
        # would file a visitor's wallets under somebody else's account.
        api, _ = wired(confirmation="confirm")
        await run(pending_addresses=["0xAAA", "sol1", "btc1"])
        assert api.wallets == [("anon-pf", "sol1"), ("anon-pf", "btc1")]
        assert api.wallet_tokens == [None, None]

    async def test_a_signed_in_yes_still_takes_the_owned_door(self, wired):
        # The other half of the same rule: a token means the portfolio lands
        # owned, and the ownerless door is not touched.
        api, _ = wired(confirmation="confirm")
        await run(authorization="Bearer T", pending_addresses=["0xAAA"])
        assert api.created == 1 and api.created_anonymous == []

    async def test_an_unreadable_confirmation_never_writes(self, wired, monkeypatch):
        api, _ = wired(intent="general")

        async def boom(_reply):
            raise RuntimeError("classifier down")

        monkeypatch.setattr(graph, "classify_confirmation", boom)
        graph.agent_graph.cache_clear()
        out = await run(authorization="Bearer T", pending_addresses=["0xAAA"])
        assert api.created == 0 and not out.get("pending_clear")
