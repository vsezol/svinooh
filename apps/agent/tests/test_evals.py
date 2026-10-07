import json

import httpx
import pytest
from langchain_core.messages import AIMessage

from app.agent.graph import ANSWERING_NODES
from app.agent.llm import Models
from app.agent.tools import (
    asking_tools,
    deposit_tools,
    earn_tools,
    liquidity_tools,
    lpdown_tools,
    moving_tools,
    portfolio_tools,
    swap_tools,
)
from app.settings import Settings
from evals.checks import judged, language_of, mentions
from evals.run import Case, Golden, gate, langfuse_for, load, parse, wilson
from evals.world import WORLDS, World
from tests import fixtures as fx
from tests.support import Talking

TOOLS = {
    tool.name
    for tool in [
        *earn_tools(None),
        *deposit_tools(None, []),
        *moving_tools(None, (), []),
        *swap_tools(None, []),
        *liquidity_tools(None, (), [], True, None, ()),
        *lpdown_tools(None, [], (), None),
        *asking_tools([]),
        *portfolio_tools(None, "pf", None, fx.as_portfolio()),
    ]
}

EXPECTATIONS = {
    "answered_by",
    "tools",
    "cards",
    "asks",
    "proposes",
    "writes",
    "fetches_nothing",
    "says",
    "says_one_of",
    "never_says",
    "language",
}

CASES = load()


def outcome(**overrides) -> dict:
    return {
        "answer": "",
        "answered_by": "general",
        "tools": [],
        "cards": [],
        "choices": [],
        "proposes": [],
        "writes": [],
        "fetched": [],
        **overrides,
    }


class TestTheWorld:
    def test_the_answer_recorded_for_that_query_beats_the_general_one(self):
        world = World({"GET /pools": {"all": True}, "GET /pools?token=USDC": {"usdc": True}})
        asked = world.answer(httpx.Request("GET", "http://world/pools?token=USDC&limit=8"))
        assert asked.json() == {"usdc": True}
        assert world.answer(httpx.Request("GET", "http://world/pools?limit=8")).json() == {
            "all": True
        }

    def test_what_was_never_recorded_is_not_found_and_a_failure_fails(self):
        world = World({"GET /a": {}}, failures={"GET /b": 500})
        assert world.answer(httpx.Request("GET", "http://world/c")).status_code == 404
        assert world.answer(httpx.Request("GET", "http://world/b")).status_code == 500

    def test_every_write_is_kept_to_be_checked(self):
        world = World({"POST /api/portfolios": {"slug": "x"}})
        world.answer(httpx.Request("GET", "http://world/api/portfolios/x"))
        world.answer(httpx.Request("POST", "http://world/api/portfolios", json={}))
        assert world.writes == ["POST /api/portfolios"]


class TestTheChecks:
    @pytest.mark.parametrize(
        ("said", "needle"),
        [
            ("Итого лежит 158 536,15 $.", "158536"),
            ("Your total is $158,536.15.", "158,536.15"),
            ("Итого лежит 158\u00a0536,15 $", "158536"),
        ],
    )
    def test_a_figure_is_found_however_it_is_written(self, said, needle):
        assert mentions(said, needle)

    def test_a_figure_inside_a_bigger_one_is_still_a_mention(self):
        assert mentions("в Ethena лежит $56,210.40", "56210")

    @pytest.mark.parametrize(
        ("said", "language"),
        [
            ("Сколько денег лежит на кошельках?", "ru"),
            ("Скільки в мене зараз грошей на гаманцях?", "uk"),
            ("How much is my portfolio worth?", "en"),
            ("Лежит 2500 USDC в Steakhouse USDC и 12 SOL на кошельке.", "ru"),
        ],
    )
    def test_the_language_of_an_answer(self, said, language):
        assert language_of(said) == language

    def test_cards_match_whatever_order_they_came_in(self):
        prepared = [
            {"action": "withdraw", "pool": "B", "amount": "1000.000000", "everything": True},
            {"action": "deposit", "pool": "A", "amount": "1000"},
        ]
        wanted = {"cards": [{"action": "deposit", "pool": "A", "amount": "1000"}, {"pool": "B"}]}
        assert judged(wanted, outcome(answer="ok", cards=prepared))["cards"][0]

    def test_a_card_nobody_asked_for_fails(self):
        prepared = [{"action": "deposit", "pool": "A", "amount": "5"}]
        assert not judged({"cards": []}, outcome(answer="ok", cards=prepared))["cards"][0]

    def test_a_write_nobody_expected_fails_every_case(self):
        verdicts = judged({}, outcome(answer="ok", writes=["POST /api/portfolios"]))
        assert not verdicts["writes"][0]

    def test_an_emoji_fails(self):
        assert not judged({}, outcome(answer="Готово ✅"))["no_emoji"][0]

    def test_a_check_with_nothing_to_check_is_not_scored(self):
        assert set(judged({}, outcome(answer="ok"))) == {
            "answered",
            "writes",
            "no_emoji",
            "keeps_its_prompt",
        }


class TestTheGoldenSet:
    def test_every_case_has_its_own_id(self):
        ids = [case.id for case in CASES]
        assert len(ids) == len(set(ids))

    @pytest.mark.parametrize("case", CASES, ids=lambda case: case.id)
    def test_a_case_can_run(self, case: Case):
        assert (WORLDS / f"{case.world}.json").exists()
        assert set(case.expect) <= EXPECTATIONS
        assert {"intent", "language", "role", "source"} <= set(case.slice)
        assert case.slice["role"] in ("typical", "regression", "guardrail")
        wanted = case.expect.get("answered_by", [])
        assert set(wanted if isinstance(wanted, list) else [wanted]) <= set(ANSWERING_NODES)
        assert set(case.expect.get("tools", [])) <= TOOLS
        case.ask()

    @pytest.mark.parametrize("case", CASES, ids=lambda case: case.id)
    def test_every_pool_a_card_names_is_in_its_world(self, case: Case):
        recorded = (WORLDS / f"{case.world}.json").read_text()
        for card in case.expect.get("cards", []):
            for key in ("pool", "from_pool"):
                if key in card:
                    assert json.dumps(card[key]) in recorded


class TestTheGate:
    def rows(self, *passed: bool):
        from evals.run import Row

        return [
            Row("c", {"role": "typical"}, {"seconds": 1}, {"answered": (ok, "")}) for ok in passed
        ]

    def case(self, role: str = "typical") -> Case:
        return Case("c", "visitor", {"question": "q"}, {}, {"role": role})

    def test_a_case_that_passed_before_and_mostly_fails_now_is_a_regression(self):
        assert gate(self.rows(False, False, True), [self.case()], 3, {"c": True})
        assert not gate(self.rows(False, True, True), [self.case()], 3, {"c": True})

    def test_a_guardrail_has_to_hold_every_time(self):
        assert gate(self.rows(True, True, False), [self.case("guardrail")], 3, {})

    def test_a_run_that_never_finished_is_not_a_pass(self):
        from evals.run import Row

        missing = [Row("c", {}, {}, {})]
        assert gate(missing, [self.case()], 1, {})

    def test_the_interval_is_wide_on_a_small_set(self):
        low, high = wilson(30, 35)
        assert 0.70 < low < 0.72 and 0.93 < high < 0.95


class TestOneCaseOffline:
    async def test_a_turn_runs_in_its_world_and_is_measured(self):
        label = {
            "reason": "where to put USDC",
            "language": "Russian",
            "intent": "earn",
            "stance": "asking",
            "risk": "unknown",
            "lp_range": "unknown",
        }
        scripted = Talking(
            replies=[
                AIMessage(
                    content="", tool_calls=[{"name": "IntentLabel", "args": label, "id": "l"}]
                ),
                AIMessage(
                    content="",
                    tool_calls=[{"name": "earn_options", "args": {"token": "USDC"}, "id": "e"}],
                ),
                AIMessage(content="Надёжнее всего Steakhouse USDC, 5.12%."),
            ]
        )
        settings = Settings()
        panel = parse(json.loads((WORLDS.parent / "panel.json").read_text()))
        golden = Golden(settings, panel, langfuse_for(settings))
        case = next(case for case in CASES if case.id == "earn-asking-usdc-ru")
        answered = await golden.answer(case, Models(settings, factory=lambda *_, **__: scripted))
        assert answered["answered_by"] == "earn"
        assert [tool["name"] for tool in answered["tools"]] == ["earn_options"]
        assert "GET /v1/lend/pools" in answered["fetched"]
        assert all(ok for ok, _ in judged(case.expect, answered).values())
