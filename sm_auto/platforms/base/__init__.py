"""
SM-Auto Platform Base Package.

Provides abstract base classes for platform implementations.
Defines interfaces for platforms, automation handlers, and parsers.

Classes:
    PlatformBase: Abstract base class for platform implementations
    AutomationBase: Abstract base class for automation handlers
    ParserBase: Abstract base class for data parsers
"""

from sm_auto.platforms.base.platform_base import PlatformBase, PlatformConfig
from sm_auto.platforms.base.automation_base import AutomationBase, AutomationState
from sm_auto.platforms.base.parser_base import ParserBase, JSONParserBase, HTMLParserBase

__all__ = [
    "PlatformBase",
    "PlatformConfig",
    "AutomationBase",
    "AutomationState",
    "ParserBase",
    "JSONParserBase",
    "HTMLParserBase",
]
