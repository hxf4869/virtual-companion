package com.virtualcompanion.runtime.authorization;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.virtualcompanion.catalog.ModelProtocol;
import com.virtualcompanion.catalog.SafetyClassifierOutcome;
import com.virtualcompanion.modelruntime.authorization.AuthorizationSnapshot;
import com.virtualcompanion.modelruntime.authorization.AuthorizationSnapshotId;
import com.virtualcompanion.modelruntime.authorization.AuthorizationStatus;
import com.virtualcompanion.modelruntime.authorization.DataCategory;
import com.virtualcompanion.modelruntime.authorization.ExecutionAuthorizationGuard;
import com.virtualcompanion.modelruntime.authorization.InMemoryAuthorizationSnapshotStore;
import com.virtualcompanion.modelruntime.authorization.ProcessingPurpose;
import com.virtualcompanion.modelruntime.authorization.ProviderContractRef;
import com.virtualcompanion.modelruntime.authorization.ProviderRegion;
import com.virtualcompanion.modelruntime.contract.ModelProtocolCapabilities;
import com.virtualcompanion.modelruntime.contract.OwnershipTuple;
import com.virtualcompanion.modelruntime.contract.ProtocolMessage;
import com.virtualcompanion.modelruntime.contract.ResponseMode;
import com.virtualcompanion.modelruntime.contract.TimeoutBudget;
import com.virtualcompanion.modelruntime.execution.AdapterLocator;
import com.virtualcompanion.modelruntime.execution.InMemoryAdapterLocator;
import com.virtualcompanion.modelruntime.execution.LiveAttemptOutcome;
import com.virtualcompanion.modelruntime.execution.LiveAttemptTerminal;
import com.virtualcompanion.modelruntime.execution.LiveInvocationRequest;
import com.virtualcompanion.modelruntime.execution.LiveModelInvoker;
import com.virtualcompanion.modelruntime.execution.PayloadComposition;
import com.virtualcompanion.modelopenai.OpenAiChatCompletionsAdapter;
import com.virtualcompanion.modelopenai.OpenAiChatCompletionsConfig;
import com.virtualcompanion.modelruntime.registry.InMemoryProviderRegistry;
import com.virtualcompanion.modelruntime.registry.ProviderId;
import com.virtualcompanion.modelruntime.registry.ProviderRegistration;
import com.virtualcompanion.modelruntime.routing.DeterministicRouter;
import com.virtualcompanion.modelruntime.routing.Entitlement;
import com.virtualcompanion.modelruntime.routing.GenerationRecovery;
import com.virtualcompanion.modelruntime.routing.QuotaLedger;
import com.virtualcompanion.modelruntime.routing.RoutingRequest;
import com.virtualcompanion.modelruntime.routing.ServiceClass;
import com.virtualcompanion.safety.ClassifierReport;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * S0-26 provider-call capture test: the REAL OpenAI Chat Completions adapter
 * (real codec, real HTTP client) runs against a loopback HTTP server, and the
 * captured request body proves the enforcement chain end to end.
 *
 * <p>The dual authorization snapshots declare {@code MESSAGE_TEXT} only, while
 * the assembled payload carries a memory-recall SYSTEM block. The invoker must
 * delete that unauthorized block BEFORE materializing the protocol request, so
 * the actual outbound HTTP body contains the authorized user turn but never
 * the memory text — deletion at the payload level, not a prompt instruction.
 */
class UnauthorizedMemoryOutboundCaptureTest {

    private static final OwnershipTuple OWNERSHIP = new OwnershipTuple("1", "9", "5", "10");
    private static final ProviderId PROVIDER = new ProviderId("capture-loopback");
    private static final ProviderRegion REGION = new ProviderRegion("us");
    private static final ProviderContractRef CONTRACT = new ProviderContractRef("alpha-standard");
    private static final String MEMORY_TEXT = "长期记忆：用户对花生严重过敏（2026-01-05 已确认）";
    private static final String USER_TEXT = "今天中午吃什么比较合适？";

    private HttpServer server;
    private final List<String> capturedBodies = new CopyOnWriteArrayList<>();

    @BeforeEach
    void startLoopbackServer() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/chat/completions", exchange -> {
            byte[] body = exchange.getRequestBody().readAllBytes();
            capturedBodies.add(new String(body, StandardCharsets.UTF_8));
            // Minimal valid streaming completion: one content chunk → stop
            // chunk → usage chunk → [DONE] (the exact shape the session's SSE
            // parser and the fence require).
            String sse = "data: {\"object\":\"chat.completion.chunk\",\"choices\":"
                    + "[{\"index\":0,\"delta\":{\"content\":\"ok\"},\"finish_reason\":null}]}\n\n"
                    + "data: {\"object\":\"chat.completion.chunk\",\"choices\":"
                    + "[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n"
                    + "data: {\"object\":\"chat.completion.chunk\",\"choices\":[],"
                    + "\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":1,\"total_tokens\":2}}\n\n"
                    + "data: [DONE]\n\n";
            byte[] response = sse.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "text/event-stream");
            exchange.sendResponseHeaders(200, response.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(response);
            }
        });
        server.start();
    }

    @AfterEach
    void stopLoopbackServer() {
        if (server != null) {
            server.stop(0);
        }
    }

    @Test
    void capturedRequestBodyContainsNoUnauthorizedMemoryText() {
        LiveModelInvoker invoker = invokerWithMessageTextOnlySnapshots();

        LiveAttemptOutcome outcome = invoker.invoke(request());

        // The authorized turn completed through the real adapter + codec.
        assertEquals(LiveAttemptTerminal.SUCCEEDED, outcome.terminal());
        assertEquals("ok", outcome.response());
        assertEquals(1, capturedBodies.size());

        String requestBody = capturedBodies.getFirst();
        assertTrue(requestBody.contains(USER_TEXT),
                "the authorized conversation turn must be present in the request body");
        assertFalse(requestBody.contains(MEMORY_TEXT),
                "the unauthorized MEMORY_SNIPPET block must be deleted from the"
                        + " actual request body");
        assertFalse(requestBody.contains("\"role\":\"system\""),
                "no system block may remain once neither persona nor memory is"
                        + " declared by the snapshot");
    }

    private LiveModelInvoker invokerWithMessageTextOnlySnapshots() {
        InMemoryAuthorizationSnapshotStore store = new InMemoryAuthorizationSnapshotStore();
        store.put(snapshot("snap-req"));
        store.put(snapshot("snap-exec"));

        OpenAiChatCompletionsConfig config = new OpenAiChatCompletionsConfig(
                java.net.URI.create(
                        "http://127.0.0.1:" + server.getAddress().getPort()
                                + "/v1/chat/completions"),
                "loopback-capture-token",
                "capture-model");
        OpenAiChatCompletionsAdapter adapter = new OpenAiChatCompletionsAdapter(config);
        ProviderRegistration registration = new ProviderRegistration(
                PROVIDER, adapter.protocol(), adapter.capabilities(), adapter);
        InMemoryProviderRegistry registry = new InMemoryProviderRegistry();
        registry.register(registration);

        AdapterLocator locator = new InMemoryAdapterLocator(List.of(registration));
        ExecutionAuthorizationGuard guard = new ExecutionAuthorizationGuard(store, registry);
        QuotaLedger ledger = new QuotaLedger();
        ledger.provision(OWNERSHIP.ownerUserId(), 100L);
        DeterministicRouter router = new DeterministicRouter(registry, ledger);
        GenerationRecovery recovery = new GenerationRecovery(ledger);
        return new LiveModelInvoker(
                router,
                guard,
                store,
                locator,
                recovery,
                Map.of(PROVIDER, "capture-supplier"));
    }

    /** Dual ACTIVE snapshots authorizing MESSAGE_TEXT only (default intent). */
    private static AuthorizationSnapshot snapshot(String id) {
        return new AuthorizationSnapshot(
                new AuthorizationSnapshotId(id),
                AuthorizationStatus.ACTIVE,
                PROVIDER,
                REGION,
                CONTRACT,
                ProcessingPurpose.COMPANION_CHAT,
                Set.of(DataCategory.MESSAGE_TEXT),
                false,
                false);
    }

    /**
     * An assembled external request carrying an unauthorized memory-recall
     * SYSTEM block ahead of the authorized user turn, with the S0-26
     * per-message composition declaration.
     */
    private static LiveInvocationRequest request() {
        RoutingRequest routing = new RoutingRequest(
                OWNERSHIP,
                new Entitlement(OWNERSHIP.ownerUserId(), ServiceClass.simulated()),
                ModelProtocol.OPENAI_CHAT_COMPLETIONS,
                new ModelProtocolCapabilities(Set.of()),
                "snap-req",
                "snap-exec",
                "ZERO_LLM_FALLBACK",
                42L);
        return new LiveInvocationRequest(
                routing,
                List.of(
                        new ProtocolMessage(ProtocolMessage.Role.SYSTEM, MEMORY_TEXT),
                        new ProtocolMessage(ProtocolMessage.Role.USER, USER_TEXT)),
                new ResponseMode.Text(),
                true,
                new TimeoutBudget(
                        Duration.ofSeconds(5), Duration.ofSeconds(30), Duration.ofSeconds(30)),
                List.of(),
                new ClassifierReport(SafetyClassifierOutcome.CLASSIFIED, 0.80),
                PayloadComposition.of(DataCategory.MEMORY_SNIPPET, DataCategory.MESSAGE_TEXT));
    }
}
