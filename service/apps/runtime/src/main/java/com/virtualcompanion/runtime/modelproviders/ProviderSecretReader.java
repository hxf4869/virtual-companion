package com.virtualcompanion.runtime.modelproviders;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermission;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;

/**
 * Reads a platform credential referenced by a {@link ModelProviderProperties.Deployment}.
 *
 * <p>Credentials are injected through an approved channel and never stored in the
 * repository, logs, business types, OpenAPI or catalog. Resolution order:
 * <ol>
 *   <li>the environment variable {@code VC_MODEL_SECRET_<NAME>} (name upper-cased,
 *       hyphens turned into underscores) for local/Windows development; then</li>
 *   <li>the Docker-secret file {@code <secretRoot>/<name>} on Linux deployments.</li>
 * </ol>
 * Resolution is fail-closed: an unknown secret is an explicit
 * {@link IllegalStateException}, never a blank or guessed default.</p>
 *
 * <p>Secret names are restricted to a plain basename (no path separators, no
 * {@code .} or {@code ..} segments) and every resolved file must stay inside
 * {@code secretRoot} (P2-05 containment). Secret files must be regular files,
 * no larger than {@value #MAX_SECRET_FILE_BYTES} bytes, and on POSIX
 * filesystems must not be writable by group or other users.</p>
 */
public final class ProviderSecretReader {

    /** Upper bound for a Docker-style secret file (64 KiB). */
    public static final long MAX_SECRET_FILE_BYTES = 64 * 1024;

    private final Path secretRoot;

    public ProviderSecretReader(Path secretRoot) {
        this.secretRoot = Objects.requireNonNull(secretRoot, "secretRoot must not be null");
    }

    /**
     * Read the credential referenced by a secret name.
     *
     * @param secretName non-blank basename of the secret reference
     * @return the credential value (the trailing newline of a secret file is stripped)
     * @throws IllegalArgumentException when the name is not a plain basename
     * @throws IllegalStateException    when the resolved file escapes the secret
     *                                  root, is not a regular file, exceeds the
     *                                  size limit, has unsafe POSIX permissions,
     *                                  cannot be read, or neither the environment
     *                                  variable nor the secret file provides a value
     */
    public String readSecret(String secretName) {
        Objects.requireNonNull(secretName, "secretName must not be null");
        if (secretName.isBlank()) {
            throw new IllegalArgumentException("secretName must not be blank");
        }
        requirePlainBasename(secretName);

        String envName = "VC_MODEL_SECRET_"
                + secretName.toUpperCase(Locale.ROOT).replace('-', '_');
        String fromEnv = System.getenv(envName);
        if (fromEnv != null && !fromEnv.isBlank()) {
            return fromEnv;
        }

        Path secretFile = resolveContained(secretName);
        if (Files.isSymbolicLink(secretFile) || !Files.isRegularFile(secretFile)) {
            throw new IllegalStateException(
                    "no credential found for secret " + secretName
                            + " (expected env " + envName + " or secret file " + secretFile + ")");
        }
        try {
            requireSafePermissions(secretFile);
            if (Files.size(secretFile) > MAX_SECRET_FILE_BYTES) {
                throw new IllegalStateException(
                        "secret file " + secretFile + " exceeds the "
                                + MAX_SECRET_FILE_BYTES + " byte limit");
            }
            return Files.readString(secretFile).stripTrailing();
        } catch (IOException exception) {
            throw new IllegalStateException(
                    "cannot read secret file " + secretFile, exception);
        }
    }

    private static void requirePlainBasename(String secretName) {
        if (secretName.contains("/") || secretName.contains("\\")) {
            throw new IllegalArgumentException(
                    "secretName must be a plain basename without path separators");
        }
        if (".".equals(secretName) || "..".equals(secretName)) {
            throw new IllegalArgumentException(
                    "secretName must not be a dot segment");
        }
    }

    private Path resolveContained(String secretName) {
        Path root = secretRoot.toAbsolutePath().normalize();
        Path resolved = root.resolve(secretName).normalize();
        if (!resolved.startsWith(root)) {
            throw new IllegalStateException(
                    "secret file escapes the secret root: " + secretName);
        }
        return resolved;
    }

    private static void requireSafePermissions(Path secretFile) throws IOException {
        Set<PosixFilePermission> permissions;
        try {
            permissions = Files.getPosixFilePermissions(secretFile);
        } catch (UnsupportedOperationException unsupported) {
            // Non-POSIX filesystem (e.g. Windows): ownership semantics do not apply.
            return;
        }
        if (permissions.contains(PosixFilePermission.GROUP_WRITE)
                || permissions.contains(PosixFilePermission.OTHERS_WRITE)) {
            throw new IllegalStateException(
                    "secret file must not be writable by group or other users: "
                            + secretFile);
        }
    }
}
