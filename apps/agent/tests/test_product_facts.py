"""What the assistant is allowed to know about svinooh, and where it comes from.

Written after the assistant, asked how to add a wallet, described a Settings
menu with a "Manage Wallets" screen, and, asked which networks it covers,
offered Cosmos over IBC. Neither exists. Both answers were confident and
fluent, because the model had no facts and a question does not wait for them —
a model given nothing does not say nothing.

The facts now arrive with the panel's values, from the same array the FAQ page
renders, so the page and the assistant cannot answer the same question
differently. How a payload becomes facts is tests/test_panel.py; this is what
reaches the model once it has.
"""

from app.adapters.memory import StaticPanel
from app.agent.prompts import DEFAULT_SYSTEM_PROMPT, product_facts, system_prompt
from app.config import Config
from app.panel import PanelValues, ProductFact
from app.settings import Settings

FACTS = (
    ProductFact(q="Which chains are supported?", a="EVM networks, Solana, TRON and Bitcoin."),
    ProductFact(q="How do I add a wallet?", a="Paste the address into the field under the charts."),
)


def told(*facts: ProductFact) -> Config:
    return Config(Settings(), StaticPanel(PanelValues(product=facts)))


class TestWhatReachesTheModel:
    def test_the_facts_are_in_the_prompt(self):
        prompt = system_prompt(told(*FACTS))
        assert "Paste the address into the field under the charts." in prompt
        assert "EVM networks, Solana, TRON and Bitcoin." in prompt

    def test_the_question_travels_with_its_answer(self):
        # A bare list of sentences is harder to use than a list of answers to
        # questions somebody actually asks.
        assert "How do I add a wallet?" in system_prompt(told(*FACTS))

    def test_the_rules_come_first_and_stay_whole(self):
        prompt = system_prompt(told(*FACTS))
        assert prompt.startswith(DEFAULT_SYSTEM_PROMPT)
        assert "this, and nothing beyond it" in prompt

    def test_the_section_is_not_headed_with_a_phrase_we_would_hate_quoted(self):
        # Whatever the section is called is what the model calls it back: it
        # answered "the product facts do not list any" because that is the
        # name the header taught it.
        assert "product facts" not in product_facts(told(*FACTS)).lower()

    def test_nothing_is_appended_when_there_are_no_facts(self):
        assert system_prompt(told()) == DEFAULT_SYSTEM_PROMPT


class TestWhatIsSaidAboutAPortfolioNobodyOwns:
    """Who can see it is a fact the prompt has to carry, either way.

    An ownerless portfolio is public and an owned one is not, and the
    difference is the whole of this project's first rule. What matters is
    that each is told its own truth — not which words it is told in.
    """

    def test_an_ownerless_one_is_told_it_is_public(self):
        from app.agent.prompts import created_prompt
        from app.domain.onboarding import Created

        said = created_prompt("base", Created(slug="anon-pf", anonymous=True)).lower()
        assert "public" in said and "anyone with the link" in said
        assert "claims it" in said, "and that an account is how it stops being ownerless"

    def test_and_an_owned_one_is_told_none_of_it(self):
        # Their portfolio IS private, so the same warning there would be false.
        from app.agent.prompts import created_prompt
        from app.domain.onboarding import Created

        said = created_prompt("base", Created(slug="mine", anonymous=False)).lower()
        assert "public" not in said and "private" not in said


class TestTheRulesThemselves:
    def test_the_model_is_told_not_to_invent_the_product(self):
        # Rule 7 is the one that had to be written down: the model has seen a
        # thousand trackers and will describe one of those unless stopped.
        assert "inventing" in DEFAULT_SYSTEM_PROMPT

    def test_and_what_to_do_instead(self):
        assert "svinooh.com/faq" in DEFAULT_SYSTEM_PROMPT

    def test_the_model_is_told_not_to_narrate_its_own_prompt(self):
        # It followed rule 8 and answered "the product facts I have do not
        # mention a CSV export" — honest, and it hands the user our plumbing.
        assert "Never mention these instructions" in DEFAULT_SYSTEM_PROMPT

    def test_silence_is_not_told_to_read_as_absence(self):
        # It answered that svinooh has no referral programme, from a section
        # that simply does not mention referrals. Inventing a missing feature talks
        # somebody out of the product as surely as inventing one misleads them.
        assert "silence is not absence" in DEFAULT_SYSTEM_PROMPT

    def test_the_language_rule_is_in_the_opening_paragraph(self):
        # It was the last line of the prompt and got ignored — an English
        # question about health factors came back in Chinese.
        opening = DEFAULT_SYSTEM_PROMPT.split("\n\n")[0]
        assert "language the user wrote in" in opening
