"""What the assistant is allowed to know about svinooh, and where it comes from.

Written after the assistant, asked how to add a wallet, described a Settings
menu with a "Manage Wallets" screen, and, asked which networks it covers,
offered Cosmos over IBC. Neither exists. Both answers were confident and
fluent, because the model had no facts and a question does not wait for them —
a model given nothing does not say nothing.

The facts now arrive with the config, from the same array the FAQ page renders,
so the page and the assistant cannot answer the same question differently.
"""

import pytest

from app import remote_config
from app.config import DEFAULT_SYSTEM_PROMPT, product_facts, settings, system_prompt

FACTS = [
    {"q": "Which chains are supported?", "a": "EVM networks, Solana, TRON and Bitcoin."},
    {"q": "How do I add a wallet?", "a": "Paste the address into the field under the charts."},
]


@pytest.fixture
def panel_says(monkeypatch):
    def set(values):
        monkeypatch.setattr(remote_config, "_values", values)

    return set


class TestWhatReachesTheModel:
    def test_the_facts_are_in_the_prompt(self, panel_says):
        panel_says({"product": FACTS})
        prompt = system_prompt()
        assert "Paste the address into the field under the charts." in prompt
        assert "EVM networks, Solana, TRON and Bitcoin." in prompt

    def test_the_question_travels_with_its_answer(self, panel_says):
        # A bare list of sentences is harder to use than a list of answers to
        # questions somebody actually asks.
        panel_says({"product": FACTS})
        assert "How do I add a wallet?" in system_prompt()

    def test_the_rules_come_first_and_stay_whole(self, panel_says):
        panel_says({"product": FACTS})
        prompt = system_prompt()
        assert prompt.startswith(DEFAULT_SYSTEM_PROMPT)
        assert "this, and nothing beyond it" in prompt

    def test_the_section_is_not_headed_with_a_phrase_we_would_hate_quoted(self, panel_says):
        # Whatever the section is called is what the model calls it back: it
        # answered "the product facts do not list any" because that is the
        # name the header taught it.
        panel_says({"product": FACTS})
        assert "product facts" not in product_facts().lower()


class TestWhenThereAreNoFacts:
    def test_nothing_is_appended(self, panel_says):
        panel_says({})
        assert system_prompt() == settings.system_prompt

    @pytest.mark.parametrize("value", [None, "", [], "a string", {"not": "a list"}, 42], ids=str)
    def test_a_shape_we_did_not_expect_is_ignored_rather_than_rendered(self, panel_says, value):
        # The config is fetched over HTTP from another service; a bad payload
        # must cost the facts, never the conversation.
        panel_says({"product": value})
        assert product_facts() == ""

    def test_entries_without_an_answer_are_dropped(self, panel_says):
        panel_says({"product": [{"q": "?"}, {"a": "Bitcoin balances."}, "junk"]})
        facts = product_facts()
        assert "Bitcoin balances." in facts and "?" not in facts


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
        # It answered "у svinooh нет реферальной программы" from a section that
        # simply does not mention referrals. Inventing a missing feature talks
        # somebody out of the product as surely as inventing one misleads them.
        assert "silence is not absence" in DEFAULT_SYSTEM_PROMPT

    def test_the_language_rule_is_in_the_opening_paragraph(self):
        # It was the last line of the prompt and got ignored — an English
        # question about health factors came back in Chinese.
        opening = DEFAULT_SYSTEM_PROMPT.split("\n\n")[0]
        assert "language the user wrote in" in opening
