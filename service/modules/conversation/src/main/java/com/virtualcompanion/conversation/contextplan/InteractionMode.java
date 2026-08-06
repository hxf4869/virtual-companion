package com.virtualcompanion.conversation.contextplan;

/**
 * Provider-neutral interaction intent for one generation turn.
 *
 * <p>{@code LISTEN} keeps the companion in a low-pressure reflective stance
 * (the gentle-listener default); {@code DISCUSS} opens an active exchange. The
 * choice is made deterministically by {@link InteractionModeSelector} from
 * observable signals, never from a provider session or model output.
 */
public enum InteractionMode {
    LISTEN,
    DISCUSS
}
