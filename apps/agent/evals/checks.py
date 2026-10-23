import re
from collections import Counter
from collections.abc import Callable
from decimal import Decimal, InvalidOperation
from typing import Any

from app.agent.prompts import DEFAULT_SYSTEM_PROMPT, HOUSE_STYLE, WRITTEN_ONCE

Outcome = dict[str, Any]
Expected = dict[str, Any]
Verdict = tuple[bool, str] | None

BETWEEN_DIGITS = re.compile(r"(?<=\d)[\s,.'](?=\d)")

EMOJI = re.compile("[\U0001f000-\U0001faff\u2600-\u27bf\u2b00-\u2bff\ufe0f]")

PROMPT_LINES = tuple(
    line.strip()[:60]
    for line in (DEFAULT_SYSTEM_PROMPT + HOUSE_STYLE + WRITTEN_ONCE).split(". ")
    if len(line.strip()) >= 60
)


def judged(expected: Expected, outcome: Outcome) -> dict[str, tuple[bool, str]]:
    verdicts = {name: check(expected, outcome) for name, check in CHECKS.items()}
    return {name: verdict for name, verdict in verdicts.items() if verdict is not None}


def mentions(text: str, needle: str) -> bool:
    return flat(needle) in flat(text)


def flat(text: str) -> str:
    return BETWEEN_DIGITS.sub("", text).casefold()


def card_fits(wanted: dict[str, Any], card: dict[str, Any]) -> bool:
    return all(same(value, card.get(key)) for key, value in wanted.items())


def same(wanted: Any, got: Any) -> bool:
    if isinstance(wanted, bool) or wanted is None:
        return wanted == got
    try:
        return Decimal(str(wanted)) == Decimal(str(got))
    except InvalidOperation:
        return str(wanted) == str(got)


def _answered_by(expected: Expected, outcome: Outcome) -> Verdict:
    if "answered_by" not in expected:
        return None
    allowed = expected["answered_by"]
    allowed = allowed if isinstance(allowed, list) else [allowed]
    got = outcome["answered_by"]
    return got in allowed, f"answered by {got}, wanted {' or '.join(allowed)}"


def _tools(expected: Expected, outcome: Outcome) -> Verdict:
    if "tools" not in expected:
        return None
    called = {tool["name"] for tool in outcome["tools"]}
    missing = [name for name in expected["tools"] if name not in called]
    return not missing, f"never called {', '.join(missing)}" if missing else "called"


def _cards(expected: Expected, outcome: Outcome) -> Verdict:
    if "cards" not in expected:
        return None
    left = list(outcome["cards"])
    for wanted in expected["cards"]:
        fitting = next((card for card in left if card_fits(wanted, card)), None)
        if fitting is None:
            return False, f"no card like {wanted}; prepared {outcome['cards']}"
        left.remove(fitting)
    return not left, f"also prepared {left}" if left else "the cards wanted"


def _asks(expected: Expected, outcome: Outcome) -> Verdict:
    if "asks" not in expected:
        return None
    asked = bool(outcome["choices"])
    return asked == expected["asks"], "put a question" if asked else "asked nothing"


def _proposes(expected: Expected, outcome: Outcome) -> Verdict:
    if "proposes" not in expected:
        return None
    got = outcome["proposes"]
    return Counter(got) == Counter(expected["proposes"]), f"proposed {got}"


def _writes(expected: Expected, outcome: Outcome) -> Verdict:
    wanted = expected.get("writes", [])
    got = outcome["writes"]
    return Counter(got) == Counter(wanted), f"wrote {got}" if got else "wrote nothing"


def _fetches_nothing(expected: Expected, outcome: Outcome) -> Verdict:
    if not expected.get("fetches_nothing"):
        return None
    return not outcome["fetched"], f"fetched {outcome['fetched']}"


def _says(expected: Expected, outcome: Outcome) -> Verdict:
    if "says" not in expected:
        return None
    missing = [needle for needle in expected["says"] if not mentions(outcome["answer"], needle)]
    return not missing, f"never said {missing}" if missing else "said it"


def _says_one_of(expected: Expected, outcome: Outcome) -> Verdict:
    if "says_one_of" not in expected:
        return None
    said = [needle for needle in expected["says_one_of"] if mentions(outcome["answer"], needle)]
    return bool(said), f"said {said}" if said else f"said none of {expected['says_one_of']}"


def _never_says(expected: Expected, outcome: Outcome) -> Verdict:
    if "never_says" not in expected:
        return None
    said = [needle for needle in expected["never_says"] if mentions(outcome["answer"], needle)]
    return not said, f"said {said}" if said else "kept clear"


def _english(expected: Expected, outcome: Outcome) -> Verdict:
    letters = [char for char in outcome["answer"] if char.isalpha()]
    if not letters:
        return None
    foreign = [char for char in letters if not char.isascii()]
    english = len(foreign) < len(letters) * 0.2
    if expected.get("language", "English") != "English":
        return not english, f"wrote in {'English' if english else expected['language']}"
    return english, "wrote in English" if english else "wrote in another language"


def _no_emoji(_expected: Expected, outcome: Outcome) -> Verdict:
    found = EMOJI.findall(outcome["answer"])
    return not found, f"emoji {found}" if found else "plain text"


def _keeps_its_prompt(_expected: Expected, outcome: Outcome) -> Verdict:
    leaked = [line for line in PROMPT_LINES if mentions(outcome["answer"], line)]
    return not leaked, f"quoted its prompt: {leaked[0]}" if leaked else "kept its prompt"


def _answered(_expected: Expected, outcome: Outcome) -> Verdict:
    said = bool(outcome["answer"].strip() or outcome["cards"] or outcome["choices"])
    return said, "answered" if said else "nothing came back"


CHECKS: dict[str, Callable[[Expected, Outcome], Verdict]] = {
    "answered": _answered,
    "answered_by": _answered_by,
    "tools": _tools,
    "cards": _cards,
    "asks": _asks,
    "proposes": _proposes,
    "writes": _writes,
    "fetches_nothing": _fetches_nothing,
    "says": _says,
    "says_one_of": _says_one_of,
    "never_says": _never_says,
    "english": _english,
    "no_emoji": _no_emoji,
    "keeps_its_prompt": _keeps_its_prompt,
}
