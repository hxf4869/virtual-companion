package com.virtualcompanion.modelruntime.routing;

import com.virtualcompanion.modelruntime.registry.ProviderId;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

/**
 * §12.8 会话模型粘滞: process-local store of the model deployment that last
 * completed a turn for each conversation. The router prefers this deployment
 * while it is healthy, so an active conversation keeps the same model (and
 * therefore the same persona voice) across turns; a switch happens only at a
 * turn boundary and only when health changes (circuit OPEN) or the deployment
 * no longer matches the request.
 *
 * <p>Deliberately process-local and id-only: the Technical Alpha / Beta
 * deployment topology is single-node Compose, so in-process memory is the
 * whole cluster state. A restart clears the map — the first successful turn
 * re-establishes affinity, which is indistinguishable from a fresh
 * conversation. Entries carry only a conversation id and a provider id (no
 * user content, no owner identity beyond the conversation surrogate key).
 */
public final class SessionDeploymentAffinity {

    private final ConcurrentMap<String, ProviderId> byConversation = new ConcurrentHashMap<>();

    /**
     * Record the deployment that just served this conversation successfully.
     * Last success wins; safe to call concurrently.
     */
    public void record(String conversationId, ProviderId deployment) {
        if (conversationId == null || conversationId.isBlank()) {
            throw new IllegalArgumentException("conversationId must not be blank");
        }
        byConversation.put(conversationId, java.util.Objects.requireNonNull(deployment, "deployment must not be null"));
    }

    /**
     * The conversation's last successful deployment, if known to this process.
     */
    public Optional<ProviderId> sticky(String conversationId) {
        if (conversationId == null) {
            return Optional.empty();
        }
        return Optional.ofNullable(byConversation.get(conversationId));
    }
}
