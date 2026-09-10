"""How we ask a model to answer in a shape, and why the way matters.

Not a style question. There are two ways to ask and they reach different
numbers of providers: `json_schema` sends `response_format` and needs a
provider advertising `structured_outputs`; `function_calling` describes the
schema as a tool and needs `tools`.

Every provider of our models supports tools. Four of the answering model's
fifteen do not support structured outputs. That difference is invisible until
it meets `require_parameters` — and then it is a filter that emptied the list
and failed every classification in production.

The library's default is the narrow one, and it changed to that under us. So
the way we ask is pinned here rather than inherited.
"""
from typing import Literal

import pytest
from langchain_openai import ChatOpenAI
from pydantic import BaseModel

from app.agent.llm import structured


class Shape(BaseModel):
    verdict: Literal["yes", "no"]


@pytest.fixture
def model():
    # A client is built without ever calling anything; the key is a placeholder
    # so construction succeeds offline.
    return ChatOpenAI(model="m", api_key="not-a-real-key", base_url="https://example.invalid")


def bound(runnable) -> dict:
    """What the runnable will actually put in the request body."""
    first = getattr(runnable, "first", runnable)
    return getattr(first, "kwargs", {})


class TestTheWayWeAsk:
    def test_the_schema_travels_as_a_tool(self, model):
        kwargs = bound(structured(model, Shape))
        assert "tools" in kwargs, "tools is the parameter every provider of ours supports"

    def test_and_not_as_a_response_format(self, model):
        # response_format is the library's current default and needs
        # `structured_outputs`, which a quarter of our providers lack.
        assert "response_format" not in bound(structured(model, Shape))

    def test_the_model_is_left_no_choice_about_calling_it(self, model):
        kwargs = bound(structured(model, Shape))
        assert kwargs.get("tool_choice"), "a label that the model may decline to give is not a label"

    def test_the_library_default_is_still_the_narrow_one(self, model):
        # The reason this file exists. If this ever fails, the default moved and
        # `structured` may no longer need to override it — check which way it
        # moved before deleting anything.
        assert "response_format" in bound(model.with_structured_output(Shape))
