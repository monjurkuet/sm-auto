# SM-Auto Configuration Guide

This document explains the configuration system for SM-Auto, a universal web automation framework built on nodriver.

---

## Table of Contents

1. [Configuration Hierarchy](#configuration-hierarchy)
2. [Configuration File Format](#configuration-file-format)
3. [Environment Variables](#environment-variables)
4. [Configuration Options](#configuration-options)
5. [Platform-Specific Settings](#platform-specific-settings)
6. [Selector Configuration](#selector-configuration)
7. [Examples](#examples)

---

## Configuration Hierarchy

SM-Auto loads configuration from multiple sources with the following priority (highest to lowest):

1. **Command-line arguments** - Override specific options
2. **Environment variables** - For sensitive data and dynamic configuration
3. **Custom config file** - Path specified via `--config` or `-c` flag
4. **Project config** - `./config/sm_auto.yaml` or `./config/default_config.yaml`
5. **User config** - `~/.sm_auto/config.yaml`
6. **Default config** - Built-in defaults in `sm_auto/config/default_config.yaml`

---

## Configuration File Format

SM-Auto uses YAML format for configuration files. Here's the complete schema:

```yaml
# Browser Configuration
browser:
  headless: false              # Run browser in headless mode
  user_agent: null            # Custom user agent string
  window_width: 1280          # Browser window width
  window_height: 720          # Browser window height
  disable_images: false       # Disable image loading for faster scraping
  proxy: null                 # Proxy server URL (e.g., "http://proxy:port")

# Profile Configuration
profiles:
  chrome_user_data_dir: null  # Path to Chrome user data directory
  auto_discover: true         # Auto-detect Chrome installations
  copy_on_use: false          # Copy profile before using (slower but safer)

# Delay Configuration (for human-like behavior)
delays:
  micro_delay_min: 0.08       # Minimum delay between keystrokes (seconds)
  micro_delay_max: 0.2        # Maximum delay between keystrokes (seconds)
  action_delay_min: 0.5       # Minimum delay between actions (seconds)
  action_delay_max: 2.5       # Maximum delay between actions (seconds)
  task_delay_min: 2.0         # Minimum delay between tasks (seconds)
  task_delay_max: 8.0         # Maximum delay between tasks (seconds)
  page_delay_min: 1.5         # Minimum delay after page load (seconds)
  page_delay_max: 4.0         # Maximum delay after page load (seconds)
  reading_pause_min: 3.0      # Minimum reading pause (seconds)
  reading_pause_max: 12.0     # Maximum reading pause (seconds)
  session_gap_min: 5.0        # Minimum gap between sessions (seconds)
  session_gap_max: 15.0       # Maximum gap between sessions (seconds)

# Network Interception
network:
  enabled: true               # Enable CDP network interception
  capture_json: true          # Capture JSON responses
  capture_graphql: true       # Capture GraphQL requests/responses
  ignored_mimes:              # MIME types to ignore
    - image/png
    - image/jpeg
    - image/gif
    - image/webp
    - text/css
    - application/javascript

# Storage Configuration
storage:
  format: json                # Output format: "json", "mongodb", or "both"
  json:
    enabled: true
    output_dir: "./output"    # Output directory for JSON files
    filename_template: "{platform}_{query}_{timestamp}.json"
  mongodb:
    enabled: false
    uri: null                 # MongoDB connection URI
    database: "sm_auto"      # Database name
    collection: "marketplace" # Collection name

# Logging Configuration
logging:
  level: "INFO"               # Log level: DEBUG, INFO, WARNING, ERROR, CRITICAL
  file: null                  # Log file path (null = stdout only)
  format: "%(asctime)s - %(name)s - %(levelname)s - %(message)s"

# Platform-Specific Configuration
platforms:
  facebook:
    marketplace:
      scroll_limit: 10        # Maximum scroll iterations
      min_price: null        # Minimum price filter
      max_price: null        # Maximum price filter
      category: null          # Category filter
```

---

## Environment Variables

SM-Auto supports the following environment variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `SM_AUTO_CONFIG` | Path to custom config file | `/path/to/config.yaml` |
| `SM_AUTO_HEADLESS` | Run in headless mode | `true` or `false` |
| `SM_AUTO_LOG_LEVEL` | Logging level | `DEBUG` |
| `SM_AUTO_CHROME_USER_DATA_DIR` | Chrome profile directory | `~/.config/google-chrome` |
| `SM_AUTO_PROXY` | Proxy server URL | `http://proxy:8080` |
| `MONGODB_URI` | MongoDB connection URI | `mongodb://localhost:27017` |
| `FACEBOOK_EMAIL` | Facebook email (for auth) | `user@example.com` |
| `FACEBOOK_PASSWORD` | Facebook password | `secretpassword` |

**Note:** Sensitive credentials should be stored in a `.env` file (see `.env.example`).

---

## Configuration Options

### Browser Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `headless` | bool | false | Run browser without visible window |
| `user_agent` | string | null | Custom User-Agent header |
| `window_width` | int | 1280 | Browser viewport width |
| `window_height` | int | 720 | Browser viewport height |
| `disable_images` | bool | false | Block image requests |
| `proxy` | string | null | HTTP/SOCKS proxy |

### Profile Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `chrome_user_data_dir` | string | null | Custom Chrome profile path |
| `auto_discover` | bool | true | Auto-detect Chrome installations |
| `copy_on_use` | bool | false | Copy profile before use |

### Delay Settings

All delays use random values within the specified range to simulate human behavior.

| Option | Default Range | Description |
|--------|---------------|-------------|
| `micro_delay` | 80-200ms | Between keystrokes |
| `action_delay` | 0.5-2.5s | Between UI actions |
| `task_delay` | 2-8s | Between major tasks |
| `page_delay` | 1.5-4s | After page navigation |
| `reading_pause` | 3-12s | Simulated reading time |
| `session_gap` | 5-15s | Between sessions |

### Storage Settings

#### JSON Storage

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | bool | true | Enable JSON output |
| `output_dir` | string | "./output" | Output directory |
| `filename_template` | string | see above | Filename pattern |

Filename template variables:
- `{platform}` - Platform name
- `{query}` - Search query
- `{timestamp}` - ISO timestamp
- `{date}` - Date only (YYYYMMDD)

#### MongoDB Storage

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | bool | false | Enable MongoDB output |
| `uri` | string | null | Connection URI |
| `database` | string | "sm_auto" | Database name |
| `collection` | string | "marketplace" | Collection name |

---

## Platform-Specific Settings

### Facebook Marketplace

```yaml
platforms:
  facebook:
    marketplace:
      scroll_limit: 10        # How many times to scroll
      min_price: 100          # Minimum price (optional)
      max_price: 5000         # Maximum price (optional)
      category: "electronics"  # Category filter (optional)
```

### Facebook Page

```yaml
platforms:
  facebook:
    page:
      save_debug_html: false  # Save HTML for debugging
      max_scrolls: 15         # Scroll iterations for lazy loading
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `save_debug_html` | bool | false | Save HTML files for debugging |
| `max_scrolls` | int | 15 | Maximum scroll iterations |

---

## Selector Configuration

Selectors are stored in YAML files to allow updates without code changes:

- Default: `sm_auto/config/facebook_selectors.yaml`
- Project: `./config/facebook_selectors.yaml`
- User: `~/.sm_auto/facebook_selectors.yaml`

See [facebook_selectors.yaml](../sm_auto/config/facebook_selectors.yaml) for the complete selector configuration.

---

## Examples

### Minimal Configuration

```yaml
browser:
  headless: false

storage:
  format: json
  json:
    enabled: true
    output_dir: "./output"
```

### Production Configuration

```yaml
browser:
  headless: true
  proxy: "http://proxy.company.com:8080"

delays:
  micro_delay_min: 0.1
  micro_delay_max: 0.3
  action_delay_min: 1.0
  action_delay_max: 3.0

network:
  enabled: true
  ignored_mimes:
    - image/*
    - text/css
    - application/javascript

storage:
  format: both
  json:
    enabled: true
    output_dir: "/data/scrapes"
  mongodb:
    enabled: true
    uri: "${MONGODB_URI}"
    database: "production"
    collection: "listings"

logging:
  level: WARNING
  file: "/var/log/sm-auto/app.log"
```

### Configuration via Environment Variables

```bash
# Set environment variables
export SM_AUTO_HEADLESS=true
export SM_AUTO_LOG_LEVEL=DEBUG
export MONGODB_URI="mongodb://user:pass@localhost:27017"

# Run the tool
sm-auto run facebook-marketplace --query "iPhone"
```

---

## Related Documentation

- [API Documentation](../README.md)
- [Selector Configuration](facebook_selectors.yaml)
- [Exception Handling](../sm_auto/core/exceptions.py)
- [CLI Commands](../sm_auto/cli/main.py)
