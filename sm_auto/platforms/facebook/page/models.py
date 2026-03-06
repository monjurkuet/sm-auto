"""
Facebook Page Data Models.

Pydantic models for representing Facebook pages and their metrics.
"""

from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


class FacebookPage(BaseModel):
    """Represents a Facebook Page being tracked."""

    page_id: str = Field(
        ...,
        description="Unique Facebook page ID (used as _id in MongoDB)",
    )
    page_url: str = Field(
        ...,
        description="Full URL to the Facebook page",
    )
    username: Optional[str] = Field(
        default=None,
        description="Username extracted from URL (e.g., 'cvrng' from facebook.com/cvrng)",
    )
    page_name: Optional[str] = Field(
        default=None,
        description="Official page name",
    )
    description: Optional[str] = Field(
        default=None,
        description="Page description from meta tags",
    )
    email: Optional[str] = Field(
        default=None,
        description="Contact email if available",
    )
    profile_image_url: Optional[str] = Field(
        default=None,
        description="URL to profile image",
    )
    cover_image_url: Optional[str] = Field(
        default=None,
        description="URL to cover image",
    )
    category: Optional[str] = Field(
        default=None,
        description="Page category",
    )
    location: Optional[str] = Field(
        default=None,
        description="Page location if available",
    )
    website: Optional[str] = Field(
        default=None,
        description="Website URL if available",
    )
    phone: Optional[str] = Field(
        default=None,
        description="Contact phone if available",
    )
    is_verified: Optional[bool] = Field(
        default=None,
        description="Whether the page is verified",
    )
    page_created: Optional[str] = Field(
        default=None,
        description="Page creation date from transparency info",
    )
    first_seen: datetime = Field(
        default_factory=datetime.utcnow,
        description="When page was first added to tracking",
    )
    last_checked: datetime = Field(
        default_factory=datetime.utcnow,
        description="Last time page was checked/updated",
    )

    class Config:
        """Pydantic config."""

        json_schema_extra = {
            "example": {
                "page_id": "100063979652930",
                "page_url": "https://www.facebook.com/cvrng",
                "username": "cvrng",
                "page_name": "Computer Vision BD | Rangpur",
                "description": "Largest Computer Sales & Service Center in Rangpur",
                "email": "info@computervision.com.bd",
                "profile_image_url": "https://scontent.xx.fbcdn.net/v/...",
                "category": "Computer Store",
                "location": "Rangpur, Bangladesh",
                "is_verified": False,
                "first_seen": "2026-03-01T00:00:00Z",
                "last_checked": "2026-03-06T13:37:00Z",
            }
        }


class FacebookPageMetric(BaseModel):
    """Represents metrics for a Facebook Page at a point in time."""

    page_id: str = Field(
        ...,
        description="Reference to the Facebook page ID",
    )
    likes: Optional[str] = Field(
        default=None,
        description="Total likes (formatted string, e.g., '54,195')",
    )
    likes_numeric: Optional[int] = Field(
        default=None,
        description="Numeric likes value for filtering/sorting",
    )
    followers: Optional[str] = Field(
        default=None,
        description="Total followers (formatted string)",
    )
    followers_numeric: Optional[int] = Field(
        default=None,
        description="Numeric followers value for filtering/sorting",
    )
    talking_about: Optional[str] = Field(
        default=None,
        description="People talking about this (formatted string)",
    )
    talking_about_numeric: Optional[int] = Field(
        default=None,
        description="Numeric talking about value for filtering/sorting",
    )
    checkins: Optional[str] = Field(
        default=None,
        description="Number of checkins",
    )
    checkins_numeric: Optional[int] = Field(
        default=None,
        description="Numeric checkins value",
    )
    recorded_at: datetime = Field(
        default_factory=datetime.utcnow,
        description="When this metric was recorded",
    )

    class Config:
        """Pydantic config."""

        json_schema_extra = {
            "example": {
                "page_id": "100063979652930",
                "likes": "54,195",
                "likes_numeric": 54195,
                "followers": "54",
                "followers_numeric": 54,
                "talking_about": "944",
                "talking_about_numeric": 944,
                "recorded_at": "2026-03-06T13:37:00Z",
            }
        }


class PageExtractionResult(BaseModel):
    """Result from extracting page data."""

    page_id: Optional[str] = Field(
        default=None,
        description="Facebook page ID",
    )
    page_url: str = Field(
        ...,
        description="Page URL that was scraped",
    )
    page_name: Optional[str] = Field(
        default=None,
        description="Extracted page name",
    )
    username: Optional[str] = Field(
        default=None,
        description="Extracted username from URL",
    )
    description: Optional[str] = Field(
        default=None,
        description="Page description",
    )
    email: Optional[str] = Field(
        default=None,
        description="Extracted email",
    )
    phone: Optional[str] = Field(
        default=None,
        description="Extracted phone number",
    )
    profile_image_url: Optional[str] = Field(
        default=None,
        description="Profile image URL",
    )
    cover_image_url: Optional[str] = Field(
        default=None,
        description="Cover image URL",
    )
    category: Optional[str] = Field(
        default=None,
        description="Page category",
    )
    location: Optional[str] = Field(
        default=None,
        description="Page location",
    )
    website: Optional[str] = Field(
        default=None,
        description="Website URL",
    )
    is_verified: Optional[bool] = Field(
        default=None,
        description="Verification status",
    )
    page_created: Optional[str] = Field(
        default=None,
        description="Page creation date from transparency page",
    )
    likes: Optional[str] = Field(
        default=None,
        description="Likes count (formatted)",
    )
    likes_numeric: Optional[int] = Field(
        default=None,
        description="Likes count (numeric)",
    )
    followers: Optional[str] = Field(
        default=None,
        description="Followers count (formatted)",
    )
    followers_numeric: Optional[int] = Field(
        default=None,
        description="Followers count (numeric)",
    )
    talking_about: Optional[str] = Field(
        default=None,
        description="Talking about count (formatted)",
    )
    talking_about_numeric: Optional[int] = Field(
        default=None,
        description="Talking about count (numeric)",
    )
    checkins: Optional[str] = Field(
        default=None,
        description="Checkins count (formatted)",
    )
    checkins_numeric: Optional[int] = Field(
        default=None,
        description="Checkins count (numeric)",
    )
    extraction_method: str = Field(
        default="html",
        description="Method used for extraction (html, javascript)",
    )
    extracted_at: datetime = Field(
        default_factory=datetime.utcnow,
        description="When extraction occurred",
    )


class PageUpdateResult(BaseModel):
    """Result from updating a page."""

    page_id: str = Field(..., description="Page ID")
    page_url: str = Field(..., description="Page URL")
    success: bool = Field(..., description="Whether update was successful")
    page_updated: bool = Field(
        default=False,
        description="Whether page document was updated",
    )
    metric_inserted: bool = Field(
        default=False,
        description="Whether new metric was inserted",
    )
    error: Optional[str] = Field(
        default=None,
        description="Error message if update failed",
    )
    updated_at: datetime = Field(
        default_factory=datetime.utcnow,
        description="When update was attempted",
    )
