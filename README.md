# Claude Compressor

Save tokens and money by compressing Claude Code API requests using [The Token Company](https://thetokencompany.com) API.

## Setup (3 steps)

**1. Install**

Clone the repository and run
```bash
./install.sh
```

**2. Add your API key to `~/.zshrc` or `~/.bashrc`**

Get compression API key from [The Token Company](https://thetokencompany.com)

```bash
export TTC_KEY="your_token_company_api_key"
export PATH="$HOME/.local/bin:$PATH"
```

**3. Reload your shell**
```bash
source ~/.zshrc
```

Done! Now use `claude-c` instead of `claude`.

## Usage

```bash
# Use Claude with compression
claude-c

# Adjust compression level (0-1, higher = more compression)
claude-c -0.8
```

## Requirements

- Docker ([Get Docker](https://docs.docker.com/get-docker/))
- Claude Code ([Get Claude Code](https://github.com/anthropics/claude-code))
- Token Company API key ([Sign up](https://thetokencompany.com))

## How It Works

```
Claude Code → Claude Compressor (localhost:8877) → Anthropic API
                     ↓
              Compress via The Token Company API
```

The `claude-c` wrapper automatically starts the Docker container and routes your requests through the compression proxy.

## Troubleshooting

**Container won't start?**
```bash
docker rm -f claude-compressor
./install.sh
```

**Check if it's working:**
```bash
tail -f ~/claude-compressor.log
```

**Reset everything:**
```bash
docker rm -f claude-compressor
docker rmi claude-compressor:latest
./install.sh
```

## License

MIT
