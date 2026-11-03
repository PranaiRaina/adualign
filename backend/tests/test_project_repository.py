# mypy: disable-error-code="arg-type"

import datetime
from collections.abc import Iterator
from typing import cast

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from api.database.models import Draft, Listing, Project, Report, User
from api.database.repository import ConflictError, ReportRepository
from api.database.schemas import ProjectCreate, ProjectUpdate, ReportUpdate
from api.routers import reports as reports_router


@pytest.fixture
def session(tmp_path) -> Iterator[Session]:
    engine = create_engine(f"sqlite:///{tmp_path / 'project-repository.db'}")
    User.__table__.create(bind=engine)
    Project.__table__.create(bind=engine)
    Report.__table__.create(bind=engine)
    Draft.__table__.create(bind=engine)
    Listing.__table__.create(bind=engine)

    db_session = sessionmaker(autocommit=False, autoflush=False, bind=engine)()
    try:
        yield db_session
    finally:
        db_session.close()
        engine.dispose()


def create_user(session: Session, *, email: str, name: str) -> User:
    user = User(email=email, name=name)
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def user_id(user: User) -> str:
    return cast(str, user.id)


def project_id(project: Project) -> str:
    return cast(str, project.id)


def create_project(
    session: Session, *, user_id: str, finance_state: dict | None = None
) -> Project:
    project = Project(
        user_id=user_id,
        address="123 Oak St",
        finance_state=finance_state,
    )
    session.add(project)
    session.commit()
    session.refresh(project)
    return project


def test_create_project_persists_map_snapshot(session: Session):
    user = create_user(session, email="owner@example.com", name="Owner")
    owner_id = user_id(user)
    expected_snapshot = {
        "version": 1,
        "selectedLocation": {"lat": 33.6, "lng": -117.8, "name": "123 Oak St"},
    }
    finance_state = {"county": "Orange County"}

    created = ReportRepository.create_project(
        session,
        ProjectCreate(
            address="123 Oak St",
            finance_state=finance_state,
            map_snapshot=expected_snapshot,
        ),
        user_id=owner_id,
    )

    session.expire_all()
    stored = session.get(Project, created.id)

    assert stored is not None
    assert stored.map_snapshot == expected_snapshot
    assert stored.finance_state == finance_state


def test_create_project_persists_adu_dimensions(session: Session):
    user = create_user(session, email="owner@example.com", name="Owner")
    owner_id = user_id(user)

    created = ReportRepository.create_project(
        session,
        ProjectCreate(
            adu_sqft=366,
            adu_width_ft=10.5,
            adu_length_ft=34.9,
        ),
        user_id=owner_id,
    )

    session.expire_all()
    stored = session.get(Project, created.id)

    assert stored is not None
    assert stored.adu_width_ft == 10.5
    assert stored.adu_length_ft == 34.9


def test_create_project_with_finance_state_starts_as_project(session: Session):
    user = create_user(session, email="owner@example.com", name="Owner")
    owner_id = user_id(user)

    created = ReportRepository.create_project(
        session,
        ProjectCreate(finance_state={"county": "Orange County"}),
        user_id=owner_id,
    )

    session.expire_all()
    stored = session.get(Project, created.id)

    assert stored is not None
    assert stored.status == "project"


def test_update_project_finance_state_marks_new_project_as_project(session: Session):
    user = create_user(session, email="owner@example.com", name="Owner")
    owner_id = user_id(user)
    project = create_project(session, user_id=owner_id)
    pid = project_id(project)

    updated = ReportRepository.update_project_finance_state(
        session,
        pid,
        {"county": "Orange County"},
        user_id=owner_id,
    )

    session.expire_all()
    stored = session.get(Project, pid)

    assert updated is not None
    assert stored is not None
    assert stored.status == "project"


def test_update_project_persists_map_snapshot_without_clobbering_finance_state(
    session: Session,
):
    user = create_user(session, email="owner@example.com", name="Owner")
    owner_id = user_id(user)
    existing_finance_state = {"county": "Orange County"}
    project = create_project(
        session,
        user_id=owner_id,
        finance_state=existing_finance_state,
    )
    pid = project_id(project)
    expected_snapshot = {
        "version": 2,
        "selectedLocation": {"lat": 33.7, "lng": -117.9, "name": "456 Pine St"},
    }

    updated = ReportRepository.update_project(
        session,
        pid,
        ProjectUpdate(map_snapshot=expected_snapshot),
        user_id=owner_id,
    )

    session.expire_all()
    stored = session.get(Project, pid)

    assert updated is not None
    assert stored is not None
    assert updated.map_snapshot == expected_snapshot
    assert stored.map_snapshot == expected_snapshot
    assert stored.finance_state == existing_finance_state


def test_update_project_respects_user_scope(session: Session):
    owner = create_user(session, email="owner@example.com", name="Owner")
    other_user = create_user(session, email="other@example.com", name="Other User")
    owner_user_id = user_id(owner)
    other_user_id = user_id(other_user)
    original_snapshot = {
        "version": 1,
        "selectedLocation": {"lat": 33.6, "lng": -117.8, "name": "123 Oak St"},
    }
    project = create_project(session, user_id=owner_user_id)
    pid = project_id(project)
    setattr(project, "map_snapshot", original_snapshot)
    session.commit()

    result = ReportRepository.update_project(
        session,
        pid,
        ProjectUpdate(
            map_snapshot={
                "version": 3,
                "selectedLocation": {"lat": 34.0, "lng": -118.2, "name": "789 Elm St"},
            }
        ),
        user_id=other_user_id,
    )

    session.expire_all()
    stored = session.get(Project, pid)

    assert result is None
    assert stored is not None
    assert stored.map_snapshot == original_snapshot


def test_create_report_serializes_requirement_timestamps(session: Session):
    user = create_user(session, email="owner@example.com", name="Owner")
    project = create_project(session, user_id=user.id)

    report = ReportRepository.create_report(
        session,
        project.id,
        visible={
            "requirements": [
                {
                    "id": "project_intent",
                    "title": "Project Intent",
                    "question": "What is the main reason?",
                    "answer": "Long-term rental income",
                    "selected_option_id": "long_term_rental_income",
                    "status": "answered",
                    "updated_at": "2026-05-29T01:14:20.549392+00:00",
                }
            ]
        },
    )

    session.expire_all()
    stored = session.get(Report, report.id)

    assert stored is not None
    assert isinstance(stored.visible["requirements"][0]["updated_at"], str)


def test_report_input_version_changes_only_for_report_inputs(session: Session):
    user = create_user(session, email="owner@example.com", name="Owner")
    project = ReportRepository.create_project(
        session,
        ProjectCreate(address="123 Oak St", map_snapshot={"version": 1}),
        user_id=user.id,
    )

    ReportRepository.update_project(
        session,
        project.id,
        ProjectUpdate(address="123 Oak St", map_snapshot={"version": 2}),
        user_id=user.id,
    )
    unchanged = session.get(Project, project.id)
    assert unchanged is not None
    assert unchanged.report_input_version == 1

    ReportRepository.update_project(
        session,
        project.id,
        ProjectUpdate(adu_sqft=750),
        user_id=user.id,
    )
    changed = session.get(Project, project.id)
    assert changed is not None
    assert changed.report_input_version == 2


def test_generated_report_tracks_project_input_version(session: Session):
    user = create_user(session, email="owner@example.com", name="Owner")
    project = ReportRepository.create_project(
        session,
        ProjectCreate(address="123 Oak St"),
        user_id=user.id,
    )
    report = ReportRepository.create_report(session, project.id)
    assert report.source_project_version == 1
    current_project = ReportRepository.get_project(session, project.id, user_id=user.id)
    assert current_project is not None
    assert reports_router._project_out(current_project).report_status == "current"

    ReportRepository.update_project(
        session,
        project.id,
        ProjectUpdate(adu_sqft=750),
        user_id=user.id,
    )
    with pytest.raises(ConflictError):
        ReportRepository.replace_generated_report(
            session,
            project.id,
            ReportUpdate(visible={"executive_summary": "Updated"}),
            source_project_version=1,
            user_id=user.id,
        )

    outdated_project = ReportRepository.get_project(
        session, project.id, user_id=user.id
    )
    assert outdated_project is not None
    assert reports_router._project_out(outdated_project).report_status == "outdated"

    refreshed = ReportRepository.replace_generated_report(
        session,
        project.id,
        ReportUpdate(visible={"executive_summary": "Updated"}),
        source_project_version=2,
        user_id=user.id,
    )
    assert refreshed.source_project_version == 2
    regenerated_project = ReportRepository.get_project(
        session, project.id, user_id=user.id
    )
    assert regenerated_project is not None
    assert reports_router._project_out(regenerated_project).report_status == "current"


def test_delta_update_report_serializes_requirement_timestamps(session: Session):
    user = create_user(session, email="owner@example.com", name="Owner")
    project = create_project(session, user_id=user.id)
    report = ReportRepository.create_report(session, project.id)

    updated = ReportRepository.delta_update(
        session,
        project.id,
        ReportUpdate(
            visible={
                "requirements": [
                    {
                        "id": "budget_readiness",
                        "title": "Budget Readiness",
                        "question": "How ready is the budget?",
                        "answer": "Still estimating",
                        "selected_option_id": "still_estimating",
                        "status": "answered",
                        "updated_at": "2026-05-29T01:15:20.549392+00:00",
                    }
                ]
            }
        ),
    )

    session.expire_all()
    stored = session.get(Report, updated.id or report.id)

    assert stored is not None
    assert isinstance(stored.visible["requirements"][0]["updated_at"], str)


def test_create_project_with_explicit_project_status_persists_project(session: Session):
    user = create_user(session, email="owner@example.com", name="Owner")

    created = ReportRepository.create_project(
        session,
        ProjectCreate(
            status="project",
            address="123 Oak St",
            county="Orange County",
            map_snapshot={"version": 1},
        ),
        user_id=user.id,
    )

    session.expire_all()
    stored = session.get(Project, created.id)

    assert stored is not None
    assert stored.status == "project"
    assert stored.user_id == user.id
    assert stored.address == "123 Oak St"
    # A sparse project shell carries no finance state yet.
    assert stored.finance_state is None


def test_create_project_without_status_or_finance_defaults_to_project(session: Session):
    user = create_user(session, email="owner@example.com", name="Owner")

    created = ReportRepository.create_project(
        session,
        ProjectCreate(address="123 Oak St"),
        user_id=user.id,
    )

    session.expire_all()
    stored = session.get(Project, created.id)

    assert stored is not None
    assert stored.status == "project"


def _backdate_project(session: Session, project_id: str, *, hours: int) -> None:
    project = session.get(Project, project_id)
    assert project is not None
    setattr(
        project,
        "created_at",
        datetime.datetime.utcnow() - datetime.timedelta(hours=hours),
    )
    session.commit()


def test_delete_abandoned_drafts_removes_empty_old_project(session: Session):
    user = create_user(session, email="owner@example.com", name="Owner")
    created = ReportRepository.create_project(
        session,
        ProjectCreate(
            status="project",
            address="123 Oak St",
        ),
        user_id=user.id,
    )
    _backdate_project(session, created.id, hours=48)

    cutoff = datetime.datetime.utcnow() - datetime.timedelta(hours=24)
    deleted = ReportRepository.delete_abandoned_drafts(session, older_than=cutoff)

    session.expire_all()
    assert deleted == [created.id]
    assert session.get(Project, created.id) is None


def test_delete_abandoned_drafts_keeps_recent_and_meaningful_projects(session: Session):
    user = create_user(session, email="owner@example.com", name="Owner")

    recent = ReportRepository.create_project(
        session,
        ProjectCreate(status="project", address="Recent"),
        user_id=user.id,
    )
    with_finance = ReportRepository.create_project(
        session,
        ProjectCreate(status="project", finance_state={"county": "Orange County"}),
        user_id=user.id,
    )
    _backdate_project(session, with_finance.id, hours=48)

    empty_old_draft = ReportRepository.create_project(
        session,
        ProjectCreate(status="project"),
        user_id=user.id,
    )
    _backdate_project(session, empty_old_draft.id, hours=48)

    with_report = ReportRepository.create_project(
        session,
        ProjectCreate(status="project", address="Has report"),
        user_id=user.id,
    )
    ReportRepository.create_report(session, with_report.id)
    _backdate_project(session, with_report.id, hours=48)

    cutoff = datetime.datetime.utcnow() - datetime.timedelta(hours=24)
    deleted = ReportRepository.delete_abandoned_drafts(session, older_than=cutoff)

    session.expire_all()
    assert deleted == [empty_old_draft.id]
    assert session.get(Project, recent.id) is not None
    assert session.get(Project, with_finance.id) is not None
    assert session.get(Project, empty_old_draft.id) is None
    assert session.get(Project, with_report.id) is not None


def test_create_project_persists_home_sqft_and_partial_update_keeps_it(
    session: Session,
):
    user = create_user(session, email="owner@example.com", name="Owner")
    owner_id = user_id(user)

    created = ReportRepository.create_project(
        session,
        ProjectCreate(home_sqft=1810.0),
        user_id=owner_id,
    )
    initial_version = created.report_input_version

    # A save that omits home_sqft (exclude_unset) must not clobber it, and
    # home_sqft itself is advisory-only: never a report input.
    updated = ReportRepository.update_project(
        session,
        created.id,
        ProjectUpdate(map_snapshot={"version": 2}),
        user_id=owner_id,
    )

    assert updated is not None
    assert updated.home_sqft == 1810.0
    assert updated.report_input_version == initial_version

    updated = ReportRepository.update_project(
        session,
        created.id,
        ProjectUpdate(home_sqft=2200.0),
        user_id=owner_id,
    )

    assert updated is not None
    assert updated.home_sqft == 2200.0
    assert updated.report_input_version == initial_version
