import argparse
import asyncio
import os
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

import yaml

from app.settings import Settings

from .judges import CRITERIA, JUDGE, Judges, Shown, Verdict, judges_for

HERE = Path(__file__).parent

TRUSTED_AT = 0.9


@dataclass(frozen=True)
class Label:
    id: str
    judge: str
    label: str
    shown: Shown


@dataclass(frozen=True)
class Agreement:
    caught: int
    missed: int
    cleared: int
    flagged: int
    unsure: int

    @property
    def catches(self) -> float:
        return self.caught / max(1, self.caught + self.missed)

    @property
    def clears(self) -> float:
        return self.cleared / max(1, self.cleared + self.flagged)

    @property
    def trusted(self) -> bool:
        return self.catches >= TRUSTED_AT and self.clears >= TRUSTED_AT


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m evals.calibrate")
    parser.add_argument("--judge", default=JUDGE)
    parser.add_argument("--concurrency", type=int, default=6)
    parser.add_argument("--gate", action="store_true")
    args = parser.parse_args(argv)
    labelled = load()
    model = args.judge or JUDGE
    verdicts = asyncio.run(judged(judges_for(Settings(), model), labelled, args.concurrency))
    report = calibration(labelled, verdicts, model)
    sys.stdout.write(report + "\n")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as written:
            written.write(report + "\n")
    untrusted = [name for name in CRITERIA if not agreement(labelled, verdicts, name).trusted]
    return 1 if args.gate and untrusted else 0


def load() -> list[Label]:
    raw = yaml.safe_load((HERE / "labels.yaml").read_text())
    data = raw["data"]
    return [
        Label(
            id=entry["id"],
            judge=entry["judge"],
            label=entry["label"],
            shown=Shown(
                question=entry.get("question", ""),
                answer=entry["answer"],
                data=data.get(entry.get("data", ""), ""),
                record=entry.get("record", ""),
            ),
        )
        for entry in raw["labels"]
    ]


async def judged(judges: Judges, labelled: list[Label], concurrency: int) -> dict[str, Verdict]:
    room = asyncio.Semaphore(concurrency)

    async def one(label: Label) -> tuple[str, Verdict]:
        async with room:
            return label.id, await judges.judge(label.judge, label.shown)

    return dict(await asyncio.gather(*(one(label) for label in labelled)))


def agreement(labelled: list[Label], verdicts: dict[str, Verdict], judge: str) -> Agreement:
    pairs = pairs_of(labelled, verdicts, judge)
    return Agreement(
        caught=sum(human == "fail" and said == "fail" for human, said in pairs),
        missed=sum(human == "fail" and said != "fail" for human, said in pairs),
        cleared=sum(human == "pass" and said == "pass" for human, said in pairs),
        flagged=sum(human == "pass" and said != "pass" for human, said in pairs),
        unsure=sum(said == "unknown" for _, said in pairs),
    )


def kappa(labelled: list[Label], verdicts: dict[str, Verdict], judge: str) -> float:
    pairs = pairs_of(labelled, verdicts, judge)
    total = len(pairs)
    if total == 0:
        return 0.0
    observed = sum(human == said for human, said in pairs) / total
    by_chance = sum(
        (sum(human == side for human, _ in pairs) / total)
        * (sum(said == side for _, said in pairs) / total)
        for side in ("pass", "fail")
    )
    return 1.0 if by_chance == 1 else (observed - by_chance) / (1 - by_chance)


def pairs_of(
    labelled: list[Label], verdicts: dict[str, Verdict], judge: str
) -> list[tuple[str, str]]:
    return [(label.label, verdicts[label.id].verdict) for label in labelled if label.judge == judge]


def calibration(labelled: list[Label], verdicts: dict[str, Verdict], model: str) -> str:
    lines = [
        f"## Judges against {len(labelled)} labelled replies",
        "",
        f"Judge model {model}. A judge is trusted when it catches at least "
        f"{TRUSTED_AT:.0%} of the failures and clears at least {TRUSTED_AT:.0%} of the passes.",
        "",
        "| judge | catches failures | clears passes | Cohen's kappa | unsure | trusted |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for name in CRITERIA:
        seen = agreement(labelled, verdicts, name)
        lines.append(
            f"| {name} | {seen.caught}/{seen.caught + seen.missed} | "
            f"{seen.cleared}/{seen.cleared + seen.flagged} | "
            f"{kappa(labelled, verdicts, name):.2f} | {seen.unsure} | "
            f"{'yes' if seen.trusted else 'no'} |"
        )
    disagreements = [label for label in labelled if verdicts[label.id].verdict != label.label]
    if disagreements:
        lines += ["", "### Where the judge and the label part", ""]
        for label in disagreements:
            verdict = verdicts[label.id]
            lines.append(
                f"- `{label.id}`: labelled {label.label}, judged {verdict.verdict}. "
                f"{verdict.reasoning.strip()[:400]}"
            )
    return "\n".join(lines)


if __name__ == "__main__":
    sys.exit(main())
