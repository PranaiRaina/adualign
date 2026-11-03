"""Shared service entrypoints for the ADU finance chatbot."""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass

from .calculator import (
    apply_manual_complication_selections,
    bootstrap_base_estimate,
    build_finance_presentation,
    hydrate_finance_state,
    recompute_adjusted_estimate,
)
from .citations import normalize_finance_chat_citations
from .config import CONSULTANT_ROUTE
from .graph import run_finance_consultant_graph, stream_finance_consultant_graph
from .schemas import (
    ChatMessage,
    FinancialChatResult,
    FinancialChatStreamEvent,
    ManualComplicationSelections,
    FinancePresentationInput,
    FinanceStateSnapshot,
)


@dataclass(frozen=True)
class FinancialChatExecutionContext:
    latest_message: str
    history: list[ChatMessage]
    finance_state: FinanceStateSnapshot
    presentation: FinancePresentationInput
    answer_safe_context: str | None
    report_synced: bool


async def run_financial_chat(
    *,
    messages: list[ChatMessage],
    address: str | None = None,
    county: str | None = None,
    adu_sqft: float | None = None,
    adu_width_ft: float | None = None,
    adu_length_ft: float | None = None,
    adu_type: str | None = None,
    adu_shape: str | None = None,
    fire_hazard_severity: str | None = None,
    fire_hazard_zone_type: str | None = None,
    answer_safe_context: str | None = None,
    project_id: str | None = None,
    current_user_id: str | None = None,
    stored_finance_state: dict | None = None,
) -> FinancialChatResult:
    context = build_financial_chat_execution_context(
        messages=messages,
        address=address,
        county=county,
        adu_sqft=adu_sqft,
        adu_width_ft=adu_width_ft,
        adu_length_ft=adu_length_ft,
        adu_type=adu_type,
        adu_shape=adu_shape,
        fire_hazard_severity=fire_hazard_severity,
        fire_hazard_zone_type=fire_hazard_zone_type,
        project_id=project_id,
        current_user_id=current_user_id,
        answer_safe_context=answer_safe_context,
        stored_finance_state=stored_finance_state,
    )

    consultant_result = await run_finance_consultant_graph(
        message=context.latest_message,
        history=context.history,
        finance_state=context.finance_state,
        presentation=context.presentation,
        answer_safe_context=context.answer_safe_context,
    )
    normalized_answer, normalized_sources = normalize_finance_chat_citations(
        consultant_result.answer,
        consultant_result.sources,
    )
    return build_financial_chat_result(
        answer=normalized_answer,
        sources=normalized_sources,
        suggested_questions=consultant_result.suggested_questions,
        context=context,
    )


async def stream_financial_chat(
    *,
    messages: list[ChatMessage],
    address: str | None = None,
    county: str | None = None,
    adu_sqft: float | None = None,
    adu_width_ft: float | None = None,
    adu_length_ft: float | None = None,
    adu_type: str | None = None,
    adu_shape: str | None = None,
    fire_hazard_severity: str | None = None,
    fire_hazard_zone_type: str | None = None,
    answer_safe_context: str | None = None,
    project_id: str | None = None,
    current_user_id: str | None = None,
    stored_finance_state: dict | None = None,
) -> AsyncIterator[FinancialChatStreamEvent]:
    context = build_financial_chat_execution_context(
        messages=messages,
        address=address,
        county=county,
        adu_sqft=adu_sqft,
        adu_width_ft=adu_width_ft,
        adu_length_ft=adu_length_ft,
        adu_type=adu_type,
        adu_shape=adu_shape,
        fire_hazard_severity=fire_hazard_severity,
        fire_hazard_zone_type=fire_hazard_zone_type,
        project_id=project_id,
        current_user_id=current_user_id,
        answer_safe_context=answer_safe_context,
        stored_finance_state=stored_finance_state,
    )
    yield FinancialChatStreamEvent(
        "finance_state",
        context.finance_state.model_dump(mode="json"),
    )

    consultant_result = None
    async for event in stream_finance_consultant_graph(
        message=context.latest_message,
        history=context.history,
        answer_safe_context=context.answer_safe_context,
        finance_state=context.finance_state,
        presentation=context.presentation,
    ):
        if event.event == "result":
            consultant_result = event.payload
            continue
        yield event

    if consultant_result is None:
        raise RuntimeError("Finance stream ended without a final result.")

    yield FinancialChatStreamEvent(
        "result",
        build_financial_chat_result(
            answer=consultant_result.answer,
            sources=consultant_result.sources,
            suggested_questions=consultant_result.suggested_questions,
            context=context,
        ),
    )


def calculate_finance_snapshot(
    *,
    address: str | None,
    county: str | None,
    adu_sqft: float | None,
    adu_type: str | None,
    fire_hazard_severity: str | None,
    fire_hazard_zone_type: str | None,
    stored_finance_state: dict | None,
    manual_complications: ManualComplicationSelections | None = None,
    adu_width_ft: float | None = None,
    adu_length_ft: float | None = None,
    adu_shape: str | None = None,
) -> tuple[FinanceStateSnapshot, FinancePresentationInput]:
    finance_state = build_finance_state(
        stored_finance_state=stored_finance_state,
        address=address,
        county=county,
        adu_sqft=adu_sqft,
        adu_width_ft=adu_width_ft,
        adu_length_ft=adu_length_ft,
        adu_type=adu_type,
        adu_shape=adu_shape,
        fire_hazard_severity=fire_hazard_severity,
        fire_hazard_zone_type=fire_hazard_zone_type,
        manual_complications=manual_complications,
    )
    presentation = build_finance_presentation(finance_state)
    return finance_state, presentation


def build_financial_chat_execution_context(
    *,
    messages: list[ChatMessage],
    address: str | None,
    county: str | None,
    adu_sqft: float | None,
    adu_type: str | None,
    fire_hazard_severity: str | None,
    fire_hazard_zone_type: str | None,
    project_id: str | None,
    current_user_id: str | None,
    answer_safe_context: str | None,
    stored_finance_state: dict | None,
    adu_width_ft: float | None = None,
    adu_length_ft: float | None = None,
    adu_shape: str | None = None,
) -> FinancialChatExecutionContext:
    latest_message, history = split_message_history(messages)
    finance_state, presentation = calculate_finance_snapshot(
        stored_finance_state=stored_finance_state,
        address=address,
        county=county,
        adu_sqft=adu_sqft,
        adu_width_ft=adu_width_ft,
        adu_length_ft=adu_length_ft,
        adu_type=adu_type,
        adu_shape=adu_shape,
        fire_hazard_severity=fire_hazard_severity,
        fire_hazard_zone_type=fire_hazard_zone_type,
    )
    return FinancialChatExecutionContext(
        latest_message=latest_message,
        history=history,
        finance_state=finance_state,
        presentation=presentation,
        answer_safe_context=answer_safe_context,
        report_synced=False,
    )


def build_finance_state(
    *,
    stored_finance_state: dict | None,
    address: str | None,
    county: str | None,
    adu_sqft: float | None,
    adu_type: str | None,
    fire_hazard_severity: str | None,
    fire_hazard_zone_type: str | None,
    manual_complications: ManualComplicationSelections | None = None,
    adu_width_ft: float | None = None,
    adu_length_ft: float | None = None,
    adu_shape: str | None = None,
) -> FinanceStateSnapshot:
    finance_state = hydrate_finance_state(
        stored_finance_state,
        address=address,
        county=county,
        adu_sqft=adu_sqft,
        adu_width_ft=adu_width_ft,
        adu_length_ft=adu_length_ft,
        adu_type=adu_type,
        adu_shape=adu_shape,
        fire_hazard_severity=fire_hazard_severity,
        fire_hazard_zone_type=fire_hazard_zone_type,
    )
    finance_state = bootstrap_base_estimate(finance_state)
    finance_state = apply_manual_complication_selections(
        finance_state,
        selections=manual_complications,
    )
    return recompute_adjusted_estimate(finance_state)


def split_message_history(messages: list[ChatMessage]) -> tuple[str, list[ChatMessage]]:
    if not messages:
        return "", []
    if messages[-1].role == "user":
        return messages[-1].content, messages[:-1]
    latest_user = next(
        (message for message in reversed(messages) if message.role == "user"), None
    )
    if latest_user is None:
        return "", messages
    latest_index = messages.index(latest_user)
    return latest_user.content, messages[:latest_index]


def build_financial_chat_result(
    *,
    answer: str,
    sources: list[dict],
    suggested_questions: list[str],
    context: FinancialChatExecutionContext,
) -> FinancialChatResult:
    return FinancialChatResult(
        answer=answer,
        sources=sources,
        suggested_questions=suggested_questions,
        finance_state=context.finance_state,
        presentation=context.presentation,
        report_synced=context.report_synced,
        route=CONSULTANT_ROUTE,
    )
