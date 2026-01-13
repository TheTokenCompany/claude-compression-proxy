#!/bin/bash
# Installation script for Claude Compressor

set -e

echo "--> Installing Claude Compressor"

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "[!] Docker is not installed. Please install Docker first:"
    echo "   https://docs.docker.com/get-docker/"
    exit 1
fi

# Build Docker image
echo "--> Building Docker image"
docker build -t claude-compressor:latest .

# Copy CLI script to user's local bin (or add to PATH)
BIN_DIR="${HOME}/.local/bin"
mkdir -p "$BIN_DIR"

echo "--> Installing claude-c command to ${BIN_DIR}"
cp bin/claude-c "$BIN_DIR/claude-c"
chmod +x "$BIN_DIR/claude-c"

# Check if ~/.local/bin is in PATH
if [[ ":$PATH:" != *":${BIN_DIR}:"* ]]; then
    echo ""
    echo "[WARN] ${BIN_DIR} is not in your PATH."
    echo "   Add this line to your ~/.zshrc or ~/.bashrc:"
    echo ""
    echo "   export PATH=\"\$HOME/.local/bin:\$PATH\""
    echo ""
fi

echo ""
echo "[OK] Installation complete!"
echo ""
echo "--- Next steps:"
echo "   1. Set your Token Company API key:"
echo "      export TTC_KEY=\"your_token_company_api_key\""
echo ""
echo "   2. Add to your ~/.zshrc or ~/.bashrc for persistence:"
echo "      echo 'export TTC_KEY=\"your_token_company_api_key\"' >> ~/.zshrc"
echo ""
echo "   3. Use the compressed Claude:"
echo "      claude-c       # Default compression aggressiveness (0.6)"
echo "      claude-c -0.8  # Higher compression aggressiveness (0.8)"
echo "      claude-c -0.3  # Lower compression aggressiveness (0.3)"
echo ""
echo "   4. View logs:"
echo "      tail -f ~/claude-compressor.log  # View compression statistics"
echo ""
