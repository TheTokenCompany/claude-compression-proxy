#!/usr/bin/env python3
"""
Claude API Interceptor (Reverse Proxy)

Acts as a local Anthropic API that compresses requests
before forwarding them to the real API.
"""

import os
import json
import logging
import asyncio
from datetime import datetime
from typing import Dict, Any, Optional
from pathlib import Path
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request, Response
from fastapi.responses import StreamingResponse
import uvicorn

# Configuration
config = {
    "port": int(os.getenv("INTERCEPTOR_PORT", "8877")),
    "ttc_key": os.getenv("TTC_KEY"),
    "compression_threshold": float(os.getenv("COMPRESSION_THRESHOLD", "0.6")),
    "compression_api": "https://api.thetokencompany.com/v1/compress",
    "anthropic_host": "https://api.anthropic.com",
    "log_file": os.getenv("LOG_FILE", str(Path.home() / "claude-compressor.log")),
    "min_text_length": int(os.getenv("MIN_TEXT_LENGTH", "150")),
}

# Stats
stats = {
    "requests": 0,
    "compressed": 0,
    "tokens_saved": 0,
    "original_tokens": 0,
    "start_time": datetime.now(),
}

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(config["log_file"], mode="a"),
    ],
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handle application lifespan events."""
    # Startup
    logger.info("--> Claude Compressor starting")
    logger.info(
        f"    Port: {config['port']}, Threshold: {config['compression_threshold']}, "
        f"Min length: {config['min_text_length']}"
    )

    if not config["ttc_key"]:
        logger.warning("[WARN] TTC_KEY not set - compression disabled, acting as passthrough proxy")

    logger.info("=" * 50)
    logger.info(f"To use: ANTHROPIC_BASE_URL=http://127.0.0.1:{config['port']} claude")
    logger.info("=" * 50)

    yield

    # Shutdown
    logger.info("\n<-- Shutting down")
    log_stats()


app = FastAPI(title="Claude Compressor", lifespan=lifespan)


def log_stats():
    """Log current statistics."""
    uptime = int((datetime.now() - stats["start_time"]).total_seconds())
    savings = (
        round((stats["tokens_saved"] / stats["original_tokens"]) * 100)
        if stats["original_tokens"] > 0
        else 0
    )
    logger.info(
        f"[stats] {stats['requests']} requests, {stats['compressed']} compressed, "
        f"{stats['tokens_saved']} tokens saved ({savings}% reduction), uptime {uptime}s"
    )


async def compress_text(text: str) -> Dict[str, Any]:
    """
    Compress text using Token Company API.

    Returns:
        dict with keys: text, saved, original
    """
    if not config["ttc_key"] or not text or len(text) < config["min_text_length"]:
        return {"text": text, "saved": 0, "original": 0}

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                config["compression_api"],
                headers={
                    "Authorization": f"Bearer {config['ttc_key']}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "bear-1",
                    "compression_settings": {"aggressiveness": config["compression_threshold"]},
                    "input": text,
                },
            )

            if response.status_code == 200:
                data = response.json()
                if data.get("output") and data.get("output_tokens", 0) < data.get("original_input_tokens", 0):
                    saved = data["original_input_tokens"] - data["output_tokens"]
                    logger.info(f"    >>> {data['original_input_tokens']} -> {data['output_tokens']} tokens (-{saved})")
                    return {
                        "text": data["output"],
                        "saved": saved,
                        "original": data["original_input_tokens"],
                    }

    except Exception as e:
        logger.error(f"    [!] Compression API error: {e}")

    return {"text": text, "saved": 0, "original": 0}


async def process_payload(body_str: str) -> Dict[str, Any]:
    """
    Process Anthropic API payload and compress messages.

    Returns:
        dict with keys: body (str), total_saved (int), total_original (int)
    """
    try:
        body = json.loads(body_str)
        if "messages" not in body:
            return {"body": body_str, "total_saved": 0, "total_original": 0}

        logger.info(f"... Processing {len(body['messages'])} messages")

        total_saved = 0
        total_original = 0

        # Compress messages in parallel
        compression_tasks = []
        message_paths = []  # Track which messages/blocks to update

        for msg_idx, msg in enumerate(body["messages"]):
            if msg.get("role") in ["user", "assistant"]:
                content = msg.get("content")

                if isinstance(content, str) and len(content) > config["min_text_length"]:
                    compression_tasks.append(compress_text(content))
                    message_paths.append(("string", msg_idx, None))

                elif isinstance(content, list):
                    for block_idx, block in enumerate(content):
                        if (
                            block.get("type") == "text"
                            and block.get("text")
                            and len(block["text"]) > config["min_text_length"]
                        ):
                            compression_tasks.append(compress_text(block["text"]))
                            message_paths.append(("array", msg_idx, block_idx))

        # Wait for all compressions to complete
        if compression_tasks:
            results = await asyncio.gather(*compression_tasks)

            # Apply compressed results
            for path, result in zip(message_paths, results):
                path_type, msg_idx, block_idx = path

                if path_type == "string":
                    body["messages"][msg_idx]["content"] = result["text"]
                else:  # array
                    body["messages"][msg_idx]["content"][block_idx]["text"] = result["text"]

                total_saved += result["saved"]
                total_original += result["original"]

        if total_saved > 0:
            logger.info(f"[OK] Saved {total_saved} tokens this request")

        return {
            "body": json.dumps(body),
            "total_saved": total_saved,
            "total_original": total_original,
        }

    except Exception as e:
        logger.error(f"[!] Payload processing error: {e}")
        return {"body": body_str, "total_saved": 0, "total_original": 0}


@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"])
async def proxy(request: Request, path: str):
    """Proxy all requests to Anthropic API with optional compression."""
    stats["requests"] += 1

    url_path = f"/{path}"
    if request.url.query:
        url_path += f"?{request.url.query}"

    is_messages_endpoint = "/messages" in url_path and request.method == "POST"

    if is_messages_endpoint:
        logger.info(f"\n>>> {request.method} {url_path}")

    # Read request body
    body = await request.body()
    body_str = body.decode("utf-8") if body else None

    # Process messages endpoint
    if is_messages_endpoint and body_str:
        result = await process_payload(body_str)
        body_str = result["body"]
        body = body_str.encode("utf-8")
        stats["tokens_saved"] += result["total_saved"]
        stats["original_tokens"] += result["total_original"]
        if result["total_saved"] > 0:
            stats["compressed"] += 1

    # Prepare headers for forwarding
    forward_headers = dict(request.headers)
    forward_headers["host"] = "api.anthropic.com"

    # Remove hop-by-hop headers
    for header in ["connection", "keep-alive", "transfer-encoding", "content-length"]:
        forward_headers.pop(header, None)

    # Forward to Anthropic
    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            response = await client.request(
                method=request.method,
                url=f"{config['anthropic_host']}{url_path}",
                headers=forward_headers,
                content=body,
            )

            # Return response
            return Response(
                content=response.content,
                status_code=response.status_code,
                headers=dict(response.headers),
            )

    except Exception as e:
        logger.error(f"[!] Forward error: {e}")
        return Response(
            content=json.dumps({"error": "Bad Gateway", "message": str(e)}),
            status_code=502,
            media_type="application/json",
        )


if __name__ == "__main__":
    # Enable access logs to verify requests are being received
    uvicorn.run(
        app,
        host="0.0.0.0",  # Bind to all interfaces for Docker
        port=config["port"],
        log_level="info",
        access_log=True,
    )
