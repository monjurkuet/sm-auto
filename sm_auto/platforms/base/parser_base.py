"""
Parser Base Module for SM-Auto framework.

Provides base classes for parsing JSON API responses and HTML content.
"""

import json
from abc import ABC, abstractmethod
from typing import Optional, Dict, Any, List, TypeVar, Generic

from sm_auto.utils.logger import get_logger
from sm_auto.core.exceptions import ParserError, ParseValidationError

logger = get_logger(__name__)

T = TypeVar("T")


class ParserBase(ABC, Generic[T]):
    """
    Abstract base class for data parsers.

    Provides a common interface for parsing API responses
    and HTML content into structured data models.
    """

    def __init__(self):
        """Initialize the parser."""
        self._parse_errors: List[str] = []

    @abstractmethod
    def parse(self, data: Any) -> Optional[T]:
        """
        Parse raw data into a structured model.

        Args:
            data: Raw data to parse.

        Returns:
            Parsed data model or None.
        """
        pass

    @abstractmethod
    def parse_many(self, data: Any) -> List[T]:
        """
        Parse raw data into a list of models.

        Args:
            data: Raw data to parse.

        Returns:
            List of parsed data models.
        """
        pass

    def get_parse_errors(self) -> List[str]:
        """
        Get list of parse errors.

        Returns:
            List of error messages.
        """
        return self._parse_errors.copy()

    def clear_errors(self) -> None:
        """Clear parse errors."""
        self._parse_errors.clear()

    def _record_error(self, message: str) -> None:
        """
        Record a parse error.

        Args:
            message: Error message.
        """
        self._parse_errors.append(message)
        logger.debug(f"Parse error: {message}")


class JSONParserBase(ParserBase[T], ABC):
    """
    Base class for JSON response parsers.

    Provides common functionality for parsing JSON API responses.
    """

    def parse_json(self, json_str: str) -> Optional[T]:
        """
        Parse a JSON string.

        Args:
            json_str: JSON string to parse.

        Returns:
            Parsed data model or None.
        """
        try:
            data = json.loads(json_str)
            return self.parse(data)
        except json.JSONDecodeError as e:
            self._record_error(f"JSON decode error: {e}")
            return None

    def parse_json_safe(self, json_str: str) -> Optional[Dict[str, Any]]:
        """
        Safely parse JSON string to dictionary.

        Args:
            json_str: JSON string to parse.

        Returns:
            Parsed dictionary or None.
        """
        try:
            return json.loads(json_str)
        except json.JSONDecodeError as e:
            self._record_error(f"JSON decode error: {e}")
            return None

    def get_nested(
        self,
        data: Dict[str, Any],
        *keys: str,
        default: Any = None,
    ) -> Any:
        """
        Safely get a nested value from a dictionary.

        Args:
            data: Dictionary to search.
            keys: Keys to traverse.
            default: Default value if not found.

        Returns:
            Value at the nested key path or default.
        """
        current = data
        for key in keys:
            if isinstance(current, dict) and key in current:
                current = current[key]
            else:
                return default
        return current

    def find_key_recursive(
        self,
        obj: Any,
        target_key: str,
        max_depth: int = 10,
    ) -> Any:
        """
        Recursively find a value by key in a nested structure.

        Args:
            obj: Object to search.
            target_key: Key to find.
            max_depth: Maximum recursion depth.

        Returns:
            Value at the key or None.
        """

        def _search(
            current: Any,
            key: str,
            depth: int = 0,
        ) -> Any:
            if depth > max_depth:
                return None

            if isinstance(current, dict):
                if key in current:
                    return current[key]
                for k, v in current.items():
                    result = _search(v, key, depth + 1)
                    if result is not None:
                        return result

            elif isinstance(current, list):
                for item in current:
                    result = _search(item, key, depth + 1)
                    if result is not None:
                        return result

            return None

        return _search(obj, target_key)


class HTMLParserBase(ParserBase[T], ABC):
    """
    Base class for HTML content parsers.

    Provides common functionality for parsing HTML content
    using BeautifulSoup.
    """

    def __init__(self):
        """Initialize the HTML parser."""
        super().__init__()
        self._soup = None

    def set_html(self, html: str) -> None:
        """
        Set the HTML content to parse.

        Args:
            html: HTML content.
        """
        try:
            from bs4 import BeautifulSoup

            self._soup = BeautifulSoup(html, "html.parser")
        except ImportError:
            self._record_error("BeautifulSoup not available")
        except Exception as e:
            self._record_error(f"HTML parse error: {e}")

    def clear_html(self) -> None:
        """Clear the current HTML content."""
        self._soup = None

    def select(self, selector: str) -> List[Any]:
        """
        Select elements using CSS selector.

        Args:
            selector: CSS selector.

        Returns:
            List of matching elements.
        """
        if self._soup is None:
            return []

        try:
            return self._soup.select(selector)
        except Exception as e:
            self._record_error(f"Selector error: {e}")
            return []

    def select_one(self, selector: str) -> Optional[Any]:
        """
        Select a single element using CSS selector.

        Args:
            selector: CSS selector.

        Returns:
            First matching element or None.
        """
        results = self.select(selector)
        return results[0] if results else None

    def get_text(self, selector: str, default: str = "") -> str:
        """
        Get text content of an element.

        Args:
            selector: CSS selector.
            default: Default value if not found.

        Returns:
            Text content or default.
        """
        element = self.select_one(selector)
        if element:
            return element.get_text(strip=True) or default
        return default

    def get_attribute(
        self,
        selector: str,
        attribute: str,
        default: str = "",
    ) -> str:
        """
        Get an attribute value from an element.

        Args:
            selector: CSS selector.
            attribute: Attribute name.
            default: Default value if not found.

        Returns:
            Attribute value or default.
        """
        element = self.select_one(selector)
        if element and element.has_attr(attribute):
            return element[attribute] or default
        return default
