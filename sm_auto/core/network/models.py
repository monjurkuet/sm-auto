"""
Network data models for SM-Auto framework.

Pydantic models for representing network requests, responses,
and intercepted data from CDP.
"""

from datetime import datetime
from typing import Optional, Dict, Any, List
from pydantic import BaseModel, Field


class RequestData(BaseModel):
    """Represents an HTTP request."""

    url: str
    method: str = Field(default="GET")
    headers: Dict[str, str] = Field(default_factory=dict)
    post_data: Optional[str] = Field(default=None)
    timestamp: datetime = Field(default_factory=datetime.now)

    class Config:
        """Pydantic config."""

        arbitrary_types_allowed = True


class ResponseData(BaseModel):
    """Represents an HTTP response."""

    url: str
    status: int
    status_text: str = Field(default="")
    headers: Dict[str, str] = Field(default_factory=dict)
    mime_type: str = Field(default="")
    body: Optional[str] = Field(default=None)
    timestamp: datetime = Field(default_factory=datetime.now)

    class Config:
        """Pydantic config."""

        arbitrary_types_allowed = True


class RequestEvent(BaseModel):
    """Represents a network request event from CDP."""

    request_id: str
    url: str
    method: str
    headers: Dict[str, str] = Field(default_factory=dict)
    post_data: Optional[str] = Field(default=None)
    timestamp: datetime = Field(default_factory=datetime.now)

    class Config:
        """Pydantic config."""

        arbitrary_types_allowed = True


class ResponseEvent(BaseModel):
    """Represents a network response event from CDP."""

    request_id: str
    url: str
    status: int
    status_text: str = Field(default="")
    mime_type: str = Field(default="")
    headers: Dict[str, str] = Field(default_factory=dict)
    body: Optional[str] = Field(default=None)
    timestamp: datetime = Field(default_factory=datetime.now)

    class Config:
        """Pydantic config."""

        arbitrary_types_allowed = True


class GraphQLRequest(BaseModel):
    """Represents a GraphQL API request."""

    url: str
    query_name: Optional[str] = Field(default=None)
    query: Optional[str] = Field(default=None)
    variables: Dict[str, Any] = Field(default_factory=dict)
    operation_name: Optional[str] = Field(default=None)

    class Config:
        """Pydantic config."""

        arbitrary_types_allowed = True


class GraphQLResponse(BaseModel):
    """Represents a GraphQL API response."""

    url: str
    data: Optional[Dict[str, Any]] = Field(default=None)
    errors: Optional[List[Dict[str, Any]]] = Field(default=None)
    extensions: Optional[Dict[str, Any]] = Field(default=None)

    class Config:
        """Pydantic config."""

        arbitrary_types_allowed = True


class NetworkCaptureEvent(BaseModel):
    """Represents a captured network event with metadata."""

    event_type: str  # "request" or "response"
    url: str
    method: Optional[str] = Field(default=None)
    status: Optional[int] = Field(default=None)
    mime_type: Optional[str] = Field(default=None)
    body: Optional[str] = Field(default=None)
    headers: Dict[str, str] = Field(default_factory=dict)
    timestamp: datetime = Field(default_factory=datetime.now)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    class Config:
        """Pydantic config."""

        arbitrary_types_allowed = True
