package com.virtualcompanion.runtime.baseline;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.ByteArrayInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import tools.jackson.databind.node.ObjectNode;
import tools.jackson.databind.json.JsonMapper;

class CatalogSnapshotLoaderTest {

    private static final JsonMapper JSON_MAPPER = JsonMapper.builder().build();
    private static final String VALID_SNAPSHOT = """
            {
              "sources": {
                "product-scope.yaml": {
                  "document": {
                    "phase": "TECHNICAL_ALPHA",
                    "alpha": {
                      "transport": "HTTP_SSE",
                      "publicRegistrationEnabled": false,
                      "paymentEnabled": false,
                      "romanceModeEnabled": false,
                      "voiceEnabled": false,
                      "imageEnabled": false,
                      "websocketEnabled": false
                    },
                    "betaGate": {
                      "betaGenerationEnabledByDefault": false
                    }
                  }
                }
              }
            }
            """;

    @Test
    void loadsWhitelistedProjectionFromPackagedSnapshot() {
        var snapshot = new CatalogSnapshotLoader(JSON_MAPPER).load();

        assertThat(snapshot.phase()).isEqualTo("TECHNICAL_ALPHA");
        assertThat(snapshot.transport()).isEqualTo("HTTP_SSE");
        assertThat(snapshot.capabilities())
                .isEqualTo(new TechnicalAlphaCapabilities(
                        CatalogSnapshotLoader.CAPABILITY_SOURCE,
                        false,
                        false,
                        false,
                        false,
                        false,
                        false,
                        false));
    }

    @Test
    void packagedSnapshotPreservesGeneratedSourceBytes() throws Exception {
        byte[] packagedBytes;
        try (var inputStream = CatalogSnapshotLoader.class
                .getClassLoader()
                .getResourceAsStream(CatalogSnapshotLoader.SNAPSHOT_RESOURCE_PATH)) {
            assertThat(inputStream).isNotNull();
            packagedBytes = inputStream.readAllBytes();
        }

        var sourcePath = findRepositoryRoot()
                .resolve(CatalogSnapshotLoader.SNAPSHOT_RESOURCE_PATH);
        assertThat(packagedBytes).isEqualTo(Files.readAllBytes(sourcePath));
    }

    @Test
    void rejectsMissingSnapshotResource() {
        var loader = new CatalogSnapshotLoader(JSON_MAPPER, () -> null);

        assertThatThrownBy(loader::load)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("missing");
    }

    @ParameterizedTest(name = "{1} is required")
    @MethodSource("whitelistedFields")
    void rejectsEveryMissingWhitelistedField(String section, String field) {
        var document = mutableDocument();
        objectAt(document, section).remove(field);

        assertThatThrownBy(loaderFor(documentRoot(document))::load)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining(field);
    }

    @ParameterizedTest(name = "{1} must have its exact JSON type")
    @MethodSource("whitelistedFields")
    void rejectsEveryWhitelistedFieldWithWrongType(String section, String field) {
        var document = mutableDocument();
        var object = objectAt(document, section);
        if (field.equals("phase") || field.equals("transport")) {
            object.put(field, false);
        } else {
            object.put(field, "false");
        }

        assertThatThrownBy(loaderFor(documentRoot(document))::load)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining(field);
    }

    @ParameterizedTest(name = "{1} cannot be enabled")
    @MethodSource("restrictedGates")
    void rejectsEveryRestrictedGateWhenEnabled(String section, String field) {
        var document = mutableDocument();
        objectAt(document, section).put(field, true);

        assertThatThrownBy(loaderFor(documentRoot(document))::load)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("must remain disabled");
    }

    private static CatalogSnapshotLoader loaderFor(String snapshotJson) {
        return new CatalogSnapshotLoader(
                JSON_MAPPER,
                () -> new ByteArrayInputStream(snapshotJson.getBytes(UTF_8)));
    }

    private static ObjectNode mutableDocument() {
        return (ObjectNode) JSON_MAPPER
                .readTree(VALID_SNAPSHOT)
                .get("sources")
                .get("product-scope.yaml")
                .get("document");
    }

    private static ObjectNode objectAt(ObjectNode document, String section) {
        return section == null ? document : (ObjectNode) document.get(section);
    }

    private static String documentRoot(ObjectNode document) {
        var root = JSON_MAPPER.readTree(VALID_SNAPSHOT);
        ((ObjectNode) root.get("sources").get("product-scope.yaml")).set("document", document);
        return JSON_MAPPER.writeValueAsString(root);
    }

    private static Stream<Arguments> whitelistedFields() {
        return Stream.concat(
                Stream.of(
                        Arguments.of(null, "phase"),
                        Arguments.of("alpha", "transport")),
                restrictedGates());
    }

    private static Stream<Arguments> restrictedGates() {
        return Stream.of(
                Arguments.of("alpha", "publicRegistrationEnabled"),
                Arguments.of("alpha", "paymentEnabled"),
                Arguments.of("alpha", "romanceModeEnabled"),
                Arguments.of("alpha", "voiceEnabled"),
                Arguments.of("alpha", "imageEnabled"),
                Arguments.of("alpha", "websocketEnabled"),
                Arguments.of("betaGate", "betaGenerationEnabledByDefault"));
    }

    private static Path findRepositoryRoot() {
        var current = Path.of("").toAbsolutePath();
        while (current != null
                && !Files.isRegularFile(
                        current.resolve(CatalogSnapshotLoader.SNAPSHOT_RESOURCE_PATH))) {
            current = current.getParent();
        }
        if (current == null) {
            throw new IllegalStateException("Could not locate repository root");
        }
        return current;
    }
}
