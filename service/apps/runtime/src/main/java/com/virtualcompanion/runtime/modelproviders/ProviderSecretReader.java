package com.virtualcompanion.runtime.modelproviders;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;
import java.util.Objects;

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
 */
public final class ProviderSecretReader {

    private final Path secretRoot;

    public ProviderSecretReader(Path secretRoot) {
        this.secretRoot = Objects.requireNonNull(secretRoot, "secretRoot must not be null");
    }

    /**
     * Read the credential referenced by a secret name.
     *
     * @param secretName non-blank secret reference from runtime configuration
     * @return the credential value (the trailing newline of a secret file is stripped)
     * @throws IllegalStateException when neither the environment variable nor the
     *                               secret file provides a value
     */
    public String readSecret(String secretName) {
        Objects.requireNonNull(secretName, "secretName must not be null");
        if (secretName.isBlank()) {
            throw new IllegalArgumentException("secretName must not be blank");
        }

        String envName = "VC_MODEL_SECRET_"
                + secretName.toUpperCase(Locale.ROOT).replace('-', '_');
        String fromEnv = System.getenv(envName);
        if (fromEnv != null && !fromEnv.isBlank()) {
            return fromEnv;
        }

        Path secretFile = secretRoot.resolve(secretName);
        if (Files.isRegularFile(secretFile)) {
            try {
                return Files.readString(secretFile).stripTrailing();
            } catch (IOException exception) {
                throw new IllegalStateException(
                        "cannot read secret file " + secretFile, exception);
            }
        }

        throw new IllegalStateException(
                "no credential found for secret " + secretName
                        + " (expected env " + envName + " or secret file " + secretFile + ")");
    }
}
