package com.virtualcompanion.modelruntime.contract;

/**
 * Provider-neutral output payload.
 */
public sealed interface ModelPayload
        permits ModelPayload.TextChunk, ModelPayload.StructuredJson {

    record TextChunk(String text) implements ModelPayload {

        public TextChunk {
            text = ContractChecks.requireNonEmpty(text, "text");
        }
    }

    record StructuredJson(String json) implements ModelPayload {

        public StructuredJson {
            json = ContractChecks.requireNonBlank(json, "json");
        }
    }
}
