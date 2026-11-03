"""
Listings router — published marketplace data only.
Draft management is handled through /projects/{id}/draft endpoints.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from datetime import datetime
from typing import Any, List, Optional, cast

from pydantic import BaseModel

from api.database.core import get_db
from api.database.models import Listing, SavedListing, User
from ..authentication.auth import get_current_user

router = APIRouter(prefix="/listings", tags=["listings"])


class ListingResponse(BaseModel):
    id: str
    seller_id: str
    project_id: Optional[str] = None
    adu_type: Optional[str] = None
    permit_status: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip_code: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    monthly_rent: Optional[float] = None
    bedrooms: Optional[int] = None
    bathrooms: Optional[float] = None
    sqft: Optional[float] = None
    hero_image: Optional[str] = None
    seo_title: Optional[str] = None
    description: Optional[str] = None
    image_gallery: List[str] = []
    amenities: List[str] = []
    utilities_included: List[str] = []
    lease_term: Optional[str] = None
    pet_policy: Optional[str] = None
    furnished: Optional[str] = None
    available_date: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    view_count: int = 0
    save_count: int = 0

    class Config:
        from_attributes = True


# --- Published Marketplace Endpoints ---


@router.get("/", response_model=List[ListingResponse])
def get_published_listings(
    db: Session = Depends(get_db),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=100),
    city: Optional[str] = None,
    adu_type: Optional[str] = None,
    min_rent: Optional[float] = None,
    max_rent: Optional[float] = None,
):
    """Fetch published marketplace listings with optional filters."""
    query = db.query(Listing)
    if city:
        query = query.filter(Listing.city == city)
    if adu_type:
        query = query.filter(Listing.adu_type == adu_type)
    if min_rent is not None:
        query = query.filter(Listing.monthly_rent >= min_rent)
    if max_rent is not None:
        query = query.filter(Listing.monthly_rent <= max_rent)
    return query.order_by(Listing.created_at.desc()).offset(skip).limit(limit).all()


@router.get("/{listing_id}", response_model=ListingResponse)
def get_listing(listing_id: str, db: Session = Depends(get_db)):
    """Fetch a single published listing and increment view count."""
    listing = db.query(Listing).filter(Listing.id == listing_id).first()
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")

    cast(Any, listing).view_count = int(cast(Any, listing.view_count) or 0) + 1
    db.commit()
    return listing


@router.delete("/{listing_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_listing(
    listing_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Allows a seller to remove their published listing."""
    db_listing = db.query(Listing).filter(Listing.id == listing_id).first()
    if not db_listing:
        raise HTTPException(status_code=404, detail="Listing not found")
    if db_listing.seller_id != current_user.id:
        raise HTTPException(
            status_code=403, detail="You can only delete your own listings."
        )

    db.delete(db_listing)
    db.commit()


# --- Saved/Favorited Listings ---


@router.post("/{listing_id}/favorite", status_code=status.HTTP_201_CREATED)
def favorite_listing(
    listing_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    existing_save = (
        db.query(SavedListing)
        .filter(
            SavedListing.listing_id == listing_id,
            SavedListing.user_id == current_user.id,
        )
        .first()
    )
    if existing_save:
        return {"msg": "Already favorited", "saved": True}

    new_save = SavedListing(listing_id=listing_id, user_id=current_user.id)
    db.add(new_save)
    db.commit()
    return {"msg": "Successfully favorited listing", "saved": True}


@router.delete("/{listing_id}/favorite", status_code=status.HTTP_200_OK)
def unfavorite_listing(
    listing_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    existing_save = (
        db.query(SavedListing)
        .filter(
            SavedListing.listing_id == listing_id,
            SavedListing.user_id == current_user.id,
        )
        .first()
    )
    if not existing_save:
        raise HTTPException(status_code=404, detail="Not in favorites")

    db.delete(existing_save)
    db.commit()
    return {"msg": "Removed from favorites", "saved": False}


@router.get("/favorites/mine", response_model=List[ListingResponse])
def get_my_favorites(
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    saved_entries = (
        db.query(SavedListing).filter(SavedListing.user_id == current_user.id).all()
    )
    listing_ids = [s.listing_id for s in saved_entries]
    if not listing_ids:
        return []
    return db.query(Listing).filter(Listing.id.in_(listing_ids)).all()
