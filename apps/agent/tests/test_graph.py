from dataclasses import replace
from decimal import Decimal

import pytest

from app.agent.context import without_what_the_chain_read
from app.agent.onboarding import create_portfolio_with_wallets
from app.domain.conversation import Turn
from app.domain.earn import Coin, Held, YieldPool
from app.domain.portfolio import Leg, Me, Portfolio, PortfolioRef, Position, Wallet
from app.ports import Ask, Failed, Finished, Progress
from tests import fixtures as fx
from tests.support import Catalog, Intents, agent


class Api:
    def __init__(self, *, owned=None, portfolio=None, refuse=False, me_fails=False):
        self.calls = []
        self.owned = owned if owned is not None else []
        self.portfolio_data = portfolio or fx.as_portfolio()
        self.refuse = refuse
        self.me_fails = me_fails
        self.created = 0
        self.wallets = []
        self.created_anonymous = []
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
    def __init__(self, tool_calls=None, text="answered"):
        self.prompts = []
        self.seen = []
        self.bound = 0
        self._tool_calls = tool_calls
        self.text = text
        self.tools_bound: list[str] = []

    def bind_tools(self, tools):
        self.bound += 1
        self.tools_bound = [getattr(t, "name", getattr(t, "__name__", str(t))) for t in tools]
        return self

    async def ainvoke(self, messages):
        self.prompts.append(messages[0].content)
        self.seen = messages
        calls, self._tool_calls = self._tool_calls, None

        class Reply:
            content = "" if calls else self.text
            tool_calls = calls or []

        return Reply()


def wire(
    *,
    intent="portfolio",
    confirmation=None,
    api=None,
    model=None,
    catalog=None,
    asked_to_place=False,
    language="English",
):
    api = api or Api()
    model = model or Model()
    intents = Intents(intent, asked_to_place=asked_to_place, language=language)
    bot = agent(
        model=model,
        portfolio=api,
        intents=intents,
        confirmation=confirmation,
        catalog=catalog,
    )
    bot.intents = intents
    return bot, api, model


async def run(bot, **state):
    return await bot.graph.ainvoke({"question": "q", "history": (), **state})


class TestRouting:
    async def test_the_answer_is_written_in_the_language_of_the_question(self):
        bot, _, model = wire(intent="general", language="Russian")
        await run(bot)
        said = model.prompts[0]
        assert "The user wrote to you in Russian" in said
        assert "not in a language next to it" in said

    async def test_a_turn_with_no_language_named_adds_no_instruction(self):
        bot, _, model = wire(intent="general", language="")
        await run(bot)
        assert "wrote to you in" not in model.prompts[0]

    async def test_the_question_is_labelled_with_the_conversation_it_is_in(self):
        bot, _, _ = wire(intent="earn")
        spoken = (Turn(q="put it to the highest rate", a="how much?", at=0),)
        await run(bot, history=spoken)
        assert bot.intents.heard == spoken, "a reply out of context is a different question"

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
            async def classify(self, _question, _history=()):
                raise RuntimeError("classifier down")

        bot = agent(model=Model(), portfolio=Api(), intents=Broken())
        out = await run(bot, portfolio="p", authorization="Bearer T")
        assert out["intent"] == "portfolio" and out["route"] == "grounded"


EARN_CALL = {"name": "earn_options", "args": {"token": "USDC"}, "id": "e1"}


class TestWhereToPutMoney:
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

    async def test_the_money_lying_around_is_what_a_deposit_comes_from(self):
        holding = fx.as_portfolio(
            fx.portfolio([fx.wallet(fx.SOL_ADDRESS, [fx.USDC_SOL], chain="SOL")])
        )
        bot, _, model = wire(
            intent="earn",
            catalog=Catalog(),
            api=Api(portfolio=holding),
            model=Model(tool_calls=[EARN_CALL]),
            asked_to_place=True,
        )
        await run(bot, portfolio="on-screen", authorization="Bearer T")
        asked = model.prompts[0]
        assert "USDC 12.0014" in asked, "the amount is in the prompt, so it is not a question"
        assert "never ask for a number that is already here" in asked
        assert "never say you cannot see it" in asked
        assert "Place what they named and nothing else" in asked
        assert "just moved money and the figure has not caught up" in asked

    async def test_a_portfolio_that_could_not_be_read_adds_nothing(self):
        bot, _, model = wire(
            intent="earn",
            catalog=Catalog(),
            api=Api(refuse=True),
            model=Model(tool_calls=[EARN_CALL]),
        )
        await run(bot, portfolio="on-screen", authorization="Bearer T")
        assert "money a deposit would come from" not in model.prompts[0]

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

    async def test_a_question_closes_with_an_offer_to_do_it(self):
        bot, _, model = wire(intent="earn", catalog=Catalog(), model=Model(tool_calls=[EARN_CALL]))
        await run(bot)
        asked = model.prompts[0]
        assert "asking what the options are, not asking you to act" in asked
        assert "never leaves it" in asked and "until they sign" in asked

    async def test_being_told_to_do_it_asks_for_what_is_missing_instead(self):
        bot, _, model = wire(
            intent="earn",
            catalog=Catalog(),
            model=Model(tool_calls=[EARN_CALL]),
            asked_to_place=True,
        )
        await run(bot)
        asked = model.prompts[0]
        assert "asking you to place the money" in asked
        assert "neither of these is optional" in asked
        assert "place nothing until each has an answer" in asked
        assert "name ONE pool" in asked
        assert "do not say anything has been done or sent" in asked
        assert "wallet address is not yours to ask for" in asked
        assert "asking what the options are" not in asked

    async def test_a_turn_that_spends_every_hop_says_so(self, caplog):
        import logging

        class Greedy(Model):
            async def ainvoke(self, messages):
                self._tool_calls = [EARN_CALL]
                return await super().ainvoke(messages)

        bot, _, _ = wire(intent="earn", catalog=Catalog(), model=Greedy())
        with caplog.at_level(logging.WARNING, logger="svinooh-ai"):
            await run(bot)
        assert "tool budget spent" in caplog.text, "a silent ceiling is a defect nobody can see"

    async def test_an_empty_answer_after_the_last_hop_is_asked_for_again_in_words(self):
        class Silent(Model):
            """Calls a tool every hop, says nothing when it cannot, and answers once told to."""

            with_tools = False

            def bind_tools(self, tools):
                self.with_tools = True
                return super().bind_tools(tools)

            async def ainvoke(self, messages):
                with_tools, self.with_tools = self.with_tools, False
                if "Write the answer now, in words" in str(messages[-1].content):
                    self._tool_calls, self.text = [], "Here is what came back."
                elif with_tools:
                    self._tool_calls, self.text = [EARN_CALL], ""
                else:
                    self._tool_calls, self.text = [], ""
                return await super().ainvoke(messages)

        bot, _, _ = wire(intent="earn", catalog=Catalog(), model=Silent())
        out = await run(bot)
        assert out["answer"] == "Here is what came back."

    async def test_a_question_comes_back_as_buttons(self):
        asking = {
            "name": "ask_the_user",
            "args": {
                "header": "Token",
                "question": "Which one do we place?",
                "options": ["USDC 12.00", "SOL 0.009"],
            },
            "id": "q1",
        }
        bot, _, _ = wire(
            intent="earn",
            catalog=Catalog(),
            model=Model(tool_calls=[asking]),
            asked_to_place=True,
        )
        out = await run(bot)
        assert [choice.header for choice in out["choices"]] == ["Token"]
        assert out["choices"][0].options == ("USDC 12.00", "SOL 0.009")

    async def test_a_turn_that_asks_does_not_also_place(self):
        both = [
            {
                "name": "ask_the_user",
                "args": {"header": "Risk", "question": "How much?", "options": ["Low", "High"]},
                "id": "q1",
            },
            {
                "name": "propose_deposit",
                "args": {"pool_id": "sol:kamino:vault:AAA", "amount": "250"},
                "id": "d1",
            },
        ]
        bot, _, _ = wire(
            intent="earn", catalog=Catalog(), model=Model(tool_calls=both), asked_to_place=True
        )
        out = await run(bot)
        assert out["choices"], "the question stands"
        assert out["deposits"] == (), "a deposit chosen on a guess is the guess we removed"

    async def test_the_tool_that_prepares_a_deposit_is_there_either_way(self):
        bot, _, model = wire(intent="earn", catalog=Catalog(), model=Model(tool_calls=[EARN_CALL]))
        await run(bot)
        assert model.tools_bound == [
            "calculate",
            "earn_options",
            "propose_deposit",
            "propose_withdraw",
            "propose_move",
            "propose_swap",
            "liquidity_pools",
            "propose_liquidity",
            "propose_close_liquidity",
            "propose_rebalance",
            "ask_the_user",
        ]
        assert "prepare nothing until they answer it" in model.prompts[0]

    async def test_being_told_to_place_it_puts_the_deposit_on_the_reply(self):
        deposit_call = {
            "name": "propose_deposit",
            "args": {"pool_id": "sol:kamino:vault:AAA", "amount": "250"},
            "id": "d1",
        }
        bot, _, model = wire(
            intent="earn",
            catalog=Catalog(),
            model=Model(tool_calls=[deposit_call]),
            asked_to_place=True,
        )
        out = await run(bot)
        assert "propose_deposit" in model.tools_bound
        (card,) = out["deposits"]
        assert card.amount == Decimal("250")
        assert card.pool.id == "sol:kamino:vault:AAA"

    async def test_nothing_is_on_the_reply_when_the_model_only_talked(self):
        bot, _, _ = wire(
            intent="earn",
            catalog=Catalog(),
            model=Model(tool_calls=[EARN_CALL]),
            asked_to_place=True,
        )
        assert (await run(bot))["deposits"] == ()

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
    async def test_a_visitor_is_proposed_to_rather_than_turned_away(self):
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
        model = Model(
            tool_calls=[{"name": "ProposePortfolio", "args": {"addresses": ["0xAAA"]}, "id": "c"}]
        )
        bot, _, _ = wire(api=Api(owned=[]), model=model)
        await run(bot, authorization="Bearer T")
        assert "public" not in model.prompts[-1]


class TestAYesWithNothingBehindIt:
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
    async def test_the_result_says_which_door_it_went_through(self):
        api = Api()
        owned = await create_portfolio_with_wallets(api, ["0xAAA"], "Bearer T")
        visitor = await create_portfolio_with_wallets(api, ["0xBBB"], None)
        assert owned.anonymous is False and owned.slug == "new-pf"
        assert visitor.anonymous is True and visitor.slug == "anon-pf"

    async def test_the_address_that_opened_it_counts_as_added(self):
        api = Api()
        result = await create_portfolio_with_wallets(api, ["0xAAA", "sol1"], None)
        assert result.added == ("0xAAA", "sol1")
        assert api.wallets == [("anon-pf", "sol1")], "only the rest are POSTed"

    async def test_an_empty_proposal_makes_nothing_rather_than_guessing(self):
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
        bot, api, _ = wire(confirmation="confirm")
        out = await run(bot, pending_addresses=["0xAAA", "sol1"])
        assert api.created == 0, "the owned door needs a token and was not used"
        assert api.created_anonymous == ["0xAAA"], "opened by its first address"
        assert out["pending_clear"] is True
        assert out["portfolio_created"] == "anon-pf"

    async def test_the_visitors_remaining_wallets_are_added_without_a_token(self):
        bot, api, _ = wire(confirmation="confirm")
        await run(bot, pending_addresses=["0xAAA", "sol1", "btc1"])
        assert api.wallets == [("anon-pf", "sol1"), ("anon-pf", "btc1")]
        assert api.wallet_tokens == [None, None]

    async def test_a_signed_in_yes_still_takes_the_owned_door(self):
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
        bot, _, _ = wire(confirmation="confirm", model=Model(text="Done."))
        reply = await bot.run(Ask(question="yes", pending_addresses=("0xAAA",)))
        assert reply.answer.endswith("/p/anon-pf")
        assert reply.answer.startswith("Done.")

    async def test_and_only_once_when_the_model_wrote_it_too(self):
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


PRIME = YieldPool(
    id="sol:kamino:vault:PRIME",
    name="USDC Prime",
    protocol="kamino",
    kind="vault",
    network="sol",
    token="USDC",
    apy_net=Decimal("0.042"),
    apy_base=Decimal("0.042"),
    apy_rewards=Decimal("0"),
    apy_incentives=Decimal("0"),
    tvl_usd=Decimal("90000000"),
    url="https://kamino.com/earn/lend/PRIME",
)

TURBO = YieldPool(
    id="sol:kamino:vault:TURBO",
    name="Elemental USDC Turbo",
    protocol="kamino",
    kind="vault",
    network="sol",
    token="USDC",
    apy_net=Decimal("0.1265"),
    apy_base=Decimal("0.08"),
    apy_rewards=Decimal("0"),
    apy_incentives=Decimal("0.0465"),
    tvl_usd=Decimal("5300000"),
    url="https://kamino.com/earn/lend/TURBO",
)

JITO = YieldPool(
    id="sol:kamino:vault:JITO",
    name="JitoSOL vault",
    protocol="kamino",
    kind="vault",
    network="sol",
    token="JitoSOL",
    apy_net=Decimal("0.07"),
    apy_base=Decimal("0.07"),
    apy_rewards=Decimal("0"),
    apy_incentives=Decimal("0"),
    tvl_usd=Decimal("50000000"),
    url="https://kamino.com/earn/lend/JITO",
)


def in_pools(*held: Held) -> Catalog:
    shelf = Catalog(PRIME, TURBO, JITO)
    shelf.held = held
    return shelf


def with_a_solana_wallet() -> "Api":
    return Api(
        portfolio=fx.as_portfolio(
            fx.portfolio([fx.wallet(fx.SOL_ADDRESS, [fx.USDC_SOL], chain="SOL")])
        )
    )


async def moving(shelf: Catalog, *calls: dict):
    bot, _, model = wire(
        intent="earn",
        catalog=shelf,
        api=with_a_solana_wallet(),
        model=Model(tool_calls=list(calls)),
        asked_to_place=True,
    )
    out = await run(bot, portfolio="on-screen", authorization="Bearer T")
    return out, model


TWELVE_IN_PRIME = Held(pool=PRIME, amount=Decimal("12.001555"))


class TestWhatIsInPools:
    async def test_every_solana_wallet_is_asked_what_it_has_in_pools(self):
        shelf = in_pools(TWELVE_IN_PRIME)
        await moving(shelf)
        assert shelf.owners == [fx.SOL_ADDRESS]

    async def test_it_is_on_a_line_of_its_own_with_the_id_to_take_it_by(self):
        _, model = await moving(in_pools(TWELVE_IN_PRIME))
        said = model.prompts[0]
        assert "12.001555 USDC in USDC Prime" in said
        assert "id sol:kamino:vault:PRIME" in said
        assert "one transaction" in said and "never tell them to withdraw first" in said

    async def test_nothing_in_pools_adds_no_such_block(self):
        _, model = await moving(in_pools())
        assert "What they have in pools" not in model.prompts[0]


class TestTakingMoneyOut:
    async def test_all_of_it_is_a_withdrawal_card_asking_for_all(self):
        out, _ = await moving(
            in_pools(TWELVE_IN_PRIME),
            {
                "name": "propose_withdraw",
                "args": {"pool_id": PRIME.id, "amount": "all"},
                "id": "w1",
            },
        )
        (card,) = out["deposits"]
        assert card.action == "withdraw" and card.pool.name == "USDC Prime"
        assert card.everything and card.amount == Decimal("12.001555")

    async def test_a_pool_they_are_not_in_prepares_nothing(self):
        out, model = await moving(
            in_pools(TWELVE_IN_PRIME),
            {"name": "propose_withdraw", "args": {"pool_id": TURBO.id}, "id": "w1"},
        )
        assert out["deposits"] == ()
        assert "nothing in a pool with the id" in str(model.seen[-1].content)

    async def test_more_than_is_there_says_what_is(self):
        out, model = await moving(
            in_pools(TWELVE_IN_PRIME),
            {"name": "propose_withdraw", "args": {"pool_id": PRIME.id, "amount": "50"}, "id": "w1"},
        )
        assert out["deposits"] == ()
        assert "12.001555 USDC in USDC Prime" in str(model.seen[-1].content)


class TestMovingMoney:
    async def test_a_move_is_one_card_naming_both_pools(self):
        out, _ = await moving(
            in_pools(TWELVE_IN_PRIME),
            {
                "name": "propose_move",
                "args": {"from_pool_id": PRIME.id, "to_pool_id": TURBO.id},
                "id": "m1",
            },
        )
        (card,) = out["deposits"]
        assert card.action == "move"
        assert (card.source.name, card.pool.name) == ("USDC Prime", "Elemental USDC Turbo")
        assert card.everything

    async def test_across_tokens_it_is_a_move_that_swaps_on_the_way(self):
        out, model = await moving(
            in_pools(TWELVE_IN_PRIME),
            {
                "name": "propose_move",
                "args": {"from_pool_id": PRIME.id, "to_pool_id": JITO.id},
                "id": "m1",
            },
        )
        (card,) = out["deposits"]
        assert (card.source.token, card.pool.token) == ("USDC", "JitoSOL")
        said = str(model.seen[-1].content)
        assert "swapped from USDC to JitoSOL" in said and "sign more than once" in said
        assert "12.001555 USDC out of USDC Prime" in said, "the amount is in the token it leaves"

    async def test_into_a_pair_pool_it_says_to_place_it_from_the_pool_instead(self):
        out, model = await moving(
            in_pools(TWELVE_IN_PRIME),
            {
                "name": "propose_move",
                "args": {
                    "from_pool_id": PRIME.id,
                    "to_pool_id": "sol:meteora:dlmm:BVRbyLjjfSBcoyiYFuxbgKYnWuiFaF9CSXEa5vdSZ9Hh",
                },
                "id": "m1",
            },
        )
        assert out["deposits"] == ()
        said = str(model.seen[-1].content)
        assert "a pool for liquidity, not for lending" in said
        assert f"from_pool_id {PRIME.id}" in said

    async def test_into_the_pool_it_is_already_in_prepares_nothing(self):
        out, _ = await moving(
            in_pools(TWELVE_IN_PRIME),
            {
                "name": "propose_move",
                "args": {"from_pool_id": PRIME.id, "to_pool_id": PRIME.id},
                "id": "m1",
            },
        )
        assert out["deposits"] == ()


class Script:
    """A model that says each reply in turn, and records how many it was asked for."""

    def __init__(self, *replies: tuple[str, list]):
        self.replies = list(replies)
        self.asked = 0
        self.prompts: list[str] = []

    def bind_tools(self, _tools):
        return self

    async def ainvoke(self, messages):
        self.prompts.append(messages[0].content)
        text, calls = self.replies[min(self.asked, len(self.replies) - 1)]
        self.asked += 1

        class Reply:
            content = text
            tool_calls = calls

        return Reply()


ASK_RISK = {
    "name": "ask_the_user",
    "args": {"header": "Risk", "question": "How much risk?", "options": ["Low", "High"]},
    "id": "q1",
}

MOVE_ON_A_GUESS = {
    "name": "propose_move",
    "args": {"from_pool_id": PRIME.id, "to_pool_id": TURBO.id},
    "id": "m1",
}


class TestAQuestionOnScreenEndsTheTurn:
    async def test_the_model_is_not_asked_again_once_it_has_asked(self):
        model = Script(("Pick one.", [ASK_RISK]), ("", [ASK_RISK]), ("", [MOVE_ON_A_GUESS]))
        bot, _, _ = wire(
            intent="earn",
            catalog=in_pools(TWELVE_IN_PRIME),
            api=with_a_solana_wallet(),
            model=model,
            asked_to_place=True,
        )
        out = await run(bot, portfolio="on-screen", authorization="Bearer T")
        assert model.asked == 1, "a second hop is where the same question got asked twice"
        assert len(out["choices"]) == 1
        assert out["deposits"] == (), "nothing is prepared on a guess at what was just asked"
        assert out["answer"] == "Pick one."

    async def test_a_question_with_no_words_above_it_is_still_an_answer(self):
        model = Script(("", [ASK_RISK]))
        bot, _, _ = wire(
            intent="earn",
            catalog=in_pools(TWELVE_IN_PRIME),
            api=with_a_solana_wallet(),
            model=model,
            asked_to_place=True,
        )
        out = await run(bot, portfolio="on-screen", authorization="Bearer T")
        assert out["answer"] == "" and out["choices"]

    async def test_a_turn_with_no_question_keeps_using_its_tools(self):
        model = Script(("", [EARN_CALL]), ("Here is the best.", []))
        bot, _, _ = wire(intent="earn", catalog=Catalog(), model=model)
        out = await run(bot)
        assert model.asked == 2 and out["answer"] == "Here is the best."


class TestOneSumOfMoneyIsCountedOnce:
    """The scanner and the chain, reporting the same vault shares, are one position."""

    FARMING_THE_SAME_SHARES = Position(
        symbol="Kamino",
        name="Farming",
        value_usd=12.0,
        platform="kamino",
        category="staked",
        apy=0.081,
        legs=(Leg(symbol="kV-gtUSDCp", role="supply", value_usd=11.998, amount=11.59424),),
    )

    def read(self, *positions: Position) -> tuple[Position, ...]:
        wallet = Wallet(address="A", chain="SOL", status="ok", positions=positions)
        held = Held(pool=PRIME, amount=Decimal("12.001555"), shares=Decimal("11.59424"))
        kept = without_what_the_chain_read(
            Portfolio(slug="p", total_usd=0.0, wallets=(wallet,)), {"A": (held,)}
        )
        return kept.wallets[0].positions

    def test_the_scanners_view_of_the_same_shares_is_not_offered_again(self):
        assert self.read(self.FARMING_THE_SAME_SHARES) == ()

    def test_a_position_with_no_legs_on_the_protocol_that_was_read_is_the_same_money(self):
        bare = Position(symbol="Kamino", value_usd=12.0, platform="kamino", category="staked")
        assert self.read(bare) == ()

    def test_other_shares_on_the_same_protocol_are_another_position(self):
        other = replace(
            self.FARMING_THE_SAME_SHARES,
            legs=(Leg(symbol="kV-JITO", role="supply", value_usd=500.0, amount=4.2),),
        )
        assert self.read(other) == (other,)

    def test_a_loan_on_the_same_protocol_stays(self):
        loan = Position(
            symbol="Kamino",
            value_usd=500.0,
            platform="kamino",
            category="lending",
            legs=(
                Leg(symbol="USDC", role="supply", value_usd=900.0, amount=900.0, apy=0.05),
                Leg(symbol="SOL", role="borrow", value_usd=-400.0, amount=3.0),
            ),
        )
        assert self.read(loan) == (loan,)

    def test_another_protocol_is_untouched(self):
        orca = replace(self.FARMING_THE_SAME_SHARES, platform="orca")
        assert self.read(orca) == (orca,)


class TestEveryCardItPrepared:
    async def test_a_move_and_a_deposit_in_one_turn_are_two_cards(self):
        both = [
            MOVE_ON_A_GUESS,
            {"name": "propose_deposit", "args": {"pool_id": TURBO.id, "amount": "1"}, "id": "d1"},
        ]
        bot, _, _ = wire(
            intent="earn",
            catalog=in_pools(TWELVE_IN_PRIME),
            api=with_a_solana_wallet(),
            model=Model(tool_calls=both),
            asked_to_place=True,
        )
        out = await run(bot, portfolio="on-screen", authorization="Bearer T")
        assert [card.action for card in out["deposits"]] == ["move", "deposit"], (
            "a turn that said it prepared two things and showed one lost a button"
        )

    def test_the_same_thing_prepared_twice_is_one_card(self):
        from app.agent.graph import each_once
        from app.domain.earn import Deposit, DepositTerms

        terms = DepositTerms(program_id="p", address="a", token_mint="m")
        first = Deposit(pool=TURBO, amount=Decimal("1"), terms=terms)
        again = Deposit(pool=TURBO, amount=Decimal("2"), terms=terms)
        assert each_once([first, again]) == (again,)


class TestNoPoolBeforeTheRiskIsKnown:
    """He asked for the risk to be a question every time, never a guess."""

    async def unknown(self, *calls: dict):
        bot, _, model = wire(
            intent="earn",
            catalog=in_pools(TWELVE_IN_PRIME),
            api=with_a_solana_wallet(),
            model=Model(tool_calls=list(calls)),
            asked_to_place=True,
        )
        bot.intents.risk = "unknown"
        out = await run(bot, portfolio="on-screen", authorization="Bearer T")
        return out, model

    async def test_a_move_waits_for_the_risk(self):
        out, model = await self.unknown(MOVE_ON_A_GUESS)
        assert out["deposits"] == ()
        assert "Nobody has said how much risk they want" in str(model.seen[-1].content)

    async def test_a_deposit_waits_for_the_risk(self):
        out, _ = await self.unknown(
            {"name": "propose_deposit", "args": {"pool_id": TURBO.id, "amount": "5"}, "id": "d1"}
        )
        assert out["deposits"] == ()

    async def test_taking_money_out_needs_no_risk(self):
        out, _ = await self.unknown(
            {"name": "propose_withdraw", "args": {"pool_id": PRIME.id}, "id": "w1"}
        )
        assert [card.action for card in out["deposits"]] == ["withdraw"]

    def test_a_better_rate_is_not_a_risk(self):
        from app.agent.intent import IntentLabel

        told = IntentLabel.model_json_schema()["properties"]["risk"]["description"]
        assert "'повыгоднее'" in told and "`unknown`" in told


class TestASwapIsATrade:
    async def test_the_prompt_says_a_move_into_another_token_changes_what_they_hold(self):
        _, model = await moving(in_pools(TWELVE_IN_PRIME))
        said = model.prompts[0]
        assert (
            "Any swap is also a trade" in said
            and "rises and falls with the other token's price" in said
        )


SOL_COIN = Coin(symbol="SOL", mint="So11111111111111111111111111111111111111112", decimals=9)
USDC_COIN = Coin(symbol="USDC", mint="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals=6)


def with_coins(shelf: Catalog, *coins: Coin) -> Catalog:
    shelf.coins = {coin.symbol.upper(): coin for coin in coins}
    return shelf


class TestPayingWithAnotherCoin:
    async def test_a_coin_they_named_is_spent_and_swapped_into_the_pools_token(self):
        shelf = with_coins(in_pools(), SOL_COIN)
        out, model = await moving(
            shelf,
            {
                "name": "propose_deposit",
                "args": {"pool_id": TURBO.id, "amount": "0.5", "token": "SOL"},
                "id": "d1",
            },
        )
        (card,) = out["deposits"]
        assert card.pay_with == SOL_COIN and card.amount == Decimal("0.5")
        said = str(model.seen[-1].content)
        assert "0.5 SOL into Elemental USDC Turbo" in said and "a trade" in said
        assert shelf.coins_asked == [("SOL", (fx.SOL_ADDRESS,))], "their own wallets first"

    async def test_the_pools_own_token_is_no_swap_and_nobody_is_asked(self):
        shelf = with_coins(in_pools(), USDC_COIN)
        out, _ = await moving(
            shelf,
            {
                "name": "propose_deposit",
                "args": {"pool_id": TURBO.id, "amount": "5", "token": "usdc"},
                "id": "d1",
            },
        )
        (card,) = out["deposits"]
        assert card.pay_with is None
        assert shelf.coins_asked == []

    async def test_a_coin_nobody_trades_prepares_nothing_and_says_so(self):
        out, model = await moving(
            in_pools(),
            {
                "name": "propose_deposit",
                "args": {"pool_id": TURBO.id, "amount": "5", "token": "NOPE"},
                "id": "d1",
            },
        )
        assert out["deposits"] == ()
        assert "No coin called NOPE" in str(model.seen[-1].content)

    async def test_the_minimum_is_the_pools_to_judge_after_the_swap(self):
        shelf = with_coins(in_pools(), SOL_COIN)
        out, _ = await moving(
            shelf,
            {
                "name": "propose_deposit",
                "args": {"pool_id": TURBO.id, "amount": "0.001", "token": "SOL"},
                "id": "d1",
            },
        )
        (card,) = out["deposits"]
        assert card.pay_with == SOL_COIN, "a figure of SOL is not a figure of the pool's token"


class TestTakingItOutAsAnotherCoin:
    async def test_the_withdrawal_ends_as_the_coin_they_asked_for(self):
        shelf = with_coins(in_pools(TWELVE_IN_PRIME), SOL_COIN)
        out, model = await moving(
            shelf,
            {
                "name": "propose_withdraw",
                "args": {"pool_id": PRIME.id, "amount": "all", "token": "SOL"},
                "id": "w1",
            },
        )
        (card,) = out["deposits"]
        assert card.action == "withdraw" and card.receive_as == SOL_COIN and card.everything
        said = str(model.seen[-1].content)
        assert "out of USDC Prime, back to their wallet, as SOL" in said and "a trade" in said

    async def test_the_pools_own_token_is_a_plain_withdrawal(self):
        shelf = with_coins(in_pools(TWELVE_IN_PRIME), USDC_COIN)
        out, _ = await moving(
            shelf,
            {
                "name": "propose_withdraw",
                "args": {"pool_id": PRIME.id, "token": "USDC"},
                "id": "w1",
            },
        )
        (card,) = out["deposits"]
        assert card.receive_as is None

    async def test_the_prompt_says_money_can_come_back_as_another_coin(self):
        _, model = await moving(in_pools(TWELVE_IN_PRIME))
        assert "asked for it back as another coin" in model.prompts[0]


class TestAMoveGoesIntoAVault:
    async def test_a_reserve_is_not_offered_as_where_a_move_goes(self):
        reserve = replace(TURBO, id="sol:kamino:reserve:RES", name="SOL/BTC Market", kind="reserve")
        shelf = Catalog(PRIME, reserve)
        shelf.held = (TWELVE_IN_PRIME,)
        out, model = await moving(
            shelf,
            {
                "name": "propose_move",
                "args": {"from_pool_id": PRIME.id, "to_pool_id": reserve.id},
                "id": "m1",
            },
        )
        assert out["deposits"] == ()
        assert "a move goes into a vault" in str(model.seen[-1].content)
