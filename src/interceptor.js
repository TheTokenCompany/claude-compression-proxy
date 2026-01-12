#!/usr/bin/env node
/**
 * Claude API Interceptor (Reverse Proxy)
 *
 * Acts as a local Anthropic API that compresses requests
 * before forwarding them to the real API.
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

// Configuration
const config = {
  port: parseInt(process.env.INTERCEPTOR_PORT || "8877"),
  ttcKey: process.env.TTC_KEY,
  compressionThreshold: parseFloat(process.env.COMPRESSION_THRESHOLD || "0.6"),
  compressionApi: "https://api.thetokencompany.com/v1/compress",
  anthropicHost: "api.anthropic.com",
  logFile: process.env.LOG_FILE || path.join(process.env.HOME, "claude-compressor.log"),
  minTextLength: parseInt(process.env.MIN_TEXT_LENGTH || "150"),
};

// Stats
const stats = {
  requests: 0,
  compressed: 0,
  tokensSaved: 0,
  originalTokens: 0,
  startTime: Date.now(),
};

// Logging
function log(message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}`;
  console.log(line);
  try {
    fs.appendFileSync(config.logFile, line + "\n");
  } catch (e) {
    // Ignore log file errors
  }
}

function logStats() {
  const uptime = Math.round((Date.now() - stats.startTime) / 1000);
  const savings = stats.originalTokens > 0
    ? Math.round((stats.tokensSaved / stats.originalTokens) * 100)
    : 0;
  log(`📊 Stats: ${stats.requests} requests, ${stats.compressed} compressed, ${stats.tokensSaved} tokens saved (${savings}% reduction), uptime ${uptime}s`);
}

// Compression function
async function compressText(text) {
  if (!config.ttcKey || !text || text.length < config.minTextLength) {
    return { text, saved: 0, original: 0 };
  }

  return new Promise((resolve) => {
    const url = new URL(config.compressionApi);
    const postData = JSON.stringify({
      model: "bear-1",
      compression_settings: { aggressiveness: config.compressionThreshold },
      input: text,
    });

    const req = https.request(
      {
        hostname: url.hostname,
        port: 443,
        path: url.pathname,
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.ttcKey}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(postData),
        },
        timeout: 30000,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            if (json.output && json.output_tokens < json.original_input_tokens) {
              const saved = json.original_input_tokens - json.output_tokens;
              log(`   ✨ ${json.original_input_tokens} → ${json.output_tokens} tokens (-${saved})`);
              resolve({ text: json.output, saved, original: json.original_input_tokens });
            } else {
              resolve({ text, saved: 0, original: 0 });
            }
          } catch (e) {
            log(`   ❌ Parse error: ${e.message}`);
            resolve({ text, saved: 0, original: 0 });
          }
        });
      }
    );

    req.on("error", (e) => {
      log(`   ❌ Compression API error: ${e.message}`);
      resolve({ text, saved: 0, original: 0 });
    });

    req.on("timeout", () => {
      log(`   ❌ Compression API timeout`);
      req.destroy();
      resolve({ text, saved: 0, original: 0 });
    });

    req.write(postData);
    req.end();
  });
}

// Process Anthropic payload
async function processPayload(bodyStr) {
  try {
    const body = JSON.parse(bodyStr);
    if (!body.messages) return { body: bodyStr, totalSaved: 0, totalOriginal: 0 };

    log(`🔍 Processing ${body.messages.length} messages`);

    let totalSaved = 0;
    let totalOriginal = 0;

    for (const msg of body.messages) {
      if (["user", "assistant"].includes(msg.role)) {
        if (typeof msg.content === "string" && msg.content.length > config.minTextLength) {
          const result = await compressText(msg.content);
          msg.content = result.text;
          totalSaved += result.saved;
          totalOriginal += result.original;
        } else if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === "text" && block.text && block.text.length > config.minTextLength) {
              const result = await compressText(block.text);
              block.text = result.text;
              totalSaved += result.saved;
              totalOriginal += result.original;
            }
          }
        }
      }
    }

    if (totalSaved > 0) {
      log(`✅ Saved ${totalSaved} tokens this request`);
    }

    return { body: JSON.stringify(body), totalSaved, totalOriginal };
  } catch (e) {
    log(`❌ Payload processing error: ${e.message}`);
    return { body: bodyStr, totalSaved: 0, totalOriginal: 0 };
  }
}

// Forward request to Anthropic
function forwardToAnthropic(method, urlPath, headers, body, clientRes) {
  const forwardHeaders = { ...headers };

  forwardHeaders.host = config.anthropicHost;

  if (body) {
    forwardHeaders["content-length"] = Buffer.byteLength(body);
  }

  // Remove hop-by-hop headers
  delete forwardHeaders["connection"];
  delete forwardHeaders["keep-alive"];
  delete forwardHeaders["transfer-encoding"];

  const options = {
    hostname: config.anthropicHost,
    port: 443,
    path: urlPath,
    method: method,
    headers: forwardHeaders,
  };

  const proxyReq = https.request(options, (proxyRes) => {
    const responseHeaders = { ...proxyRes.headers };
    clientRes.writeHead(proxyRes.statusCode, responseHeaders);
    proxyRes.pipe(clientRes);
  });

  proxyReq.on("error", (e) => {
    log(`❌ Forward error: ${e.message}`);
    clientRes.writeHead(502);
    clientRes.end(JSON.stringify({ error: "Bad Gateway", message: e.message }));
  });

  if (body) {
    proxyReq.write(body);
  }
  proxyReq.end();
}

// Handle incoming requests
async function handleRequest(req, res) {
  stats.requests++;

  const urlPath = req.url;
  const isMessagesEndpoint = urlPath.includes("/messages") && req.method === "POST";

  if (isMessagesEndpoint) {
    log(`\n🎯 ${req.method} ${urlPath}`);
  }

  // Collect request body
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  let body = chunks.length > 0 ? Buffer.concat(chunks).toString("utf-8") : null;

  // Process messages endpoint
  if (isMessagesEndpoint && body) {
    const result = await processPayload(body);
    body = result.body;
    stats.tokensSaved += result.totalSaved;
    stats.originalTokens += result.totalOriginal;
    if (result.totalSaved > 0) stats.compressed++;
  }

  // Forward to Anthropic
  forwardToAnthropic(req.method, urlPath, req.headers, body, res);
}

// Create and start server
function startServer() {
  log("🚀 Claude Compressor starting...");
  log(`📋 Port: ${config.port}, Threshold: ${config.compressionThreshold}, Min length: ${config.minTextLength}`);

  if (!config.ttcKey) {
    log("⚠️  TTC_KEY not set - compression disabled, acting as passthrough proxy");
  }

  const server = http.createServer(handleRequest);

  server.listen(config.port, "127.0.0.1", () => {
    log(`✅ Listening on http://127.0.0.1:${config.port}`);
    log(`\n${"═".repeat(50)}`);
    log(`To use: ANTHROPIC_BASE_URL=http://127.0.0.1:${config.port} claude`);
    log(`${"═".repeat(50)}\n`);
  });

  server.on("error", (e) => {
    if (e.code === "EADDRINUSE") {
      log(`❌ Port ${config.port} already in use`);
      log(`   Try: INTERCEPTOR_PORT=8878 claude-compressor`);
    } else {
      log(`❌ Server error: ${e.message}`);
    }
    process.exit(1);
  });

  // Graceful shutdown
  const shutdown = () => {
    log(`\n👋 Shutting down...`);
    logStats();
    server.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Periodic stats
  setInterval(logStats, 300000); // Every 5 minutes
}

// Export for use as module
module.exports = { startServer, config, stats };

// Run if called directly
if (require.main === module) {
  startServer();
}

