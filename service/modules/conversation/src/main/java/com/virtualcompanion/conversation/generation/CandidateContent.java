package com.virtualcompanion.conversation.generation;

/**
 * Immutable content domain used for candidate addressing.
 *
 * <p>The type tag is part of the content address. Content is hashed exactly as
 * supplied; no Unicode normalization or JSON canonicalization is performed.</p>
 */
public sealed interface CandidateContent
        permits CandidateContent.Text, CandidateContent.StructuredJson {

    Type type();

    String value();

    enum Type {
        TEXT("TEXT"),
        STRUCTURED_JSON("STRUCTURED_JSON");

        private final String addressTag;

        Type(String addressTag) {
            this.addressTag = addressTag;
        }

        public String addressTag() {
            return addressTag;
        }
    }

    record Text(String value) implements CandidateContent {

        public Text {
            value = ConversationChecks.requireNonEmpty(value, "value");
        }

        @Override
        public Type type() {
            return Type.TEXT;
        }
    }

    record StructuredJson(String value) implements CandidateContent {

        public StructuredJson {
            value = ConversationChecks.requireNonBlank(value, "value");
        }

        @Override
        public Type type() {
            return Type.STRUCTURED_JSON;
        }
    }
}
