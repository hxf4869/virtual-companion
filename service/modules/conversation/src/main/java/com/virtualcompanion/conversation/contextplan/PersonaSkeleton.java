package com.virtualcompanion.conversation.contextplan;

import java.util.Objects;

/**
 * Provider-neutral persona skeleton for the gentle-listener companion.
 *
 * <p>Every field is supplier-neutral: there is no provider, model, adapter or
 * API field, and {@code defaultMode} is the provider-neutral
 * {@link InteractionMode}. The structural absence of provider-specific fields is
 * asserted by {@code PersonaSkeletonTest} via reflection so a future addition
 * cannot silently introduce provider coupling. Real persona content is approved
 * out of band; this skeleton only fixes the shape (TASK-0019 forbids guessing
 * final persona content here).
 */
public record PersonaSkeleton(
        String templateId,
        String displayName,
        String tone,
        InteractionMode defaultMode,
        String reflectionPromptStyle) {

    public PersonaSkeleton {
        Objects.requireNonNull(templateId, "templateId must not be null");
        if (templateId.isBlank()) {
            throw new IllegalArgumentException("templateId must not be blank");
        }
        Objects.requireNonNull(displayName, "displayName must not be null");
        if (displayName.isBlank()) {
            throw new IllegalArgumentException("displayName must not be blank");
        }
        Objects.requireNonNull(tone, "tone must not be null");
        if (tone.isBlank()) {
            throw new IllegalArgumentException("tone must not be blank");
        }
        Objects.requireNonNull(defaultMode, "defaultMode must not be null");
        Objects.requireNonNull(reflectionPromptStyle, "reflectionPromptStyle must not be null");
        if (reflectionPromptStyle.isBlank()) {
            throw new IllegalArgumentException("reflectionPromptStyle must not be blank");
        }
    }

    /**
     * The gentle-listener persona template declared by {@code product-scope.yaml}.
     */
    public static PersonaSkeleton gentleListener() {
        return new PersonaSkeleton(
                "gentle-listener",
                "Gentle Listener",
                "calm, reflective, low-pressure",
                InteractionMode.LISTEN,
                "open-ended reflection");
    }
}
