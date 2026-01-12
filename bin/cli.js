#!/usr/bin/env node
/**
 * Claude Compressor CLI
 * 
 * Usage:
 *   claude-compressor              # Start the proxy server
 *   claude-compressor --help       # Show help
 *   claude-compressor --status     # Check if running
 */

const { spawn, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const args = process.argv.slice(2);
const PORT = process.env.INTERCEPTOR_PORT || "8877";

function showHelp() {
  console.log(`
Claude Compressor - Compress Claude Code API requests to save tokens

Usage:
  claude-compressor [options]

Options:
  --help, -h        Show this help message
  --status, -s      Check if the proxy is running
  --stop            Stop the running proxy
  --daemon, -d      Run as background daemon

Environment Variables:
  TTC_KEY                 Your Token Company API key (required for compression)
  COMPRESSION_THRESHOLD   Aggressiveness 0-1 (default: 0.6)
  INTERCEPTOR_PORT        Port to listen on (default: 8877)
  MIN_TEXT_LENGTH         Minimum text length to compress (default: 150)

Example:
  # Start the proxy
  claude-compressor

  # Then run Claude pointing to the proxy
  ANTHROPIC_BASE_URL=http://127.0.0.1:8877 claude

  # Or add to your shell config (~/.zshrc):
  alias claude-c='ANTHROPIC_BASE_URL=http://127.0.0.1:8877 claude'
`);
}

function checkStatus() {
  try {
    execSync(`curl -s --connect-timeout 1 http://127.0.0.1:${PORT}`, { stdio: "pipe" });
    console.log(`✅ Claude Compressor is running on port ${PORT}`);
    return true;
  } catch {
    console.log(`❌ Claude Compressor is not running on port ${PORT}`);
    return false;
  }
}

function stopDaemon() {
  try {
    const result = execSync(`lsof -ti:${PORT}`, { stdio: "pipe" }).toString().trim();
    if (result) {
      execSync(`kill ${result}`);
      console.log(`✅ Stopped process on port ${PORT}`);
    } else {
      console.log(`ℹ️  No process found on port ${PORT}`);
    }
  } catch {
    console.log(`ℹ️  No process found on port ${PORT}`);
  }
}

function startDaemon() {
  const logFile = path.join(process.env.HOME, "claude-compressor.log");
  const interceptorPath = path.join(__dirname, "..", "src", "interceptor.js");
  
  console.log(`🚀 Starting Claude Compressor daemon...`);
  console.log(`   Log file: ${logFile}`);
  
  const out = fs.openSync(logFile, "a");
  const err = fs.openSync(logFile, "a");
  
  const child = spawn("node", [interceptorPath], {
    detached: true,
    stdio: ["ignore", out, err],
    env: process.env,
  });
  
  child.unref();
  
  // Wait a bit and check if it started
  setTimeout(() => {
    if (checkStatus()) {
      console.log(`\n📝 To use with Claude:`);
      console.log(`   ANTHROPIC_BASE_URL=http://127.0.0.1:${PORT} claude`);
    }
    process.exit(0);
  }, 1000);
}

// Main
if (args.includes("--help") || args.includes("-h")) {
  showHelp();
} else if (args.includes("--status") || args.includes("-s")) {
  process.exit(checkStatus() ? 0 : 1);
} else if (args.includes("--stop")) {
  stopDaemon();
} else if (args.includes("--daemon") || args.includes("-d")) {
  startDaemon();
} else {
  // Run in foreground
  require("../src/interceptor.js").startServer();
}

