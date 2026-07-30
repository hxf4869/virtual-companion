package com.virtualcompanion.modelopenai;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Minimal UTF-8 SSE framing decoder for Chat Completions data events.
 */
final class SseDecoder {

    private SseDecoder() {
    }

    static void decode(InputStream input, EventConsumer consumer)
            throws IOException, OpenAiCodecException {
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
            if (!"data".equals(field)) {
                throw new OpenAiCodecException();
            }
            dataLines.add(value);
        }
    }

    private static boolean dispatch(
            List<String> dataLines,
            EventConsumer consumer
    ) throws OpenAiCodecException {
        return consumer.onEvent(String.join("\n", dataLines));
    }

    @FunctionalInterface
    interface EventConsumer {
        boolean onEvent(String data) throws OpenAiCodecException;
    }
}
