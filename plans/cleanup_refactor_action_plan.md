# SM-Auto Cleanup & Refactor Action Plan

**Generated:** 2026-03-04  
**Based On:** Complete Codebase Analysis

---

## Executive Summary

This document provides a detailed, actionable plan for cleaning up and refactoring the SM-Auto codebase. The plan is organized by priority and implementation phase.

---

## Phase 1: Critical Bug Fixes (Priority 1)

### Task 1.1: Fix Duplicate Exception Definition

**File:** `sm_auto/core/exceptions.py`  
**Lines:** 51-54  
**Severity:** Critical

**Issue:**
```python
# Line 51 - This overwrites the first definition!
class ProfileNotFoundError(ProfileError):
    """Raised when Chrome installation is not found."""
    pass
```

**Action:**
1. Rename class to `ChromeInstallationNotFoundError`
2. Update docstring to clarify distinction
3. Update any imports in other files

**Files to Check for Imports:**
- `sm_auto/core/browser/profile_manager.py`
- `sm_auto/utils/security.py`
- `sm_auto/cli/profile_commands.py`

**Expected Result:**
```python
class ChromeInstallationNotFoundError(ProfileError):
    """
    Raised when Chrome browser installation cannot be found on the system.
    
    This is distinct from ProfileNotFoundError which is raised when a specific
    profile cannot be found within an existing Chrome installation.
    """
    pass
```

---

### Task 1.2: Remove Debug Print Statement

**File:** `sm_auto/core/network/cdp_interceptor.py`  
**Line:** 249  
**Severity:** High

**Issue:**
```python
print(f"[CDP] Pushing response to queue: {url}, body length: {len(body) if body else 0}")
```

**Action:**
Replace with proper logging:
```python
logger.debug(f"[CDP] Pushing response to queue: {url}, body length: {len(body) if body else 0}")
```

---

## Phase 2: Type Safety Improvements (Priority 2)

### Task 2.1: Add Type Hints to CLI Modules

**Files:**
- `sm_auto/cli/main.py`
- `sm_auto/cli/profile_commands.py`
- `sm_auto/cli/run_commands.py`

**Actions:**

1. Add return type hints to all command functions:
```python
# Before
@click.command()
def list_profiles(verbose: bool):
    """List all available Chrome profiles."""

# After
@click.command()
def list_profiles(verbose: bool) -> None:
    """List all available Chrome profiles."""
```

2. Add type hints for click context:
```python
from click import Context

@click.pass_context
def some_command(ctx: Context, ...) -> None:
```

3. Add Optional imports for nullable params:
```python
from typing import Optional

def facebook_marketplace(
    query: str,
    profile: Optional[str],
    output: Optional[str],
) -> None:
```

---

### Task 2.2: Fix Mutable Default Pattern

**File:** `sm_auto/core/browser/profile_manager.py`  
**Line:** 49  
**Severity:** Low (already handled but not idiomatic)

**Current:**
```python
@dataclass
class ChromeUserDataDir:
    profiles: List[ChromeProfile] = None  # type: ignore
    
    def __post_init__(self):
        if self.profiles is None:
            self.profiles = []
```

**Improved:**
```python
from dataclasses import dataclass, field

@dataclass
class ChromeUserDataDir:
    profiles: List[ChromeProfile] = field(default_factory=list)
```

---

## Phase 3: Performance Improvements (Priority 3)

### Task 3.1: Cache Settings to Avoid Repeated Loading

**File:** `sm_auto/utils/delays.py`  
**Lines:** 17-35  
**Severity:** Medium

**Current Implementation:**
```python
async def micro_delay() -> None:
    from sm_auto.utils.config import get_settings
    settings = get_settings()  # Loaded every time!
    delay = random.uniform(settings.delays.micro_delay_min, settings.delays.micro_delay_max)
    await asyncio.sleep(delay)
```

**Improved Implementation:**
```python
from functools import lru_cache
from typing import Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from sm_auto.utils.config import Settings

# Module-level cache
_settings_cache: Optional["Settings"] = None

def _get_cached_settings() -> "Settings":
    """Get cached settings to avoid repeated loading."""
    global _settings_cache
    if _settings_cache is None:
        from sm_auto.utils.config import get_settings
        _settings_cache = get_settings()
    return _settings_cache

def clear_settings_cache() -> None:
    """Clear settings cache for testing or config reload."""
    global _settings_cache
    _settings_cache = None

async def micro_delay() -> None:
    settings = _get_cached_settings()
    delay = random.uniform(settings.delays.micro_delay_min, settings.delays.micro_delay_max)
    await asyncio.sleep(delay)
```

---

### Task 3.2: Implement Async File I/O

**File:** `sm_auto/core/browser/profile_manager.py`  
**Lines:** 244-260  
**Severity:** Medium

**Current (Synchronous):**
```python
def _read_preferences(self, preferences_path: Path) -> Optional[Dict[str, Any]]:
    try:
        with open(preferences_file, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError) as e:
        logger.debug(f"Could not read preferences: {e}")
        return None
```

**Improved (Async):**
```python
import aiofiles

async def _read_preferences_async(self, preferences_path: Path) -> Optional[Dict[str, Any]]:
    """Read preferences file asynchronously."""
    try:
        async with aiofiles.open(preferences_path, "r") as f:
            content = await f.read()
            return json.loads(content)
    except (json.JSONDecodeError, IOError) as e:
        logger.debug(f"Could not read preferences: {e}")
        return None
```

Update `discover_profiles()` to use the async version.

---

## Phase 4: Security Improvements (Priority 4)

### Task 4.1: Add Path Validation to CLI

**File:** `sm_auto/cli/profile_commands.py`  
**Lines:** 260-270  
**Severity:** Medium

**Current:**
```python
if path:
    profile_path = Path(path)  # No validation!
```

**Improved:**
```python
from sm_auto.utils.security import validate_profile_path

if path:
    profile_path = validate_profile_path(Path(path))
```

The `validate_profile_path()` function already exists in `sm_auto/utils/security.py`.

---

### Task 4.2: Sanitize Browser Args in Logs

**File:** `sm_auto/core/browser/driver_factory.py`  
**Line:** 88  
**Severity:** Low

**Current:**
```python
logger.debug(f"Args: {browser_args}")
```

**Improved:**
The `sanitize_browser_args()` function already exists and is being used correctly.
Verify it's filtering sensitive data properly.

---

## Phase 5: Code Organization (Priority 5)

### Task 5.1: Fix Import Ordering

**Files to Fix:**
- `sm_auto/cli/profile_commands.py`
- `sm_auto/platforms/facebook/marketplace/automation.py`

**Standard Import Order:**
1. Standard library imports
2. Third-party imports
3. Local application imports

**Example:**
```python
# 1. Standard library
import asyncio
import json
from pathlib import Path
from typing import Optional, List

# 2. Third-party
import click
import nodriver as uc

# 3. Local
from sm_auto.utils.logger import get_logger
from sm_auto.core.exceptions import ProfileNotFoundError
```

---

### Task 5.2: Extract Hardcoded Selectors to Config

**File:** `sm_auto/platforms/facebook/marketplace/automation.py`  
**Lines:** 33-55  
**Severity:** Medium

**Current:**
```python
FACEBOOK_SELECTORS = {
    "search_input": 'input[aria-label="Search Marketplace"]',
    "search_input_alt": 'input[placeholder="Search Marketplace"]',
    ...
}
```

**Action:**
1. Move selectors to `sm_auto/config/facebook_selectors.yaml`
2. Load using existing `SelectorConfig` class
3. Add fallback chains

**YAML Structure:**
```yaml
selectors:
  search:
    input: 'input[aria-label="Search Marketplace"]'
    input_alt: 'input[placeholder="Search Marketplace"]'
    button: 'button[aria-label="Search"]'
  feed:
    container: '[data-pagelet="MainFeed"]'
    listing_card: '[data-testid="marketplace-feed-item"]'
  
fallbacks:
  search.input:
    - 'input[aria-label="Search Marketplace"]'
    - 'input[placeholder="Search Marketplace"]'
    - 'input[type="search"]'
```

---

## Phase 6: Testing Improvements (Priority 6)

### Task 6.1: Add Tests for Profile Manager

**Create:** `tests/test_profile_manager.py`

**Test Cases:**
1. Profile discovery on different OS
2. Profile verification
3. Profile copying
4. Error handling (ProfileNotFoundError)
5. Path validation

**Example:**
```python
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock

from sm_auto.core.browser.profile_manager import ProfileManager, ChromeProfile
from sm_auto.core.exceptions import ProfileNotFoundError


class TestProfileManager:
    @pytest.fixture
    def manager(self):
        return ProfileManager()

    @pytest.mark.asyncio
    async def test_discover_profiles_returns_list(self, manager):
        with patch.object(manager, '_get_chrome_user_data_dir'):
            profiles = await manager.discover_profiles()
            assert isinstance(profiles, list)

    @pytest.mark.asyncio
    async def test_verify_profile_raises_on_invalid(self, manager):
        with pytest.raises(ProfileNotFoundError):
            await manager.verify_profile("nonexistent_profile")
```

---

### Task 6.2: Add Tests for Network Interception

**Create:** `tests/test_network_interception.py`

**Test Cases:**
1. CDP event handling
2. Response capture
3. Queue management
4. URL filtering
5. MIME type filtering

---

### Task 6.3: Add Tests for CLI Commands

**Create:** `tests/test_cli.py`

**Test Cases:**
1. Command parsing
2. Argument validation
3. Error handling
4. Help text generation

Use `click.testing.CliRunner` for testing.

---

## Phase 7: Documentation Improvements (Priority 7)

### Task 7.1: Add Module Docstrings

Add module-level docstrings to all files missing them:
- `sm_auto/cli/__init__.py`
- `sm_auto/config/__init__.py`
- `sm_auto/core/auth/__init__.py`
- `sm_auto/core/browser/__init__.py`
- `sm_auto/core/network/__init__.py`
- `sm_auto/platforms/base/__init__.py`
- `sm_auto/platforms/facebook/__init__.py`
- `sm_auto/platforms/facebook/auth/__init__.py`
- `sm_auto/platforms/facebook/marketplace/__init__.py`

### Task 7.2: Add Configuration Documentation

Create `docs/configuration.md` explaining:
1. Configuration hierarchy (env vars > config file > defaults)
2. All available options
3. Example configurations
4. Platform-specific settings

---

## Implementation Checklist

### Phase 1: Critical Bugs
- [ ] 1.1 Fix duplicate exception definition
- [ ] 1.2 Remove debug print statement

### Phase 2: Type Safety
- [ ] 2.1 Add type hints to CLI modules
- [ ] 2.2 Fix mutable default pattern

### Phase 3: Performance
- [ ] 3.1 Cache settings in delays module
- [ ] 3.2 Implement async file I/O

### Phase 4: Security
- [ ] 4.1 Add path validation to CLI
- [ ] 4.2 Verify log sanitization

### Phase 5: Organization
- [ ] 5.1 Fix import ordering
- [ ] 5.2 Extract selectors to config

### Phase 6: Testing
- [ ] 6.1 Add profile manager tests
- [ ] 6.2 Add network interception tests
- [ ] 6.3 Add CLI tests

### Phase 7: Documentation
- [ ] 7.1 Add module docstrings
- [ ] 7.2 Create configuration documentation

---

## Success Criteria

| Metric | Before | Target After |
|--------|--------|--------------|
| Critical Bugs | 2 | 0 |
| Type Coverage | 70% | 90%+ |
| Test Coverage | ~40% | 80%+ |
| Files with Missing Docstrings | 15 | 0 |
| Code Style Issues | 10+ | 0 |

---

## Notes

1. **Testing Strategy:** Use pytest with pytest-asyncio for async code
2. **Type Checking:** Run mypy regularly during development
3. **Linting:** Use ruff for fast linting
4. **Formatting:** Use black with 88 character line length
5. **Version Control:** Make small, focused commits for each task
