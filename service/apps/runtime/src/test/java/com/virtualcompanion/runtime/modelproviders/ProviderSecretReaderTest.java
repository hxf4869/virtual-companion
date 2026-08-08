package com.virtualcompanion.runtime.modelproviders;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFileAttributeView;
import java.nio.file.attribute.PosixFilePermission;
import java.util.Arrays;
import java.util.Set;
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

    @Test
    void traversalAndSeparatorSecretNamesRejected() throws IOException {
        Files.writeString(tempDir.resolve("openai-key"), "sk-live-token");

        assertThrows(IllegalArgumentException.class, () -> reader().readSecret("../openai-key"));
        assertThrows(IllegalArgumentException.class, () -> reader().readSecret("sub/../openai-key"));
        assertThrows(IllegalArgumentException.class, () -> reader().readSecret("/etc/passwd"));
        assertThrows(IllegalArgumentException.class, () -> reader().readSecret("sub/openai-key"));
        assertThrows(IllegalArgumentException.class, () -> reader().readSecret("sub\\openai-key"));
        assertThrows(IllegalArgumentException.class, () -> reader().readSecret("."));
        assertThrows(IllegalArgumentException.class, () -> reader().readSecret(".."));
        // The valid basename still resolves through the same reader.
        assertEquals("sk-live-token", reader().readSecret("openai-key"));
    }

    @Test
    void secretFileEscapingRootRejected() throws IOException {
        Path outside = Files.createTempFile("outside-key", null);
        try {
            Files.writeString(outside, "outside-token");
            Files.createSymbolicLink(tempDir.resolve("link-key"), outside);

            assertThrows(IllegalStateException.class, () -> reader().readSecret("link-key"));
        } finally {
            Files.deleteIfExists(outside);
        }
    }

    @Test
    void oversizedSecretFileRejected() throws IOException {
        byte[] oversized = new byte[(int) ProviderSecretReader.MAX_SECRET_FILE_BYTES + 1];
        Arrays.fill(oversized, (byte) 'x');
        Files.write(tempDir.resolve("big-key"), oversized);

        assertThrows(IllegalStateException.class, () -> reader().readSecret("big-key"));
    }

    @Test
    void groupOrWorldWritableSecretRejected() throws IOException {
        Path file = tempDir.resolve("writable-key");
        Files.writeString(file, "sk-live-token");
        PosixFileAttributeView view =
                Files.getFileAttributeView(file, PosixFileAttributeView.class);
        if (view == null) {
            // Non-POSIX filesystem: permission semantics do not apply.
            return;
        }
        Files.setPosixFilePermissions(file, Set.of(
                PosixFilePermission.OWNER_READ,
                PosixFilePermission.OWNER_WRITE,
                PosixFilePermission.GROUP_WRITE));

        assertThrows(IllegalStateException.class, () -> reader().readSecret("writable-key"));
    }

    private ProviderSecretReader reader() {
        return new ProviderSecretReader(tempDir);
    }
}
