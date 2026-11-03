"""
Supabase PostgreSQL Repository for Projects, Reports, and Drafts.
Uses sync SQLAlchemy with the connection pooler.
"""

from __future__ import annotations
import datetime
import json
import uuid
from dataclasses import dataclass
from typing import Any, cast
from sqlalchemy import and_, case, func, or_, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload
from .models import (
    AdminUsageSettings,
    ChatUsage,
    ChatUsageLog,
    Draft,
    Listing,
    Project,
    Report,
    User,
    UserServiceBalance,
    UserServiceTransaction,
)
from .schemas import (
    ProjectCreate,
    ProjectUpdate,
    ReportUpdate,
    ReportVisible,
    ReportContext,
)
from api.rate_limiting.llm_pricing import DEFAULT_LLM_PROVIDER


# Route tag stamped on map property-search usage logs. Defined here (rather than
# in api.rate_limiting.map_search_usage) so this module stays import-free of the
# rate_limiting package, which imports from here.
MAP_SEARCH_ROUTE = "map_search"
SERVICE_TYPE_ADDRESS_ACCESS = "address_access"
SIGNUP_ADDRESS_CREDIT_AMOUNT = 35
ADMIN_USAGE_SETTINGS_ID = "global"
DEFAULT_GLOBAL_BUDGET_MICROS = 500_000
SERVICE_ACTOR_TYPES = frozenset({"user", "admin", "system", "webhook"})
SERVICE_TRANSACTION_REASONS = frozenset(
    {
        "purchase",
        "subscription_grant",
        "map_search_charge",
        "refund",
        "admin_adjustment",
        "signup_bonus",
    }
)
UTC_NOW = datetime.UTC
REPORT_INPUT_FIELDS = frozenset(
    {
        "address",
        "county",
        "property_area_sqft",
        "buildable_area_sqft",
        "setback_ft",
        "max_adu_sqft",
        "adu_sqft",
        "adu_width_ft",
        "adu_length_ft",
        "adu_type",
        "adu_shape",
        "primary_use",
        "blocker_types",
        "fire_hazard_severity",
        "fire_hazard_zone_type",
        "current_yard_zone",
        "adu_clearances",
        "finance_state",
    }
)


class ConflictError(Exception):
    """Raised when a delta update hits a version conflict."""

    pass


@dataclass(frozen=True)
class ServiceCreditMutationResult:
    balance: UserServiceBalance
    transaction: UserServiceTransaction
    applied: bool


@dataclass(frozen=True)
class AdminUsageSettingsValues:
    budget_micros: int
    usage_reset_interval_days: int | None


@dataclass(frozen=True)
class GlobalUsageSettingsMutation:
    settings: AdminUsageSettingsValues
    affected_user_count: int
    changed_user_count: int
    invalidated_api_key_hashes: list[str]


class ReportRepository:
    """Stateless repository — receives a sync DB session per call."""

    @staticmethod
    def _as_mutable(instance: object) -> Any:
        return cast(Any, instance)

    @staticmethod
    def _serialize_report_visible(visible: dict[str, Any] | None) -> dict[str, Any]:
        return ReportVisible(**(visible or {})).model_dump(mode="json")

    @staticmethod
    def _serialize_report_context(context: dict[str, Any] | None) -> dict[str, Any]:
        return ReportContext(**(context or {})).model_dump(mode="json")

    @staticmethod
    def _initial_project_status(_: ProjectCreate) -> str:
        return "project"

    @staticmethod
    def _project_report_inputs_changed(project: Any, updates: dict[str, Any]) -> bool:
        return any(
            field in REPORT_INPUT_FIELDS and getattr(project, field, None) != value
            for field, value in updates.items()
        )

    # ── Projects ──────────────────────────────────────────────────────────

    @staticmethod
    def create_project(
        db: Session,
        data: ProjectCreate,
        *,
        user_id: str,
    ) -> Project:
        project = ReportRepository._as_mutable(Project())
        project.user_id = user_id
        project.status = ReportRepository._initial_project_status(data)
        project.report_input_version = 1
        project.address = data.address
        project.county = data.county
        project.property_area_sqft = data.property_area_sqft
        project.buildable_area_sqft = data.buildable_area_sqft
        project.setback_ft = data.setback_ft
        project.max_adu_sqft = data.max_adu_sqft
        project.adu_sqft = data.adu_sqft
        project.adu_width_ft = data.adu_width_ft
        project.adu_length_ft = data.adu_length_ft
        project.adu_type = data.adu_type
        project.adu_shape = data.adu_shape
        project.home_sqft = data.home_sqft
        project.primary_use = data.primary_use
        project.blocker_types = data.blocker_types
        project.fire_hazard_severity = data.fire_hazard_severity
        project.fire_hazard_zone_type = data.fire_hazard_zone_type
        project.current_yard_zone = data.current_yard_zone
        project.adu_clearances = (
            [clearance.model_dump(mode="json") for clearance in data.adu_clearances]
            if data.adu_clearances
            else []
        )
        project.finance_state = data.finance_state
        project.map_snapshot = data.map_snapshot
        db.add(project)
        db.commit()
        db.refresh(project)
        return cast(Project, project)

    @staticmethod
    def get_project(
        db: Session,
        project_id: str,
        *,
        user_id: str | None = None,
    ) -> Project | None:
        query = (
            db.query(Project)
            .options(selectinload(Project.report), selectinload(Project.draft))
            .filter(Project.id == project_id)
        )
        if user_id is not None:
            query = query.filter(Project.user_id == user_id)
        return query.first()

    @staticmethod
    def list_projects(
        db: Session,
        *,
        user_id: str,
        limit: int = 50,
        offset: int = 0,
    ) -> list[Project]:
        return (
            db.query(Project)
            .options(selectinload(Project.report), selectinload(Project.draft))
            .filter(Project.user_id == user_id)
            .order_by(Project.created_at.desc())
            .limit(limit)
            .offset(offset)
            .all()
        )

    @staticmethod
    def update_project(
        db: Session,
        project_id: str,
        data: ProjectUpdate,
        *,
        user_id: str | None = None,
    ) -> Project | None:
        query = db.query(Project).filter(Project.id == project_id)
        if user_id is not None:
            query = query.filter(Project.user_id == user_id)
        project = cast(Any, query.first())
        if not project:
            return None

        update_data = data.model_dump(exclude_unset=True)
        report_inputs_changed = ReportRepository._project_report_inputs_changed(
            project, update_data
        )
        for field, value in update_data.items():
            setattr(project, field, value)

        if report_inputs_changed:
            project.report_input_version = int(project.report_input_version or 1) + 1

        project.updated_at = datetime.datetime.utcnow()
        db.commit()
        db.refresh(project)
        return cast(Project, project)

    @staticmethod
    def update_project_status(
        db: Session,
        project_id: str,
        status: str,
    ) -> Project | None:
        project = cast(Any, db.query(Project).filter(Project.id == project_id).first())
        if not project:
            return None
        project.status = status
        project.updated_at = datetime.datetime.utcnow()
        db.commit()
        db.refresh(project)
        return cast(Project, project)

    @staticmethod
    def update_project_finance_state(
        db: Session,
        project_id: str,
        finance_state: dict[str, Any],
        *,
        user_id: str | None = None,
    ) -> Project | None:
        query = db.query(Project).filter(Project.id == project_id)
        if user_id is not None:
            query = query.filter(Project.user_id == user_id)
        project = cast(Any, query.first())
        if not project:
            return None
        if project.finance_state != finance_state:
            project.report_input_version = int(project.report_input_version or 1) + 1
        project.finance_state = finance_state
        if finance_state and project.status in {"new", "draft", "project"}:
            project.status = "project"
        project.updated_at = datetime.datetime.utcnow()
        db.commit()
        db.refresh(project)
        return cast(Project, project)

    @staticmethod
    def delete_project(
        db: Session,
        project_id: str,
        *,
        user_id: str | None = None,
    ) -> bool:
        query = db.query(Project).filter(Project.id == project_id)
        if user_id is not None:
            query = query.filter(Project.user_id == user_id)
        project = query.first()
        if not project:
            return False
        db.query(Listing).filter(Listing.project_id == project_id).delete()
        db.query(Draft).filter(Draft.project_id == project_id).delete()
        db.delete(project)
        db.commit()
        return True

    @staticmethod
    def delete_abandoned_drafts(
        db: Session,
        *,
        older_than: datetime.datetime,
        limit: int = 500,
    ) -> list[str]:
        """Delete empty click-created draft shells older than the cutoff.

        A project shell is treated as abandoned only when it carries no report, no draft
        listing and no finance state. Returns the
        ids that were removed.
        """
        candidates = (
            db.query(Project)
            .filter(
                Project.status.in_(("draft", "project")),
                Project.created_at < older_than,
                ~Project.report.has(),
                ~Project.draft.has(),
            )
            .limit(limit)
            .all()
        )

        deleted_ids: list[str] = []
        for project in candidates:
            mutable = cast(Any, project)
            if mutable.finance_state:
                continue
            deleted_ids.append(cast(str, mutable.id))
            db.delete(project)

        if deleted_ids:
            db.commit()
        return deleted_ids

    # ── Reports ───────────────────────────────────────────────────────────

    @staticmethod
    def create_report(
        db: Session,
        project_id: str,
        *,
        visible: dict[str, Any] | None = None,
        context: dict[str, Any] | None = None,
    ) -> Report:
        vis = ReportRepository._serialize_report_visible(visible)
        ctx = ReportRepository._serialize_report_context(context)

        report = ReportRepository._as_mutable(Report())
        report.project_id = project_id
        report.version = 1
        project = db.query(Project).filter(Project.id == project_id).first()
        if project is None:
            raise ValueError(f"No project found for report {project_id}")
        report.source_project_version = int(
            cast(Any, project).report_input_version or 1
        )
        report.visible = vis
        report.context = ctx
        db.add(report)

        db.commit()
        db.refresh(report)
        return cast(Report, report)

    @staticmethod
    def get_report_by_project(
        db: Session,
        project_id: str,
        *,
        user_id: str | None = None,
    ) -> Report | None:
        query = db.query(Report).filter(Report.project_id == project_id)
        if user_id is not None:
            query = query.join(Project, Report.project_id == Project.id).filter(
                Project.user_id == user_id
            )
        return query.first()

    @staticmethod
    def delta_update(
        db: Session,
        project_id: str,
        update: ReportUpdate,
        *,
        expected_version: int | None = None,
        source_project_version: int | None = None,
        user_id: str | None = None,
    ) -> Report:
        report = ReportRepository.get_report_by_project(
            db,
            project_id,
            user_id=user_id,
        )
        if report is None:
            raise ValueError(f"No report found for project {project_id}")

        report_mut = ReportRepository._as_mutable(report)

        if expected_version is not None and int(report_mut.version) > expected_version:
            raise ConflictError(
                f"Report version conflict: stored v{report_mut.version} > expected v{expected_version}"
            )

        if update.visible:
            current_visible = dict(report_mut.visible or {})
            current_visible.update(update.visible)
            report_mut.visible = ReportRepository._serialize_report_visible(
                current_visible
            )

        if update.context:
            current_context = dict(report_mut.context or {})
            for key, value in update.context.items():
                current_context[key] = value
            report_mut.context = ReportRepository._serialize_report_context(
                current_context
            )

        report_mut.version = int(report_mut.version) + 1
        if source_project_version is not None:
            report_mut.source_project_version = source_project_version
        report_mut.last_modified = datetime.datetime.utcnow()
        db.commit()
        db.refresh(report)
        return report

    @staticmethod
    def replace_generated_report(
        db: Session,
        project_id: str,
        update: ReportUpdate,
        *,
        source_project_version: int,
        expected_report_version: int | None = None,
        user_id: str | None = None,
    ) -> Report:
        project = ReportRepository.get_project(db, project_id, user_id=user_id)
        if project is None:
            raise ValueError(f"No project found for report {project_id}")
        if int(cast(Any, project).report_input_version or 1) != source_project_version:
            raise ConflictError("Project changed during report generation")

        report = ReportRepository.delta_update(
            db,
            project_id,
            update,
            expected_version=expected_report_version,
            source_project_version=source_project_version,
            user_id=user_id,
        )
        return report

    @staticmethod
    def delete_report(
        db: Session,
        project_id: str,
        *,
        user_id: str | None = None,
    ) -> bool:
        report = ReportRepository.get_report_by_project(
            db,
            project_id,
            user_id=user_id,
        )
        if not report:
            return False
        db.delete(report)
        db.commit()
        return True

    # ── Drafts ────────────────────────────────────────────────────────────

    @staticmethod
    def create_draft(
        db: Session,
        project_id: str,
        seller_id: str,
        draft_payload: dict[str, Any],
        field_meta: dict[str, Any],
    ) -> Draft:
        draft = ReportRepository._as_mutable(Draft())
        draft.project_id = project_id
        draft.seller_id = seller_id
        draft.version = 1
        draft.draft_payload = draft_payload
        draft.field_meta = field_meta
        db.add(draft)

        ReportRepository.update_project_status(db, project_id, "project")

        db.commit()
        db.refresh(draft)
        return cast(Draft, draft)

    @staticmethod
    def get_draft_by_project(
        db: Session,
        project_id: str,
    ) -> Draft | None:
        return db.query(Draft).filter(Draft.project_id == project_id).first()

    @staticmethod
    def upsert_draft(
        db: Session,
        project_id: str,
        seller_id: str,
        draft_payload: dict[str, Any],
        field_meta: dict[str, Any],
    ) -> Draft:
        existing = ReportRepository.get_draft_by_project(db, project_id)
        if existing:
            existing_mut = ReportRepository._as_mutable(existing)
            existing_mut.draft_payload = draft_payload
            existing_mut.field_meta = field_meta
            existing_mut.version = int(existing_mut.version) + 1
            existing_mut.updated_at = datetime.datetime.utcnow()
            db.commit()
            db.refresh(existing)
            return existing
        return ReportRepository.create_draft(
            db, project_id, seller_id, draft_payload, field_meta
        )

    @staticmethod
    def delete_draft(
        db: Session,
        project_id: str,
    ) -> bool:
        draft = ReportRepository.get_draft_by_project(db, project_id)
        if not draft:
            return False
        db.delete(draft)

        project = cast(
            Any,
            db.query(Project).filter(Project.id == project_id).first(),
        )
        if project:
            project.status = "project"
            project.updated_at = datetime.datetime.utcnow()

        db.commit()
        return True


class RateLimitRepository:
    """Stateless repository for chat usage budgets and ledger events."""

    @staticmethod
    def get_admin_usage_settings(db: Session) -> AdminUsageSettingsValues:
        settings_row = (
            db.query(AdminUsageSettings)
            .filter(AdminUsageSettings.id == ADMIN_USAGE_SETTINGS_ID)
            .first()
        )
        if settings_row is None:
            return AdminUsageSettingsValues(
                budget_micros=DEFAULT_GLOBAL_BUDGET_MICROS,
                usage_reset_interval_days=None,
            )
        settings = ReportRepository._as_mutable(settings_row)
        return AdminUsageSettingsValues(
            budget_micros=int(settings.default_budget_micros),
            usage_reset_interval_days=settings.default_usage_reset_interval_days,
        )

    @staticmethod
    def apply_global_usage_settings(
        db: Session,
        *,
        update_budget: bool,
        budget_micros: int | None,
        update_usage_reset_interval: bool,
        usage_reset_interval_days: int | None,
        actor_id: str | None = None,
    ) -> GlobalUsageSettingsMutation:
        settings = ReportRepository._as_mutable(
            RateLimitRepository._get_or_create_admin_usage_settings(db)
        )
        if update_budget:
            settings.default_budget_micros = int(budget_micros or 0)
        if update_usage_reset_interval:
            settings.default_usage_reset_interval_days = usage_reset_interval_days
        settings.updated_at = datetime.datetime.now(datetime.UTC)
        settings.updated_by_actor_id = actor_id

        active_rows = (
            db.query(ChatUsage)
            .filter(ChatUsage.is_active.is_(True))
            .with_for_update()
            .all()
        )
        changed_user_count = 0
        for chat_usage in active_rows:
            if RateLimitRepository._apply_global_settings_to_row(
                db,
                chat_usage,
                update_budget=update_budget,
                budget_micros=budget_micros,
                update_usage_reset_interval=update_usage_reset_interval,
                usage_reset_interval_days=usage_reset_interval_days,
                actor_id=actor_id,
            ):
                changed_user_count += 1

        db.commit()
        return GlobalUsageSettingsMutation(
            settings=AdminUsageSettingsValues(
                budget_micros=int(settings.default_budget_micros),
                usage_reset_interval_days=settings.default_usage_reset_interval_days,
            ),
            affected_user_count=len(active_rows),
            changed_user_count=changed_user_count,
            invalidated_api_key_hashes=[
                str(row.api_key_hash) for row in active_rows if update_budget
            ],
        )

    @staticmethod
    def _get_or_create_admin_usage_settings(db: Session) -> AdminUsageSettings:
        settings = (
            db.query(AdminUsageSettings)
            .filter(AdminUsageSettings.id == ADMIN_USAGE_SETTINGS_ID)
            .first()
        )
        if settings is not None:
            return settings

        settings = ReportRepository._as_mutable(AdminUsageSettings())
        settings.id = ADMIN_USAGE_SETTINGS_ID
        settings.default_budget_micros = DEFAULT_GLOBAL_BUDGET_MICROS
        settings.default_usage_reset_interval_days = None
        db.add(settings)
        db.flush()
        return cast(AdminUsageSettings, settings)

    @staticmethod
    def _apply_global_settings_to_row(
        db: Session,
        chat_usage: ChatUsage,
        *,
        update_budget: bool,
        budget_micros: int | None,
        update_usage_reset_interval: bool,
        usage_reset_interval_days: int | None,
        actor_id: str | None,
    ) -> bool:
        usage_mut = ReportRepository._as_mutable(chat_usage)
        changed = False
        metadata: dict[str, Any] = {"changes": {}}
        if update_budget and int(usage_mut.budget_micros or 0) != int(
            budget_micros or 0
        ):
            metadata["changes"]["budget_micros"] = {
                "before": int(usage_mut.budget_micros or 0),
                "after": int(budget_micros or 0),
            }
            usage_mut.budget_micros = int(budget_micros or 0)
            usage_mut.budget_currency = "USD"
            changed = True
        if (
            update_usage_reset_interval
            and usage_mut.usage_reset_interval_days != usage_reset_interval_days
        ):
            metadata["changes"]["usage_reset_interval_days"] = {
                "before": usage_mut.usage_reset_interval_days,
                "after": usage_reset_interval_days,
            }
            usage_mut.usage_reset_interval_days = usage_reset_interval_days
            changed = True
        if not changed:
            return False

        usage_mut.updated_at = datetime.datetime.now(datetime.UTC)
        usage_mut.updated_by_actor_type = "admin"
        usage_mut.updated_by_actor_id = actor_id
        usage_mut.updated_reason = "global_usage_settings_update"
        db.add(
            RateLimitRepository._new_accounting_log(
                chat_usage,
                event_type="global_usage_settings_update",
                delta_micros=0,
                actor_type="admin",
                actor_id=actor_id,
                reason="global_usage_settings_update",
                metadata=metadata,
            )
        )
        return True

    @staticmethod
    def get_chat_usage_by_hash(db: Session, api_key_hash: str) -> ChatUsage | None:
        return (
            db.query(ChatUsage)
            .filter(
                ChatUsage.api_key_hash == api_key_hash,
                ChatUsage.is_active.is_(True),
            )
            .first()
        )

    get_api_key_by_hash = get_chat_usage_by_hash

    @staticmethod
    def get_chat_usage_by_user_id(db: Session, user_id: str) -> ChatUsage | None:
        return RateLimitRepository._get_active_chat_usage(db, user_id)

    get_api_key_by_user_id = get_chat_usage_by_user_id

    @staticmethod
    def update_chat_usage_budget_config(
        db: Session,
        chat_usage: ChatUsage,
        *,
        budget_micros: int,
        budget_currency: str = "USD",
    ) -> ChatUsage:
        usage_mut = ReportRepository._as_mutable(chat_usage)
        usage_mut.budget_micros = budget_micros
        usage_mut.budget_currency = budget_currency
        usage_mut.updated_at = datetime.datetime.now(datetime.UTC)
        usage_mut.updated_by_actor_type = "system"
        usage_mut.updated_reason = "budget_config_normalized"
        db.commit()
        db.refresh(chat_usage)
        return chat_usage

    @staticmethod
    def update_api_key_budget_config(
        db: Session,
        api_key: ChatUsage,
        *,
        budget_micros: int,
        budget_period: str | None = None,
        budget_currency: str = "USD",
    ) -> ChatUsage:
        return RateLimitRepository.update_chat_usage_budget_config(
            db,
            api_key,
            budget_micros=budget_micros,
            budget_currency=budget_currency,
        )

    @staticmethod
    def log_token_usage(
        db: Session,
        chat_usage_id: str,
        tokens_used: int,
        model: str,
        request_id: str,
        *,
        cost_micros: int = 0,
        prompt_tokens: int | None = None,
        completion_tokens: int | None = None,
        total_tokens: int | None = None,
        cached_tokens: int = 0,
        provider: str = DEFAULT_LLM_PROVIDER,
        route: str | None = None,
        source: str | None = None,
        is_estimated: bool = False,
        stream_terminated_early: bool = False,
    ) -> ChatUsageLog:
        chat_usage = (
            db.query(ChatUsage)
            .filter(ChatUsage.id == chat_usage_id)
            .with_for_update()
            .one()
        )
        usage_mut = ReportRepository._as_mutable(chat_usage)
        applied_micros = 0 if route == MAP_SEARCH_ROUTE else int(cost_micros)
        usage_mut.used_micros = max(0, int(usage_mut.used_micros or 0)) + applied_micros
        usage_mut.updated_at = datetime.datetime.now(datetime.UTC)
        usage_mut.updated_by_actor_type = "usage_meter"
        usage_mut.updated_by_actor_id = request_id
        usage_mut.updated_reason = "chat_usage"

        log = RateLimitRepository._new_usage_log(
            chat_usage,
            tokens_used=tokens_used,
            model=model,
            request_id=request_id,
            cost_micros=cost_micros,
            delta_micros=applied_micros,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            cached_tokens=cached_tokens,
            provider=provider,
            route=route,
            source=source,
            is_estimated=is_estimated,
            stream_terminated_early=stream_terminated_early,
        )
        db.add(log)
        db.commit()
        db.refresh(log)
        return cast(ChatUsageLog, log)

    @staticmethod
    def _new_usage_log(
        chat_usage: ChatUsage,
        *,
        tokens_used: int,
        model: str,
        request_id: str,
        cost_micros: int,
        delta_micros: int,
        prompt_tokens: int | None,
        completion_tokens: int | None,
        total_tokens: int | None,
        cached_tokens: int,
        provider: str,
        route: str | None,
        source: str | None,
        is_estimated: bool,
        stream_terminated_early: bool,
    ) -> ChatUsageLog:
        log = ReportRepository._as_mutable(ChatUsageLog())
        log.chat_usage_id = chat_usage.id
        log.user_id = chat_usage.user_id
        log.event_type = "usage"
        log.delta_micros = int(delta_micros)
        log.cost_micros = int(cost_micros)
        log.used_micros_after = int(chat_usage.used_micros or 0)
        log.budget_micros_after = int(chat_usage.budget_micros or 0)
        log.tokens_used = tokens_used
        log.prompt_tokens = prompt_tokens
        log.completion_tokens = completion_tokens
        log.total_tokens = total_tokens if total_tokens is not None else tokens_used
        log.cached_tokens = cached_tokens
        log.provider = provider
        log.route = route
        log.source = source
        log.is_estimated = is_estimated
        log.stream_terminated_early = stream_terminated_early
        log.model = model
        log.request_id = request_id
        log.actor_type = "usage_meter"
        log.actor_id = request_id
        log.reason = "chat_usage"
        return cast(ChatUsageLog, log)

    @staticmethod
    def has_usage_log_for_user_request(
        db: Session,
        *,
        user_id: str,
        request_id: str,
        route: str,
    ) -> bool:
        return (
            db.query(ChatUsageLog.id)
            .join(ChatUsage, ChatUsageLog.chat_usage_id == ChatUsage.id)
            .filter(
                ChatUsage.user_id == user_id,
                ChatUsageLog.request_id == request_id,
                ChatUsageLog.route == route,
            )
            .first()
            is not None
        )

    @staticmethod
    def create_chat_usage(
        db: Session,
        user_id: str,
        api_key_hash: str,
        *,
        budget_micros: int,
        usage_reset_interval_days: int | None = None,
        name: str | None = None,
        budget_currency: str = "USD",
    ) -> ChatUsage:
        db.query(User).filter(User.id == user_id).with_for_update().one()

        existing_active = RateLimitRepository._get_active_chat_usage(db, user_id)
        if existing_active is not None:
            return existing_active

        (
            db.query(ChatUsage)
            .filter(ChatUsage.user_id == user_id, ChatUsage.is_active.is_(True))
            .update({"is_active": False}, synchronize_session=False)
        )
        chat_usage = ReportRepository._as_mutable(ChatUsage())
        chat_usage.user_id = user_id
        chat_usage.api_key_hash = api_key_hash
        chat_usage.budget_micros = budget_micros
        chat_usage.budget_currency = budget_currency
        chat_usage.used_micros = 0
        chat_usage.usage_reset_interval_days = usage_reset_interval_days
        chat_usage.name = name
        chat_usage.updated_by_actor_type = "system"
        chat_usage.updated_reason = "chat_usage_created"
        db.add(chat_usage)
        db.commit()
        db.refresh(chat_usage)
        return cast(ChatUsage, chat_usage)

    @staticmethod
    def create_api_key(
        db: Session,
        user_id: str,
        api_key_hash: str,
        *,
        budget_micros: int,
        budget_period: str | None = None,
        usage_reset_interval_days: int | None = None,
        name: str | None = None,
        budget_currency: str = "USD",
    ) -> ChatUsage:
        return RateLimitRepository.create_chat_usage(
            db,
            user_id,
            api_key_hash,
            budget_micros=budget_micros,
            usage_reset_interval_days=usage_reset_interval_days,
            name=name,
            budget_currency=budget_currency,
        )

    @staticmethod
    def get_period_usage_totals_for_user(
        db: Session,
        *,
        user_id: str,
        period: str | None = None,
        now: datetime.datetime | None = None,
        reset_at: datetime.datetime | None = None,
    ) -> dict[str, int]:
        chat_usage = RateLimitRepository._get_active_chat_usage(db, user_id)
        if chat_usage is None:
            return {
                "tokens_used": 0,
                "prompt_tokens_used": 0,
                "completion_tokens_used": 0,
                "total_tokens_used": 0,
                "cost_used_micros": 0,
                "map_search_count": 0,
            }

        window_start = reset_at or chat_usage.last_reset_at
        filters = [ChatUsageLog.chat_usage_id == chat_usage.id]
        if window_start is not None:
            filters.append(ChatUsageLog.created_at >= window_start)

        row = (
            db.query(
                func.coalesce(func.sum(ChatUsageLog.tokens_used), 0),
                func.coalesce(func.sum(ChatUsageLog.prompt_tokens), 0),
                func.coalesce(func.sum(ChatUsageLog.completion_tokens), 0),
                func.coalesce(func.sum(ChatUsageLog.total_tokens), 0),
                func.coalesce(
                    func.sum(
                        case((ChatUsageLog.route == MAP_SEARCH_ROUTE, 1), else_=0)
                    ),
                    0,
                ),
            )
            .filter(*filters)
            .one()
        )
        return {
            "tokens_used": int(row[0] or 0),
            "prompt_tokens_used": int(row[1] or 0),
            "completion_tokens_used": int(row[2] or 0),
            "total_tokens_used": int(row[3] or 0),
            "cost_used_micros": (
                max(0, int(chat_usage.used_micros or 0)) if chat_usage else 0
            ),
            "map_search_count": int(row[4] or 0),
        }

    @staticmethod
    def get_effective_cost_used_micros(db: Session, *, api_key_id: str) -> int:
        chat_usage = db.query(ChatUsage).filter(ChatUsage.id == api_key_id).first()
        if chat_usage is None:
            return 0
        return max(0, int(chat_usage.used_micros or 0))

    @staticmethod
    def _get_active_chat_usage(db: Session, user_id: str) -> ChatUsage | None:
        return (
            db.query(ChatUsage)
            .filter(ChatUsage.user_id == user_id, ChatUsage.is_active.is_(True))
            .order_by(ChatUsage.created_at.desc(), ChatUsage.id.desc())
            .first()
        )

    @staticmethod
    def _active_usage_log_join_condition():
        return and_(
            ChatUsageLog.chat_usage_id == ChatUsage.id,
            or_(
                ChatUsage.last_reset_at.is_(None),
                ChatUsageLog.created_at >= ChatUsage.last_reset_at,
            ),
        )

    @staticmethod
    def set_usage_reset_marker(
        db: Session,
        *,
        user_id: str,
        reset_at: datetime.datetime | None = None,
        actor_type: str = "system",
        actor_id: str | None = None,
    ) -> ChatUsage | None:
        reset_at = reset_at or datetime.datetime.now(datetime.UTC)
        chat_usage = RateLimitRepository._get_active_chat_usage(db, user_id)
        if chat_usage is None:
            return None

        usage_mut = ReportRepository._as_mutable(chat_usage)
        previous_used_micros = int(usage_mut.used_micros or 0)
        usage_mut.used_micros = 0
        usage_mut.last_reset_at = reset_at
        usage_mut.updated_at = reset_at
        usage_mut.updated_by_actor_type = actor_type
        usage_mut.updated_by_actor_id = actor_id
        usage_mut.updated_reason = "usage_reset"

        log = RateLimitRepository._new_accounting_log(
            chat_usage,
            event_type="usage_reset",
            delta_micros=-previous_used_micros,
            actor_type=actor_type,
            actor_id=actor_id,
            reason="usage_reset",
        )
        db.add(log)
        db.commit()
        db.refresh(chat_usage)
        return cast(ChatUsage, chat_usage)

    @staticmethod
    def list_due_chat_usage_resets(
        db: Session,
        *,
        now: datetime.datetime,
        limit: int,
    ) -> list[ChatUsage]:
        eligible_rows = (
            db.query(ChatUsage)
            .filter(
                ChatUsage.is_active.is_(True),
                ChatUsage.usage_reset_interval_days.is_not(None),
                ChatUsage.usage_reset_interval_days > 0,
            )
            .order_by(ChatUsage.created_at.asc(), ChatUsage.id.asc())
            .yield_per(1000)
        )
        due_rows: list[ChatUsage] = []
        for chat_usage in eligible_rows:
            if not RateLimitRepository.is_chat_usage_reset_due(chat_usage, now=now):
                continue
            due_rows.append(chat_usage)
            if len(due_rows) >= limit:
                break
        return due_rows

    @staticmethod
    def is_chat_usage_reset_due(
        chat_usage: ChatUsage,
        *,
        now: datetime.datetime,
    ) -> bool:
        interval_days = getattr(chat_usage, "usage_reset_interval_days", None)
        if not interval_days or int(interval_days) <= 0:
            return False

        anchor = cast(
            datetime.datetime | None,
            chat_usage.last_reset_at or chat_usage.created_at,
        )
        if anchor is None:
            return False

        due_at = RateLimitRepository._as_utc(anchor) + datetime.timedelta(
            days=int(interval_days)
        )
        return RateLimitRepository._as_utc(now) >= due_at

    @staticmethod
    def reset_chat_usage_if_due(
        db: Session,
        *,
        chat_usage: ChatUsage,
        reset_at: datetime.datetime,
        actor_type: str = "system",
        actor_id: str | None = None,
    ) -> ChatUsage | None:
        if not RateLimitRepository.is_chat_usage_reset_due(
            chat_usage,
            now=reset_at,
        ):
            return None

        usage_mut = ReportRepository._as_mutable(chat_usage)
        previous_used_micros = int(usage_mut.used_micros or 0)
        usage_mut.used_micros = 0
        usage_mut.last_reset_at = reset_at
        usage_mut.updated_at = reset_at
        usage_mut.updated_by_actor_type = actor_type
        usage_mut.updated_by_actor_id = actor_id
        usage_mut.updated_reason = "usage_reset"

        db.add(
            RateLimitRepository._new_accounting_log(
                chat_usage,
                event_type="usage_reset",
                delta_micros=-previous_used_micros,
                actor_type=actor_type,
                actor_id=actor_id,
                reason="usage_reset",
            )
        )
        db.commit()
        db.refresh(chat_usage)
        return cast(ChatUsage, chat_usage)

    @staticmethod
    def _as_utc(value: datetime.datetime) -> datetime.datetime:
        if value.tzinfo is None:
            return value.replace(tzinfo=datetime.UTC)
        return value.astimezone(datetime.UTC)

    @staticmethod
    def _new_accounting_log(
        chat_usage: ChatUsage,
        *,
        event_type: str,
        delta_micros: int,
        actor_type: str,
        actor_id: str | None,
        reason: str,
        metadata: dict[str, Any] | None = None,
    ) -> ChatUsageLog:
        log = ReportRepository._as_mutable(ChatUsageLog())
        log.chat_usage_id = chat_usage.id
        log.user_id = chat_usage.user_id
        log.event_type = event_type
        log.delta_micros = delta_micros
        log.cost_micros = 0
        log.used_micros_after = int(chat_usage.used_micros or 0)
        log.budget_micros_after = int(chat_usage.budget_micros or 0)
        log.actor_type = actor_type
        log.actor_id = actor_id
        log.reason = reason
        log.metadata_json = metadata
        return cast(ChatUsageLog, log)

    @staticmethod
    def set_user_budget_micros(
        db: Session,
        *,
        user_id: str,
        budget_micros: int,
        actor_type: str = "system",
        actor_id: str | None = None,
    ) -> ChatUsage | None:
        chat_usage = RateLimitRepository._get_active_chat_usage(db, user_id)
        if chat_usage is None:
            return None

        usage_mut = ReportRepository._as_mutable(chat_usage)
        usage_mut.budget_micros = int(budget_micros)
        usage_mut.budget_currency = "USD"
        usage_mut.updated_at = datetime.datetime.now(datetime.UTC)
        usage_mut.updated_by_actor_type = actor_type
        usage_mut.updated_by_actor_id = actor_id
        usage_mut.updated_reason = "budget_update"

        db.add(
            RateLimitRepository._new_accounting_log(
                chat_usage,
                event_type="budget_update",
                delta_micros=0,
                actor_type=actor_type,
                actor_id=actor_id,
                reason="budget_update",
            )
        )
        db.commit()
        db.refresh(chat_usage)
        return cast(ChatUsage, chat_usage)

    @staticmethod
    def list_user_usage_overview(
        db: Session,
        *,
        now: datetime.datetime | None = None,
        limit: int = 1000,
    ) -> list[dict[str, Any]]:
        tokens_used = func.coalesce(
            func.sum(
                func.coalesce(ChatUsageLog.total_tokens, ChatUsageLog.tokens_used)
            ),
            0,
        ).label("total_tokens_used")
        map_search_count = func.coalesce(
            func.sum(case((ChatUsageLog.route == MAP_SEARCH_ROUTE, 1), else_=0)),
            0,
        ).label("map_search_count")
        no_budget_last = case((ChatUsage.budget_micros.is_(None), 1), else_=0).label(
            "no_budget_last"
        )

        rows = (
            db.query(
                User.id.label("id"),
                User.email.label("email"),
                User.name.label("name"),
                User.created_at.label("created_at"),
                ChatUsage.budget_micros.label("budget_micros"),
                ChatUsage.used_micros.label("cost_used_micros"),
                tokens_used,
                map_search_count,
            )
            .outerjoin(
                ChatUsage,
                and_(ChatUsage.user_id == User.id, ChatUsage.is_active.is_(True)),
            )
            .outerjoin(
                ChatUsageLog,
                RateLimitRepository._active_usage_log_join_condition(),
            )
            .group_by(
                User.id,
                User.email,
                User.name,
                User.created_at,
                ChatUsage.budget_micros,
                ChatUsage.used_micros,
            )
            .order_by(
                no_budget_last.asc(),
                ChatUsage.used_micros.desc().nullslast(),
                User.created_at.desc(),
                User.id.asc(),
            )
            .limit(limit)
            .all()
        )
        return [dict(row._mapping) for row in rows]


class ServiceCreditRepository:
    """Repository for user-scoped consumable service balances and ledger rows."""

    @staticmethod
    def _validate_service_type(service_type: str) -> str:
        if service_type != SERVICE_TYPE_ADDRESS_ACCESS:
            raise ValueError(f"Unsupported service_type: {service_type}")
        return service_type

    @staticmethod
    def _validate_actor_type(actor_type: str) -> str:
        if actor_type not in SERVICE_ACTOR_TYPES:
            raise ValueError(f"Unsupported actor_type: {actor_type}")
        return actor_type

    @staticmethod
    def _validate_reason(reason: str) -> str:
        if reason not in SERVICE_TRANSACTION_REASONS:
            raise ValueError(f"Unsupported reason: {reason}")
        return reason

    @staticmethod
    def get_balance(
        db: Session, *, user_id: str, service_type: str
    ) -> UserServiceBalance | None:
        ServiceCreditRepository._validate_service_type(service_type)
        return (
            db.query(UserServiceBalance)
            .filter(
                UserServiceBalance.user_id == user_id,
                UserServiceBalance.service_type == service_type,
            )
            .first()
        )

    @staticmethod
    def get_transaction_by_idempotency_key(
        db: Session, *, idempotency_key: str
    ) -> UserServiceTransaction | None:
        return (
            db.query(UserServiceTransaction)
            .filter(UserServiceTransaction.idempotency_key == idempotency_key)
            .first()
        )

    @staticmethod
    def list_balances_by_user_id(db: Session, *, service_type: str) -> dict[str, int]:
        ServiceCreditRepository._validate_service_type(service_type)
        rows = (
            db.query(UserServiceBalance.user_id, UserServiceBalance.balance)
            .filter(UserServiceBalance.service_type == service_type)
            .all()
        )
        return {str(user_id): int(balance) for user_id, balance in rows}

    @staticmethod
    def list_recent_transactions(
        db: Session,
        *,
        user_id: str,
        service_type: str,
        limit: int,
    ) -> list[UserServiceTransaction]:
        ServiceCreditRepository._validate_service_type(service_type)
        return cast(
            list[UserServiceTransaction],
            db.query(UserServiceTransaction)
            .filter(
                UserServiceTransaction.user_id == user_id,
                UserServiceTransaction.service_type == service_type,
            )
            .order_by(
                UserServiceTransaction.created_at.desc(),
                UserServiceTransaction.transaction_id.desc(),
            )
            .limit(limit)
            .all(),
        )

    @staticmethod
    def list_map_search_counts_by_user_id(db: Session) -> dict[str, int]:
        rows = (
            db.query(
                UserServiceTransaction.user_id,
                func.count(UserServiceTransaction.transaction_id),
            )
            .filter(
                UserServiceTransaction.service_type == SERVICE_TYPE_ADDRESS_ACCESS,
                UserServiceTransaction.reason == "map_search_charge",
                UserServiceTransaction.delta < 0,
            )
            .group_by(UserServiceTransaction.user_id)
            .all()
        )
        return {str(user_id): int(count) for user_id, count in rows}

    @staticmethod
    def grant_signup_credits(
        db: Session, *, user_id: str
    ) -> ServiceCreditMutationResult:
        idempotency_key = f"signup_bonus:{user_id}:v1"
        existing_result = ServiceCreditRepository._get_existing_signup_grant(
            db,
            user_id=user_id,
            idempotency_key=idempotency_key,
        )
        if existing_result:
            return existing_result

        return ServiceCreditRepository.grant_credits(
            db,
            user_id=user_id,
            service_type=SERVICE_TYPE_ADDRESS_ACCESS,
            amount=SIGNUP_ADDRESS_CREDIT_AMOUNT,
            reason="signup_bonus",
            actor_type="system",
            idempotency_key=idempotency_key,
        )

    @staticmethod
    def _get_existing_signup_grant(
        db: Session,
        *,
        user_id: str,
        idempotency_key: str,
    ) -> ServiceCreditMutationResult | None:
        transaction = ServiceCreditRepository.get_transaction_by_idempotency_key(
            db, idempotency_key=idempotency_key
        )
        if transaction is None:
            return None
        ServiceCreditRepository._validate_existing_signup_transaction(
            transaction, user_id=user_id
        )
        balance = ServiceCreditRepository.get_balance(
            db, user_id=user_id, service_type=SERVICE_TYPE_ADDRESS_ACCESS
        )
        if balance is None:
            raise RuntimeError("Signup transaction found without balance row")
        return ServiceCreditMutationResult(
            balance=balance,
            transaction=transaction,
            applied=False,
        )

    @staticmethod
    def _validate_existing_signup_transaction(
        transaction: UserServiceTransaction, *, user_id: str
    ) -> None:
        is_valid = (
            str(transaction.user_id) == user_id
            and str(transaction.service_type) == SERVICE_TYPE_ADDRESS_ACCESS
            and str(transaction.reason) == "signup_bonus"
            and int(transaction.delta) > 0
        )
        if not is_valid:
            raise ValueError("Signup idempotency key belongs to another mutation")

    @staticmethod
    def _get_idempotent_result(
        db: Session,
        *,
        idempotency_key: str | None,
        user_id: str,
        service_type: str,
        expected_delta: int,
    ) -> ServiceCreditMutationResult | None:
        if not idempotency_key:
            return None
        transaction = ServiceCreditRepository.get_transaction_by_idempotency_key(
            db, idempotency_key=idempotency_key
        )
        if transaction is None:
            return None
        ServiceCreditRepository._validate_existing_transaction(
            transaction,
            user_id=user_id,
            service_type=service_type,
            expected_delta=expected_delta,
        )
        balance = ServiceCreditRepository.get_balance(
            db, user_id=user_id, service_type=service_type
        )
        if balance is None:
            raise RuntimeError("Existing service transaction found without balance row")
        return ServiceCreditMutationResult(
            balance=balance,
            transaction=transaction,
            applied=False,
        )

    @staticmethod
    def _lock_user_credit_account(db: Session, *, user_id: str) -> None:
        user_exists = (
            db.query(User.id).filter(User.id == user_id).with_for_update().first()
        )
        if user_exists is None:
            raise ValueError("Cannot mutate credits for an unknown user")

    @staticmethod
    def grant_credits(
        db: Session,
        *,
        user_id: str,
        service_type: str,
        amount: int,
        reason: str,
        actor_type: str,
        actor_id: str | None = None,
        idempotency_key: str | None = None,
        project_id: str | None = None,
        request_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> ServiceCreditMutationResult:
        if amount <= 0:
            raise ValueError("amount must be positive")

        service_type = ServiceCreditRepository._validate_service_type(service_type)
        actor_type = ServiceCreditRepository._validate_actor_type(actor_type)
        reason = ServiceCreditRepository._validate_reason(reason)

        existing_result = ServiceCreditRepository._get_idempotent_result(
            db,
            idempotency_key=idempotency_key,
            user_id=user_id,
            service_type=service_type,
            expected_delta=amount,
        )
        if existing_result:
            return existing_result

        ServiceCreditRepository._lock_user_credit_account(db, user_id=user_id)

        balance = (
            db.query(UserServiceBalance)
            .filter(
                UserServiceBalance.user_id == user_id,
                UserServiceBalance.service_type == service_type,
            )
            .with_for_update()
            .first()
        )
        existing_result = ServiceCreditRepository._get_idempotent_result(
            db,
            idempotency_key=idempotency_key,
            user_id=user_id,
            service_type=service_type,
            expected_delta=amount,
        )
        if existing_result:
            return existing_result
        if balance is None:
            balance = ReportRepository._as_mutable(UserServiceBalance())
            balance.user_id = user_id
            balance.service_type = service_type
            balance.balance = 0
            balance.last_updated_by_actor_type = actor_type
            balance.last_updated_by_actor_id = actor_id
            db.add(balance)

        balance.balance = int(balance.balance or 0) + amount
        balance.last_updated_by_actor_type = actor_type
        balance.last_updated_by_actor_id = actor_id
        balance.updated_at = datetime.datetime.now(UTC_NOW)

        transaction = ReportRepository._as_mutable(UserServiceTransaction())
        transaction.user_id = user_id
        transaction.service_type = service_type
        transaction.delta = amount
        transaction.reason = reason
        transaction.idempotency_key = idempotency_key
        transaction.project_id = project_id
        transaction.request_id = request_id
        transaction.actor_type = actor_type
        transaction.actor_id = actor_id
        transaction.metadata_json = metadata
        db.add(transaction)
        db.commit()
        db.refresh(balance)
        db.refresh(transaction)
        return ServiceCreditMutationResult(
            balance=cast(UserServiceBalance, balance),
            transaction=cast(UserServiceTransaction, transaction),
            applied=True,
        )

    @staticmethod
    def debit_credits(
        db: Session,
        *,
        user_id: str,
        service_type: str,
        amount: int,
        reason: str,
        actor_type: str,
        actor_id: str | None = None,
        idempotency_key: str | None = None,
        project_id: str | None = None,
        request_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> ServiceCreditMutationResult | None:
        if amount <= 0:
            raise ValueError("amount must be positive")

        service_type = ServiceCreditRepository._validate_service_type(service_type)
        actor_type = ServiceCreditRepository._validate_actor_type(actor_type)
        reason = ServiceCreditRepository._validate_reason(reason)

        if db.get_bind().dialect.name == "postgresql":
            return ServiceCreditRepository._debit_credits_postgres(
                db,
                user_id=user_id,
                service_type=service_type,
                amount=amount,
                reason=reason,
                actor_type=actor_type,
                actor_id=actor_id,
                idempotency_key=idempotency_key,
                project_id=project_id,
                request_id=request_id,
                metadata=metadata,
            )

        existing_result = ServiceCreditRepository._get_idempotent_result(
            db,
            idempotency_key=idempotency_key,
            user_id=user_id,
            service_type=service_type,
            expected_delta=-amount,
        )
        if existing_result:
            return existing_result

        ServiceCreditRepository._lock_user_credit_account(db, user_id=user_id)

        balance = (
            db.query(UserServiceBalance)
            .filter(
                UserServiceBalance.user_id == user_id,
                UserServiceBalance.service_type == service_type,
            )
            .with_for_update()
            .first()
        )
        existing_result = ServiceCreditRepository._get_idempotent_result(
            db,
            idempotency_key=idempotency_key,
            user_id=user_id,
            service_type=service_type,
            expected_delta=-amount,
        )
        if existing_result:
            return existing_result
        if balance is None or int(balance.balance or 0) < amount:
            db.rollback()
            return None

        balance_mut = ReportRepository._as_mutable(balance)
        balance_mut.balance = int(balance_mut.balance) - amount
        balance_mut.last_updated_by_actor_type = actor_type
        balance_mut.last_updated_by_actor_id = actor_id
        balance_mut.updated_at = datetime.datetime.now(UTC_NOW)

        transaction = ReportRepository._as_mutable(UserServiceTransaction())
        transaction.transaction_id = str(uuid.uuid4())
        transaction.user_id = user_id
        transaction.service_type = service_type
        transaction.delta = -amount
        transaction.reason = reason
        transaction.idempotency_key = idempotency_key
        transaction.project_id = project_id
        transaction.request_id = request_id
        transaction.actor_type = actor_type
        transaction.actor_id = actor_id
        transaction.metadata_json = metadata
        db.add(transaction)
        db.commit()
        db.refresh(balance_mut)
        db.refresh(transaction)
        return ServiceCreditMutationResult(
            balance=cast(UserServiceBalance, balance_mut),
            transaction=cast(UserServiceTransaction, transaction),
            applied=True,
        )

    # One statement replaces lock-user -> lock-balance -> idempotency re-check ->
    # update -> insert -> refresh (9 statements). The ledger insert goes first so
    # the unique idempotency index arbitrates concurrent duplicates (the loser
    # waits, then DO NOTHINGs); the debit only applies if that insert happened,
    # and the conditional UPDATE's row lock serializes concurrent debits.
    _DEBIT_SQL = text(
        """
        WITH inserted AS (
            INSERT INTO user_service_transactions (
                transaction_id, user_id, service_type, delta, reason,
                idempotency_key, project_id, request_id, actor_type, actor_id,
                metadata, created_at
            )
            VALUES (
                :transaction_id, :user_id, :service_type, :delta, :reason,
                :idempotency_key, :project_id, :request_id, :actor_type, :actor_id,
                CAST(:metadata AS jsonb), :now
            )
            ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
            DO NOTHING
            RETURNING transaction_id
        ),
        debited AS (
            UPDATE user_service_balances
            SET balance = balance - :amount,
                last_updated_by_actor_type = :actor_type,
                last_updated_by_actor_id = :actor_id,
                updated_at = :now
            WHERE user_id = :user_id
              AND service_type = :service_type
              AND balance >= :amount
              AND EXISTS (SELECT 1 FROM inserted)
            RETURNING balance_id, balance
        )
        SELECT (SELECT transaction_id FROM inserted) AS transaction_id,
               debited.balance_id,
               debited.balance
        FROM (SELECT 1) AS one
        LEFT JOIN debited ON true
        """
    )

    @staticmethod
    def _debit_credits_postgres(
        db: Session,
        *,
        user_id: str,
        service_type: str,
        amount: int,
        reason: str,
        actor_type: str,
        actor_id: str | None,
        idempotency_key: str | None,
        project_id: str | None,
        request_id: str | None,
        metadata: dict[str, Any] | None,
    ) -> ServiceCreditMutationResult | None:
        transaction_id = str(uuid.uuid4())
        now = datetime.datetime.now(UTC_NOW)
        try:
            row = db.execute(
                ServiceCreditRepository._DEBIT_SQL,
                {
                    "transaction_id": transaction_id,
                    "user_id": user_id,
                    "service_type": service_type,
                    "delta": -amount,
                    "amount": amount,
                    "reason": reason,
                    "idempotency_key": idempotency_key,
                    "project_id": project_id,
                    "request_id": request_id,
                    "actor_type": actor_type,
                    "actor_id": actor_id,
                    "metadata": json.dumps(metadata) if metadata is not None else None,
                    "now": now,
                },
            ).one()
        except IntegrityError as exc:
            db.rollback()
            raise ValueError("Cannot mutate credits for an unknown user") from exc

        if row.transaction_id is None:
            # Idempotency key already used: return the original mutation.
            db.rollback()
            return ServiceCreditRepository._get_idempotent_result(
                db,
                idempotency_key=idempotency_key,
                user_id=user_id,
                service_type=service_type,
                expected_delta=-amount,
            )
        if row.balance_id is None:
            # Missing balance row or insufficient credits: undo the ledger insert.
            db.rollback()
            return None

        db.commit()
        balance = UserServiceBalance(
            balance_id=row.balance_id,
            user_id=user_id,
            service_type=service_type,
            balance=int(row.balance),
            last_updated_by_actor_type=actor_type,
            last_updated_by_actor_id=actor_id,
            updated_at=now,
        )
        transaction = UserServiceTransaction(
            transaction_id=transaction_id,
            user_id=user_id,
            service_type=service_type,
            delta=-amount,
            reason=reason,
            idempotency_key=idempotency_key,
            project_id=project_id,
            request_id=request_id,
            actor_type=actor_type,
            actor_id=actor_id,
            metadata_json=metadata,
            created_at=now,
        )
        return ServiceCreditMutationResult(
            balance=balance, transaction=transaction, applied=True
        )

    @staticmethod
    def _validate_existing_transaction(
        transaction: UserServiceTransaction,
        *,
        user_id: str,
        service_type: str,
        expected_delta: int,
    ) -> None:
        matches_request = (
            str(transaction.user_id) == user_id
            and str(transaction.service_type) == service_type
            and int(transaction.delta) == expected_delta
        )
        if not matches_request:
            raise ValueError("Idempotency key belongs to a different credit mutation")
