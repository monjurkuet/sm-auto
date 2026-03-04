"""Platform implementations for SM-Auto framework."""

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
