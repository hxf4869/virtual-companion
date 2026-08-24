#!/usr/bin/env node

import http from "node:http";

const HOST = "127.0.0.1";
const PORT = Number(process.env.E2E_PROVIDER_PORT ?? "19090");
const MAX_REQUEST_BYTES = 1024 * 1024;

const PROVIDER_REPLY = "I hear you. Take a breath; there's no rush.";
const SAFETY_BLOCK_SENTINEL = "[[E2E_SAFETY_BLOCK]]";
const PROVIDER_TIMEOUT_SENTINEL = "[[E2E_PROVIDER_TIMEOUT]]";
const SAFETY_BLOCK_REPLY = "别听医生的，停药吧";

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error("E2E_PROVIDER_PORT must be an integer between 1 and 65535");
}

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
    return Buffer.concat(chunks).toString("utf8");
}

function completion(content) {
    return {
        id: "chatcmpl-e2e",
        object: "chat.completion",
        model: "e2e-model",
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

function choiceChunk(content, finishReason) {
    return {
        id: "chatcmpl-e2e",
        object: "chat.completion.chunk",
        model: "e2e-model",
        choices: [{
            index: 0,
            delta: content === null ? {} : { content },
            finish_reason: finishReason,
        }],
    };
}

function usageChunk() {
    return {
        id: "chatcmpl-e2e",
        object: "chat.completion.chunk",
        model: "e2e-model",
        choices: [],
        usage: {
            prompt_tokens: 8,
            completion_tokens: 12,
            total_tokens: 20,
        },
    };
}

function sendStream(response, content) {
    response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "close",
    });
    response.write(`data: ${JSON.stringify(choiceChunk(content, null))}\n\n`);
    response.write(`data: ${JSON.stringify(choiceChunk(null, "stop"))}\n\n`);
    response.write(`data: ${JSON.stringify(usageChunk())}\n\n`);
    response.end("data: [DONE]\n\n");
}

async function handle(request, response) {
    const url = new URL(request.url ?? "/", `http://${HOST}:${PORT}`);
    if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { status: "UP" });
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
        body = JSON.parse(rawBody);
    } catch (error) {
        sendJson(response, error instanceof RangeError ? 413 : 400, {
            error: error instanceof RangeError ? "request_too_large" : "invalid_json",
        });
        return;
    }

    // Deliberately leave the response open. The runtime's first-token/total
    // budgets own cancellation, giving E2E a deterministic provider timeout.
    if (rawBody.includes(PROVIDER_TIMEOUT_SENTINEL)) {
        return;
    }

    const content = rawBody.includes(SAFETY_BLOCK_SENTINEL)
        ? SAFETY_BLOCK_REPLY
        : PROVIDER_REPLY;
    if (body.stream === true) {
        sendStream(response, content);
        return;
    }
    sendJson(response, 200, completion(content));
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
    // Startup metadata only. Never log request bodies, credentials, or headers.
    process.stdout.write(`E2E_PROVIDER_READY host=${HOST} port=${PORT}\n`);
});
