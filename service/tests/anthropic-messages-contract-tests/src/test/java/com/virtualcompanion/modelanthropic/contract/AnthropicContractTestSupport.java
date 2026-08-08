package com.virtualcompanion.modelanthropic.contract;

import com.virtualcompanion.modelanthropic.AnthropicMessagesAdapter;
import com.virtualcompanion.modelanthropic.AnthropicMessagesConfig;
import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.ModelProtocolEvent;
import com.virtualcompanion.modelruntime.contract.ModelProtocolRequest;
import com.virtualcompanion.modelruntime.contract.OwnershipTuple;
import com.virtualcompanion.modelruntime.contract.ProtocolMessage;
import com.virtualcompanion.modelruntime.contract.ResponseMode;
import com.virtualcompanion.modelruntime.contract.TimeoutBudget;
import com.virtualcompanion.modelruntime.port.ModelProtocolSession;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

final class AnthropicContractTestSupport {

    static final String API_KEY = "offline-key-sentinel";
    static final String ANTHROPIC_VERSION = "2023-06-01";
    static final String MODEL = "offline-model-sentinel";
    static final int MAX_TOKENS = 1024;
    static final String REQUESTED_AUTH = "requested-auth-sentinel";
    static final String EXECUTION_AUTH = "execution-auth-sentinel";

    private static final JsonMapper JSON = JsonMapper.builder().build();

    private AnthropicContractTestSupport() {
    }

    static InvocationBinding.ExternalAttemptBinding binding() {
        return new InvocationBinding.ExternalAttemptBinding(
                new OwnershipTuple(
                        "owner-1",
                        "relationship-1",
                        "conversation-1",
                        "generation-1"
                ),
                "provider-attempt-1",
                7,
                REQUESTED_AUTH,
                EXECUTION_AUTH
        );
    }

    static InvocationBinding.DeterministicSourceBinding deterministicBinding() {
        return new InvocationBinding.DeterministicSourceBinding(
                binding().ownership(),
                "deterministic-source-1",
                7
        );
    }

    static ModelProtocolRequest textRequest(boolean streaming, String content) {
        return request(
                binding(),
                streaming,
                new ResponseMode.Text(),
                content,
                normalBudgets()
        );
    }

    static ModelProtocolRequest textRequest(
            InvocationBinding binding,
            boolean streaming,
            String content,
            TimeoutBudget budgets
    ) {
        return request(
                binding,
                streaming,
                new ResponseMode.Text(),
                content,
                budgets
        );
    }

    static ModelProtocolRequest structuredRequest(
            boolean streaming,
            String content
    ) {
        return request(
                binding(),
                streaming,
                new ResponseMode.StructuredJson(
                        "companion_response",
                        "{\"type\":\"object\",\"properties\":{\"answer\":{\"type\":\"string\"}},"
                                + "\"required\":[\"answer\"],\"additionalProperties\":false}"
                ),
                content,
                normalBudgets()
        );
    }

    static ModelProtocolRequest invalidStructuredRequest() {
        return request(
                binding(),
                false,
                new ResponseMode.StructuredJson("invalid_schema", "{not-json"),
                "structured",
                normalBudgets()
        );
    }

    static ModelProtocolRequest request(
            InvocationBinding binding,
            boolean streaming,
            ResponseMode mode,
            String content,
            TimeoutBudget budgets
    ) {
        return new ModelProtocolRequest(
                binding,
                List.of(
                        new ProtocolMessage(
                                ProtocolMessage.Role.SYSTEM,
                                "synthetic-system"
                        ),
                        new ProtocolMessage(
                                ProtocolMessage.Role.USER,
                                content
                        ),
                        new ProtocolMessage(
                                ProtocolMessage.Role.ASSISTANT,
                                "synthetic-prior"
                        )
                ),
                mode,
                streaming,
                budgets
        );
    }

    static TimeoutBudget normalBudgets() {
        return new TimeoutBudget(
                Duration.ofSeconds(2),
                Duration.ofSeconds(2),
                Duration.ofSeconds(5)
        );
    }

    static AnthropicMessagesAdapter adapter(
            HttpClient client,
            URI endpoint
    ) {
        return new AnthropicMessagesAdapter(
                client,
                new AnthropicMessagesConfig(endpoint, API_KEY, ANTHROPIC_VERSION, MODEL, MAX_TOKENS)
        );
    }

    static List<ModelProtocolEvent> drain(ModelProtocolSession session) {
        var events = new ArrayList<ModelProtocolEvent>();
        for (int index = 0; index < 100_000; index++) {
            var event = session.next();
            if (event.isEmpty()) {
                break;
            }
            events.add(event.orElseThrow());
        }
        assertTrue(events.size() < 100_000, "session did not terminate");
        assertEquals(1, events.stream().filter(ModelProtocolEvent::terminal).count());
        assertTrue(events.getLast().terminal(), "terminal event must be last");
        for (int index = 0; index < events.size(); index++) {
            assertEquals(index, events.get(index).sequence(), "sequence must be contiguous");
            assertEquals(binding(), events.get(index).binding(), "full binding must survive");
        }
        if (session.next().isPresent()) {
            fail("terminal session emitted a late event");
        }
        return List.copyOf(events);
    }

    static String completion(
            String content,
            String stopReason,
            long inputTokens,
            long outputTokens
    ) {
        var root = JSON.createObjectNode();
        root.put("id", "msg_offline");
        root.put("type", "message");
        root.put("role", "assistant");
        root.put("model", MODEL);
        root.putArray("content").addObject()
                .put("type", "text")
                .put("text", content);
        root.put("stop_reason", stopReason);
        root.putNull("stop_sequence");
        addUsage(root, inputTokens, outputTokens);
        return JSON.writeValueAsString(root);
    }

    static String toolUseCompletion(
            String inputJson,
            String stopReason,
            long inputTokens,
            long outputTokens
    ) {
        var root = JSON.createObjectNode();
        root.put("id", "msg_offline");
        root.put("type", "message");
        root.put("role", "assistant");
        root.put("model", MODEL);
        var block = root.putArray("content").addObject();
        block.put("type", "tool_use");
        block.put("id", "toolu_offline");
        block.put("name", "companion_response");
        block.set("input", parseJson(inputJson));
        root.put("stop_reason", stopReason);
        root.putNull("stop_sequence");
        addUsage(root, inputTokens, outputTokens);
        return JSON.writeValueAsString(root);
    }

    static String multiTextCompletion(
            List<String> texts,
            String stopReason,
            long inputTokens,
            long outputTokens
    ) {
        var root = JSON.createObjectNode();
        root.put("id", "msg_offline");
        root.put("type", "message");
        root.put("role", "assistant");
        root.put("model", MODEL);
        var blocks = root.putArray("content");
        for (var text : texts) {
            blocks.addObject().put("type", "text").put("text", text);
        }
        root.put("stop_reason", stopReason);
        root.putNull("stop_sequence");
        addUsage(root, inputTokens, outputTokens);
        return JSON.writeValueAsString(root);
    }

    static String messageStart(long inputTokens) {
        var root = JSON.createObjectNode();
        root.put("type", "message_start");
        var message = root.putObject("message");
        message.put("id", "msg_offline");
        message.put("type", "message");
        message.put("role", "assistant");
        message.putArray("content");
        message.putNull("stop_reason");
        message.putNull("stop_sequence");
        addUsage(message, inputTokens, 1);
        return JSON.writeValueAsString(root);
    }

    static String contentBlockStart() {
        var root = JSON.createObjectNode();
        root.put("type", "content_block_start");
        root.put("index", 0);
        var block = root.putObject("content_block");
        block.put("type", "text");
        block.put("text", "");
        return JSON.writeValueAsString(root);
    }

    static String contentBlockStartToolUse() {
        var root = JSON.createObjectNode();
        root.put("type", "content_block_start");
        root.put("index", 0);
        var block = root.putObject("content_block");
        block.put("type", "tool_use");
        block.put("id", "toolu_offline");
        block.put("name", "companion_response");
        block.putObject("input");
        return JSON.writeValueAsString(root);
    }

    static String contentBlockStop() {
        return "{\"type\":\"content_block_stop\",\"index\":0}";
    }

    static String textDelta(String text) {
        var root = JSON.createObjectNode();
        root.put("type", "content_block_delta");
        root.put("index", 0);
        var delta = root.putObject("delta");
        delta.put("type", "text_delta");
        delta.put("text", text);
        return JSON.writeValueAsString(root);
    }

    static String inputJsonDelta(String partialJson) {
        var root = JSON.createObjectNode();
        root.put("type", "content_block_delta");
        root.put("index", 0);
        var delta = root.putObject("delta");
        delta.put("type", "input_json_delta");
        delta.put("partial_json", partialJson);
        return JSON.writeValueAsString(root);
    }

    static String messageDelta(String stopReason, long outputTokens) {
        var root = JSON.createObjectNode();
        root.put("type", "message_delta");
        var delta = root.putObject("delta");
        if (stopReason == null) {
            delta.putNull("stop_reason");
        } else {
            delta.put("stop_reason", stopReason);
        }
        delta.putNull("stop_sequence");
        root.putObject("usage").put("output_tokens", outputTokens);
        return JSON.writeValueAsString(root);
    }

    static String messageStop() {
        return "{\"type\":\"message_stop\"}";
    }

    static String ping() {
        return "{\"type\":\"ping\"}";
    }

    static String sse(String data) {
        return "data: " + data + "\n\n";
    }

    static String sseCrLf(String data) {
        return "data: " + data + "\r\n\r\n";
    }

    static String sseEvent(String type, String data) {
        return "event: " + type + "\ndata: " + data + "\n\n";
    }

    static JsonNode parseJson(String value) {
        return JSON.readTree(value);
    }

    private static void addUsage(
            tools.jackson.databind.node.ObjectNode root,
            long inputTokens,
            long outputTokens
    ) {
        root.putObject("usage")
                .put("input_tokens", inputTokens)
                .put("output_tokens", outputTokens);
    }
}
