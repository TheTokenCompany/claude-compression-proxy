# Claude Compressor

A local proxy that intercepts Claude Code API requests and compresses messages using [The Token Company](https://thetokencompany.com) API to reduce token usage and costs.

## How It Works

```
Claude Code → Claude Compressor (localhost:8877) → Anthropic API
                     ↓
              Compress messages
              via Token Company API
```

1. Claude Compressor runs as a local HTTP proxy
2. You point Claude Code to use the proxy via `ANTHROPIC_BASE_URL`
3. The proxy intercepts `/messages` API calls
4. Long messages are compressed using The Token Company's compression API
5. Compressed requests are forwarded to the real Anthropic API

## Installation

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/claude-compressor.git
cd claude-compressor

# Install globally (adds 'claude-compressor' to PATH)
npm install -g .

# Or use directly
npm start
```

## Usage

### Quick Start

```bash
# 1. Set your Token Company API key
export TTC_KEY="your_ttc_api_key"

# 2. Start the proxy
claude-compressor

# 3. In another terminal, run Claude with the proxy
ANTHROPIC_BASE_URL=http://127.0.0.1:8877 claude
```

### Add to Shell Config

Add these lines to your `~/.zshrc` or `~/.bashrc`:

```bash
# Claude Compressor configuration
export TTC_KEY="your_ttc_api_key"

# Alias for compressed Claude
alias claude-c='ANTHROPIC_BASE_URL=http://127.0.0.1:8877 claude'

# Function to start compressor and run Claude
claude-compressed() {
  # Start compressor if not running
  if ! curl -s --connect-timeout 1 http://127.0.0.1:8877 > /dev/null 2>&1; then
    claude-compressor -d
    sleep 1
  fi
  ANTHROPIC_BASE_URL=http://127.0.0.1:8877 claude "$@"
}
```

Then reload your shell:
```bash
source ~/.zshrc
```

### CLI Options

```bash
claude-compressor           # Start proxy in foreground
claude-compressor -d        # Start as background daemon
claude-compressor -s        # Check if proxy is running
claude-compressor --stop    # Stop the daemon
claude-compressor -h        # Show help
```

## Configuration

Set these environment variables to customize behavior:

| Variable | Default | Description |
|----------|---------|-------------|
| `TTC_KEY` | (required) | Your Token Company API key |
| `INTERCEPTOR_PORT` | `8877` | Port for the proxy to listen on |
| `COMPRESSION_THRESHOLD` | `0.6` | Aggressiveness (0-1, higher = more compression) |
| `MIN_TEXT_LENGTH` | `150` | Minimum character length to compress |
| `LOG_FILE` | `~/claude-compressor.log` | Path to log file |

Example:
```bash
INTERCEPTOR_PORT=9000 COMPRESSION_THRESHOLD=0.8 claude-compressor
```

## Logs

View compression stats and activity:
```bash
tail -f ~/claude-compressor.log
```

Sample output:
```
[2024-01-15T10:30:00.000Z] 🚀 Claude Compressor starting...
[2024-01-15T10:30:00.001Z] ✅ Listening on http://127.0.0.1:8877
[2024-01-15T10:30:15.123Z] 🎯 POST /v1/messages
[2024-01-15T10:30:15.124Z] 🔍 Processing 5 messages
[2024-01-15T10:30:15.456Z]    ✨ 1250 → 890 tokens (-360)
[2024-01-15T10:30:15.789Z]    ✨ 2100 → 1450 tokens (-650)
[2024-01-15T10:30:15.790Z] ✅ Saved 1010 tokens this request
```

## Why?

Claude Code can use a lot of tokens, especially with large codebases. This proxy:

- **Saves money** by reducing token usage
- **Transparent** - no changes to Claude Code needed
- **Fast** - compression happens in parallel
- **Safe** - falls back to original text if compression fails

## Get a Token Company API Key

Sign up at [The Token Company](https://thetokencompany.com) to get your API key.

## License

MIT

