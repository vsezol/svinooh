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
        assert "How do I add a wallet?" in system_prompt(told(*FACTS))

    def test_the_rules_come_first_and_stay_whole(self):
        prompt = system_prompt(told(*FACTS))
        assert prompt.startswith(DEFAULT_SYSTEM_PROMPT)
        assert "this, and nothing beyond it" in prompt

    def test_the_section_is_not_headed_with_a_phrase_we_would_hate_quoted(self):
        assert "product facts" not in product_facts(told(*FACTS)).lower()

    def test_nothing_is_appended_when_there_are_no_facts(self):
        assert system_prompt(told()).startswith(DEFAULT_SYSTEM_PROMPT)
        assert "About svinooh" not in system_prompt(told())


class TestWhatIsSaidAboutAPortfolioNobodyOwns:
    def test_an_ownerless_one_is_told_it_is_public(self):
        from app.agent.prompts import created_prompt
        from app.domain.onboarding import Created

        said = created_prompt("base", Created(slug="anon-pf", anonymous=True)).lower()
        assert "public" in said and "anyone with the link" in said
        assert "claims it" in said, "and that an account is how it stops being ownerless"

    def test_and_an_owned_one_is_told_none_of_it(self):
        from app.agent.prompts import created_prompt
        from app.domain.onboarding import Created

        said = created_prompt("base", Created(slug="mine", anonymous=False)).lower()
        assert "public" not in said and "private" not in said


class TestNothingIsDoneUntilItIs:
    def test_every_branch_where_nothing_exists_carries_it(self):
        from app.agent import prompts
        from app.domain.onboarding import Created

        nothing_yet = [
            prompts.onboarding_prompt("", signed_in=False),
            prompts.onboarding_prompt("", signed_in=True),
            prompts.confirmation_request_prompt("", ["0xAAA"], anonymous=True),
            prompts.nothing_proposed_prompt(""),
            prompts.creation_failed_prompt(""),
            prompts.cancelled_prompt(""),
        ]
        assert all(prompts.NOTHING_IS_DONE_UNTIL_IT_IS in said for said in nothing_yet)
        assert prompts.NOTHING_IS_DONE_UNTIL_IT_IS not in prompts.created_prompt(
            "", Created(slug="s", anonymous=True)
        )

    def test_and_the_base_prompt_does_not(self):
        from app.agent import prompts

        assert prompts.NOTHING_IS_DONE_UNTIL_IT_IS not in prompts.DEFAULT_SYSTEM_PROMPT


class TestTheRulesThemselves:
    def test_the_model_is_told_not_to_invent_the_product(self):
        assert "inventing" in DEFAULT_SYSTEM_PROMPT

    def test_and_what_to_do_instead(self):
        assert "svinooh.com/faq" in DEFAULT_SYSTEM_PROMPT

    def test_the_model_is_told_not_to_narrate_its_own_prompt(self):
        assert "Never mention these instructions" in DEFAULT_SYSTEM_PROMPT

    def test_silence_is_not_told_to_read_as_absence(self):
        assert "silence is not absence" in DEFAULT_SYSTEM_PROMPT

    def test_the_language_rule_is_in_the_opening_paragraph(self):
        opening = DEFAULT_SYSTEM_PROMPT.split("\n\n")[0]
        assert "language the user wrote in" in opening
