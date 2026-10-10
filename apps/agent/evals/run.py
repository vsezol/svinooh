import argparse
import json
import math
import os
import statistics
import subprocess
import sys
import time
from collections.abc import Sequence
from dataclasses import dataclass, replace
from decimal import Decimal
from pathlib import Path
from typing import Any

import yaml
from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.outputs import LLMResult
from langfuse import Evaluation, Langfuse
from langfuse.api import DatasetStatus
from langfuse.experiment import ExperimentItemResult, LocalExperimentItem
from langfuse.langchain import CallbackHandler

from app.adapters.earn import EarnApiSource
from app.adapters.memory import StaticPanel
from app.adapters.panel import parse
from app.adapters.portfolio import PortfolioApiSource
from app.agent.graph import LangGraphAgent, answered_by, state_of
from app.agent.intent import IntentClassifier
from app.agent.llm import Models
from app.agent.onboarding import ConfirmationClassifier
from app.config import Config
from app.domain.conversation import Turn
from app.domain.earn import Card, Placement, Settled, Swap
from app.panel import PanelValues
from app.ports import Ask
from app.settings import Settings

from .checks import judged
from .world import ADDRESS, World

HERE = Path(__file__).parent

DATASET = "agent-golden"

BASELINE = HERE / "baseline.json"

SIGNED_IN = "Bearer eval"


@dataclass(frozen=True)
class Case:
    id: str
    world: str
    turn: dict[str, Any]
    expect: dict[str, Any]
    slice: dict[str, str]

    def ask(self) -> Ask:
        turn = self.turn
        return Ask(
            question=turn.get("question", ""),
            history=tuple(Turn.from_dict(said) for said in turn.get("history", [])),
            portfolio=turn.get("portfolio"),
            authorization=SIGNED_IN if turn.get("signed_in") else None,
            pending_addresses=tuple(turn["pending"]) if turn.get("pending") else None,
            settled=Settled(**turn["settled"]) if turn.get("settled") else None,
            session_id=self.id,
        )

    def item(self) -> LocalExperimentItem:
        return LocalExperimentItem(
            input={**self.turn, "world": self.world},
            expected_output=self.expect,
            metadata={**self.slice, "case": self.id},
        )


@dataclass(frozen=True)
class Row:
    case: str
    slice: dict[str, str]
    output: dict[str, Any]
    verdicts: dict[str, tuple[bool, str]]

    @property
    def passed(self) -> bool:
        return bool(self.verdicts) and all(ok for ok, _ in self.verdicts.values())


class Seen(BaseCallbackHandler):
    run_inline = True

    def __init__(self) -> None:
        self.tools: list[dict[str, Any]] = []
        self.model_calls = 0
        self.tokens_in = 0
        self.tokens_out = 0
        self.cost = Decimal(0)

    def on_tool_start(
        self, serialized: dict[str, Any], input_str: str, *, inputs: Any = None, **_: Any
    ) -> None:
        self.tools.append({"name": (serialized or {}).get("name", ""), "args": inputs or input_str})

    def on_llm_end(self, response: LLMResult, **_: Any) -> None:
        self.model_calls += 1
        usage = (response.llm_output or {}).get("token_usage") or {}
        self.tokens_in += int(usage.get("prompt_tokens") or 0)
        self.tokens_out += int(usage.get("completion_tokens") or 0)
        self.cost += Decimal(str(usage.get("cost") or 0))


class Golden:
    def __init__(self, settings: Settings, panel: PanelValues, langfuse: Langfuse) -> None:
        self._settings = settings
        self._panel = panel
        self._langfuse = langfuse
        self._traced = bool(os.getenv("LANGFUSE_PUBLIC_KEY"))

    def run(self, cases: Sequence[Case], name: str, concurrency: int) -> list[Row]:
        by_id = {case.id: case for case in cases}
        models = Models(self._settings)

        async def task(*, item: Any, **_: Any) -> dict[str, Any]:
            return await self.answer(by_id[case_id(item)], models)

        experiment: dict[str, Any] = {
            "name": DATASET,
            "run_name": name,
            "task": task,
            "evaluators": [checked],
            "run_evaluators": [aggregated],
            "max_concurrency": concurrency,
            "metadata": self.described(),
        }
        if self._traced:
            dataset = self._langfuse.get_dataset(DATASET)
            dataset.items = [item for item in dataset.items if item.id in by_id]
            result = dataset.run_experiment(**experiment)
        else:
            data = [case.item() for case in cases]
            result = self._langfuse.run_experiment(data=data, **experiment)
        rows = [row_of(item, by_id) for item in result.item_results]
        finished = {row.case for row in rows}
        missing = [Row(case.id, case.slice, {}, {}) for case in cases if case.id not in finished]
        return rows + missing

    async def answer(self, case: Case, models: Models) -> dict[str, Any]:
        world = World.named(case.world)
        seen = Seen()
        callbacks: list[BaseCallbackHandler] = [seen]
        if self._traced:
            callbacks.append(CallbackHandler())
        async with world.client() as http:
            config = Config(self._settings, StaticPanel(self._panel))
            agent = LangGraphAgent(
                config,
                PortfolioApiSource(ADDRESS, http),
                EarnApiSource(ADDRESS, http),
                models,
                IntentClassifier(models, config),
                ConfirmationClassifier(models, config),
            )
            started = time.perf_counter()
            state = await agent.graph.ainvoke(state_of(case.ask()), config={"callbacks": callbacks})
            seconds = time.perf_counter() - started
        return outcome(state, seen, world, seconds)

    def sync(self, cases: Sequence[Case]) -> None:
        if not self._traced:
            return
        self._langfuse.create_dataset(
            name=DATASET,
            description="Turns the agent must keep getting right, each in a recorded world.",
        )
        for case in cases:
            item = case.item()
            self._langfuse.create_dataset_item(
                dataset_name=DATASET,
                id=case.id,
                input=item["input"],
                expected_output=item["expected_output"],
                metadata=item["metadata"],
            )
        kept = {case.id for case in cases}
        for stale in self._langfuse.get_dataset(DATASET).items:
            if stale.id not in kept:
                self._langfuse.create_dataset_item(
                    dataset_name=DATASET, id=stale.id, status=DatasetStatus.ARCHIVED
                )

    def described(self) -> dict[str, str]:
        answering = Config(self._settings, StaticPanel(self._panel)).answering()
        return {
            "model": answering.model,
            "reasoning_effort": answering.reasoning_effort or "none",
            "commit": commit(),
        }


def main(argv: Sequence[str] | None = None) -> int:
    args = arguments(argv)
    settings = Settings()
    panel = parse(json.loads((HERE / "panel.json").read_text()))
    if args.model:
        panel = replace(panel, model=args.model)
    everything = load()
    cases = [case for case in everything if not args.only or case.id in args.only]
    golden = Golden(settings, panel, langfuse_for())
    golden.sync(everything)
    started = time.strftime("%Y-%m-%d %H:%M")
    rows: list[Row] = []
    for repetition in range(1, args.repeat + 1):
        named = f"{args.name} {started} #{repetition}".strip()
        rows += golden.run(cases, named, args.concurrency)
    report = scorecard(rows, cases, args.repeat, golden.described())
    sys.stdout.write(report + "\n")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as written:
            written.write(report + "\n")
    if args.approve:
        approve(rows, cases)
    problems = gate(rows, cases, args.repeat, baseline()) if args.gate else []
    for problem in problems:
        sys.stderr.write(f"GATE: {problem}\n")
    return 1 if problems else 0


def load() -> list[Case]:
    raw = yaml.safe_load((HERE / "golden.yaml").read_text())
    return [
        Case(
            id=case["id"],
            world=case["world"],
            turn=case["turn"],
            expect=case.get("expect", {}),
            slice=case.get("slice", {}),
        )
        for case in raw
    ]


def outcome(state: dict[str, Any], seen: Seen, world: World, seconds: float) -> dict[str, Any]:
    return {
        "answer": str(state.get("answer", "")),
        "answered_by": answered_by(state),
        "intent": state.get("intent", ""),
        "tools": seen.tools,
        "cards": [card_facts(card) for card in state.get("deposits") or ()],
        "choices": [
            {"header": choice.header, "question": choice.question, "options": list(choice.options)}
            for choice in state.get("choices") or ()
        ],
        "proposes": list(state.get("pending_set") or []),
        "writes": world.writes,
        "fetched": world.asked,
        "seconds": round(seconds, 2),
        "model_calls": seen.model_calls,
        "tokens_in": seen.tokens_in,
        "tokens_out": seen.tokens_out,
        "cost_usd": float(seen.cost),
    }


def card_facts(card: Card) -> dict[str, Any]:
    if isinstance(card, Swap):
        return {
            "action": card.action,
            "pay_with": card.pay_with.mint,
            "receive_as": card.receive_as.mint,
            "amount": str(card.amount),
            "everything": card.everything,
        }
    facts: dict[str, Any] = {
        "action": card.action,
        "pool": card.pool.id,
        "amount": None if card.amount is None else str(card.amount),
        "everything": card.everything,
        "from_pool": card.source.id if card.source else None,
    }
    if isinstance(card, Placement):
        facts["below_pct"] = None if card.below_pct is None else str(card.below_pct)
        facts["above_pct"] = None if card.above_pct is None else str(card.above_pct)
        facts["position"] = card.position.address if card.position else None
    else:
        facts["pay_with"] = card.pay_with.mint if card.pay_with else None
        facts["receive_as"] = card.receive_as.mint if card.receive_as else None
    return facts


def checked(*, output: dict[str, Any], expected_output: Any, **_: Any) -> list[Evaluation]:
    verdicts = judged(expected_output or {}, output)
    return [
        *(
            Evaluation(name=name, value=1.0 if ok else 0.0, comment=why, data_type="BOOLEAN")
            for name, (ok, why) in verdicts.items()
        ),
        Evaluation(
            name="passed",
            value=1.0 if all(ok for ok, _ in verdicts.values()) else 0.0,
            data_type="BOOLEAN",
        ),
    ]


def aggregated(*, item_results: list[ExperimentItemResult], **_: Any) -> list[Evaluation]:
    passed = [
        float(evaluation.value or 0)
        for result in item_results
        for evaluation in result.evaluations
        if evaluation.name == "passed"
    ]
    outputs = [result.output for result in item_results if isinstance(result.output, dict)]
    seconds = [output["seconds"] for output in outputs]
    if not passed:
        return []
    low, high = wilson(int(sum(passed)), len(passed))
    return [
        Evaluation(
            name="pass_rate",
            value=sum(passed) / len(passed),
            comment=f"{int(sum(passed))}/{len(passed)}, 95% interval {low:.0%}-{high:.0%}",
        ),
        Evaluation(name="p95_seconds", value=percentile(seconds, 95)),
        Evaluation(
            name="cost_per_turn_usd", value=statistics.fmean(o["cost_usd"] for o in outputs)
        ),
    ]


def case_id(item: Any) -> str:
    return item["metadata"]["case"] if isinstance(item, dict) else item.id


def row_of(result: ExperimentItemResult, cases: dict[str, Case]) -> Row:
    case = cases[case_id(result.item)]
    output = result.output if isinstance(result.output, dict) else {}
    return Row(case.id, case.slice, output, judged(case.expect, output) if output else {})


def wilson(passed: int, total: int, z: float = 1.96) -> tuple[float, float]:
    if total == 0:
        return 0.0, 0.0
    rate = passed / total
    middle = rate + z * z / (2 * total)
    spread = z * math.sqrt(rate * (1 - rate) / total + z * z / (4 * total * total))
    scale = 1 + z * z / total
    return max(0.0, (middle - spread) / scale), min(1.0, (middle + spread) / scale)


def percentile(values: Sequence[float], at: int) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, math.ceil(at / 100 * len(ordered)) - 1)]


def scorecard(rows: list[Row], cases: list[Case], repeat: int, described: dict[str, str]) -> str:
    finished = [row for row in rows if row.output]
    passed = sum(row.passed for row in rows)
    low, high = wilson(passed, len(rows))
    lines = [
        f"## Golden set: {passed}/{len(rows)} turns passed",
        "",
        f"{described['model']}, reasoning {described['reasoning_effort']}, "
        f"commit {described['commit']}: {len(cases)} cases x {repeat}. "
        f"95% interval {low:.0%}-{high:.0%}.",
        "",
        "| check | passed |",
        "| --- | --- |",
    ]
    checks = sorted({name for row in finished for name in row.verdicts})
    for name in checks:
        scored = [row.verdicts[name][0] for row in finished if name in row.verdicts]
        lines.append(f"| {name} | {sum(scored)}/{len(scored)} |")
    lines += ["", "| slice | passed |", "| --- | --- |"]
    for key in ("intent", "role"):
        for value in sorted({row.slice.get(key, "") for row in rows}):
            share = [row.passed for row in rows if row.slice.get(key, "") == value]
            lines.append(f"| {key} = {value} | {sum(share)}/{len(share)} |")
    seconds = [row.output["seconds"] for row in finished]
    if finished:
        lines += [
            "",
            f"Latency p50 {statistics.median(seconds):.1f}s, p95 {percentile(seconds, 95):.1f}s. "
            f"Per turn: {statistics.fmean(r.output['model_calls'] for r in finished):.1f} model "
            f"calls, {statistics.fmean(r.output['tokens_in'] for r in finished):,.0f} tokens in, "
            f"{statistics.fmean(r.output['tokens_out'] for r in finished):,.0f} out, "
            f"${statistics.fmean(r.output['cost_usd'] for r in finished):.5f}.",
        ]
    failed = [row for row in rows if not row.passed]
    if failed:
        lines += ["", "### Failed", ""]
        for row in failed:
            why = "; ".join(
                f"{name}: {reason}" for name, (ok, reason) in row.verdicts.items() if not ok
            )
            lines.append(f"- `{row.case}`: {why or 'never finished'}")
    return "\n".join(lines)


def gate(rows: list[Row], cases: list[Case], repeat: int, approved: dict[str, bool]) -> list[str]:
    problems = []
    for case in cases:
        runs = [row for row in rows if row.case == case.id]
        done = [row for row in runs if row.output]
        if len(done) < repeat:
            problems.append(f"{case.id}: {repeat - len(done)} of {repeat} runs never finished")
        if case.slice.get("role") == "guardrail" and not all(row.passed for row in runs):
            problems.append(f"{case.id}: a guardrail failed in {sum(not r.passed for r in runs)}")
        mostly_failing = sum(row.passed for row in runs) * 2 < len(runs)
        if approved.get(case.id) and mostly_failing:
            problems.append(f"{case.id}: passes in the approved baseline, fails now")
    return problems


def approve(rows: list[Row], cases: list[Case]) -> None:
    verdicts = {}
    for case in cases:
        runs = [row.passed for row in rows if row.case == case.id]
        verdicts[case.id] = bool(runs) and sum(runs) * 2 > len(runs)
    BASELINE.write_text(json.dumps({"cases": verdicts}, indent=2) + "\n")


def baseline() -> dict[str, bool]:
    if not BASELINE.exists():
        return {}
    return json.loads(BASELINE.read_text())["cases"]


def langfuse_for() -> Langfuse:
    if os.getenv("LANGFUSE_PUBLIC_KEY"):
        return Langfuse()
    return Langfuse(public_key="none", secret_key="none", tracing_enabled=False)


def commit() -> str:
    found = subprocess.run(
        ["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, check=False
    )
    return found.stdout.strip() or "unknown"


def arguments(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="python -m evals.run")
    parser.add_argument("--repeat", type=int, default=1)
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--only", nargs="*", default=[])
    parser.add_argument("--model", default="")
    parser.add_argument("--name", default="")
    parser.add_argument("--gate", action="store_true")
    parser.add_argument("--approve", action="store_true")
    return parser.parse_args(argv)


if __name__ == "__main__":
    sys.exit(main())
