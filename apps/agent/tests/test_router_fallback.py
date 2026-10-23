import logging

import pytest
from pydantic import ValidationError

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
        return IntentLabel(
            intent=self.label,
            reason="stubbed",
            stance="asking",
            language="English",
            risk="unknown",
            lp_range="unknown",
        )


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
    def test_the_word_has_to_be_said(self):
        with pytest.raises(ValidationError):
            IntentLabel(intent="earn", reason="r")

    def test_and_it_is_one_of_two_words(self):
        schema = IntentLabel.model_json_schema()
        required = {"reason", "language", "intent", "stance", "risk", "lp_range"}
        assert set(schema["required"]) == required
        stance = schema["$defs"]["Stance"]["enum"] if "$defs" in schema else None
        told = schema["properties"]["stance"]
        assert stance == ["asking", "placing"] or told.get("enum") == ["asking", "placing"]

    def test_the_model_is_told_which_is_which(self):
        told = IntentLabel.model_json_schema()["properties"]["stance"]["description"]
        assert "tells you to do something with money" in told
        assert "only name an amount" in told, "a reply to 'how much?' is still placing"
        assert "leaves the destination to you is still `placing`" in told, "not a question"
        assert "no default" in told


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
