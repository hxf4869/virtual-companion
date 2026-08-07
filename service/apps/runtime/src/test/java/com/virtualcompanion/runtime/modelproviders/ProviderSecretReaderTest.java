package com.virtualcompanion.runtime.modelproviders;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ProviderSecretReaderTest {

    @TempDir
    Path tempDir;

    @Test
    void readsSecretFromSecretFileAndStripsTrailingNewline() throws IOException {
        Files.writeString(tempDir.resolve("openai-key"), "sk-live-token\n");

        assertEquals("sk-live-token", reader().readSecret("openai-key"));
    }

    @Test
    void missingSecretFailsClosed() {
        IllegalStateException exception = assertThrows(
                IllegalStateException.class, () -> reader().readSecret("missing-key"));
        assertTrue(exception.getMessage().contains("no credential found"));
    }

    @Test
    void blankSecretNameRejected() {
        assertThrows(IllegalArgumentException.class, () -> reader().readSecret("  "));
    }

    @Test
    void nullSecretNameRejected() {
        assertThrows(NullPointerException.class, () -> reader().readSecret(null));
    }

    @Test
    void nullSecretRootRejected() {
        assertThrows(NullPointerException.class, () -> new ProviderSecretReader(null));
    }

    private ProviderSecretReader reader() {
        return new ProviderSecretReader(tempDir);
    }
}
