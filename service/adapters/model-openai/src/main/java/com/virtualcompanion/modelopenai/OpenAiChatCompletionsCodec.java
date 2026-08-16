package com.virtualcompanion.modelopenai;

import com.virtualcompanion.modelruntime.contract.ModelProtocolRequest;
import com.virtualcompanion.modelruntime.contract.ProtocolMessage;
import com.virtualcompanion.modelruntime.contract.ResponseMode;
import com.virtualcompanion.modelruntime.contract.SizeLimits;
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
 * Strict Chat Completions JSON codec. All parse failures collapse to one
 * body-free internal signal.
 */
final class OpenAiChatCompletionsCodec {

    private static final String COMPLETION_OBJECT = "chat.completion";
    private static final String CHUNK_OBJECT = "chat.completion.chunk";

    private final JsonMapper jsonMapper = JsonMapper.builder()
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .build();

    String encodeRequest(
            ModelProtocolRequest request, String model, int maxTokens, double temperature)
            throws OpenAiCodecException {
        try {
            var root = jsonMapper.createObjectNode();
            root.put("model", model);
            // SAMPLE-CFG: deployment-level sampling defaults (operator-tuned).
            root.put("max_tokens", OpenAiChatCompletionsConfig.requireMaxTokens(maxTokens));
            root.put("temperature", OpenAiChatCompletionsConfig.requireTemperature(temperature));
            var messages = root.putArray("messages");
            for (ProtocolMessage message : request.messages()) {
                var encoded = messages.addObject();
                encoded.put("role", role(message.role()));
                encoded.put("content", message.content());
            }
            root.put("stream", request.streaming());
            if (request.streaming()) {
                root.putObject("stream_options").put("include_usage", true);
            }
            if (request.responseMode() instanceof ResponseMode.StructuredJson structured) {
                if (SizeLimits.utf8Bytes(structured.jsonSchema())
                        > SizeLimits.MAX_SCHEMA_BYTES) {
                    throw new OpenAiCodecException();
                }
                var schema = jsonMapper.readTree(structured.jsonSchema());
                if (schema == null || !schema.isObject()) {
                    throw new OpenAiCodecException();
                }
                var responseFormat = root.putObject("response_format");
                responseFormat.put("type", "json_schema");
                var jsonSchema = responseFormat.putObject("json_schema");
                jsonSchema.put("name", structured.schemaName());
                jsonSchema.put("strict", true);
                jsonSchema.set("schema", schema);
            }
            return jsonMapper.writeValueAsString(root);
        } catch (OpenAiCodecException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new OpenAiCodecException();
        }
    }

    Completion decodeCompletion(InputStream body) throws OpenAiCodecException {
        try {
            var root = requireObject(jsonMapper.readTree(body));
            requireExactText(root, "object", COMPLETION_OBJECT);
            var choice = requireOnlyChoice(root);
            var message = requireObject(choice.get("message"));
            var content = requireNonEmptyText(message, "content");
            var stopReason = requireFinishReason(choice.get("finish_reason"));
            var usage = requireUsage(root.get("usage"));
            return new Completion(content, usage, stopReason);
        } catch (OpenAiCodecException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new OpenAiCodecException();
        }
    }

    StreamChunk decodeStreamChunk(String data) throws OpenAiCodecException {
        try {
            var root = requireObject(jsonMapper.readTree(data));
            requireExactText(root, "object", CHUNK_OBJECT);
            var choices = root.get("choices");
            if (choices == null || !choices.isArray()) {
                throw new OpenAiCodecException();
            }

            var usageNode = root.get("usage");
            boolean hasUsage = usageNode != null && !usageNode.isNull();
            if (choices.isEmpty()) {
                if (!hasUsage) {
                    throw new OpenAiCodecException();
                }
                return new UsageChunk(requireUsage(usageNode));
            }
            if (choices.size() != 1 || hasUsage) {
                throw new OpenAiCodecException();
            }

            var choice = requireObject(choices.get(0));
            requireIndexZero(choice);
            var delta = requireObject(choice.get("delta"));
            var content = optionalContent(delta.get("content"));
            var finishReason = optionalFinishReason(choice.get("finish_reason"));
            return new ChoiceChunk(content, finishReason);
        } catch (OpenAiCodecException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new OpenAiCodecException();
        }
    }

    String requireStructuredJson(String json) throws OpenAiCodecException {
        try {
            if (json == null || json.isBlank() || jsonMapper.readTree(json) == null) {
                throw new OpenAiCodecException();
            }
            return json;
        } catch (OpenAiCodecException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new OpenAiCodecException();
        }
    }

    private static String role(ProtocolMessage.Role role) {
        return role.name().toLowerCase(Locale.ROOT);
    }

    private static ObjectNode requireObject(JsonNode value)
            throws OpenAiCodecException {
        if (value == null || !value.isObject()) {
            throw new OpenAiCodecException();
        }
        return (ObjectNode) value;
    }

    private static ObjectNode requireOnlyChoice(ObjectNode root)
            throws OpenAiCodecException {
        var choices = root.get("choices");
        if (choices == null || !choices.isArray() || choices.size() != 1) {
            throw new OpenAiCodecException();
        }
        var choice = requireObject(choices.get(0));
        requireIndexZero(choice);
        return choice;
    }

    private static void requireIndexZero(ObjectNode choice)
            throws OpenAiCodecException {
        var index = choice.get("index");
        if (index == null || !index.isIntegralNumber() || index.longValue() != 0) {
            throw new OpenAiCodecException();
        }
    }

    private static void requireExactText(
            ObjectNode parent,
            String field,
            String expected
    ) throws OpenAiCodecException {
        var value = parent.get(field);
        if (value == null || !value.isString() || !expected.equals(value.stringValue())) {
            throw new OpenAiCodecException();
        }
    }

    private static String requireNonEmptyText(ObjectNode parent, String field)
            throws OpenAiCodecException {
        var value = parent.get(field);
        if (value == null || !value.isString() || value.stringValue().isEmpty()) {
            throw new OpenAiCodecException();
        }
        return value.stringValue();
    }

    private static Optional<String> optionalContent(JsonNode value)
            throws OpenAiCodecException {
        if (value == null || value.isNull()) {
            return Optional.empty();
        }
        if (!value.isString()) {
            throw new OpenAiCodecException();
        }
        return value.stringValue().isEmpty()
                ? Optional.empty()
                : Optional.of(value.stringValue());
    }

    private static StopReason requireFinishReason(JsonNode value)
            throws OpenAiCodecException {
        return optionalFinishReason(value).orElseThrow(OpenAiCodecException::new);
    }

    private static Optional<StopReason> optionalFinishReason(JsonNode value)
            throws OpenAiCodecException {
        if (value == null || value.isNull()) {
            return Optional.empty();
        }
        if (!value.isString()) {
            throw new OpenAiCodecException();
        }
        return Optional.of(switch (value.stringValue()) {
            case "stop" -> StopReason.STOP;
            case "length" -> StopReason.LENGTH;
            case "content_filter" -> StopReason.POLICY;
            case "tool_calls", "function_call" -> StopReason.UNKNOWN;
            default -> throw new OpenAiCodecException();
        });
    }

    private static TokenUsage requireUsage(JsonNode value)
            throws OpenAiCodecException {
        var usage = requireObject(value);
        long input = requireNonNegativeInteger(usage, "prompt_tokens");
        long output = requireNonNegativeInteger(usage, "completion_tokens");
        long total = requireNonNegativeInteger(usage, "total_tokens");
        if (input > Long.MAX_VALUE - output || input + output != total) {
            throw new OpenAiCodecException();
        }
        return new TokenUsage(input, output, total);
    }

    private static long requireNonNegativeInteger(ObjectNode parent, String field)
            throws OpenAiCodecException {
        var value = parent.get(field);
        if (value == null || !value.isIntegralNumber() || !value.canConvertToLong()) {
            throw new OpenAiCodecException();
        }
        long number = value.longValue();
        if (number < 0) {
            throw new OpenAiCodecException();
        }
        return number;
    }

    record Completion(String content, TokenUsage usage, StopReason stopReason) {
    }

    sealed interface StreamChunk permits ChoiceChunk, UsageChunk {
    }

    record ChoiceChunk(
            Optional<String> content,
            Optional<StopReason> finishReason
    ) implements StreamChunk {
    }

    record UsageChunk(TokenUsage usage) implements StreamChunk {
    }
}
