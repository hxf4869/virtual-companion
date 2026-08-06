package com.virtualcompanion.safety;

/**
 * Outcome of one safety pipeline evaluation.
 *
 * <p>{@code ALLOW} releases reviewed content; {@code PAUSE} pauses incremental streaming
 * pending further review (set by the incremental gate); {@code BLOCK} refuses the content
 * and prevents {@code chat.completed} (set by the final gate and by hard-rule / fail-closed
 * decisions). Only {@code ALLOW} permits completion.
 */
public enum SafetyVerdict {
    ALLOW,
    PAUSE,
    BLOCK
}
