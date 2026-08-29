#!/usr/bin/env node
// G1 fake OpenAI-compatible provider. Never logs request bodies, headers, or tokens.

import http from "node:http";

const HOST = "127.0.0.1";
const PORT = Number(process.env.E2E_PROVIDER_PORT ?? "19090");
const MAX_REQUEST_BYTES = 1024 * 1024;
const PROVIDER_REPLY = "I hear you. Take a breath; there is no rush.";

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error("E2E_PROVIDER_PORT must be an integer between 1 and 65535");
}

const config = {
    firstTokenMs: Number(process.env.G1_FIRST_TOKEN_MS ?? "200"),
    deltaMs: Number(process.env.G1_DELTA_MS ?? "50"),
    chunks: Number(process.env.G1_CHUNKS ?? "8"),
    holdMs: Number(process.env.G1_HOLD_MS ?? "0"),
};

const stats = {
    requests: 0,
    streamRequests: 0,
    bytesIn: 0,
    startedAt: new Date().toISOString(),
};

function sendJson(response, statusCode, body) {
    const payload = JSON.stringify(body);
    response.writeHead(statusCode, {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(payload),
        "cache-control": "no-store",
    });
    response.end(payload);
}

async function readBody(request) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_REQUEST_BYTES) {
            throw new RangeError("request body is too large");
        }
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

function sleep(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) {
        return Promise.resolve();
    }
    return new Promise((resolve) => setTimeout(resolve, n));
}

function choiceChunk(content, finishReason) {
    return {
        id: "chatcmpl-g1",
        object: "chat.completion.chunk",
        model: "g1-model",
        choices: [{
            index: 0,
            delta: content === null ? {} : { content },
            finish_reason: finishReason,
        }],
    };
}

function usageChunk() {
    return {
        id: "chatcmpl-g1",
        object: "chat.completion.chunk",
        model: "g1-model",
        choices: [],
        usage: {
            prompt_tokens: 8,
            completion_tokens: 12,
            total_tokens: 20,
        },
    };
}

function completion(content) {
    return {
        id: "chatcmpl-g1",
        object: "chat.completion",
        model: "g1-model",
        choices: [{
            index: 0,
            message: { role: "assistant", content },
            finish_reason: "stop",
        }],
        usage: {
            prompt_tokens: 8,
            completion_tokens: 12,
            total_tokens: 20,
        },
    };
}

function splitReply(text, chunks) {
    const n = Math.max(1, Math.min(64, Math.trunc(chunks) || 1));
    if (n === 1) {
        return [text];
    }
    const parts = [];
    const size = Math.ceil(text.length / n);
    for (let i = 0; i < text.length; i += size) {
        parts.push(text.slice(i, i + size));
    }
    return parts.length === 0 ? [text] : parts;
}

async function sendStream(response, content) {
    response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "close",
    });
    await sleep(config.holdMs);
    await sleep(config.firstTokenMs);
    const parts = splitReply(content, config.chunks);
    for (const part of parts) {
        response.write(`data: ${JSON.stringify(choiceChunk(part, null))}\n\n`);
        await sleep(config.deltaMs);
    }
    response.write(`data: ${JSON.stringify(choiceChunk(null, "stop"))}\n\n`);
    response.write(`data: ${JSON.stringify(usageChunk())}\n\n`);
    response.end("data: [DONE]\n\n");
}

function applyConfig(body) {
    if (body == null || typeof body !== "object") {
        return;
    }
    for (const key of ["firstTokenMs", "deltaMs", "chunks", "holdMs"]) {
        if (typeof body[key] === "number" && Number.isFinite(body[key]) && body[key] >= 0) {
            config[key] = body[key];
        }
    }
}

async function handle(request, response) {
    const url = new URL(request.url ?? "/", `http://${HOST}:${PORT}`);
    if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { status: "UP" });
        return;
    }
    if (request.method === "GET" && url.pathname === "/g1/config") {
        sendJson(response, 200, { ...config });
        return;
    }
    if (request.method === "GET" && url.pathname === "/g1/stats") {
        sendJson(response, 200, { ...stats, config: { ...config } });
        return;
    }
    if (request.method === "PUT" && url.pathname === "/g1/config") {
        const raw = await readBody(request);
        applyConfig(JSON.parse(raw.toString("utf8") || "{}"));
        sendJson(response, 200, { ...config });
        return;
    }
    if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") {
        sendJson(response, 404, { error: "not_found" });
        return;
    }

    let rawBody;
    let body;
    try {
        rawBody = await readBody(request);
        stats.bytesIn += rawBody.length;
        body = JSON.parse(rawBody.toString("utf8"));
    } catch (error) {
        sendJson(response, error instanceof RangeError ? 413 : 400, {
            error: error instanceof RangeError ? "request_too_large" : "invalid_json",
        });
        return;
    }

    stats.requests += 1;
    if (body && body.stream === true) {
        stats.streamRequests += 1;
        await sendStream(response, PROVIDER_REPLY);
        return;
    }
    await sleep(config.holdMs);
    await sleep(config.firstTokenMs);
    sendJson(response, 200, completion(PROVIDER_REPLY));
}

const server = http.createServer((request, response) => {
    handle(request, response).catch(() => {
        if (!response.headersSent) {
            sendJson(response, 500, { error: "provider_failure" });
        } else {
            response.destroy();
        }
    });
});

server.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
});

server.listen(PORT, HOST, () => {
    process.stdout.write(`G1_FAKE_PROVIDER_READY host=${HOST} port=${PORT}\n`);
});
