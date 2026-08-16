package com.virtualcompanion.modelanthropic;

import com.virtualcompanion.modelruntime.contract.ModelProtocolRequest;
import com.virtualcompanion.modelruntime.contract.ProtocolMessage;
import com.virtualcompanion.modelruntime.contract.ResponseMode;
import com.virtualcompanion.modelruntime.contract.StopReason;
import com.virtualcompanion.modelruntime.contract.TokenUsage;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

import java.io.InputStream;
import java.util.Locale;
import java.util.Optional;

/**
 * Strict Anthropic Messages JSON codec. All parse failures collapse to one
 * body-free internal signal so no provider detail crosses the boundary.
 */
final class AnthropicMessagesCodec {

    private static final String MESSAGE_OBJECT = "message";

    private final JsonMapper jsonMapper = JsonMapper.builder()
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .build();

    String encodeRequest(
            ModelProtocolRequest request, String model, int maxTokens, double temperature)
            throws AnthropicCodecException {
        try {
            var root = jsonMapper.createObjectNode();
            root.put("model", model);
            root.put("max_tokens", AnthropicMessagesConfig.requireMaxTokens(maxTokens));
            // SAMPLE-CFG: deployment-level sampling default (operator-tuned).
            root.put("temperature", AnthropicMessagesConfig.requireTemperature(temperature));

            var systemBuilder = new StringBuilder();
            boolean hasSystem = false;
            var messages = root.putArray("messages");
            for (ProtocolMessage message : request.messages()) {
                if (message.role() == ProtocolMessage.Role.SYSTEM) {
                    if (hasSystem) {
                        systemBuilder.append('\n');
                    }
                    systemBuilder.append(message.content());
                    hasSystem = true;
                } else {
                    var encoded = messages.addObject();
                    encoded.put("role", role(message.role()));
                    encoded.put("content", message.content());
                }
            }
            if (hasSystem) {
                root.put("system", systemBuilder.toString());
            }

            root.put("stream", request.streaming());

            if (request.responseMode() instanceof ResponseMode.StructuredJson structured) {
                var schema = jsonMapper.readTree(structured.jsonSchema());
                if (schema == null || !schema.isObject()) {
                    throw new AnthropicCodecException();
                }
                var tools = root.putArray("tools");
                var tool = tools.addObject();
                tool.put("name", structured.schemaName());
                tool.put("description", "structured companion response");
                tool.set("input_schema", schema);
                var toolChoice = root.putObject("tool_choice");
                toolChoice.put("type", "tool");
                toolChoice.put("name", structured.schemaName());
            }
            return jsonMapper.writeValueAsString(root);
        } catch (AnthropicCodecException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new AnthropicCodecException();
        }
    }

    Message decodeMessage(InputStream body) throws AnthropicCodecException {
        try {
            var root = requireObject(jsonMapper.readTree(body));
            requireExactText(root, "type", MESSAGE_OBJECT);
            var content = root.get("content");
            if (content == null || !content.isArray() || content.isEmpty()) {
                throw new AnthropicCodecException();
            }
            StringBuilder text = new StringBuilder();
            ToolUse toolUse = null;
            for (var blockNode : content) {
                var block = requireObject(blockNode);
                var blockType = block.get("type");
                if (blockType == null || !blockType.isString()) {
                    throw new AnthropicCodecException();
                }
                switch (blockType.stringValue()) {
                    case "text" -> text.append(requireNonEmptyText(block, "text"));
                    case "tool_use" -> {
                        if (toolUse != null) {
                            // A forced tool_choice produces exactly one
                            // tool_use block; more than one is malformed.
                            throw new AnthropicCodecException();
                        }
                        var input = block.get("input");
                        if (input == null || input.isNull()) {
                            throw new AnthropicCodecException();
                        }
                        toolUse = new ToolUse(
                                requireNonBlankText(block, "name"),
                                input.toString()
                        );
                    }
                    default -> throw new AnthropicCodecException();
                }
            }
            var stopReason = requireStopReason(root.get("stop_reason"));
            var usage = requireUsage(root.get("usage"));
            return new Message(
                    text.toString(),
                    Optional.ofNullable(toolUse),
                    usage,
                    stopReason);
        } catch (AnthropicCodecException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new AnthropicCodecException();
        }
    }

    AnthropicStreamEvent decodeStreamEvent(String data) throws AnthropicCodecException {
        try {
            var root = requireObject(jsonMapper.readTree(data));
            var typeNode = root.get("type");
            if (typeNode == null || !typeNode.isString()) {
                throw new AnthropicCodecException();
            }
            var type = typeNode.stringValue();
            switch (type) {
                case "message_start" -> {
                    var message = requireObject(root.get("message"));
                    var usage = requireObject(message.get("usage"));
                    long input = requireNonNegativeInteger(usage, "input_tokens");
                    return new AnthropicStreamEvent.MessageStart(input);
                }
                case "content_block_start" -> {
                    var index = requireNonNegativeInteger(root, "index");
                    var block = requireObject(root.get("content_block"));
                    var blockType = requireNonEmptyText(block, "type");
                    var toolUseName = "tool_use".equals(blockType)
                            ? Optional.of(requireNonBlankText(block, "name"))
                            : Optional.<String>empty();
                    return new AnthropicStreamEvent.ContentBlockStart(
                            index,
                            blockType,
                            toolUseName
                    );
                }
                case "content_block_delta" -> {
                    var index = requireNonNegativeInteger(root, "index");
                    var delta = requireObject(root.get("delta"));
                    var deltaType = delta.get("type");
                    if (deltaType == null || !deltaType.isString()) {
                        throw new AnthropicCodecException();
                    }
                    switch (deltaType.stringValue()) {
                        case "text_delta" -> {
                            var text = requireNonEmptyText(delta, "text");
                            return new AnthropicStreamEvent.TextDelta(index, text);
                        }
                        case "input_json_delta" -> {
                            var partial = delta.get("partial_json");
                            if (partial == null || !partial.isString()) {
                                throw new AnthropicCodecException();
                            }
                            return new AnthropicStreamEvent.InputJsonDelta(
                                    index,
                                    partial.stringValue()
                            );
                        }
                        default -> throw new AnthropicCodecException();
                    }
                }
                case "content_block_stop" -> {
                    var index = requireNonNegativeInteger(root, "index");
                    return new AnthropicStreamEvent.ContentBlockStop(index);
                }
                case "message_delta" -> {
                    var delta = requireObject(root.get("delta"));
                    var stopReason = optionalStopReason(delta.get("stop_reason"));
                    var usageNode = root.get("usage");
                    Optional<Long> outputTokens = Optional.empty();
                    if (usageNode != null && !usageNode.isNull()) {
                        var usage = requireObject(usageNode);
                        outputTokens = Optional.of(requireNonNegativeInteger(usage, "output_tokens"));
                    }
                    return new AnthropicStreamEvent.MessageDelta(stopReason, outputTokens);
                }
                case "message_stop" -> {
                    return new AnthropicStreamEvent.MessageStop();
                }
                case "ping" -> {
                    return new AnthropicStreamEvent.Ignored();
                }
                default -> throw new AnthropicCodecException();
            }
        } catch (AnthropicCodecException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new AnthropicCodecException();
        }
    }

    String requireStructuredJson(String json) throws AnthropicCodecException {
        try {
            if (json == null || json.isBlank() || jsonMapper.readTree(json) == null) {
                throw new AnthropicCodecException();
            }
            return json;
        } catch (AnthropicCodecException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new AnthropicCodecException();
        }
    }

    private static String role(ProtocolMessage.Role role) {
        return role.name().toLowerCase(Locale.ROOT);
    }

    private static ObjectNode requireObject(JsonNode value)
            throws AnthropicCodecException {
        if (value == null || !value.isObject()) {
            throw new AnthropicCodecException();
        }
        return (ObjectNode) value;
    }

    private static void requireExactText(
            ObjectNode parent,
            String field,
            String expected
    ) throws AnthropicCodecException {
        var value = parent.get(field);
        if (value == null || !value.isString() || !expected.equals(value.stringValue())) {
            throw new AnthropicCodecException();
        }
    }

    private static String requireNonEmptyText(ObjectNode parent, String field)
            throws AnthropicCodecException {
        var value = parent.get(field);
        if (value == null || !value.isString() || value.stringValue().isEmpty()) {
            throw new AnthropicCodecException();
        }
        return value.stringValue();
    }

    private static String requireNonBlankText(ObjectNode parent, String field)
            throws AnthropicCodecException {
        var value = requireNonEmptyText(parent, field);
        if (value.isBlank()) {
            throw new AnthropicCodecException();
        }
        return value;
    }

    private static StopReason requireStopReason(JsonNode value)
            throws AnthropicCodecException {
        return optionalStopReason(value).orElseThrow(AnthropicCodecException::new);
    }

    private static Optional<StopReason> optionalStopReason(JsonNode value)
            throws AnthropicCodecException {
        if (value == null || value.isNull()) {
            return Optional.empty();
        }
        if (!value.isString()) {
            throw new AnthropicCodecException();
        }
        return Optional.of(switch (value.stringValue()) {
            case "end_turn", "stop_sequence" -> StopReason.STOP;
            case "max_tokens" -> StopReason.LENGTH;
            case "tool_use" -> StopReason.UNKNOWN;
            default -> throw new AnthropicCodecException();
        });
    }

    private static TokenUsage requireUsage(JsonNode value)
            throws AnthropicCodecException {
        var usage = requireObject(value);
        long input = requireNonNegativeInteger(usage, "input_tokens");
        long output = requireNonNegativeInteger(usage, "output_tokens");
        if (input > Long.MAX_VALUE - output) {
            throw new AnthropicCodecException();
        }
        return new TokenUsage(input, output, input + output);
    }

    private static long requireNonNegativeInteger(ObjectNode parent, String field)
            throws AnthropicCodecException {
        var value = parent.get(field);
        if (value == null || !value.isIntegralNumber() || !value.canConvertToLong()) {
            throw new AnthropicCodecException();
        }
        long number = value.longValue();
        if (number < 0) {
            throw new AnthropicCodecException();
        }
        return number;
    }

    record Message(
            String content,
            Optional<ToolUse> toolUse,
            TokenUsage usage,
            StopReason stopReason) {
    }

    record ToolUse(String name, String input) {
    }

    sealed interface AnthropicStreamEvent permits
            AnthropicStreamEvent.MessageStart,
            AnthropicStreamEvent.ContentBlockStart,
            AnthropicStreamEvent.TextDelta,
            AnthropicStreamEvent.InputJsonDelta,
            AnthropicStreamEvent.ContentBlockStop,
            AnthropicStreamEvent.MessageDelta,
            AnthropicStreamEvent.MessageStop,
            AnthropicStreamEvent.Ignored {
        record MessageStart(long inputTokens) implements AnthropicStreamEvent {
        }

        record ContentBlockStart(
                long index,
                String blockType,
                Optional<String> toolUseName
        ) implements AnthropicStreamEvent {
        }

        record TextDelta(long index, String text) implements AnthropicStreamEvent {
        }

        record InputJsonDelta(long index, String partialJson) implements AnthropicStreamEvent {
        }

        record ContentBlockStop(long index) implements AnthropicStreamEvent {
        }

        record MessageDelta(
                Optional<StopReason> stopReason,
                Optional<Long> outputTokens
        ) implements AnthropicStreamEvent {
        }

        record MessageStop() implements AnthropicStreamEvent {
        }

        record Ignored() implements AnthropicStreamEvent {
        }
    }
}
