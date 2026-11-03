"""Live structured-output checks against deepseek-v4-flash on OpenRouter.

``build_chat_llm`` uses ``method="json_schema"`` for structured output, which
OpenRouter/deepseek supports via ``response_format``. These run only when
``OPENROUTER_API_KEY`` is set.
"""

import pytest
from pydantic import BaseModel

from api.llm import FAST, build_chat_llm
from api.utils import get_openrouter_key


class GradeResponse(BaseModel):
    relevant: bool


class RephraseResponse(BaseModel):
    query: str


@pytest.mark.skipif(not get_openrouter_key(), reason="OPENROUTER_API_KEY not set")
def test_openrouter_grader_structured_output():
    llm = build_chat_llm(
        tier=FAST, structured_output=GradeResponse, max_output_tokens=1000
    )
    result = llm.invoke(
        "Is this document relevant to the question? Answer JSON. "
        "QUESTION: What is an ADU? "
        "DOCUMENT: An ADU is an accessory dwelling unit."
    )
    assert isinstance(result, GradeResponse)
    assert result.relevant is True


@pytest.mark.skipif(not get_openrouter_key(), reason="OPENROUTER_API_KEY not set")
def test_openrouter_rephraser_structured_output():
    llm = build_chat_llm(
        tier=FAST, structured_output=RephraseResponse, max_output_tokens=500
    )
    result = llm.invoke(
        "Rephrase this question for a California ADU regulatory knowledge base. "
        "Question: What is an ADU?"
    )
    assert isinstance(result, RephraseResponse)
    assert len(result.query) > 0
