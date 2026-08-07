package com.virtualcompanion.modelanthropic;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Minimal UTF-8 SSE framing decoder for Anthropic Messages data events.
 *
 * <p>Anthropic streams explicit {@code event:} lines paired with {@code data:}
 * lines. The JSON payload repeats the type in its {@code type} field, so the
 * {@code event} line is redundant and intentionally ignored. Heartbeat lines
 * such as {@code ": ping"} are comments and ignored.
 */
final class SseDecoder {

    private SseDecoder() {
    }

    static void decode(InputStream input, EventConsumer consumer)
            throws IOException, AnthropicCodecException {
        var reader = new BufferedReader(new InputStreamReader(
                input,
                StandardCharsets.UTF_8
        ));
        var dataLines = new ArrayList<String>();
        while (true) {
            var line = reader.readLine();
            if (line == null) {
                if (!dataLines.isEmpty()) {
                    dispatch(dataLines, consumer);
                }
                return;
            }
            if (line.isEmpty()) {
                if (!dataLines.isEmpty() && !dispatch(dataLines, consumer)) {
                    return;
                }
                dataLines.clear();
                continue;
            }
            if (line.startsWith(":")) {
                continue;
            }

            int colon = line.indexOf(':');
            var field = colon < 0 ? line : line.substring(0, colon);
            var value = colon < 0 ? "" : line.substring(colon + 1);
            if (value.startsWith(" ")) {
                value = value.substring(1);
            }
            if ("data".equals(field)) {
                dataLines.add(value);
            } else if ("event".equals(field)) {
                // Redundant with the JSON type field; ignored.
            } else {
                throw new AnthropicCodecException();
            }
        }
    }

    private static boolean dispatch(
            List<String> dataLines,
            EventConsumer consumer
    ) throws AnthropicCodecException {
        return consumer.onEvent(String.join("\n", dataLines));
    }

    @FunctionalInterface
    interface EventConsumer {
        boolean onEvent(String data) throws AnthropicCodecException;
    }
}
