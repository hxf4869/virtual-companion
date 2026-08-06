package com.virtualcompanion.conversation.contextplan;

/**
 * Provider-neutral markers for the sources that compose a {@link ContextPlan}.
 *
 * <p>Only canonical, owner-owned sources appear here. A provider session is
 * deliberately <em>not</em> a context source: canonical memory is the truth and
 * a provider session never supplies it (INV-MEM-001). Adding a provider-coupled
 * source here would violate the supplier-neutrality acceptance of TASK-0019.
 */
public enum ContextSourceKind {
    SYSTEM,
    PERSONA,
    SESSION_MEMORY,
    RELATIONSHIP_MEMORY,
    CONVERSATION_HISTORY,
    USER_INPUT
}
