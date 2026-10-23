import json

import httpx
import pytest
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage

from app.adapters.mcp import EARN_TOOLS, PORTFOLIO_TOOLS
from app.agent.graph import ANSWERING_NODES
from app.agent.llm import Models
from app.agent.prompts import DEFAULT_SYSTEM_PROMPT
from app.agent.tools import (
    asking_tools,
    deposit_tools,
    liquidity_tools,
    lpdown_tools,
    moving_tools,
    swap_tools,
)
from app.settings import Settings
from evals.calibrate import Label, agreement, kappa
from evals.calibrate import load as calibration_set
from evals.checks import judged, mentions
from evals.judges import CRITERIA, Judges, Shown, Verdict, data_of, presented, record_of
from evals.run import Case, Golden, gate, langfuse_for, load, mcp_serving, parse, wilson
from evals.world import WORLDS, World, every_world_served
from tests.support import Talking

TOOLS = (
    {
        tool.name
        for tool in [
            *deposit_tools(None, []),
            *moving_tools(None, (), []),
            *swap_tools(None, []),
            *liquidity_tools(None, (), [], True, None, ()),
            *lpdown_tools(None, [], (), None),
            *asking_tools([]),
        ]
    }
    | PORTFOLIO_TOOLS
    | EARN_TOOLS
)

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


class TestTheLanguageOfTheAnswer:
    def test_an_english_case_wants_english(self):
        ok, _ = judged({}, outcome(answer="Steakhouse pays 5.12%"))["english"]
        assert ok

    def test_a_case_in_another_language_wants_that_language(self):
        russian = {"language": "Russian"}
        assert judged(russian, outcome(answer="Steakhouse платит 5,12% годовых"))["english"][0]
        assert not judged(russian, outcome(answer="Steakhouse pays 5.12%"))["english"][0]


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
            ("Your total is 158 536,15 $.", "158536"),
            ("Your total is $158,536.15.", "158,536.15"),
            ("Your total is 158\u00a0536,15 $", "158536"),
        ],
    )
    def test_a_figure_is_found_however_it_is_written(self, said, needle):
        assert mentions(said, needle)

    def test_a_figure_inside_a_bigger_one_is_still_a_mention(self):
        assert mentions("Ethena holds $56,210.40", "56210")

    @pytest.mark.parametrize(
        ("said", "english"),
        [
            ("How much is my portfolio worth?", True),
            ("2500 USDC sit in Steakhouse USDC at 5.12%, 12 SOL in the wallet.", True),
            ("Итого лежит 158 536,15 $.", False),
        ],
    )
    def test_an_answer_has_to_be_in_english(self, said, english):
        assert judged({}, outcome(answer=said))["english"][0] is english

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
        assert not judged({}, outcome(answer="Done ✅"))["no_emoji"][0]

    def test_a_check_with_nothing_to_check_is_not_scored(self):
        assert set(judged({}, outcome(answer="ok"))) == {
            "answered",
            "writes",
            "no_emoji",
            "keeps_its_prompt",
            "english",
        }


class TestTheGoldenSet:
    def test_every_case_has_its_own_id(self):
        ids = [case.id for case in CASES]
        assert len(ids) == len(set(ids))

    @pytest.mark.parametrize("case", CASES, ids=lambda case: case.id)
    def test_a_case_can_run(self, case: Case):
        assert (WORLDS / f"{case.world}.json").exists()
        assert set(case.expect) <= EXPECTATIONS
        assert {"intent", "role", "source"} <= set(case.slice)
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
            "language": "English",
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
                AIMessage(content="Steakhouse USDC is the safest, at 5.12%."),
            ]
        )
        settings = Settings()
        panel = parse(json.loads((WORLDS.parent / "panel.json").read_text()))
        case = next(case for case in CASES if case.id == "earn-asking-usdc")
        with every_world_served() as worlds, mcp_serving(worlds) as mcp_url:
            golden = Golden(settings, panel, langfuse_for(), mcp_url=mcp_url)
            answered = await golden.answer(
                case, Models(settings, factory=lambda *_, **__: scripted)
            )
        assert answered["answered_by"] == "earn"
        assert [tool["name"] for tool in answered["tools"]] == ["earn_options"]
        assert all(ok for ok, _ in judged(case.expect, answered).values())


class TestTheJudges:
    def test_a_judge_sees_only_what_its_criterion_needs(self):
        shown = Shown(question="q", answer="a", data="THE DATA", record="- THE RECORD")
        assert "THE DATA" in presented("grounded", shown)
        assert "THE RECORD" not in presented("grounded", shown)
        assert "THE RECORD" in presented("honest_about_actions", shown)
        assert "THE DATA" not in presented("answers_the_question", shown)

    def test_the_data_leaves_the_rules_out_and_keeps_what_was_looked_up(self):
        shown = data_of(
            [
                SystemMessage(content=f"{DEFAULT_SYSTEM_PROMPT}\n\nPortfolio total $158,536.15"),
                HumanMessage(content="how much?"),
                ToolMessage(content="Change +7,565.15 USD", tool_call_id="t"),
            ]
        )
        assert "Every figure you state" not in shown
        assert "Portfolio total $158,536.15" in shown and "Change +7,565.15 USD" in shown

    def test_the_record_says_what_happened_and_nothing_else(self):
        nothing = outcome()
        assert "Nothing was prepared" in record_of(nothing, None)
        prepared = outcome(cards=[{"what": "deposit 1000 USDC into Steakhouse USDC"}])
        assert "not signed yet: deposit 1000 USDC into Steakhouse USDC" in record_of(prepared, None)
        landed = record_of(
            nothing,
            {
                "action": "deposit",
                "amount": "1000",
                "token": "USDC",
                "pool": "Steakhouse USDC",
                "status": "landed",
            },
        )
        assert "landed" in landed

    async def test_a_verdict_comes_back_typed(self):
        verdict = {"reasoning": "the total is in the data", "verdict": "pass"}
        model = Talking(
            replies=[
                AIMessage(content="", tool_calls=[{"name": "Verdict", "args": verdict, "id": "v"}])
            ]
        )
        decided = await Judges(model).judge("grounded", Shown("q", "a", "d", "r"))
        assert decided.verdict == "pass"


class TestTheCalibrationSet:
    def test_every_judge_has_failures_and_passes_to_be_measured_on(self):
        labelled = calibration_set()
        for name in CRITERIA:
            mine = [label.label for label in labelled if label.judge == name]
            assert mine.count("pass") >= 5 and mine.count("fail") >= 5

    def test_every_label_names_data_that_exists_and_a_judge_that_does(self):
        labelled = calibration_set()
        assert len({label.id for label in labelled}) == len(labelled)
        for label in labelled:
            assert label.judge in CRITERIA and label.label in ("pass", "fail")
            assert label.judge != "grounded" or label.shown.data
            assert label.judge != "honest_about_actions" or label.shown.record

    def test_agreement_is_counted_against_failures_and_passes_apart(self):
        labelled = [
            Label("a", "grounded", "fail", Shown("q", "a", "d", "")),
            Label("b", "grounded", "fail", Shown("q", "a", "d", "")),
            Label("c", "grounded", "pass", Shown("q", "a", "d", "")),
            Label("d", "grounded", "pass", Shown("q", "a", "d", "")),
        ]
        said = {
            "a": Verdict(reasoning="", verdict="fail"),
            "b": Verdict(reasoning="", verdict="pass"),
            "c": Verdict(reasoning="", verdict="pass"),
            "d": Verdict(reasoning="", verdict="unknown"),
        }
        seen = agreement(labelled, said, "grounded")
        assert (seen.caught, seen.missed, seen.cleared, seen.flagged, seen.unsure) == (
            1,
            1,
            1,
            1,
            1,
        )
        assert not seen.trusted
        assert kappa(labelled, said, "grounded") == pytest.approx(0.2)
