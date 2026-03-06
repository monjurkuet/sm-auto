# SM-Auto: Universal Web Automation Framework

A flexible, extensible automation framework built on [nodriver](https://ultrafunkamsterdam.github.io/nodriver) that supports multiple platforms including Facebook, Instagram, TikTok, and more.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [CLI Commands](#cli-commands)
- [Python API](#python-api)
- [Architecture](#architecture)
- [Configuration](#configuration)
- [Data Storage](#data-storage)
  - [JSON Storage](#json-file-storage-default)
  - [MongoDB Storage](#mongodb-storage)
  - [Expanded Data Collection](#expanded-data-collection)
  - [Raw Response Capture](#raw-response-capture)
- [Human-Like Behavior](#human-like-behavior)
- [Platform Support](#platform-support)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [License](#license)

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
- motor (for MongoDB support)
- pymongo (for MongoDB support)

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
# Search and export listings to JSON
sm-auto run facebook-marketplace -q "iphone" -p "Personal" -o listings.json

# Save to MongoDB
sm-auto run facebook-marketplace -q "iphone" --storage mongodb

# Save to both JSON and MongoDB
sm-auto run facebook-marketplace -q "iphone" --storage both

# With more scrolls
sm-auto run facebook-marketplace -q "macbook" -s 20

# Save raw GraphQL responses for analysis
sm-auto run facebook-marketplace -q "iphone" --save-raw

# Custom raw response output path
sm-auto run facebook-marketplace -q "iphone" --save-raw --raw-output ./raw_data/my_search.jsonl
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
│   ├── delays.py                 # Human-like delays
│   └── storage/                  # Storage backends
│       ├── mongodb_storage.py    # MongoDB storage
│       └── json_storage.py       # JSON file storage
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

## Data Storage

SM-Auto supports multiple storage backends for saving scraped data.

### JSON File Storage (Default)

Results are saved to JSON files in the `./output` directory by default:

```bash
# Default JSON output
sm-auto run facebook-marketplace -q "iphone" -o results.json
```

### MongoDB Storage

Configure MongoDB by creating a `.env` file:

```bash
# MongoDB Configuration
MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/
MONGODB_DATABASE=sm_auto
MONGODB_COLLECTION=facebook_marketplace

# Enable MongoDB via environment variable
SMAUTO_STORAGE__MONGODB__ENABLED=true
```

Then run with MongoDB storage:

```bash
# Save to MongoDB only
sm-auto run facebook-marketplace -q "iphone" --storage mongodb

# Save to both JSON and MongoDB
sm-auto run facebook-marketplace -q "iphone" --storage both
```

Or configure via `config.yaml`:

```yaml
storage:
  default_format: "mongodb"  # Options: json, mongodb, both
  mongodb:
    enabled: true
    database: "sm_auto"
    collection: "facebook_marketplace"
  json_config:
    enabled: true
    output_dir: "./output"
    filename_template: "{platform}_{query}_{timestamp}.json"
```

## Expanded Data Collection

Facebook Marketplace listings now include enhanced data fields for deeper analysis:

### New Fields

| Field | Type | Description |
|-------|------|-------------|
| `is_sold` | `bool` | Whether the listing is marked as sold |
| `is_pending` | `bool` | Whether the listing has a pending sale |
| `is_hidden` | `bool` | Whether the listing is hidden from public view |
| `category_id` | `str` | Marketplace category identifier (e.g., "electronics", "furniture") |
| `price_numeric` | `float` | Parsed numeric price value for sorting/filtering |
| `delivery_types` | `list[str]` | Available delivery options: `LOCAL_PICKUP`, `SHIPPING`, `ONLINE` |
| `price_converted` | `str` | Price with currency formatting and offset information |

### Example Queries Using New Fields

```bash
# Search for available items only (not sold/pending)
sm-auto run facebook-marketplace -q "iphone" --storage mongodb

# Query in MongoDB for available items with shipping
# { is_sold: false, is_pending: false, delivery_types: "SHIPPING" }

# Find items under $500 with local pickup
# { price_numeric: { $lt: 500 }, delivery_types: "LOCAL_PICKUP" }

# Analyze by category
# { category_id: "electronics", is_sold: false }
```

### Data Usage Examples

```python
# Filter available items only
available_listings = [
    listing for listing in results.listings
    if not listing.is_sold and not listing.is_pending
]

# Calculate average price by delivery type
from collections import defaultdict
prices_by_delivery = defaultdict(list)
for listing in results.listings:
    if listing.price_numeric:
        for delivery in listing.delivery_types:
            prices_by_delivery[delivery].append(listing.price_numeric)

# Category analysis
categories = {}
for listing in results.listings:
    cat = listing.category_id or "unknown"
    categories[cat] = categories.get(cat, 0) + 1
```

## Raw Response Capture

Save complete GraphQL API responses for debugging, analysis, or data extraction:

### CLI Flags

| Flag | Description |
|------|-------------|
| `--save-raw` | Enable saving raw responses to JSONL file |
| `--raw-output PATH` | Custom output path for JSONL file |

### Usage Examples

```bash
# Save raw responses with default filename
sm-auto run facebook-marketplace -q "iphone" --save-raw
# Output: ./output/facebook_marketplace_raw_iphone_20240304_122548.jsonl

# Custom output path
sm-auto run facebook-marketplace -q "macbook" --save-raw --raw-output ./data/raw_macbook.jsonl

# Combine with MongoDB storage
sm-auto run facebook-marketplace -q "furniture" --storage mongodb --save-raw
```

### JSONL Format

Each line in the JSONL file is a complete GraphQL response:

```jsonl
{"timestamp": "2024-03-04T12:25:48.123456", "query": "iphone", "response": {...}}
{"timestamp": "2024-03-04T12:25:52.789012", "query": "iphone", "response": {...}}
```

### Use Cases

- **API Analysis**: Inspect raw GraphQL structure for custom parsing
- **Debugging**: Compare parsed results with original responses
- **Data Recovery**: Re-extract data if parsing logic changes
- **Research**: Analyze Facebook's internal data structures
- **Backup**: Preserve complete raw data before filtering

### Processing Raw Responses

```python
import json

# Read and process JSONL file
with open("facebook_marketplace_raw_iphone_20240304.jsonl", "r") as f:
    for line in f:
        record = json.loads(line)
        timestamp = record["timestamp"]
        response_data = record["response"]
        # Process raw response data...
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
| Facebook Marketplace | ✓ Stable | Search, feed scraping, network capture, MongoDB/JSON storage |
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
