package com.virtualcompanion.runtime.baseline;

import java.util.Objects;

public record TechnicalAlphaCapabilities(
        String source,
        boolean publicRegistrationEnabled,
        boolean paymentEnabled,
        boolean romanceModeEnabled,
        boolean voiceEnabled,
        boolean imageEnabled,
        boolean websocketEnabled,
        boolean betaGenerationEnabledByDefault) {

    public TechnicalAlphaCapabilities {
        if (Objects.requireNonNull(source, "source").isBlank()) {
            throw new IllegalArgumentException("source must not be blank");
        }
        if (publicRegistrationEnabled
                || paymentEnabled
                || romanceModeEnabled
                || voiceEnabled
                || imageEnabled
                || websocketEnabled
                || betaGenerationEnabledByDefault) {
            throw new IllegalStateException(
                    "Restricted Technical Alpha capabilities must remain disabled");
        }
    }
}
