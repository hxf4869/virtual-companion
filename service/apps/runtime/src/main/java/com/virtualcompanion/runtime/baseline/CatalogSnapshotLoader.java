package com.virtualcompanion.runtime.baseline;

import java.io.IOException;
import java.io.InputStream;
import java.util.Objects;
import java.util.function.Supplier;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Component
public class CatalogSnapshotLoader {

    static final String SNAPSHOT_RESOURCE_PATH = "specs/generated/catalog.snapshot.json";
    static final String CAPABILITY_SOURCE =
            SNAPSHOT_RESOURCE_PATH + "#sources/product-scope.yaml/document";

    private static final String PRODUCT_SCOPE_SOURCE = "product-scope.yaml";
    private static final String DOCUMENT_PATH = "sources.product-scope.yaml.document";

    private final JsonMapper jsonMapper;
    private final Supplier<InputStream> snapshotStreamSupplier;

    @Autowired
    public CatalogSnapshotLoader(JsonMapper jsonMapper) {
        this(
                jsonMapper,
                () -> CatalogSnapshotLoader.class
                        .getClassLoader()
                        .getResourceAsStream(SNAPSHOT_RESOURCE_PATH));
    }

    CatalogSnapshotLoader(
            JsonMapper jsonMapper,
            Supplier<InputStream> snapshotStreamSupplier) {
        this.jsonMapper = Objects.requireNonNull(jsonMapper, "jsonMapper");
        this.snapshotStreamSupplier =
                Objects.requireNonNull(snapshotStreamSupplier, "snapshotStreamSupplier");
    }

    CatalogSnapshot load() {
        var snapshotStream = snapshotStreamSupplier.get();
        if (snapshotStream == null) {
            throw new IllegalStateException(
                    "Required catalog snapshot resource is missing: " + SNAPSHOT_RESOURCE_PATH);
        }

        try (snapshotStream) {
            var root = requireObject(jsonMapper.readTree(snapshotStream), "$");
            var sources = requireObjectField(root, "sources", "sources");
            var productScope = requireObjectField(
                    sources,
                    PRODUCT_SCOPE_SOURCE,
                    "sources." + PRODUCT_SCOPE_SOURCE);
            var document = requireObjectField(productScope, "document", DOCUMENT_PATH);
            var alpha = requireObjectField(document, "alpha", DOCUMENT_PATH + ".alpha");
            var betaGate =
                    requireObjectField(document, "betaGate", DOCUMENT_PATH + ".betaGate");

            var capabilities = new TechnicalAlphaCapabilities(
                    CAPABILITY_SOURCE,
                    requireBoolean(
                            alpha,
                            "publicRegistrationEnabled",
                            DOCUMENT_PATH + ".alpha.publicRegistrationEnabled"),
                    requireBoolean(
                            alpha,
                            "paymentEnabled",
                            DOCUMENT_PATH + ".alpha.paymentEnabled"),
                    requireBoolean(
                            alpha,
                            "romanceModeEnabled",
                            DOCUMENT_PATH + ".alpha.romanceModeEnabled"),
                    requireBoolean(
                            alpha,
                            "voiceEnabled",
                            DOCUMENT_PATH + ".alpha.voiceEnabled"),
                    requireBoolean(
                            alpha,
                            "imageEnabled",
                            DOCUMENT_PATH + ".alpha.imageEnabled"),
                    requireBoolean(
                            alpha,
                            "websocketEnabled",
                            DOCUMENT_PATH + ".alpha.websocketEnabled"),
                    requireBoolean(
                            betaGate,
                            "betaGenerationEnabledByDefault",
                            DOCUMENT_PATH + ".betaGate.betaGenerationEnabledByDefault"));

            return new CatalogSnapshot(
                    requireText(document, "phase", DOCUMENT_PATH + ".phase"),
                    requireText(alpha, "transport", DOCUMENT_PATH + ".alpha.transport"),
                    capabilities);
        } catch (JacksonException exception) {
            throw new IllegalStateException(
                    "Catalog snapshot resource is not valid JSON: " + SNAPSHOT_RESOURCE_PATH,
                    exception);
        } catch (IOException exception) {
            throw new IllegalStateException(
                    "Catalog snapshot resource could not be read: " + SNAPSHOT_RESOURCE_PATH,
                    exception);
        }
    }

    private static JsonNode requireObjectField(JsonNode parent, String field, String path) {
        return requireObject(parent.get(field), path);
    }

    private static JsonNode requireObject(JsonNode value, String path) {
        if (value == null || !value.isObject()) {
            throw invalidField(path, "object");
        }
        return value;
    }

    private static String requireText(JsonNode parent, String field, String path) {
        var value = parent.get(field);
        if (value == null || !value.isString() || value.stringValue().isBlank()) {
            throw invalidField(path, "non-blank string");
        }
        return value.stringValue();
    }

    private static boolean requireBoolean(JsonNode parent, String field, String path) {
        var value = parent.get(field);
        if (value == null || !value.isBoolean()) {
            throw invalidField(path, "boolean");
        }
        return value.booleanValue();
    }

    private static IllegalStateException invalidField(String path, String expectedType) {
        return new IllegalStateException(
                "Catalog snapshot field %s must be a %s".formatted(path, expectedType));
    }

    record CatalogSnapshot(
            String phase,
            String transport,
            TechnicalAlphaCapabilities capabilities) {
    }
}
