import logging

import pytest

from app.adapters.memory import StaticPanel
from app.agent.intent import IntentClassifier, IntentLabel
from app.agent.llm import Models
from app.config import Config
from app.domain.conversation import Turn
from app.settings import Settings

CHEAP = "openai:cheap-labeller"
GOOD = "openai:the-one-that-answers"


class Stub:
    def __init__(self, label: str | None = "general", refusing: str | None = None):
        self.label = label
        self.refusing = refusing
        self.calls = 0

    def with_structured_output(self, _schema, **_kwargs):
        return self

    async def ainvoke(self, _messages):
        self.calls += 1
        if self.refusing:
            raise RuntimeError(self.refusing)
        return IntentLabel(intent=self.label, reason="stubbed")


def classifier(*, answering: Stub, labelling: Stub | None = None) -> IntentClassifier:
    clients = {GOOD: answering, CHEAP: labelling}
    settings = Settings(model=GOOD, router_model=CHEAP if labelling else "")
    models = Models(settings, factory=lambda name, **_kwargs: clients[name])
    return IntentClassifier(models, Config(settings, StaticPanel()))


class TestWhenTheCheapModelWorks:
    async def test_the_answering_model_is_not_troubled(self):
        cheap, good = Stub(label="portfolio"), Stub()
        label = await classifier(answering=good, labelling=cheap).classify("how much do I have?")
        assert label.intent == "portfolio"
        assert (cheap.calls, good.calls) == (1, 0), "the cheap one is the point"


class TestWhenTheCheapModelCannotBeReached:
    async def test_the_question_is_still_labelled(self):
        cheap = Stub(refusing="404 No endpoints found that can handle the requested parameters")
        good = Stub(label="general")
        label = await classifier(answering=good, labelling=cheap).classify(
            "what is impermanent loss?"
        )
        assert label.intent == "general", "the label is right, which is the whole point"
        assert good.calls == 1

    async def test_it_says_so_where_somebody_will_see_it(self, caplog):
        ours = classifier(answering=Stub(), labelling=Stub(refusing="404 no endpoints"))
        with caplog.at_level(logging.WARNING, logger="svinooh-ai"):
            await ours.classify("q")
        assert CHEAP in caplog.text and GOOD in caplog.text

    async def test_both_failing_is_the_caller_problem(self):
        ours = classifier(
            answering=Stub(refusing="500 upstream"), labelling=Stub(refusing="404 no endpoints")
        )
        with pytest.raises(RuntimeError, match="500 upstream"):
            await ours.classify("q")


class TestWhenOneModelDoesBothJobs:
    async def test_there_is_nothing_to_fall_back_to(self):
        only = Stub(refusing="429 rate limited")
        with pytest.raises(RuntimeError, match="429"):
            await classifier(answering=only).classify("q")
        assert only.calls == 1


class TestAskingApartFromTelling:
    def test_a_label_that_says_nothing_about_acting_means_a_question(self):
        assert IntentLabel(intent="earn", reason="r").asked_to_place is False

    def test_the_model_is_told_what_the_flag_means(self):
        told = IntentLabel.model_json_schema()["properties"]["asked_to_place"]["description"]
        assert "put the money" in told and "In doubt, false" in told


class Listening(Stub):
    def __init__(self, label: str = "earn"):
        super().__init__(label=label)
        self.seen: list = []

    async def ainvoke(self, messages):
        self.seen = list(messages)
        return await super().ainvoke(messages)


class TestWhatTheLabellerIsShown:
    async def test_a_reply_is_labelled_with_the_question_it_answers(self):
        cheap = Listening()
        history = (Turn(q="put it to the highest rate for usdc", a="how much?", at=0),)
        await classifier(answering=Stub(), labelling=cheap).classify("all my usdc", history)
        said = [str(message.content) for message in cheap.seen]
        assert "put it to the highest rate for usdc" in said
        assert "how much?" in said
        assert said[-1] == "all my usdc"

    async def test_an_older_conversation_is_not_dragged_along(self):
        cheap = Listening()
        history = tuple(Turn(q=f"q{n}", a=f"a{n}", at=n) for n in range(6))
        await classifier(answering=Stub(), labelling=cheap).classify("now what", history)
        said = " ".join(str(message.content) for message in cheap.seen)
        assert "q5" in said and "q4" in said
        assert "q3" not in said, "two turns of context, not the whole conversation"

    async def test_a_first_question_has_no_history_and_is_still_labelled(self):
        cheap = Listening(label="portfolio")
        label = await classifier(answering=Stub(), labelling=cheap).classify("how much do I have?")
        assert label.intent == "portfolio"
        assert len(cheap.seen) == 2, "the rules and the question, nothing else"
