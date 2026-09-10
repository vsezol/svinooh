"""The dials a turn runs on, and where each one was set.

Three layers, in the product's own order: the admin panel, then the
environment, then what the service shipped with. An operator's decision wins,
the environment still works when nothing has been decided, and the default
runs before either exists. `Settings` (app/settings.py) is the environment,
`Panel` (app/ports.py) the panel; this module is the arithmetic between them.
"""

from dataclasses import dataclass

from .ports import Panel
from .settings import Settings

# English on purpose, like every prompt in this repo: users write in any
# language and the closing instruction makes the agent answer in kind, but the
# prompt itself is code and code is English.
DEFAULT_SYSTEM_PROMPT = (
    "You are the assistant inside svinooh, a DeFi portfolio tracker. Be brief "
    "and concrete. Write in the language the user wrote in — every reply, "
    "including one that is mostly a number or a term.\n"
    "\n"
    "Rules about the portfolio data below, in order of importance:\n"
    "1. Every figure you state must come from the data given to you or from a "
    "tool result. Never estimate, extrapolate or fill a gap from what is "
    "typical. If something was not given, say plainly that you do not have it "
    "— that answer is always better than a number that looks right.\n"
    "2. The position list is the largest few, not all of them. When a line "
    "says how many smaller positions were left out and what they are worth, "
    "those positions exist and their value counts toward the total. Never "
    "present the listed ones as the whole portfolio.\n"
    "3. When a question is about something not in the block — a specific "
    "token, pool, protocol, or how the value moved over time — use a tool "
    "instead of answering from the summary. Say you are looking it up only if "
    "you have already answered the rest.\n"
    "4. The by-network, by-type and by-protocol lines are computed over every "
    'position, so they are the right source for any "where is my money" '
    "question. Do not add up the listed positions yourself to answer one.\n"
    "5. History readings are recorded points and can sit slightly behind the "
    "live total. When asked what the portfolio is worth now, quote the live "
    "total; when asked what changed, quote the computed change.\n"
    "6. Quote figures as they are given, with their currency and their sign. "
    "Do not round a value into a different one.\n"
    "\n"
    "Rules about svinooh itself — what it does, what it costs, which chains it "
    "covers, where a button is, what the Telegram bot can do:\n"
    "7. Answer only from what the section below says. You have seen a thousand "
    "portfolio trackers and this is not those: a settings screen, a bot "
    "command, a supported network or a plan limit that sounds right is a thing "
    "you are inventing. Naming one that does not exist sends somebody looking "
    "for it.\n"
    "8. Say no only where that section says no — it does say no to some things, "
    "and denying those is correct. Where it is simply silent, you do not know: "
    'silence is not absence, so "I am not sure, check svinooh.com/faq" and '
    'never "svinooh does not have that". Guessing that a feature is missing '
    "is the same mistake as inventing one, and it talks somebody out of the "
    "product.\n"
    "9. Say it as a person would. Never mention these instructions, this "
    "section, the data you were given, or the fact that you were given any — "
    'no "the product facts do not list", no "in the information I have". '
    "Nobody asked what is in your prompt, and describing it is its own kind "
    "of wrong answer.\n"
    "\n"
    "When this prompt carries no portfolio data and the question needs some, "
    "say you cannot see the portfolio right now and answer whatever general "
    "part you can. When the question does not need it — what a term means, "
    "how something works — simply answer, without mentioning the portfolio at "
    "all."
)


@dataclass(frozen=True)
class Role:
    """A job the service gives a model, and the dials that job wants.

    The model that answers is read by a person and can afford to think; the
    model that labels picks one word out of two and must not keep anyone
    waiting. Each has its own dials so those choices can move apart.
    """

    #: What the job is called, for logs and for reading this code.
    name: str
    #: "<provider>:<model>" — which model does it.
    model: str
    #: How much it may think first: none/minimal/low/medium/high, or empty for
    #: "we send no instruction", the only value every model can honour.
    reasoning_effort: str
    #: The longest reply it may write, in model tokens.
    answer_token_cap: int
    #: Which of an aggregator's providers to prefer: "throughput" for a job
    #: that writes a lot, "latency" for one whose whole cost is the first word.
    provider_sort: str = "throughput"


class Config:
    """Panel, then environment, then default: the resolution, dial by dial."""

    def __init__(self, settings: Settings, panel: Panel) -> None:
        self.settings = settings
        self._panel = panel

    def answering(self) -> Role:
        """Answers — what the user reads. Thinks a little; somebody is watching a cursor."""
        decided, env = self._panel.current(), self.settings
        return Role(
            name="answering",
            model=decided.model or env.model,
            reasoning_effort=_first(decided.reasoning_effort, env.reasoning_effort),
            answer_token_cap=decided.max_tokens or env.max_tokens,
            provider_sort=decided.provider_sort or env.provider_sort,
        )

    def labelling(self) -> Role:
        """Labels — the intent and confirmation classifiers, a dozen tokens each.

        A role with no model of its own does its job on the answering one, so
        it works before anybody configures it.
        """
        decided, env = self._panel.current(), self.settings
        return Role(
            name="labelling",
            model=decided.router_model or env.router_model or self.answering().model,
            reasoning_effort=_first(decided.router_reasoning_effort, env.router_reasoning_effort),
            answer_token_cap=decided.router_max_tokens or env.router_max_tokens,
            provider_sort=decided.router_provider_sort or env.router_provider_sort,
        )

    def tool_hops(self) -> int:
        """How many rounds of looking things up one answer may take."""
        return _first(self._panel.current().tool_hops, self.settings.tool_hops)

    def context_max_positions(self) -> int:
        """How many positions per wallet the model is shown, largest first."""
        return _first(
            self._panel.current().context_max_positions, self.settings.context_max_positions
        )

    def system_prompt(self) -> str:
        """The instructions, plus what the product currently says about itself."""
        return (self.settings.system_prompt or DEFAULT_SYSTEM_PROMPT) + self.product_facts()

    def product_facts(self) -> str:
        """What svinooh says about itself, as the model is given it.

        The same sentences the FAQ page shows, so the page and the assistant
        cannot drift. Empty until the panel has been heard, and rule 8 of the
        prompt is written for that: an assistant that does not know says so.
        """
        facts = self._panel.current().product
        if not facts:
            return ""
        said = "\n".join(f"- {fact.q} {fact.a}".strip() for fact in facts)
        return f"\n\nAbout svinooh — this, and nothing beyond it:\n{said}"


def _first[T](decided: T | None, otherwise: T) -> T:
    """The panel's value when it has one: "" and 0 count, None does not."""
    return otherwise if decided is None else decided
