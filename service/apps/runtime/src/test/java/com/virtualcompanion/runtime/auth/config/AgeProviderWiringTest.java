package com.virtualcompanion.runtime.auth.config;

import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.virtualcompanion.runtime.age.HttpAgeVerificationAdapter;
import com.virtualcompanion.runtime.age.SimulatedAgeVerifier;
import java.util.List;
import org.junit.jupiter.api.Test;

class AgeProviderWiringTest {

    private final AuthDataSourceConfig config = new AuthDataSourceConfig();

    @Test
    void defaultsToSimulatedWithoutRequiringRealProviderSecrets() {
        assertInstanceOf(SimulatedAgeVerifier.class, config.ageVerificationPort(
                false, "", "", "", "", "", List.of()));
    }

    @Test
    void explicitlyEnabledConfigurationBuildsTheRealAdapter() {
        assertInstanceOf(HttpAgeVerificationAdapter.class, config.ageVerificationPort(
                true,
                "http://127.0.0.1:1/verify",
                "api-key",
                "approved-age-vendor",
                "revision-1",
                "0123456789abcdef0123456789abcdef",
                List.of()));
    }

    @Test
    void enabledExternalEndpointRequiresAnExplicitAgeProviderHost() {
        assertThrows(IllegalArgumentException.class, () -> config.ageVerificationPort(
                true,
                "https://api.openai.com/verify",
                "api-key",
                "approved-age-vendor",
                "revision-1",
                "0123456789abcdef0123456789abcdef",
                List.of()));
    }

    @Test
    void enabledConfigurationFailsFastWhenPseudonymSecretIsMissing() {
        assertThrows(IllegalArgumentException.class, () -> config.ageVerificationPort(
                true,
                "https://api.openai.com/verify",
                "api-key",
                "approved-age-vendor",
                "revision-1",
                "",
                List.of("api.openai.com")));
    }
}
