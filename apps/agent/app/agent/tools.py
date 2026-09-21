import logging
from decimal import Decimal, InvalidOperation

from langchain_core.messages import ToolMessage
from langchain_core.tools import tool

from ..adapters.earn import YieldCatalog
from ..adapters.portfolio import DataSource
from ..domain.asking import MAX_ANSWERS, MIN_ANSWERS, Choice
from ..domain.earn import (
    Card,
    CatalogSnapshot,
    Coin,
    Deposit,
    Held,
    LiquidityPosition,
    PairPool,
    Placement,
    YieldPool,
)
from ..domain.house import plain
from ..domain.portfolio import History, Period, Portfolio, total_of
from ..observability import metrics
from .context import position_line, short_address, usd
from .steps import said, step, tool_label

logger = logging.getLogger("svinooh-ai")

MAX_MATCHES = 30

NOTHING_CAME_BACK = (
    "This call failed, so you have nothing from it. Say plainly that you could "
    "not read this right now, name no figure that would have come from it, and "
    "do not answer it from memory."
)

MAX_OPTIONS = 8


def summarize_history(history: History, period: str) -> str:
    change = history.change(period)
    if change is None:
        said("not enough history")
        return "Not enough history recorded for this period yet."
    said(f"{len(change.readings)} readings · {change.percent:+.1f}%")
    return (
        f"Period {period}: {len(change.readings)} readings.\n"
        f"Start {usd(change.first.usd)} at {change.first.at} -> "
        f"last reading {usd(change.last.usd)} at {change.last.at}.\n"
        f"Change {change.delta:+,.2f} USD ({change.percent:+.1f}%).\n"
        f"Low {usd(change.low.usd)} at {change.low.at}; "
        f"high {usd(change.high.usd)} at {change.high.at}.\n"
        "The last reading is the newest recorded point, which can sit slightly "
        "behind the live total shown in the portfolio above — quote the live "
        "total when asked what the portfolio is worth now."
    )


def find_positions(portfolio: Portfolio, query: str) -> str:
    if not query.strip():
        return "Empty query."
    matches = portfolio.matching(query)
    said(f"{len(matches)} matched" if matches else "nothing matched")
    if not matches:
        held = ", ".join(portfolio.protocols) or "no protocol positions"
        return (
            f'No position matches "{query}". '
            f"The portfolio holds: {held} — and plain token holdings."
        )
    total = total_of(match.position for match in matches)
    head = (
        f'{len(matches)} position(s) match "{query}", {usd(total)} in total'
        + (f" (showing the largest {MAX_MATCHES})" if len(matches) > MAX_MATCHES else "")
        + ":"
    )
    lines = [
        f"{short_address(match.address)}: {position_line(match.position, detail=True)}"
        for match in matches[:MAX_MATCHES]
    ]
    return "\n".join([head, *lines])


def earn_tools(catalog: YieldCatalog) -> list:

    @tool
    async def earn_options(token: str = "") -> str:
        """Places that pay for a deposit of one token, best rate first.

        Call whenever the user asks where to put money, what to earn on, which
        rate a token gets, or how to make idle funds work. Pass one ticker —
        USDC, SOL, PYUSD — to narrow it to that token; leave it empty for the
        best rates across every token. Returns each pool's rate split by where
        it comes from, how much is deposited, its minimum deposit, and a risk
        band with its reasons.

        Once per turn is enough: the same catalog answers every call, so a
        second one spends a step you may need to prepare the deposit with.
        """
        ticker = token.strip().upper()
        return describe_pools(await catalog.best_pools(ticker or None, MAX_OPTIONS), ticker)

    return [earn_options]


def asking_tools(asked: list[Choice]) -> list:
    @tool
    def ask_the_user(header: str, question: str, options: list[str]) -> str:
        """Put one question in front of the user as buttons they tap.

        Call it instead of guessing anything you need and do not have: which
        token of theirs to place, how much risk they want, which pool of two
        you cannot choose between. `header` is one or two words naming what is
        being chosen, in the user's own language — "Токен", "Риск" for somebody
        writing Russian. `question` is the question itself, one sentence, in
        that same language. `options` are two to four answers, each a
        short phrase they can tap — name the real thing, with the figure where
        there is one: "USDC 12.00", not "the stablecoin".

        Ask only for what you cannot read: the amounts are in front of you, and
        a token they already named is not a question. Call it twice in a turn
        for two things, and never for more. Then stop and wait: prepare
        nothing, propose nothing, and write a line above the buttons only when
        it says something the question does not — "pick one below" says
        nothing.
        """
        chosen = Choice(
            header=plain(header).strip(),
            question=plain(question).strip(),
            options=tuple(plain(option).strip() for option in options if plain(option).strip()),
        )
        if not chosen.question:
            return "A question with no words is not a question. Call again with one."
        if not chosen.is_answerable:
            return (
                f"Give between {MIN_ANSWERS} and {MAX_ANSWERS} answers to tap, each a short "
                "phrase. Call again with those."
            )
        asked.append(chosen)
        return (
            f"{chosen.header or 'The question'} is on their screen with those buttons. Stop "
            "here: write at most one short line above it, prepare nothing, propose nothing, "
            "and wait for the answer."
        )

    return [ask_the_user]


RISK_FIRST = (
    "Nobody has said how much risk they want, so no pool is chosen yet. Ask it with "
    "buttons — the safest pools against the highest rates, each with its rate — and "
    "prepare nothing until they answer."
)


async def other_coin(
    catalog: YieldCatalog, named: str, own: YieldPool, owners: tuple[str, ...]
) -> Coin | str | None:
    """The coin somebody named, when it is not the pool's own token.

    None is the pool's own token — nothing to swap. A string is why the coin
    cannot be used, for the model to say.
    """
    asked = named.strip()
    if not asked or asked.upper() == own.token.upper():
        return None
    found = await catalog.coin(asked, owners)
    if found is None:
        return (
            f"No coin called {asked} could be found that trades. Say so, and name what they "
            "do hold."
        )
    if own.terms is not None and found.mint == own.terms.token_mint:
        return None
    return found


SWAPPED = (
    "it is swapped on the way, which is a trade: from then on the money rises and falls "
    "with what it became — say that too — and their wallet may ask them to sign more than once"
)


def deposit_tools(
    catalog: YieldCatalog,
    prepared: list[Card],
    risk_known: bool = True,
    owners: tuple[str, ...] = (),
) -> list:
    @tool
    async def propose_deposit(pool_id: str, amount: str, token: str = "") -> str:
        """Put a deposit in front of the user to sign, once you know both facts.

        Call it only when the user has asked you to place money AND you know
        which pool and how much. `pool_id` is the id printed beside the pool in
        the rates you were given. `amount` is a plain number of tokens — no
        symbol, no currency. `token` is the coin they pay with, when it is not
        the one the pool takes: a coin they hold and named or picked, by its
        ticker — it is swapped into the pool's token on the way, and `amount`
        is then a number of that coin. Leave it empty to pay with the pool's
        own token. It moves nothing: the user signs it in their own wallet,
        and until they do, nothing has happened. Say what it is and leave it
        with them.
        """
        size = _amount(amount)
        if size is None:
            return "That amount is not a number of tokens. Ask the user how much, and call again."
        if not risk_known:
            return RISK_FIRST
        pool = await catalog.pool(pool_id.strip())
        if pool is None:
            return (
                f"No pool has the id {pool_id}. Use an id exactly as it was printed beside a "
                "pool in the rates, or read the rates again."
            )
        if pool.terms is None:
            return (
                f"{pool.name} cannot be deposited into from here — the catalog has no accounts "
                "for it. Say so and offer one of the others."
            )
        paid = await other_coin(catalog, token, pool, owners)
        if isinstance(paid, str):
            return paid
        deposit = Deposit(pool=pool, amount=size, terms=pool.terms, pay_with=paid)
        if deposit.below_minimum:
            return (
                f"{pool.name} takes at least {pool.terms.min_amount} {pool.token}. "
                "Tell the user the minimum and ask whether to go ahead with it."
            )
        prepared.append(deposit)
        spent = paid.symbol if paid else pool.token
        swapped = f", paid with their {paid.symbol}: {SWAPPED}" if paid else ""
        return (
            f"Ready for the user to sign: {size} {spent} into {pool.name} "
            f"({pool.protocol} {pool.kind}) at {as_percent(pool.apy_net)}{swapped}. They see it "
            "as a card with a button. Tell them what it is in one or two sentences, that the "
            "money leaves their own wallet straight into the protocol, and that nothing happens "
            "until they sign. Do not say it is done."
        )

    return [propose_deposit]


WHISKER = Decimal("1.001")


def moving_tools(
    catalog: YieldCatalog,
    held: tuple[Held, ...],
    prepared: list[Card],
    risk_known: bool = True,
    owners: tuple[str, ...] = (),
) -> list:
    def holding(pool_id: str) -> Held | None:
        return next((one for one in held if one.pool.id == pool_id.strip()), None)

    def nothing_there(pool_id: str) -> str:
        if not held:
            return (
                "Nothing they have in a pool could be read, so there is nothing to take out "
                "from here. Say so plainly."
            )
        return (
            f"They have nothing in a pool with the id {pool_id}. Use an id exactly as it is "
            "printed on the lines of what they have in pools."
        )

    def how_much(raw: str, source: Held) -> tuple[Decimal, bool] | str:
        if str(raw).strip().lower() in ("", "all", "everything", "max"):
            return source.amount, True
        size = _amount(raw)
        if size is None:
            return 'That amount is not a number of tokens. Pass "all", or ask how much.'
        if size > source.amount * WHISKER:
            return (
                f"They have {source.amount:f} {source.pool.token} in {source.pool.name}, less "
                "than that. Tell them what is there and offer to take all of it."
            )
        return size, False

    @tool
    async def propose_withdraw(pool_id: str, amount: str = "all", token: str = "") -> str:
        """Put a withdrawal in front of the user to sign: money out of a pool, back to their wallet.

        `pool_id` is the id printed beside the pool on the lines of what they
        have in pools. `amount` is "all" for everything in it, or a plain number
        of the pool's token. `token` is the coin they want it back as, when
        they asked for one that is not the pool's own, by its ticker — it is
        swapped on the way out. Leave it empty to get the pool's own token.
        Taking all of it also closes the accounts the deposit opened, and the
        SOL they held comes back with the money. It moves nothing: they sign it
        in their own wallet, and until they do, nothing has happened.
        """
        source = holding(pool_id)
        if source is None:
            return nothing_there(pool_id)
        taken = how_much(amount, source)
        if isinstance(taken, str):
            return taken
        size, everything = taken
        pool = await catalog.pool(source.pool.id)
        if pool is None or pool.terms is None:
            return f"{source.pool.name} cannot be withdrawn from here. Say so."
        wanted = await other_coin(catalog, token, pool, owners)
        if isinstance(wanted, str):
            return wanted
        prepared.append(
            Deposit(
                pool=pool,
                amount=size,
                terms=pool.terms,
                action="withdraw",
                everything=everything,
                receive_as=wanted,
            )
        )
        what = f"all of it, about {size:f}" if everything else f"{size:f}"
        swapped = f", as {wanted.symbol}: {SWAPPED}" if wanted else ""
        return (
            f"Ready for the user to sign: {what} {pool.token} out of {pool.name}, back to their "
            f"wallet{swapped}. They see it as a card with a button. Say what it is in one or two "
            "sentences and that nothing happens until they sign. Do not say it is done."
        )

    @tool
    async def propose_move(from_pool_id: str, to_pool_id: str, amount: str = "all") -> str:
        """Move money from a pool they are in to another pool, from one button.

        It takes the money out and puts it in together: never ask them to
        withdraw and then deposit as two steps, and never send them to a
        protocol's site to do either. The pools may take different tokens —
        then it swaps on the way, through Kamino Swap, and their wallet may ask
        them to sign more than once. `from_pool_id` is the id printed beside the pool on
        the lines of what they have in pools; `to_pool_id` is the id printed
        beside a pool in the rates. `amount` is "all", or a plain number of the
        token that pool holds. It moves nothing until they sign.
        """
        source = holding(from_pool_id)
        if source is None:
            return nothing_there(from_pool_id)
        if not risk_known:
            return RISK_FIRST
        target = await catalog.pool(to_pool_id.strip())
        if target is None:
            return (
                f"No pool has the id {to_pool_id}. Use an id exactly as it was printed beside a "
                "pool in the rates, or read the rates again."
            )
        if target.id == source.pool.id:
            return f"The money is already in {target.name}. Say so."
        if target.kind != "vault":
            return (
                f"{target.name} is one lending market's reserve, and a move goes into a vault. "
                "Offer the best vault that takes the token instead, or taking the money out."
            )
        if target.terms is None:
            return f"{target.name} cannot be deposited into from here. Offer another."
        taken = how_much(amount, source)
        if isinstance(taken, str):
            return taken
        size, everything = taken
        prepared.append(
            Deposit(
                pool=target,
                amount=size,
                terms=target.terms,
                action="move",
                source=source.pool,
                everything=everything,
            )
        )
        what = f"all of it, about {size:f}" if everything else f"{size:f}"
        swapped = target.token != source.pool.token
        way = (
            f", swapped from {source.pool.token} to {target.token} on the way — their wallet may "
            "ask them to sign more than once, a signature for each step one transaction cannot "
            "hold"
            if swapped
            else ""
        )
        return (
            f"Ready for the user to sign: {what} {source.pool.token} out of {source.pool.name} "
            f"({as_percent(source.pool.apy_net)}) and into {target.name} "
            f"({as_percent(target.apy_net)}){way}. They see it as a card with a button. Say what "
            "it is and what the rate becomes, in one or two sentences, and that nothing happens "
            "until they sign. Do not say it is done."
        )

    return [propose_withdraw, propose_move]


RANGE_FIRST = (
    "Nobody has said the range yet, so nothing is placed. Ask it with buttons — a "
    "narrow range, a middle one and a wide one, each as how far under and over the "
    "price it reaches, like -5% / +5% — and say they can type their own; prepare "
    "nothing until they answer."
)


def _percent(raw: str) -> Decimal | None:
    try:
        value = abs(Decimal(str(raw).strip().replace("%", "").replace(",", ".")))
    except InvalidOperation:
        return None
    return value if value < 100 else None


def _range(below_pct: str, above_pct: str) -> tuple[Decimal, Decimal] | str | None:
    """A range as percent under and over the price; None when neither is given."""
    if not str(below_pct).strip() and not str(above_pct).strip():
        return None
    below, above = _percent(below_pct), _percent(above_pct)
    if below is None or above is None or below + above == 0:
        return (
            "A range is two plain percentages, how far under the price it reaches and how far "
            "over it — 10.3 and 5.5 for -10.3% / +5.5%. Call again with both."
        )
    return below, above


def liquidity_tools(
    catalog: YieldCatalog,
    placed: tuple[LiquidityPosition, ...],
    prepared: list[Card],
    range_known: bool = True,
    free: dict[str, Decimal] | None = None,
) -> list:
    def short_of(symbol: str, size: Decimal) -> str | None:
        """Why the wallets cannot pay this much of a token, when their last reading says so."""
        if free is None:
            return None
        held = free.get(symbol.upper(), Decimal(0))
        if size <= held * WHISKER:
            return None
        return (
            f"Their wallets hold {held:f} {symbol} free right now — what sits in a pool is not "
            "free, and SOL keeps a little back for fees. Nothing is placed. Say so, and offer "
            "what can be done: placing what they hold free, or taking the money out of the pool "
            "first — a withdrawal card of its own, signed before, and the liquidity prepared "
            "once the money is in their wallet. Never promise the two as one card or one "
            "signature. A reading can lag a top-up by a few minutes; if they say they just "
            "added some, say a fresh reading takes a minute."
        )

    seen: dict[str, PairPool] = {}

    def remember(pools: tuple[PairPool, ...]) -> tuple[PairPool, ...]:
        seen.update({pool.id: pool for pool in pools})
        return pools

    async def resolve(pool_id: str) -> PairPool | None:
        """A pool by the id the model gave, forgiving a slip in copying one it was shown."""
        asked = pool_id.strip()
        pool = await catalog.pair_pool(asked)
        if pool is not None:
            return pool
        near = [one for one in seen.values() if _distance(one.id, asked) <= TYPOS]
        return await catalog.pair_pool(near[0].id) if len(near) == 1 else None

    async def fitting(
        pool: PairPool, below: Decimal, above: Decimal
    ) -> tuple[str | None, list[PairPool]]:
        """Why this pool cannot hold the range, and the pools of the pair that can."""
        pools = remember(await catalog.pair_pools(pool.x, pool.y, below, above))
        fit = next((one for one in pools if one.id == pool.id), None)
        if fit is None or fit.why_not is None:
            return None, []
        return fit.why_not, [one for one in pools if one.why_not is None][:3]

    def at(address: str) -> LiquidityPosition | None:
        return next((one for one in placed if one.address == address.strip()), None)

    def not_theirs(address: str) -> str:
        if not placed:
            return "They have no liquidity positions that could be read. Say so plainly."
        return (
            f"They have no liquidity position at {address}. Use an address exactly as it is "
            "printed on the lines of their liquidity positions."
        )

    @tool
    async def liquidity_pools(pair: str, below_pct: str = "", above_pct: str = "") -> str:
        """Pools that pair two tokens for liquidity, most money first.

        Call when the user wants to provide liquidity to a pair, or asks where
        to. `pair` is two tickers joined by a dash — SOL-USDC. With the range
        they chose — `below_pct` and `above_pct`, how far under and over the
        current price it reaches, in percent — each pool says whether one
        position holds that range there; only one that does can take it.
        Returns each pool's fee rate, the money in it, how wide its bins are,
        and its price.
        """
        sides = [side.strip() for side in str(pair).replace("/", "-").split("-") if side.strip()]
        if len(sides) != 2:
            return "A pair is two tickers joined by a dash, like SOL-USDC. Call again with one."
        wanted = _range(below_pct, above_pct)
        if isinstance(wanted, str):
            return wanted
        below, above = wanted if wanted else (None, None)
        pools = remember(await catalog.pair_pools(sides[0], sides[1], below, above))
        said(f"{len(pools)} pools" if pools else "no pools")
        if not pools:
            return (
                f"No pool pairs {sides[0]} and {sides[1]} with money enough in it right now. Say "
                "so, and do not offer another pair they did not ask for."
            )
        lines = [
            f"- {pool.name} (Meteora DLMM, bins {pool.bin_step / 100:g}% apart) pays "
            f"{as_percent(pool.fee_apr)} a year in fees at the last day's trading, paid only "
            f"while the price is in a position's range. {as_money(pool.tvl_usd)} in it. Price "
            f"{pool.price:f} {pool.y} per {pool.x}."
            + (
                ""
                if pool.range_bins is None
                else f" That range is {pool.range_bins} of its bins: "
                + ("one position holds it." if pool.why_not is None else f"{pool.why_not}.")
            )
            + f" id {pool.id}"
            for pool in pools[:MAX_OPTIONS]
        ]
        lines.append(
            "Name one pool the range fits in and say why that one: a higher fee rate comes from "
            "more trading or less money, and less money is more risk. A range is priced in the "
            "pool's own terms — its y per its x."
        )
        return "\n".join(lines)

    @tool
    async def propose_liquidity(
        pool_id: str, amount: str, token: str, below_pct: str, above_pct: str
    ) -> str:
        """Put liquidity for a pair in front of the user to sign, once they chose amount and range.

        `pool_id` is the id printed beside a pool. `amount` is a plain number
        of `token`, one of the pool's two tokens — the one they pay with; what
        the range needs of the other is swapped into it on the way.
        `below_pct` and `above_pct` are how far under and over the current
        price the range reaches, in percent, exactly as they chose them — 10.3
        and 5.5 for -10.3% / +5.5%. It moves nothing until they sign.
        """
        if not range_known:
            return RANGE_FIRST
        size = _amount(amount)
        if size is None:
            return "That amount is not a number of tokens. Ask the user how much, and call again."
        wanted = _range(below_pct, above_pct)
        if wanted is None:
            return RANGE_FIRST
        if isinstance(wanted, str):
            return wanted
        below, above = wanted
        pool = await resolve(pool_id)
        if pool is None:
            return (
                f"No pool has the id {pool_id}. Use an id exactly as it was printed beside a pool."
            )
        paid = pool.token(token)
        if paid is None:
            return f"{pool.name} takes {pool.x} and {pool.y}; ask which of those they pay with."
        why, holding = await fitting(pool, below, above)
        if why:
            return _held_elsewhere(why, holding)
        symbol, mint = paid
        short = short_of(symbol, size)
        if short:
            return short
        prepared.append(
            Placement(
                action="provide",
                pool=pool,
                amount=size,
                pay_with=Coin(symbol=symbol, mint=mint, decimals=0),
                below_pct=below,
                above_pct=above,
            )
        )
        other = pool.y if symbol == pool.x else pool.x
        return (
            f"Ready for the user to sign: {size:f} {symbol} into {pool.name} on Meteora across "
            f"-{below:f}% / +{above:f}% around the price, {pool.price:f} {pool.y} per {pool.x} "
            f"now. Part of it is swapped into {other} so both sides of the range fill, and their "
            "wallet asks for a signature per step. Say what it is in two sentences: that it earns "
            "fees only while the price stays in the range and sits in one token when it leaves, "
            "and that opening it locks about 0.057 SOL of rent, returned when it closes. Nothing "
            "happens until they sign. Do not say it is done."
        )

    @tool
    async def propose_close_liquidity(position: str) -> str:
        """Put the closing of one of their liquidity positions in front of them to sign.

        Everything in it comes back to their wallet as the two tokens, with
        the fees it earned and the rent its account held. `position` is the
        address printed on the lines of their liquidity positions.
        """
        held = at(position)
        if held is None:
            return not_theirs(position)
        prepared.append(Placement(action="close", pool=held.pool, position=held))
        return (
            f"Ready for the user to sign: the {held.pool.name} position closed — "
            f"{held.amount_x:f} {held.pool.x} and {held.amount_y:f} {held.pool.y} back to their "
            "wallet with its fees and rent. Say it in one or two sentences; nothing happens until "
            "they sign."
        )

    @tool
    async def propose_rebalance(position: str, below_pct: str = "", above_pct: str = "") -> str:
        """Close a liquidity position and place what it held around the price again, one button.

        For a position that has left its range, or one they want re-centred.
        `position` is the address printed on the lines of their liquidity
        positions. `below_pct` and `above_pct` are the new range in percent,
        when they chose one; leave both empty to keep its width, as far down
        as up. What it held is swapped to fit the new range on the way, and
        their wallet asks for a signature per step.
        """
        held = at(position)
        if held is None:
            return not_theirs(position)
        wanted = _range(below_pct, above_pct)
        if isinstance(wanted, str):
            return wanted
        if wanted:
            why, _ = await fitting(held.pool, *wanted)
            if why:
                return f"{why}. Offer a narrower range, or keeping its width."
        below, above = wanted if wanted else (None, None)
        prepared.append(
            Placement(
                action="rebalance",
                pool=held.pool,
                position=held,
                below_pct=below,
                above_pct=above,
            )
        )
        where = f"-{below:f}% / +{above:f}%" if wanted else "as wide as it was, as far down as up"
        return (
            f"Ready for the user to sign: the {held.pool.name} position closed and what it holds "
            f"— {held.amount_x:f} {held.pool.x} and {held.amount_y:f} {held.pool.y} — placed again "
            f"around the price, {where}, swapped to fit. Their wallet asks for a signature per "
            "step. Say it in two sentences; nothing happens until they sign."
        )

    return [liquidity_pools, propose_liquidity, propose_close_liquidity, propose_rebalance]


def _held_elsewhere(why: str, holding: list[PairPool]) -> str:
    """A range one pool cannot hold, with the pools of the same pair that can."""
    if not holding:
        return f"{why}. No pool of the pair holds it; offer a narrower range."
    options = "; ".join(
        f"{one.name} with bins {one.bin_step / 100:g}% apart, {as_percent(one.fee_apr)} a year "
        f"in fees, {as_money(one.tvl_usd)} in it, id {one.id}"
        for one in holding
    )
    return (
        f"{why}. The pools of the pair that hold it: {options}. Offer one of those, or a "
        "narrower range here."
    )


TYPOS = 3
"""How far a pool id the model copied may be off and still be the one it was shown."""


def _distance(first: str, second: str) -> int:
    """How many single characters turn one string into the other."""
    previous = list(range(len(second) + 1))
    for at, left in enumerate(first, 1):
        current = [at]
        for to, right in enumerate(second, 1):
            current.append(
                min(previous[to] + 1, current[to - 1] + 1, previous[to - 1] + (left != right))
            )
        previous = current
    return previous[-1]


def _amount(raw: str) -> Decimal | None:
    try:
        size = Decimal(str(raw).strip().replace(",", "").replace("_", ""))
    except InvalidOperation:
        return None
    return size if size > 0 else None


def describe_pools(snapshot: CatalogSnapshot, asked_for: str) -> str:
    said(pools_found(snapshot))
    if not snapshot.pools:
        asked = f" for {asked_for}" if asked_for else ""
        return (
            f"The catalog has nothing{asked} right now. Say so plainly; do not "
            "substitute a token that was not asked about."
        )
    read_at = snapshot.as_of.isoformat(timespec="minutes") if snapshot.as_of else "an unknown time"
    stale = " The catalog could not be refreshed, so these rates are older than usual."
    lines = [f"Read at {read_at}.{stale if snapshot.stale else ''}"]
    for pool in snapshot.pools:
        reasons = "; ".join(pool.risk_reasons)
        least = pool.terms.min_amount if pool.terms else None
        lines.append(
            f"- {pool.name} ({pool.protocol} {pool.kind}) pays "
            f"{as_percent(pool.apy_net)} net on {pool.token} = {rate_breakdown(pool)}. "
            f"{as_money(pool.tvl_usd)} deposited. Risk {pool.risk}"
            f"{f': {reasons}' if reasons else ''}."
            f"{f' Takes {least:f} {pool.token} at least.' if least else ''}"
            f" id {pool.id}"
        )
    lines.append(
        "Quote the net rate, name the risk in words with its reason, and never "
        "promise a rate will hold — base is what borrowers pay, the rest ends. "
        "Where a pool states a minimum, check it against what the user has "
        "before you name that pool: proposing one they cannot reach spends "
        "their turn on a refusal you could have read here."
    )
    return "\n".join(lines)


def pools_found(snapshot: CatalogSnapshot) -> str:
    if not snapshot.pools:
        return "nothing listed"
    pools = f"{len(snapshot.pools)} pools" if len(snapshot.pools) > 1 else "1 pool"
    return f"{pools} · best {as_percent(max(pool.apy_net for pool in snapshot.pools))}"


def rate_breakdown(pool: YieldPool) -> str:
    parts = [f"{as_percent(pool.apy_base)} base"]
    if pool.apy_rewards > 0:
        parts.append(f"{as_percent(pool.apy_rewards)} rewards")
    if pool.apy_incentives > 0:
        parts.append(f"{as_percent(pool.apy_incentives)} incentives")
    return " + ".join(parts)


def as_percent(value: Decimal) -> str:
    return f"{value * 100:.2f}%"


def as_money(value: Decimal) -> str:
    if value >= 1_000_000:
        return f"${value / 1_000_000:,.1f}M"
    if value >= 1_000:
        return f"${value / 1_000:,.0f}k"
    return f"${value:,.0f}"


def portfolio_tools(source: DataSource, slug: str, token: str | None, portfolio: Portfolio) -> list:

    @tool
    async def history_summary(period: Period) -> str:
        """How the portfolio's total value moved over a period.

        Call when the user asks what changed, grew or dropped, or about peaks
        and dips. Returns computed facts: start, end, change in USD and
        percent, low and high. Pick the smallest period that covers the
        question ("this week" -> 7d).
        """
        return summarize_history(await source.history(slug, period, token), period)

    @tool
    def position_details(query: str) -> str:
        """Full detail on positions matching a token symbol or protocol name.

        Call when the user asks about a specific token, pool or protocol
        that the portfolio overview above does not show. Pass one short word
        — a token symbol or a protocol name — and it matches any word in a
        position that starts with it, whatever the case. If nothing matches,
        try once more with a different word from the user's question.
        """
        return find_positions(portfolio, query)

    return [history_summary, position_details]


_PERIODS = {
    "1h": "the last hour",
    "24h": "the last 24 hours",
    "7d": "the last 7 days",
    "30d": "the last 30 days",
    "all": "the whole history",
}


def tool_phrase(name: str, args: dict) -> str | None:
    if name == "history_summary":
        period = str(args.get("period", ""))
        return f"Reading the total over {_PERIODS[period]}" if period in _PERIODS else None
    if name == "position_details":
        query = str(args.get("query", "")).strip()
        return f"Reading positions · {query}" if query else None
    if name == "earn_options":
        token = str(args.get("token", "")).strip().upper()
        return f"Reading lending rates · {token}" if token else "Reading lending rates"
    if name == "propose_deposit":
        pool = str(args.get("pool_id", "")).strip()
        return f"Preparing a deposit · {pool}" if pool else "Preparing a deposit"
    if name == "propose_withdraw":
        pool = str(args.get("pool_id", "")).strip()
        return f"Preparing a withdrawal · {pool}" if pool else "Preparing a withdrawal"
    if name == "propose_move":
        pool = str(args.get("to_pool_id", "")).strip()
        return f"Preparing a move · {pool}" if pool else "Preparing a move"
    if name == "liquidity_pools":
        pair = str(args.get("pair", "")).strip().upper()
        return f"Reading liquidity pools · {pair}" if pair else "Reading liquidity pools"
    if name == "propose_liquidity":
        return "Preparing liquidity"
    if name == "propose_close_liquidity":
        return "Preparing a close"
    if name == "propose_rebalance":
        return "Preparing a rebalance"
    return None


async def run_tools(calls: list[dict], tools: list) -> list[ToolMessage]:
    by_name = {t.name: t for t in tools}
    results = []
    for call in calls:
        name, args = call.get("name", ""), call.get("args", {})
        counted_as = name if name in by_name else "unknown"
        try:
            handler = by_name.get(name)
            if handler is None:
                raise KeyError(f"unknown tool: {name}")
            async with step(
                call.get("id") or name, tool_phrase(name, args) or tool_label(name, args)
            ):
                result = await handler.ainvoke(args)
            logger.info("tool %s(%s) -> %d chars", name, args, len(str(result)))
            metrics.counted(metrics.tool_calls, tool=counted_as, outcome="ok")
        except Exception as error:  # noqa: BLE001 — the model handles tool failures
            logger.warning("tool %s failed: %r", name, error)
            metrics.counted(metrics.tool_calls, tool=counted_as, outcome="failed")
            result = f"{error}\n{NOTHING_CAME_BACK}"
        results.append(ToolMessage(content=str(result), tool_call_id=call.get("id", "")))
    return results
