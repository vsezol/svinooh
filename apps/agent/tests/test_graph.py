"""Which branch a turn takes, and what it is allowed to do there.

The graph decides what the model sees and whether anything is written, so
these tests pin the routes rather than the wording of any answer. Every test
builds its own Agent over an Api and a Model it can inspect afterwards.
"""

import pytest

from app.agent.onboarding import create_portfolio_with_wallets
from app.domain.conversation import Turn
from app.domain.portfolio import Me, PortfolioRef
from app.ports import Ask, Failed, Finished, Progress
from tests import fixtures as fx
from tests.support import Catalog, agent


class Api:
    """The portfolio API, recording what it was asked and by whom."""

    def __init__(self, *, owned=None, portfolio=None, refuse=False, me_fails=False):
        self.calls = []
        #: The slugs this caller owns, as /auth/me would list them.
        self.owned = owned if owned is not None else []
        self.portfolio_data = portfolio or fx.as_portfolio()
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
        return Me(user_id="u1", portfolios=tuple(PortfolioRef(slug=s) for s in self.owned))

    async def portfolio(self, ref, token):
        self.calls.append(("portfolio", ref, token))
        if self.refuse:
            raise RuntimeError("403 Forbidden")
        return self.portfolio_data

    async def history(self, ref, range_, token):
        return fx.as_history([("2026-09-01T00:00:00Z", 1.0), ("2026-09-07T00:00:00Z", 2.0)])

    async def create_portfolio(self, token):
        self.created += 1
        return "new-pf"

    async def create_anonymous_portfolio(self, address):
        self.created_anonymous.append(address)
        return "anon-pf"

    async def add_wallet(self, slug, address, token):
        self.wallets.append((slug, address))
        self.wallet_tokens.append(token)


class Model:
    """The answering model: records the prompt, replies with whatever it is given."""

    def __init__(self, tool_calls=None, text="answered"):
        self.prompts = []
        self.seen = []
        self.bound = 0
        self._tool_calls = tool_calls
        self.text = text

    def bind_tools(self, tools):
        self.bound += 1
        return self

    async def ainvoke(self, messages):
        self.prompts.append(messages[0].content)
        self.seen = messages
        calls, self._tool_calls = self._tool_calls, None

        class Reply:
            content = self.text
            tool_calls = calls or []

        return Reply()


def wire(*, intent="portfolio", confirmation=None, api=None, model=None, catalog=None):
    """The real graph over doubles; hands back all three so a test can look."""
    api = api or Api()
    model = model or Model()
    bot = agent(
        model=model,
        portfolio=api,
        intent=intent,
        confirmation=confirmation,
        catalog=catalog,
    )
    return bot, api, model


async def run(bot, **state):
    """The graph itself, so a test can see which branch a turn took.

    `LangGraphAgent.run` answers in the port's words — an answer and its
    orders — and deliberately says nothing about the route. These tests are
    about the route, and this file is the implementation's own.
    """
    return await bot.graph.ainvoke({"question": "q", "history": (), **state})


class TestRouting:
    async def test_a_general_question_never_touches_the_portfolio(self):
        bot, api, _ = wire(intent="general")
        out = await run(bot, portfolio="p", authorization="Bearer T")
        assert out["answer"] == "answered" and api.calls == []

    async def test_a_portfolio_on_screen_is_the_portfolio_answered_about(self):
        bot, api, model = wire()
        out = await run(bot, portfolio="on-screen", authorization="Bearer T")
        assert out["route"] == "grounded"
        assert ("portfolio", "on-screen", "Bearer T") in api.calls
        assert ("me", "Bearer T") not in api.calls, "a hint skips the identity lookup"
        assert "By network" in model.prompts[0]

    async def test_a_visitor_is_grounded_in_what_they_can_already_read(self):
        bot, api, _ = wire()
        out = await run(bot, portfolio="public-pf")
        assert out["route"] == "grounded"
        assert ("portfolio", "public-pf", None) in api.calls, "no token is not a header"

    async def test_signed_in_with_no_hint_asks_who_is_asking(self):
        bot, api, _ = wire(api=Api(owned=["theirs"]))
        out = await run(bot, authorization="Bearer T")
        assert out["target_portfolio"] == "theirs"
        assert ("me", "Bearer T") in api.calls

    async def test_owning_nothing_leads_to_onboarding(self):
        bot, _, model = wire(api=Api(owned=[]))
        out = await run(bot, authorization="Bearer T")
        assert out["route"] == "onboard"
        assert "does not own one" in model.prompts[0]

    async def test_signed_out_with_nothing_on_screen_is_asked_to_sign_in(self):
        bot, _, model = wire()
        out = await run(
            bot,
        )
        assert out["route"] == "onboard" and "not signed" in model.prompts[0]

    async def test_an_identity_outage_is_not_an_empty_portfolio_list(self):
        bot, _, model = wire(api=Api(me_fails=True))
        out = await run(bot, authorization="Bearer T")
        assert out["route"] == "unavailable"
        assert "could not be fetched" in model.prompts[0]
        assert "does not own one" not in model.prompts[0], "a hiccup must not deny ownership"

    async def test_a_refused_portfolio_degrades_instead_of_guessing(self):
        bot, _, model = wire(api=Api(refuse=True))
        await run(bot, portfolio="not-mine", authorization="Bearer T")
        assert "could not be fetched" in model.prompts[0]
        assert "By network" not in model.prompts[0]

    async def test_a_broken_classifier_routes_where_money_is_handled(self):
        class Broken:
            async def classify(self, _question):
                raise RuntimeError("classifier down")

        bot = agent(model=Model(), portfolio=Api(), intents=Broken())
        out = await run(bot, portfolio="p", authorization="Bearer T")
        assert out["intent"] == "portfolio" and out["route"] == "grounded"


#: What the model asking "where can USDC earn" looks like on the wire.
EARN_CALL = {"name": "earn_options", "args": {"token": "USDC"}, "id": "e1"}


class TestWhereToPutMoney:
    """The earn branch: the catalog is the inventory, the portfolio is the baseline."""

    async def test_the_catalog_is_asked(self):
        shelf = Catalog()
        bot, _, _ = wire(intent="earn", catalog=shelf, model=Model(tool_calls=[EARN_CALL]))
        out = await run(bot)
        assert out["intent"] == "earn" and shelf.asked == [("USDC", 8)]

    async def test_what_is_already_earning_is_in_the_prompt_to_beat(self):
        bot, api, model = wire(
            intent="earn", catalog=Catalog(), model=Model(tool_calls=[EARN_CALL])
        )
        await run(bot, portfolio="on-screen", authorization="Bearer T")
        assert ("portfolio", "on-screen", "Bearer T") in api.calls
        assert "already has earning" in model.prompts[0], "a recommendation can be a move"

    async def test_collateral_reaches_the_prompt_as_collateral(self):
        leveraged = fx.as_portfolio(fx.portfolio([fx.wallet(fx.SOL_ADDRESS, [fx.KAMINO])]))
        bot, _, model = wire(
            intent="earn",
            catalog=Catalog(),
            api=Api(portfolio=leveraged),
            model=Model(tool_calls=[EARN_CALL]),
        )
        await run(bot, portfolio="on-screen", authorization="Bearer T")
        asked = model.prompts[0]
        assert "SOL $4,490.13 at 4.52%" in asked
        assert "collateral for that loan, not idle money" in asked
        assert "advice to liquidate somebody" in asked

    async def test_a_portfolio_that_will_not_answer_still_gets_advice(self):
        bot, _, model = wire(
            intent="earn",
            catalog=Catalog(),
            api=Api(refuse=True),
            model=Model(tool_calls=[EARN_CALL]),
        )
        out = await run(bot, portfolio="on-screen", authorization="Bearer T")
        assert out["answer"] == "answered"
        assert "already has earning" not in model.prompts[0]

    async def test_the_branch_answers_from_what_the_catalog_said(self):
        bot, _, model = wire(intent="earn", catalog=Catalog(), model=Model(tool_calls=[EARN_CALL]))
        await run(bot)
        said = model.seen[-1].content
        assert "Steakhouse USDC" in said and "Risk low" in said, "the tool result reached the model"

    async def test_a_visitor_is_answered_without_being_asked_who_they_are(self):
        shelf = Catalog()
        bot, api, _ = wire(intent="earn", catalog=shelf, model=Model(tool_calls=[EARN_CALL]))
        out = await run(bot)
        assert out["answer"] == "answered" and api.calls == []
        assert shelf.asked, "a visitor gets the catalog, not a sign-in wall"


class TestTools:
    async def test_the_model_may_drill_down_and_the_result_comes_back(self):
        model = Model(
            tool_calls=[{"name": "position_details", "args": {"query": "uniswap"}, "id": "c1"}]
        )
        bot, _, _ = wire(model=model)
        out = await run(bot, portfolio="p", authorization="Bearer T")
        assert out["answer"] == "answered"
        assert model.bound == 2, "the tools are bound to the cached client on every hop"
        assert len(model.prompts) == 2, "the model is asked again with the tool's answer"

    async def test_a_degraded_turn_offers_no_tools_to_drill_with(self):
        model = Model()
        bot, _, _ = wire(api=Api(refuse=True), model=model)
        await run(bot, portfolio="p", authorization="Bearer T")
        assert model.bound == 0


class TestAVisitorWithNoAccount:
    """The front door's premise: an answer, and a portfolio, without signing up."""

    async def test_a_visitor_is_proposed_to_rather_than_turned_away(self):
        # This branch used to answer and stop, so a visitor's addresses went
        # nowhere. Now the tool is bound for them too, and the turn ends with a
        # proposal waiting on their confirmation.
        model = Model(
            tool_calls=[{"name": "ProposePortfolio", "args": {"addresses": ["0xAAA"]}, "id": "c"}]
        )
        bot, api, _ = wire(api=Api(owned=[]), model=model)
        out = await run(
            bot,
        )
        assert out["pending_set"] == ["0xAAA"]
        assert api.created == 0 and api.created_anonymous == [], "still only a proposal"

    async def test_the_visitor_is_told_the_portfolio_will_be_public(self):
        # The disclosure has to reach the turn BEFORE the write, because after
        # it the portfolio is already public. The confirmation prompt is that
        # turn, so the fact belongs in it rather than in the created message.
        model = Model(
            tool_calls=[
                {"name": "ProposePortfolio", "args": {"addresses": ["0xAAA", "sol1"]}, "id": "c"}
            ]
        )
        bot, _, _ = wire(api=Api(owned=[]), model=model)
        await run(
            bot,
        )
        confirmation = model.prompts[-1]
        assert "public" in confirmation
        assert "held together" in confirmation, "two wallets are linked in the open"

    async def test_an_account_is_not_told_its_portfolio_is_public(self):
        # The owned door makes a private portfolio, so the same caveat there
        # would be a false warning.
        model = Model(
            tool_calls=[{"name": "ProposePortfolio", "args": {"addresses": ["0xAAA"]}, "id": "c"}]
        )
        bot, _, _ = wire(api=Api(owned=[]), model=model)
        await run(bot, authorization="Bearer T")
        assert "public" not in model.prompts[-1]


class TestAYesWithNothingBehindIt:
    """The worst answer this branch can give, and it gave it in production.

    Shown an address, the model asked "want me to?" instead of proposing.
    The next turn's "yes, create it" therefore found no proposal, fell back
    into onboarding, and was answered with "Done — the portfolio is live".
    Nothing had been created, and for a portfolio nobody owns there is no
    account to go looking under.
    """

    async def test_a_yes_is_not_answered_by_improvising(self):
        api = Api(owned=[])
        model = Model(text="Done — the portfolio is live.")
        bot = agent(model=model, portfolio=api, intent="portfolio", confirmation="confirm")
        await run(bot, question="Yes, create it.")
        assert api.created == 0 and api.created_anonymous == []
        told = model.prompts[-1].lower()
        assert "nothing has been created" in told, "the fact is given, not asked for"

    async def test_and_the_conversation_carries_on_when_it_is_not_a_yes(self):
        model = Model(text="Send me the addresses.")
        bot = agent(model=model, portfolio=Api(owned=[]), intent="portfolio", confirmation="other")
        out = await run(bot, question="what is a wallet?")
        assert out["answer"] == "Send me the addresses."

    async def test_an_unreadable_reply_is_not_a_yes(self):
        class Broken:
            async def classify(self, _reply):
                raise RuntimeError("classifier down")

        model = Model(text="Send me the addresses.")
        bot = agent(
            model=model, portfolio=Api(owned=[]), intent="portfolio", confirmations=Broken()
        )
        out = await run(bot, question="yes")
        assert out["answer"] == "Send me the addresses."

    async def test_a_real_proposal_is_untouched(self):
        model = Model(
            tool_calls=[{"name": "ProposePortfolio", "args": {"addresses": ["0xAAA"]}, "id": "c"}]
        )
        bot, api, _ = wire(api=Api(owned=[]), model=model)
        out = await run(bot)
        assert out["pending_set"] == ["0xAAA"] and api.created == 0


class TestTheExecutionItself:
    """`create_portfolio_with_wallets` directly — the two doors, up close."""

    async def test_the_result_says_which_door_it_went_through(self):
        # The caller relays this: a portfolio nobody owns needs saying so, and
        # the answer can only say it if the result carries it.
        api = Api()
        owned = await create_portfolio_with_wallets(api, ["0xAAA"], "Bearer T")
        visitor = await create_portfolio_with_wallets(api, ["0xBBB"], None)
        assert owned.anonymous is False and owned.slug == "new-pf"
        assert visitor.anonymous is True and visitor.slug == "anon-pf"

    async def test_the_address_that_opened_it_counts_as_added(self):
        # The ownerless POST both creates and holds the first wallet. Reporting
        # only the ones that went through add_wallet would tell a visitor their
        # first address was dropped.
        api = Api()
        result = await create_portfolio_with_wallets(api, ["0xAAA", "sol1"], None)
        assert result.added == ("0xAAA", "sol1")
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
        assert result.added == ("0xAAA", "sol1")
        assert [r.address for r in result.refused] == ["bad"]
        assert result.slug == "anon-pf", "the portfolio still exists"


class TestWrites:
    async def test_a_proposal_creates_nothing_by_itself(self):
        model = Model(
            tool_calls=[
                {
                    "name": "ProposePortfolio",
                    "args": {"addresses": [" 0xAAA ", "0xAAA", "sol1"]},
                    "id": "c",
                }
            ]
        )
        bot, api, _ = wire(api=Api(owned=[]), model=model)
        out = await run(bot, authorization="Bearer T")
        assert out["pending_set"] == ["0xAAA", "sol1"], "trimmed and deduped"
        assert api.created == 0, "nothing is created before a confirmation"

    async def test_a_confirmation_on_a_later_turn_writes(self):
        bot, api, _ = wire(confirmation="confirm")
        out = await run(bot, authorization="Bearer T", pending_addresses=["0xAAA", "sol1"])
        assert api.created == 1
        assert api.wallets == [("new-pf", "0xAAA"), ("new-pf", "sol1")]
        assert out["pending_clear"] is True

    async def test_a_refusal_writes_nothing_and_forgets_the_proposal(self):
        bot, api, _ = wire(confirmation="cancel")
        out = await run(bot, authorization="Bearer T", pending_addresses=["0xAAA"])
        assert api.created == 0 and out["pending_clear"] is True

    async def test_an_unrelated_reply_keeps_the_proposal_waiting(self):
        bot, api, _ = wire(intent="general", confirmation="other")
        out = await run(bot, authorization="Bearer T", pending_addresses=["0xAAA"])
        assert api.created == 0
        assert not out.get("pending_clear") and not out.get("pending_set")

    async def test_a_yes_without_a_token_writes_through_the_ownerless_door(self):
        # The rule this replaces was "a yes without a token cannot write", and
        # it was the sign-in wall the front door exists to remove. A visitor
        # confirms and gets a portfolio; what their missing token changes is
        # WHICH door, never whether the confirmed action happens.
        bot, api, _ = wire(confirmation="confirm")
        out = await run(bot, pending_addresses=["0xAAA", "sol1"])
        assert api.created == 0, "the owned door needs a token and was not used"
        assert api.created_anonymous == ["0xAAA"], "opened by its first address"
        assert out["pending_clear"] is True
        # Named for the route layer to remember on the conversation. Without it
        # the next question re-onboards a visitor who already has a portfolio,
        # because nobody can ask the host what a nameless caller owns.
        assert out["portfolio_created"] == "anon-pf"

    async def test_the_visitors_remaining_wallets_are_added_without_a_token(self):
        # The create spends the first address; the rest go through the host's
        # optional-auth add-wallet, and as nobody — borrowing a token here
        # would file a visitor's wallets under somebody else's account.
        bot, api, _ = wire(confirmation="confirm")
        await run(bot, pending_addresses=["0xAAA", "sol1", "btc1"])
        assert api.wallets == [("anon-pf", "sol1"), ("anon-pf", "btc1")]
        assert api.wallet_tokens == [None, None]

    async def test_a_signed_in_yes_still_takes_the_owned_door(self):
        # The other half of the same rule: a token means the portfolio lands
        # owned, and the ownerless door is not touched.
        bot, api, _ = wire(confirmation="confirm")
        await run(bot, authorization="Bearer T", pending_addresses=["0xAAA"])
        assert api.created == 1 and api.created_anonymous == []

    async def test_an_unreadable_confirmation_never_writes(self):
        class Broken:
            async def classify(self, _reply):
                raise RuntimeError("classifier down")

        api = Api()
        bot = agent(model=Model(), portfolio=api, intent="general", confirmations=Broken())
        out = await run(bot, authorization="Bearer T", pending_addresses=["0xAAA"])
        assert api.created == 0 and not out.get("pending_clear")


class TestTheContractWithTheLayerAbove:
    """What a use case sees: an answer and its orders, never a graph state.

    The tests above read the state the nodes wrote, because they are about
    the routing and this file is the implementation's own. These are about
    the seam — the only thing app/application is allowed to know.
    """

    async def test_a_turn_answers_in_the_ports_own_words(self):
        bot, _, _ = wire(intent="general")
        reply = await bot.run(Ask(question="what is a health factor?"))
        assert reply.answer == "answered"
        assert reply.pending_set is None
        assert reply.pending_clear is False and reply.portfolio_created is None

    async def test_a_proposal_comes_back_as_an_order_rather_than_a_write(self):
        model = Model(
            tool_calls=[{"name": "ProposePortfolio", "args": {"addresses": ["0xAAA"]}, "id": "c"}]
        )
        bot, api, _ = wire(api=Api(owned=[]), model=model)
        reply = await bot.run(Ask(question="track my wallet"))
        assert reply.pending_set == ("0xAAA",), "the order, not the write"
        assert api.created == 0 and api.created_anonymous == []

    async def test_the_link_is_in_the_answer_whatever_the_model_wrote(self):
        # Twice in production the model was handed the link and did not give
        # it: once as "svinooh.com/p/…", once not at all. For a portfolio
        # nobody owns it is the only way back, so it is appended rather than
        # asked for.
        bot, _, _ = wire(confirmation="confirm", model=Model(text="Done."))
        reply = await bot.run(Ask(question="yes", pending_addresses=("0xAAA",)))
        assert reply.answer.endswith("/p/anon-pf")
        assert reply.answer.startswith("Done.")

    async def test_and_only_once_when_the_model_wrote_it_too(self):
        # Told not to write the link itself, the model sometimes does. A reply
        # ending in the same link twice reads like a bug because it is one.
        bot, _, _ = wire(confirmation="confirm", model=Model(text="Done. /p/anon-pf"))
        reply = await bot.run(Ask(question="yes", pending_addresses=("0xAAA",)))
        assert reply.answer.count("/p/anon-pf") == 1

    async def test_and_nothing_is_appended_when_nothing_was_created(self):
        class Refusing(Api):
            async def create_anonymous_portfolio(self, address):
                raise RuntimeError("the host said no")

        bot, _, _ = wire(confirmation="confirm", api=Refusing(), model=Model(text="It failed."))
        reply = await bot.run(Ask(question="yes", pending_addresses=("0xAAA",)))
        assert "/p/" not in reply.answer and reply.portfolio_created is None

    async def test_a_confirmed_proposal_names_what_to_remember(self):
        bot, api, _ = wire(confirmation="confirm")
        reply = await bot.run(Ask(question="yes", pending_addresses=("0xAAA", "sol1")))
        assert api.created_anonymous == ["0xAAA"]
        assert reply.portfolio_created == "anon-pf" and reply.pending_clear is True

    async def test_the_conversation_is_replayed_as_the_exchange_it_was(self):
        # The store keeps turns; what a model call looks like is the agent's
        # business, and this is where the two meet.
        model = Model()
        bot, _, _ = wire(intent="general", model=model)
        await bot.run(Ask(question="and now?", history=(Turn(q="hello", a="hi", at=0),)))
        assert [m.content for m in model.seen[1:]] == ["hello", "hi", "and now?"]

    async def test_a_watched_turn_reports_in_the_same_words(self):
        bot, _, _ = wire(intent="general")
        updates = [update async for update in bot.watch(Ask(question="q"))]
        assert isinstance(updates[-1], Finished)
        assert updates[-1].reply.answer == "answered"
        assert all(isinstance(u, Progress) for u in updates[:-1])
        assert any(u.kind == "step" for u in updates[:-1]), "the work reported itself"

    async def test_a_turn_that_cannot_finish_says_so_in_the_same_words(self):
        class Refusing:
            def bind_tools(self, _tools):
                return self

            async def ainvoke(self, _messages):
                raise RuntimeError("upstream is on fire")

        bot, _, _ = wire(intent="general", model=Refusing())
        updates = [update async for update in bot.watch(Ask(question="q"))]
        assert isinstance(updates[-1], Failed)
        assert "could not be finished" in updates[-1].message
