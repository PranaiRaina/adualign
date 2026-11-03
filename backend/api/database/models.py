import datetime
import uuid
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    String,
    Integer,
    Float,
    DateTime,
    ForeignKey,
    Text,
    JSON,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import JSONB
from .core import Base


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    email = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)
    role = Column(String, default="buyer")
    avatar_url = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    listings = relationship(
        "Listing", back_populates="seller", cascade="all, delete-orphan"
    )
    saved_listings = relationship(
        "SavedListing", back_populates="user", cascade="all, delete-orphan"
    )
    projects = relationship(
        "Project", back_populates="user", cascade="all, delete-orphan"
    )
    chat_usage = relationship(
        "ChatUsage", back_populates="user", cascade="all, delete-orphan"
    )
    service_balances = relationship(
        "UserServiceBalance", back_populates="user", cascade="all, delete-orphan"
    )
    service_transactions = relationship(
        "UserServiceTransaction", back_populates="user", cascade="all, delete-orphan"
    )


class AdminUser(Base):
    __tablename__ = "admin_users"

    user_id = Column(
        String, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class AdminUsageSettings(Base):
    __tablename__ = "admin_usage_settings"

    id = Column(String, primary_key=True, default="global")
    default_budget_micros = Column(BigInteger, nullable=False)
    default_usage_reset_interval_days = Column(Integer, nullable=True)
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.datetime.now(datetime.UTC),
        onupdate=lambda: datetime.datetime.now(datetime.UTC),
    )
    updated_by_actor_id = Column(String, nullable=True)


class Project(Base):
    __tablename__ = "projects"

    id = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    status = Column(String, default="project", nullable=False, index=True)
    report_input_version = Column(Integer, default=1, nullable=False)

    address = Column(String, nullable=True)
    county = Column(String, nullable=True)
    property_area_sqft = Column(Float, nullable=True)
    buildable_area_sqft = Column(Float, nullable=True)
    setback_ft = Column(Float, nullable=True)
    max_adu_sqft = Column(Float, nullable=True)
    adu_sqft = Column(Float, nullable=True)
    adu_width_ft = Column(Float, nullable=True)
    adu_length_ft = Column(Float, nullable=True)
    adu_type = Column(String, nullable=True)
    adu_shape = Column(String, nullable=True)
    # Assessor living area of the primary home (advisory, not a report input)
    home_sqft = Column(Float, nullable=True)
    primary_use = Column(String, nullable=True)
    blocker_types = Column(JSON, nullable=True)
    fire_hazard_severity = Column(String, nullable=True)
    fire_hazard_zone_type = Column(String, nullable=True)
    current_yard_zone = Column(String, nullable=True)
    adu_clearances = Column(JSON, nullable=True)
    finance_state = Column(JSON, nullable=True)
    map_snapshot = Column(JSON, nullable=True)

    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(
        DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow
    )

    user = relationship("User", back_populates="projects")
    report = relationship(
        "Report", back_populates="project", uselist=False, cascade="all, delete-orphan"
    )
    draft = relationship(
        "Draft", back_populates="project", uselist=False, cascade="all, delete-orphan"
    )


class Report(Base):
    __tablename__ = "reports"

    id = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(
        String,
        ForeignKey("projects.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )

    version = Column(Integer, default=1, nullable=False)
    source_project_version = Column(Integer, default=1, nullable=False)
    visible = Column(JSON, nullable=False, default=dict)
    context = Column(JSON, nullable=False, default=dict)

    last_modified = Column(
        DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow
    )
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    project = relationship("Project", back_populates="report")


class Draft(Base):
    __tablename__ = "drafts"

    id = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(
        String,
        ForeignKey("projects.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )
    seller_id = Column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    version = Column(Integer, default=1, nullable=False)
    draft_payload = Column(JSON, nullable=False, default=dict)
    field_meta = Column(JSON, nullable=False, default=dict)

    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(
        DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow
    )

    project = relationship("Project", back_populates="draft")


class Listing(Base):
    """Published marketplace listings only. Indexed columns for search/filter."""

    __tablename__ = "published_listings"

    id = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))

    seller_id = Column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    seller = relationship("User", back_populates="listings")
    project_id = Column(
        String,
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=True,
        unique=True,
        index=True,
    )

    adu_type = Column(String, index=True)
    permit_status = Column(String, index=True)

    address = Column(String, nullable=True)
    city = Column(String, index=True, nullable=True)
    state = Column(String, nullable=True)
    zip_code = Column(String, index=True, nullable=True)
    lat = Column(Float, nullable=True)
    lng = Column(Float, nullable=True)

    monthly_rent = Column(Float, index=True, nullable=True)
    bedrooms = Column(Integer, index=True, nullable=True)
    bathrooms = Column(Float, index=True, nullable=True)
    sqft = Column(Float, index=True, nullable=True)

    hero_image = Column(String, nullable=True)
    seo_title = Column(String, nullable=True)
    description = Column(Text, nullable=True)

    image_gallery = Column(JSON, default=list)
    amenities = Column(JSON, default=list)
    utilities_included = Column(JSON, default=list)

    lease_term = Column(String, nullable=True)
    pet_policy = Column(String, nullable=True)
    furnished = Column(String, nullable=True)

    available_date = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(
        DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow
    )

    view_count = Column(Integer, default=0)
    save_count = Column(Integer, default=0)

    saved_by_users = relationship(
        "SavedListing", back_populates="listing", cascade="all, delete-orphan"
    )
    project = relationship("Project")


class SavedListing(Base):
    __tablename__ = "saved_listings"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))

    user_id = Column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    listing_id = Column(
        String,
        ForeignKey("published_listings.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    saved_at = Column(DateTime, default=datetime.datetime.utcnow)

    user = relationship("User", back_populates="saved_listings")
    listing = relationship("Listing", back_populates="saved_by_users")


# ── Handbook Chunks (pgvector) ──────────────────────────────────────────


class HandbookChunk(Base):
    __tablename__ = "handbook_chunks"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    content = Column(Text, nullable=False)
    metadata_json = Column(JSONB, nullable=False, default=dict, name="metadata")
    embedding: Any = Column(Vector(3072))
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


# ── Rate Limiting & Budgeting ──────────────────────────────────────────


class ChatUsage(Base):
    __tablename__ = "chat_usage"

    id = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    api_key_hash = Column(String, unique=True, nullable=False, index=True)
    name = Column(String, nullable=True)
    budget_micros = Column(BigInteger, nullable=False)
    budget_currency = Column(String, nullable=False, default="USD")
    used_micros = Column(BigInteger, nullable=False, default=0)
    usage_reset_interval_days = Column(Integer, nullable=True)
    last_reset_at = Column(DateTime(timezone=True), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(
        DateTime,
        default=lambda: datetime.datetime.now(datetime.UTC),
        onupdate=lambda: datetime.datetime.now(datetime.UTC),
    )
    updated_by_actor_type = Column(String, nullable=False, default="system")
    updated_by_actor_id = Column(String, nullable=True)
    updated_reason = Column(String, nullable=False, default="chat_usage_created")

    user = relationship("User", back_populates="chat_usage")
    logs = relationship(
        "ChatUsageLog", back_populates="chat_usage", cascade="all, delete-orphan"
    )

    @property
    def budget_period(self) -> str:
        return "lifetime"

    @budget_period.setter
    def budget_period(self, _: str) -> None:
        return None

    @property
    def usage_reset_at(self):
        return self.last_reset_at

    @usage_reset_at.setter
    def usage_reset_at(self, value) -> None:
        self.last_reset_at = value


class ChatUsageLog(Base):
    __tablename__ = "chat_usage_logs"

    id = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    chat_usage_id = Column(
        String,
        ForeignKey("chat_usage.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    event_type = Column(String, nullable=False, default="usage")
    delta_micros = Column(BigInteger, nullable=False, default=0)
    cost_micros = Column(BigInteger, nullable=False, default=0)
    used_micros_after = Column(BigInteger, nullable=True)
    budget_micros_after = Column(BigInteger, nullable=True)
    tokens_used = Column(Integer, nullable=True)
    prompt_tokens = Column(Integer, nullable=True)
    completion_tokens = Column(Integer, nullable=True)
    total_tokens = Column(Integer, nullable=True)
    cached_tokens = Column(Integer, nullable=True, default=0)
    provider = Column(String, nullable=True)
    route = Column(String, nullable=True)
    source = Column(String, nullable=True)
    is_estimated = Column(Boolean, nullable=False, default=False)
    stream_terminated_early = Column(Boolean, nullable=False, default=False)
    model = Column(String, nullable=True)
    request_id = Column(String, nullable=True, index=True)
    actor_type = Column(String, nullable=False, default="usage_meter")
    actor_id = Column(String, nullable=True)
    reason = Column(String, nullable=True)
    metadata_json = Column(JSON, nullable=True, name="metadata")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    chat_usage = relationship("ChatUsage", back_populates="logs")

    @property
    def api_key_id(self):
        return self.chat_usage_id

    @api_key_id.setter
    def api_key_id(self, value) -> None:
        self.chat_usage_id = value

    @property
    def timestamp(self):
        return self.created_at

    @timestamp.setter
    def timestamp(self, value) -> None:
        self.created_at = value


ApiKey = ChatUsage
TokenUsageLog = ChatUsageLog


class UserServiceBalance(Base):
    __tablename__ = "user_service_balances"
    __table_args__ = (
        UniqueConstraint("user_id", "service_type", name="ux_user_service_balance"),
        CheckConstraint("balance >= 0", name="ck_user_service_balance_non_negative"),
    )

    balance_id = Column(
        String, primary_key=True, index=True, default=lambda: str(uuid.uuid4())
    )
    user_id = Column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    service_type = Column(String, nullable=False, index=True)
    balance = Column(Integer, nullable=False, default=0)
    last_updated_by_actor_type = Column(String, nullable=False)
    last_updated_by_actor_id = Column(String, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.UTC))
    updated_at = Column(
        DateTime,
        default=lambda: datetime.datetime.now(datetime.UTC),
        onupdate=lambda: datetime.datetime.now(datetime.UTC),
    )

    user = relationship("User", back_populates="service_balances")


class UserServiceTransaction(Base):
    __tablename__ = "user_service_transactions"
    __table_args__ = (
        CheckConstraint("delta <> 0", name="ck_user_service_transaction_non_zero"),
    )

    transaction_id = Column(
        String, primary_key=True, index=True, default=lambda: str(uuid.uuid4())
    )
    user_id = Column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    service_type = Column(String, nullable=False, index=True)
    delta = Column(Integer, nullable=False)
    reason = Column(String, nullable=False)
    idempotency_key = Column(String, nullable=True, index=True)
    project_id = Column(
        String,
        ForeignKey("projects.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    request_id = Column(String, nullable=True, index=True)
    actor_type = Column(String, nullable=False)
    actor_id = Column(String, nullable=True)
    metadata_json = Column(JSON, nullable=True, name="metadata")
    created_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.UTC))

    user = relationship("User", back_populates="service_transactions")


class Feedback(Base):
    __tablename__ = "feedback"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(
        String,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    email = Column(String, nullable=False)
    topic = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    status = Column(String, nullable=False, default="new", index=True)
    created_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.UTC))
