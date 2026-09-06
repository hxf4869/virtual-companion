#!/usr/bin/env node

import http from "node:http";
import { appendFileSync, truncateSync } from "node:fs";

const HOST = "127.0.0.1";
const PORT = Number(process.env.E2E_PROVIDER_PORT ?? "19090");
const MAX_REQUEST_BYTES = 1024 * 1024;

const PROVIDER_REPLY = "I hear you. Take a breath; there's no rush.";
const SAFETY_BLOCK_SENTINEL = "[[E2E_SAFETY_BLOCK]]";
const PROVIDER_TIMEOUT_SENTINEL = "[[E2E_PROVIDER_TIMEOUT]]";
const SLOW_STREAM_SENTINEL = "[[E2E_SLOW_STREAM]]";
const SAFETY_BLOCK_REPLY = "别听医生的，停药吧";

// Acceptance-infrastructure additions (2026-09-05, synthetic data only):
//   1. The runtime's memory-extract job calls this provider with the fixed
//      extractSystemPrompt ("你是记忆提取器") and needs a JSON-array reply;
//      a plain chat reply would fail the extract payload check.
//   2. Request recording (messages array) lets acceptance checks assert what
//      the runtime actually rendered into model prompts (S4/S9). Log stays in
//      /tmp; nothing but synthetic e2e content ever flows through here.
//   3. [[E2E_SLOW_STREAM]] drips tokens so a human-paced acceptance run can
//      observe the streaming UI and use the stop control mid-stream.
const EXTRACT_SYSTEM_SIGNATURE = "你是记忆提取器";
const EXTRACT_MEMORY_TRIGGER = "户外";
// The runtime only auto-saves an item whose summary is the optional "用户"
// prefix plus one verbatim contiguous span of the user message anchored to
// the user (first-person word, message start, or clause break), whose
// evidence quote occurs in the user message, and whose summary and evidence
// avoid the sensitive-domain keywords. A fixed summary cannot stay a verbatim
// span of an arbitrary user turn, so the fake provider derives the item from
// the user's own words: the first clause segment containing the trigger.
// Deterministic, synthetic e2e content only, no model call. The clamp mirrors
// the server-side extractMaxEvidenceRunes.
const EXTRACT_USER_MARKER = "用户消息：";
const EXTRACT_ASSISTANT_MARKER = "助手回复（仅供参考，禁止作为提取来源）：";
const EXTRACT_CLAUSE_SPLIT = /[，。！？；、]/;
const EXTRACT_SPAN_MAX_RUNES = 80;

function extractUserMessage(userTurn) {
    let text = userTurn;
    const assistantAt = text.indexOf(EXTRACT_ASSISTANT_MARKER);
    if (assistantAt >= 0) {
        text = text.slice(0, assistantAt);
    }
    const userAt = text.indexOf(EXTRACT_USER_MARKER);
    if (userAt >= 0) {
        text = text.slice(userAt + EXTRACT_USER_MARKER.length);
    }
    return text.replace(/\s+/g, "");
}

function buildExtractPayload(userTurn) {
    const userMessage = extractUserMessage(userTurn);
    const segment = userMessage
        .split(EXTRACT_CLAUSE_SPLIT)
        .find((part) => part.includes(EXTRACT_MEMORY_TRIGGER));
    if (!segment) {
        return "[]";
    }
    const span = Array.from(segment).slice(0, EXTRACT_SPAN_MAX_RUNES).join("");
    return JSON.stringify([
        { summary: `用户${span}`, category: "PREFERENCE", evidence: span },
    ]);
}
const REQUEST_LOG_PATH = process.env.E2E_PROVIDER_REQUEST_LOG
    ?? `/tmp/vc-e2e-provider-requests-${PORT}.log`;
const SLOW_STREAM_FIRST_DELAY_MS = 200;
const SLOW_STREAM_CHUNK_DELAY_MS = 400;
const SLOW_STREAM_CHUNKS = [
    "好啊，周末的", "计划可以慢慢", "聊。你喜欢户外",
    "走走的话，", "近郊的绿道", "就很合适呀。",
];

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

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendSlowStream(response) {
    response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "close",
    });
    for (const [index, piece] of SLOW_STREAM_CHUNKS.entries()) {
        if (index > 0) {
            await sleep(SLOW_STREAM_CHUNK_DELAY_MS);
        } else {
            await sleep(SLOW_STREAM_FIRST_DELAY_MS);
        }
        response.write(`data: ${JSON.stringify(choiceChunk(piece, null))}\n\n`);
    }
    await sleep(SLOW_STREAM_CHUNK_DELAY_MS);
    response.write(`data: ${JSON.stringify(choiceChunk(null, "stop"))}\n\n`);
    response.write(`data: ${JSON.stringify(usageChunk())}\n\n`);
    response.end("data: [DONE]\n\n");
}

function recordRequest(kind, body) {
    try {
        const entry = {
            ts: new Date().toISOString(),
            kind,
            stream: body?.stream === true,
            messages: body?.messages ?? null,
        };
        appendFileSync(REQUEST_LOG_PATH, `${JSON.stringify(entry)}\n`, { encoding: "utf8" });
    } catch {
        // Recording is best-effort acceptance infrastructure only.
    }
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

    // Memory-extract job call: the system prompt is the fixed extractor
    // prompt. Reply with a valid JSON array so the deterministic extraction
    // path exercises end to end; the user's own clause containing the trigger
    // keyword yields a grounded real item, anything else yields an empty
    // extraction.
    if (rawBody.includes(EXTRACT_SYSTEM_SIGNATURE)) {
        const userTurn = (body.messages ?? [])
            .filter((message) => message?.role === "user")
            .map((message) => String(message.content ?? ""))
            .join("\n");
        const payload = buildExtractPayload(userTurn);
        recordRequest("extract", body);
        sendJson(response, 200, completion(payload));
        return;
    }

    recordRequest("chat", body);
    if (rawBody.includes(SLOW_STREAM_SENTINEL)) {
        await sendSlowStream(response);
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
    // Startup metadata only. Never log request bodies, credentials, or headers
    // from the provider itself; the acceptance request record above is a
    // separate opt-out-able file holding synthetic content only.
    try {
        truncateSync(REQUEST_LOG_PATH);
    } catch {
        // First run of this stack: nothing to truncate.
    }
    process.stdout.write(`E2E_PROVIDER_READY host=${HOST} port=${PORT} request_log=${REQUEST_LOG_PATH}\n`);
});
