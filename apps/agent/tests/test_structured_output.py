from typing import Literal

import pytest
from langchain_openai import ChatOpenAI
from pydantic import BaseModel

from app.agent.intent import IntentLabel
from app.agent.llm import structured
from app.agent.onboarding import ConfirmationDecision


class Shape(BaseModel):
    verdict: Literal["yes", "no"]


@pytest.fixture
def model():
    return ChatOpenAI(model="m", api_key="not-a-real-key", base_url="https://example.invalid")


def bound(runnable) -> dict:
    first = getattr(runnable, "first", runnable)
    return getattr(first, "kwargs", {})


class TestTheWayWeAsk:
    def test_the_schema_travels_as_a_tool(self, model):
        kwargs = bound(structured(model, Shape))
        assert "tools" in kwargs, "tools is the parameter every provider of ours supports"

    def test_and_not_as_a_response_format(self, model):
        assert "response_format" not in bound(structured(model, Shape))

    def test_the_model_is_left_no_choice_about_calling_it(self, model):
        kwargs = bound(structured(model, Shape))
        assert kwargs.get("tool_choice"), (
            "a label that the model may decline to give is not a label"
        )

    def test_the_library_default_is_still_the_narrow_one(self, model):
        assert "response_format" in bound(model.with_structured_output(Shape))


class TestWhatTheLabellerWritesFirst:
    def test_the_reason_is_asked_for_before_the_label(self):
        fields = list(IntentLabel.model_json_schema()["properties"])
        assert fields[0] == "reason", (
            "a model writes the schema in order, so a reason after the label "
            "is a justification of a choice already made"
        )
        assert fields.index("intent") < fields.index("stance")

    def test_the_same_holds_for_reading_a_yes(self):
        fields = list(ConfirmationDecision.model_json_schema()["properties"])
        assert fields[0] == "reason"

    def test_the_reason_says_it_is_the_thinking_and_not_a_note(self):
        said = IntentLabel.model_json_schema()["properties"]["reason"]["description"]
        assert "BEFORE" in said and "then label" in said
