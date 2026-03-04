# SM-Auto: Universal Web Automation Framework

A flexible, extensible automation framework built on [nodriver](https://ultrafunkamsterdam.github.io/nodriver) that supports multiple platforms including Facebook, Instagram, TikTok, and more.

## Features

- **Profile-based automation**: Use existing Chrome profiles with saved login sessions
- **CDP network interception**: Capture API traffic directly via Chrome DevTools Protocol
- **Human-like behavior**: Variable delays and realistic interaction patterns
- **Multi-platform support**: Extensible architecture for different platforms
- **Manual CAPTCHA handling**: Pause automation for manual challenge solving
- **No stealth patches needed**: nodriver handles WAF evasion automatically

## Installation

```bash
# Clone the repository
cd /root/codebase/sm-auto

# Install with uv (recommended)
uv pip install -e .

# Or with pip
pip install -e .
```

### Dependencies

- Python 3.10+
- Google Chrome (or Chromium)
- nodriver
- pydantic
- pyyaml
- click
- beautifulsoup4

## Quick Start

### 1. List Available Chrome Profiles

```bash
sm-auto profile list
```

### 2. Test a Profile

```bash
sm-auto run test --profile "Personal"
```

### 3. Run Facebook Marketplace Automation

```bash
# Search and export listings
sm-auto run facebook-marketplace -q "iphone" -p "Personal" -o listings.json

# With more scrolls
sm-auto run facebook-marketplace -q "macbook" -s 20
```

### 4. Authenticate (if needed)

```bash
# Launch browser for manual login
sm-auto auth --platform facebook --profile "new-profile"
```

## CLI Commands

### Profile Management

```bash
# List all Chrome profiles
sm-auto profile list

# List with verbose output
sm-auto profile list -v

# Verify a profile
sm-auto profile verify "Personal"

# Copy a profile
sm-auto profile copy "Personal"

# Clean old copies
sm-auto profile clean --days 7

# Show profile info
sm-auto profile info "Personal"
```

### Running Automation

```bash
# Facebook Marketplace search
sm-auto run facebook-marketplace -q "iphone" -p "Personal" -o output.json

# Test automation
sm-auto run test --profile "Personal"

# Headless mode
sm-auto run facebook-marketplace -q "iphone" --headless
```

### Authentication

```bash
# Interactive login
sm-auto auth --platform facebook
```

## Python API

### Basic Example

```python
import asyncio
from sm_auto.core.browser.profile_manager import ProfileManager
from sm_auto.core.browser.session_manager import SessionManager
from sm_auto.platforms.facebook.marketplace.automation import FacebookMarketplacePlatform

async def main():
    # Get profile
    profile_mgr = ProfileManager()
    profiles = await profile_mgr.discover_profiles()
    profile = profiles[0]  # Use first profile

    # Verify and copy
    await profile_mgr.verify_profile(profile)
    copied_path = await profile_mgr.copy_profile(profile)

    # Start session
    session_mgr = SessionManager()
    await session_mgr.start(profile_path=copied_path)

    # Initialize platform
    platform = FacebookMarketplacePlatform(session_mgr)
    await platform.initialize()

    # Run automation
    automation = platform.get_automation()
    result = await automation.search("iphone", max_scroll_count=10)

    # Process results
    for listing in result.listings:
        print(f"{listing.title} - {listing.price}")

    # Cleanup
    await session_mgr.stop()

asyncio.run(main())
```

### Using the Example Script

```bash
# Run the example directly
python -m sm_auto.examples.facebook_marketplace --query "iphone" --profile "Personal"

# With output file
python -m sm_auto.examples.facebook_marketplace -q "macbook" -o results.json
```

## Architecture

```
sm_auto/
├── core/
│   ├── browser/
│   │   ├── profile_manager.py    # Chrome profile discovery & management
│   │   ├── driver_factory.py     # nodriver launch wrapper
│   │   └── session_manager.py    # Session lifecycle management
│   ├── network/
│   │   ├── models.py             # Pydantic data models
│   │   ├── cdp_interceptor.py    # CDP network capture
│   │   └── capture_service.py    # Event routing & filtering
│   └── auth/
│       └── session_storage.py    # Cookie persistence
├── platforms/
│   ├── base/
│   │   ├── platform_base.py      # Platform interface
│   │   ├── automation_base.py    # State machine & helpers
│   │   └── parser_base.py        # Parser interface
│   └── facebook/
│       └── marketplace/
│           ├── models.py         # Marketplace data models
│           ├── parser.py         # GraphQL response parser
│           └── automation.py     # Marketplace automation
├── utils/
│   ├── logger.py                 # Centralized logging
│   ├── config.py                 # Configuration management
│   └── delays.py                 # Human-like delays
├── cli/
│   ├── main.py                   # CLI entry point
│   ├── profile_commands.py       # Profile management commands
│   └── run_commands.py           # Automation commands
└── examples/
    └── facebook_marketplace.py   # Example script
```

## Configuration

Create a `config.yaml` file:

```yaml
browser:
  headless: false
  window_width: 1920
  window_height: 1080

profiles:
  working_directory: "./working_profiles"
  max_copies: 3

delays:
  wpm: 60
  action_delay_min: 0.5
  action_delay_max: 2.5

network:
  interception_enabled: true
  filters:
    - "graphql"
    - "api"
```

Or use environment variables:

```bash
export SMAUTO_BROWSER_HEADLESS=false
export SMAUTO_DELAYS_WPM=60
```

## Human-Like Behavior

The framework includes built-in delays to simulate realistic human behavior:

| Delay Type | Range | Use Case |
| --- | --- | --- |
| Micro delay | 80-200ms | Between keystrokes |
| Action delay | 0.5-2.5s | Between UI actions |
| Task delay | 2-8s | Between distinct tasks |
| Page delay | 1.5-4s | After page navigation |
| Reading pause | 3-12s | Simulating reading content |

## Platform Support

| Platform | Status | Features |
| --- | --- | --- |
| Facebook Marketplace | ✓ Stable | Search, feed scraping, network capture |
| Instagram | ○ Planned | Profile scraping, hashtag search |
| TikTok | ○ Planned | Video scraping, user profiles |

## Troubleshooting

### No Profiles Found

Make sure Google Chrome is installed and has been used:

```bash
# Windows
%LOCALAPPDATA%\Google\Chrome\User Data\

# macOS
~/Library/Application Support/Google/Chrome/

# Linux
~/.config/google-chrome/
```

### Profile Locked Error

Close any Chrome windows using that profile before running automation.

### CAPTCHA/Challenge Detected

The framework will pause and wait for you to solve the challenge manually. Watch the browser window and solve any challenges that appear.

### Not Logged In

Use a profile that has an active Facebook session, or run `sm-auto auth` to create one.

## Development

```bash
# Install dev dependencies
uv pip install -e ".[dev]"

# Run tests
pytest

# Format code
black sm_auto/

# Type checking
mypy sm_auto/
```

## License

MIT License - see LICENSE file for details.

## Contributing

Contributions are welcome! Please read the contributing guidelines before submitting PRs.
