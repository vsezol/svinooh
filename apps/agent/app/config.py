"""Service configuration, read once from the environment.

Everything tunable lives here and nowhere else, so the *source* of the values
can change without touching the code that uses them — the roadmap is to fetch
this over the network from the host product's API (remote config), and only
this module would learn how.
"""

import os
from dataclasses import dataclass

from . import remote_config

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
class Settings:
    # ── the models ──────────────────────────────────────────────────────────
    # Which model does which job lives in the Role objects below this class,
    # one per job. What stays here is what the jobs share: the account we
    # reach them through, and the policy for choosing a provider behind it.
    model_api_key: str = os.getenv("AGENT_MODEL_API_KEY", "")
    # One endpoint for many vendors (OpenRouter and the like): when set, model
    # calls go to this OpenAI-compatible base URL instead of the provider's own
    # — one key, any vendor's model, chosen by AGENT_MODEL alone
    # (e.g. AGENT_MODEL=openai:google/gemini-2.5-flash). Empty — direct.
    model_base_url: str = os.getenv("AGENT_MODEL_BASE_URL", "")
    # Which of an aggregator's providers may serve these models. One model id
    # is served by several, and they differ in quantisation, in what they
    # actually support, in what they do with the prompt, and — measured on the
    # same question minutes apart — between 4 and 26 seconds. Left empty this
    # sends nothing and takes whoever answers.
    #   deny   : refuse providers that keep or train on the prompt. Ours carry
    #            somebody's wallet addresses and balances.
    #   require: refuse providers that do not advertise support for every
    #            parameter in the request. OFF, and it is a trap — see below.
    #   sort   : which of the survivors to prefer — per role, because the
    #            jobs want opposite things; see Role.provider_sort.
    provider_data_collection: str = os.getenv("AGENT_PROVIDER_DATA_COLLECTION", "deny")
    # It was on, to make sure whoever served us could really run tools. It does
    # not mean that. It means every parameter, including ones we never chose:
    # forcing a single tool call makes the client add parallel_tool_calls, and
    # not one of the answering model's fifteen providers advertises that. So the
    # requirement no provider could meet was one we did not know we were making,
    # and it emptied the list on every classification for hours.
    #
    # Tools are still not optional here — they are just not this setting's job.
    # The aggregator runs its own tool-compatibility filter when tools are in
    # the request, which is visible in the routing funnel of a refusal and is
    # the guarantee this was reached for.
    provider_require_parameters: bool = os.getenv("AGENT_PROVIDER_REQUIRE_PARAMETERS", "0") == "1"
    system_prompt: str = os.getenv("AGENT_SYSTEM", DEFAULT_SYSTEM_PROMPT)
    request_timeout_s: int = int(os.getenv("AGENT_TIMEOUT_S", "60"))
    # Conversation memory: how many messages the model is replayed. A turn is
    # two of them, so 40 is the last twenty exchanges.
    #
    # AGENT_HISTORY_TTL_S retired with the in-memory store. It described how
    # long a silent session survived in RAM, and a conversation's life is now a
    # promise about a product rather than a property of a process — thirty
    # days, in app/store.py, where the thing it describes lives.
    history_max_messages: int = int(os.getenv("AGENT_HISTORY_MAX_MESSAGES", "40"))
    # How many turns a stored conversation keeps at all. Larger than the
    # context window on purpose: somebody scrolls back further than the model
    # is replayed, and the transcript is the same record either way.
    chat_max_turns: int = int(os.getenv("AGENT_CHAT_MAX_TURNS", "100"))
    # How many conversations a listing returns, newest first.
    chat_list_limit: int = int(os.getenv("AGENT_CHAT_LIST_LIMIT", "50"))
    # The agent's own store — conversations (app/store.py) and the rate
    # limiter's counters (app/limits.py). Its own keyspace prefix, never the
    # portfolio's database: D1 in DESIGN.md is about not being a tenant of the
    # portfolio's Postgres, and a Redis with its own prefix keeps that true.
    # Unset (locally) and both fall back to in-process storage.
    redis_url: str = os.getenv("REDIS_URL", "")
    # The portfolio public API — DataSource #1 (see app/datasources.py). The
    # agent speaks to it over plain HTTP with the caller's token, like any
    # third-party client. On Railway this is the api service's private domain.
    portfolio_api_url: str = os.getenv("PORTFOLIO_API_URL", "http://localhost:3000")
    # A context fetch rides inside a chat turn; when it is slow, answering
    # without it beats making the person wait for it.
    context_timeout_s: int = int(os.getenv("AGENT_CONTEXT_TIMEOUT_S", "10"))
    # Origins allowed to call this service from a browser, comma-separated
    # (the portfolio web app, later the standalone agent app). Empty — no
    # cross-origin caller is allowed, which is right while the only door is
    # the server-side gateway.
    cors_origins: tuple[str, ...] = tuple(
        origin.strip()
        for origin in os.getenv("AGENT_CORS_ORIGINS", "").split(",")
        if origin.strip()
    )
    # How long a positive token validation stands before the host is asked
    # again. Short on purpose: a validation only names the caller — data calls
    # always carry the live token to the host.
    auth_cache_ttl_s: int = int(os.getenv("AGENT_AUTH_CACHE_TTL_S", "60"))
    # The cost lock: how many chat turns one caller gets per window. Every
    # turn is at least one paid model call, several when tools run.
    # What a visitor gets before the answer is the sign-in card. Counted
    # against their browser id, which is soft on purpose — clearing storage is
    # a new person — so this is a stated limit rather than a wall, and the
    # window keeps it a nudge instead of a one-time budget for all time.
    free_questions: int = int(os.getenv("AGENT_FREE_QUESTIONS", "5"))
    free_window_s: int = int(os.getenv("AGENT_FREE_WINDOW_S", "86400"))
    rate_limit_requests: int = int(os.getenv("AGENT_RATE_LIMIT_REQUESTS", "20"))
    rate_limit_window_s: int = int(os.getenv("AGENT_RATE_LIMIT_WINDOW_S", "300"))


@dataclass(frozen=True)
class Role:
    """A job the service gives a model, and the dials that job wants.

    Roles differ in what they are for, so they differ in what to spend: the
    model that answers is read by a person and can afford to think; the model
    that labels picks one word out of two and must not keep anyone waiting.
    Giving each its own settings is what lets those choices move apart.

    Adding a role — a critic, a summariser — is one line at the bottom of this
    module plus the variables it reads, and it runs on the answering model
    until somebody configures it:

        AGENT_<ROLE>_MODEL             which model does this job
        AGENT_<ROLE>_REASONING_EFFORT  how much it may think first
        AGENT_<ROLE>_MAX_TOKENS        how much it may write

    The credentials and the provider policy stay shared: they are about the
    account we call through, not about the job.
    """

    #: What the job is called, for logs and for reading this code.
    name: str
    #: "<provider>:<model>" — which model does it.
    model: str
    #: How much it may think before writing: none/minimal/low/medium/high, or
    #: empty for "we send no instruction and the endpoint is whatever it is".
    #: Empty is the only value every model can honour.
    reasoning_effort: str
    #: The longest reply it may write, counted in model tokens. Nothing to do
    #: with credentials — an answer is capped so it stays an answer, and a
    #: label is capped because a label is one word.
    answer_token_cap: int
    #: Which of an aggregator's providers to prefer for this job: "throughput"
    #: for one that writes a lot, "latency" for one whose whole cost is the
    #: wait before the first word. The two roles want opposite things, which is
    #: why this is here and not in the settings they share.
    provider_sort: str = "throughput"


def _role(
    name: str,
    env_prefix: str,
    decided: dict,
    *,
    panel_keys: tuple[str, str, str, str],
    effort: str = "",
    answer_token_cap: int = 1024,
    provider_sort: str = "throughput",
) -> Role:
    """Assemble one role from the three places a knob can be set.

    Admin panel, then environment, then what the service shipped with — the
    same order every other knob in this product resolves in, for the same
    reason: an operator's decision wins, the environment still works when
    nothing has been decided, and the default runs before either exists.

    `decided` is what the panel says right now; `panel_keys` names this role's
    knobs in it, and `env_prefix` names them in the environment
    (AGENT_ROUTER_MODEL and its siblings for labelling, AGENT_MODEL for
    answering, which has no prefix because it came first).
    """
    model_key, effort_key, cap_key, sort_key = panel_keys

    def decided_or_env(panel_key: str, env_key: str, fallback: str) -> str:
        # An empty value in the panel means "no opinion", not "set it to
        # nothing", so it falls through to the environment like an absent one.
        return str(decided.get(panel_key) or "") or os.getenv(f"AGENT_{env_key}", fallback)

    def thinking(env_key: str, fallback: str) -> str:
        # "default" is the panel's way of writing the empty string: a select
        # cannot offer "nothing", and an empty row would be read as unset and
        # fall through to the environment. It means we send no instruction —
        # which is the only setting that is safe whatever model is behind the
        # name, since a model that must think refuses being told to stop and a
        # model that cannot think is filtered out for being asked.
        value = decided_or_env(effort_key, env_key, fallback)
        return "" if value == "default" else value

    answering_model = str(decided.get("model") or "") or os.getenv(
        "AGENT_MODEL", "anthropic:claude-haiku-4-5"
    )
    # How long a reply may be, not any kind of credential: the panel carries a
    # number of model tokens, and a value that is not a positive whole number
    # is not a decision.
    cap_from_panel = decided.get(cap_key)
    cap_is_usable = isinstance(cap_from_panel, int) and not isinstance(cap_from_panel, bool)

    return Role(
        name=name,
        # A role with no model of its own does its job on the answering one.
        model=decided_or_env(model_key, f"{env_prefix}MODEL", "") or answering_model,
        # AGENT_REASONING_EFFORT carries no role in its name because it named
        # the only role there was; with an empty prefix it is still the
        # answering role's variable, and only that role's.
        reasoning_effort=thinking(f"{env_prefix}REASONING_EFFORT", effort),
        answer_token_cap=cap_from_panel
        if cap_is_usable and cap_from_panel > 0
        else int(os.getenv(f"AGENT_{env_prefix}MAX_TOKENS", str(answer_token_cap))),
        provider_sort=decided_or_env(sort_key, f"{env_prefix}PROVIDER_SORT", provider_sort),
    )


def product_facts() -> str:
    """What svinooh says about itself, as the model is given it.

    The same sentences the FAQ page shows a person, fetched with the rest of
    the config, because the agent has no shared libraries and this is the one
    channel it has (app/remote_config.py). Two consequences worth stating:
    what the page says and what the assistant says cannot drift, and a fact
    that changes changes for both in one commit.

    Empty when the config has not arrived. That is the honest state and rule 8
    is written for it — an assistant that does not know says so, rather than
    describing the product it imagines this is.
    """
    entries = remote_config.current().get("product")
    if not isinstance(entries, list) or not entries:
        return ""
    said = "\n".join(
        f"- {entry.get('q', '')} {entry.get('a', '')}".strip()
        for entry in entries
        if isinstance(entry, dict) and entry.get("a")
    )
    return f"\n\nAbout svinooh — this, and nothing beyond it:\n{said}" if said else ""


def system_prompt() -> str:
    """The instructions, plus what the product currently says about itself.

    A function rather than a field because the second half is live: it arrives
    over HTTP and can change without a deploy, like every other knob here.
    """
    return settings.system_prompt + product_facts()


def answering() -> Role:
    """Answers — what the user reads. Thinks a little; somebody is watching a cursor."""
    return _role(
        "answering",
        "",
        remote_config.current(),
        panel_keys=("model", "reasoningEffort", "maxTokens", "providerSort"),
        effort="minimal",
        answer_token_cap=1024,
        provider_sort="throughput",
    )


def labelling() -> Role:
    """Labels — the intent and confirmation classifiers.

    A dozen output tokens each, in front of every answer, so this is where a
    cheaper and faster tier pays for itself.

    Its provider preference is its own, though it currently matches the
    answering role's. Sorting by latency instead was the obvious idea once
    streaming showed that this call is the whole wait before the first word --
    a label is ten tokens, so almost none of its cost is writing -- and it was
    measured on production and did not help. The dial stays because the
    argument survives the measurement; the value stays where the evidence left
    it.

    It ships asking for no thinking at all — the empty setting, not "none".
    Choosing between two words is not deliberation, and every named value is a
    demand some endpoint cannot meet: a model that must think refuses being
    told to stop, and a model that cannot think is filtered away for being
    asked (see app/llm.py). Saying nothing is the only setting that fits both.
    """
    return _role(
        "labelling",
        "ROUTER_",
        remote_config.current(),
        panel_keys=(
            "routerModel",
            "routerReasoningEffort",
            "routerMaxTokens",
            "routerProviderSort",
        ),
        effort="",
        answer_token_cap=200,
        provider_sort="throughput",
    )


def _live_number(remote_key: str, env_key: str, default: int) -> int:
    """A number the panel may set: panel, then environment, then the default.

    Read at the point of use, like every other live knob in this product —
    which is also what makes it settable without a restart.
    """
    remote = remote_config.current().get(remote_key)
    if isinstance(remote, int) and not isinstance(remote, bool) and remote >= 0:
        return remote
    try:
        return int(os.getenv(env_key, str(default)))
    except ValueError:
        return default


def tool_hops() -> int:
    """How many rounds of looking things up one answer may take."""
    return _live_number("toolHops", "AGENT_TOOL_HOPS", 3)


def context_max_positions() -> int:
    """How many positions per wallet the model is shown, largest first."""
    return _live_number("contextMaxPositions", "AGENT_CONTEXT_MAX_POSITIONS", 12)


settings = Settings()
