package com.virtualcompanion.runtime.generation.web;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.virtualcompanion.platform.persistence.GenerationCancelService;
import com.virtualcompanion.platform.persistence.GenerationFinalizeService;
import com.virtualcompanion.platform.persistence.GenerationReceiveService;
import com.virtualcompanion.platform.persistence.GenerationReceiveService.ReceivedGeneration;
import com.virtualcompanion.platform.persistence.GenerationRecord;
import com.virtualcompanion.platform.persistence.GenerationRepository;
import com.virtualcompanion.platform.persistence.GenerationStateService;
import com.virtualcompanion.platform.persistence.GenerationStateService.GenerationSnapshot;
import com.virtualcompanion.platform.persistence.SafetyEventService;
import com.virtualcompanion.platform.persistence.ServiceWindowService;
import com.virtualcompanion.platform.persistence.WorkItemEnqueueService;
import com.virtualcompanion.runtime.servicemode.BetaServiceWindow;
import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import com.virtualcompanion.runtime.web.RuntimeApiExceptionHandler;
import com.virtualcompanion.safety.DeterministicSafetyClassifier;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.MethodParameter;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;

/**
 * Standalone controller test for the generation HTTP vertical slice intake and
 * snapshot endpoints (TASK-0174): the idempotent intake enqueues a GENERATION
 * work item only on first creation, a duplicate reception resolves to the same
 * logical generation without re-enqueuing, and the owner-scoped snapshot maps
 * the persisted state. Malformed ids and a blank idempotency key map to 400
 * INVALID_REQUEST. The {@code @AuthenticationPrincipal} resolver is replicated
 * from the message-history / memory controller tests; the owner GUC binding
 * itself is covered by the auth integration layer.
 */
class GenerationControllerTest {

    private GenerationReceiveService receiveService;
    private WorkItemEnqueueService enqueueService;
    private GenerationRepository generationRepository;
    private GenerationStateService generationStateService;
    private GenerationFinalizeService finalizeService;
    private SafetyEventService safetyEventService;
    private GenerationCancelService cancelService;
    private ServiceWindowService serviceWindowService;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        receiveService = mock(GenerationReceiveService.class);
        enqueueService = mock(WorkItemEnqueueService.class);
        generationRepository = mock(GenerationRepository.class);
        generationStateService = mock(GenerationStateService.class);
        finalizeService = mock(GenerationFinalizeService.class);
        safetyEventService = mock(SafetyEventService.class);
        cancelService = mock(GenerationCancelService.class);
        serviceWindowService = mock(ServiceWindowService.class);
        // SVC-WINDOW: disabled by default, mirroring production default.
        setUpWithWindow(new BetaServiceWindow(false, false, "20:30", 10, "Asia/Shanghai"));
    }

    private void setUpWithWindow(BetaServiceWindow window) {
        GenerationController controller = new GenerationController(
                receiveService, enqueueService, generationRepository, generationStateService,
                finalizeService, new DeterministicSafetyClassifier(), safetyEventService,
                cancelService, window, serviceWindowService,
                com.virtualcompanion.runtime.observability.TestAlerts.metrics(),
                com.virtualcompanion.runtime.observability.TestAlerts.noop());
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new RuntimeApiExceptionHandler())
                .setCustomArgumentResolvers(principalResolver())
                .build();
    }

    private static HandlerMethodArgumentResolver principalResolver() {
        return new HandlerMethodArgumentResolver() {
            @Override
            public boolean supportsParameter(MethodParameter parameter) {
                return parameter.hasParameterAnnotation(AuthenticationPrincipal.class);
            }

            @Override
            public Object resolveArgument(MethodParameter parameter,
                    ModelAndViewContainer mavContainer, NativeWebRequest webRequest,
                    WebDataBinderFactory binderFactory) {
                JwtTokenService.Principal principal =
                        new JwtTokenService.Principal(1, "USER", "alice");
                if (parameter.getParameterType() == long.class) {
                    return principal.accountId();
                }
                return principal;
            }
        };
    }

    // ------------------------------------------------------------------
    // POST /api/v1/conversations/{conversationId}/generations
    // ------------------------------------------------------------------

    @Test
    void sendGenerationRefusedOutsideTheServiceWindowBeforeAnythingPersists() throws Exception {
        // SVC-WINDOW: with the gate on and the window closed, the turn is
        // refused up front — no receive, no enqueue, 403 BETA_OPERATIONS_NOT_READY.
        // Paused makes the closed-gate refusal deterministic (the old draft
        // window 20:30-00:00 flipped on real clock when tests ran inside it).
        setUpWithWindow(new BetaServiceWindow(true, true, "20:30", 10, "Asia/Shanghai"));
        org.mockito.Mockito.when(serviceWindowService.state(
                        org.mockito.ArgumentMatchers.anyLong(),
                        org.mockito.ArgumentMatchers.any()))
                .thenReturn(new ServiceWindowService.WindowState(0, false));

        mockMvc.perform(post("/api/v1/conversations/100/generations")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"idempotencyKey\":\"key-w\",\"userContent\":\"hello\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("BETA_OPERATIONS_NOT_READY"));

        verify(receiveService, never()).receive(
                org.mockito.ArgumentMatchers.anyLong(),
                org.mockito.ArgumentMatchers.anyLong(),
                org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.anyString());
    }

    @Test
    void sendGenerationFirstCreationEnqueuesAndReturnsTheGeneration() throws Exception {
        when(receiveService.receive(1L, 100L, "key-1",
                GenerationReceiveService.DEFAULT_USER_ROLE, "hello", "AUTO"))
                .thenReturn(new ReceivedGeneration("gen-55", 55L, 200L, true));
        when(generationRepository.find(1L, 55L))
                .thenReturn(Optional.of(new GenerationRecord(
                        1L, 55L, 100L, "gen-55", "CREATED", "key-1")));

        mockMvc.perform(post("/api/v1/conversations/100/generations")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"idempotencyKey\":\"key-1\",\"userContent\":\"hello\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.generationId").value(55))
                .andExpect(jsonPath("$.conversationId").value(100))
                .andExpect(jsonPath("$.logicalGenerationId").value("gen-55"))
                .andExpect(jsonPath("$.status").value("CREATED"))
                .andExpect(jsonPath("$.mode").value("AUTO"));

        verify(enqueueService).enqueue(1L, "GENERATION", 55L);
    }

    @Test
    void sendGenerationInputBlockedTurnNeverEnqueuesOrInvokesTheModel() throws Exception {
        // SAFETY-WIRE (V58): a fresh crisis message is still persisted
        // (receive ran) but the turn walks INPUT_REVIEW -> INPUT_BLOCKED, gets
        // a chat.blocked event path and a safety event — no work item.
        when(receiveService.receive(1L, 100L, "key-safe",
                GenerationReceiveService.DEFAULT_USER_ROLE, "我不想活了", "AUTO"))
                .thenReturn(new ReceivedGeneration("gen-60", 60L, 300L, true));
        when(generationRepository.find(1L, 60L))
                .thenReturn(Optional.of(new GenerationRecord(
                        1L, 60L, 100L, "gen-60", "INPUT_BLOCKED", "key-safe")));

        mockMvc.perform(post("/api/v1/conversations/100/generations")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"idempotencyKey\":\"key-safe\",\"userContent\":\"我不想活了\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.generationId").value(60))
                .andExpect(jsonPath("$.status").value("INPUT_BLOCKED"));

        verify(generationStateService).promote(1L, 60L, GenerationStateService.INPUT_REVIEW);
        verify(finalizeService).terminalizeAsInputBlocked(1L, 60L, "input-imminent-self-harm");
        verify(safetyEventService).record(
                1L, 60L, SafetyEventService.STAGE_INPUT, "R4_IMMINENT",
                "input-imminent-self-harm");
        verify(enqueueService, never()).enqueue(
                org.mockito.ArgumentMatchers.anyLong(),
                org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.anyLong());
    }

    @Test
    void sendGenerationExitIntentCancelsTheTurnWithoutEnqueue() throws Exception {
        // NL-EXIT (§21.3.4): the exit message is persisted, the turn cancels
        // through the catalog double-hop, nothing is enqueued and no safety
        // event is written (an exit is not a safety incident).
        when(receiveService.receive(1L, 100L, "key-exit",
                GenerationReceiveService.DEFAULT_USER_ROLE, "我不想聊了", "AUTO"))
                .thenReturn(new ReceivedGeneration("gen-61", 61L, 301L, true));
        when(cancelService.cancel(1L, 61L))
                .thenReturn(Optional.of(new GenerationRecord(
                        1L, 61L, 100L, "gen-61", "CANCELLED", "key-exit")));
        when(generationRepository.find(1L, 61L))
                .thenReturn(Optional.of(new GenerationRecord(
                        1L, 61L, 100L, "gen-61", "CANCELLED", "key-exit")));

        mockMvc.perform(post("/api/v1/conversations/100/generations")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"idempotencyKey\":\"key-exit\",\"userContent\":\"我不想聊了\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.generationId").value(61))
                .andExpect(jsonPath("$.status").value("CANCELLED"));

        verify(cancelService).cancel(1L, 61L);
        verify(enqueueService, never()).enqueue(
                org.mockito.ArgumentMatchers.anyLong(),
                org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.anyLong());
        verify(safetyEventService, never()).record(
                org.mockito.ArgumentMatchers.anyLong(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.anyString());
    }

    @Test
    void sendGenerationRegenerateReusesTheSourceUserMessage() throws Exception {
        when(receiveService.receive(1L, 100L, "key-2",
                GenerationReceiveService.DEFAULT_USER_ROLE, "hello", "AUTO", 9L))
                .thenReturn(new ReceivedGeneration("gen-56", 56L, 9L, true));
        when(generationRepository.find(1L, 56L))
                .thenReturn(Optional.of(new GenerationRecord(
                        1L, 56L, 100L, "gen-56", "CREATED", "key-2")));

        mockMvc.perform(post("/api/v1/conversations/100/generations")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"idempotencyKey\":\"key-2\",\"userContent\":\"hello\",\"sourceUserMessageId\":\"9\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.generationId").value(56));

        verify(receiveService).receive(1L, 100L, "key-2",
                GenerationReceiveService.DEFAULT_USER_ROLE, "hello", "AUTO", 9L);
        verify(enqueueService).enqueue(1L, "GENERATION", 56L);
    }

    @Test
    void sendGenerationExplicitModeIsValidatedAndEchoed() throws Exception {
        when(receiveService.receive(1L, 100L, "key-1",
                GenerationReceiveService.DEFAULT_USER_ROLE, "hello", "DISCUSS"))
                .thenReturn(new ReceivedGeneration("gen-55", 55L, 200L, true));
        when(generationRepository.find(1L, 55L))
                .thenReturn(Optional.of(new GenerationRecord(
                        1L, 55L, 100L, "gen-55", "CREATED", "key-1", "DISCUSS")));

        mockMvc.perform(post("/api/v1/conversations/100/generations")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"idempotencyKey\":\"key-1\",\"userContent\":\"hello\",\"mode\":\"DISCUSS\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.mode").value("DISCUSS"));

        verify(enqueueService).enqueue(1L, "GENERATION", 55L);
    }

    @Test
    void sendGenerationCasualModeIsValidatedAndEchoed() throws Exception {
        when(receiveService.receive(1L, 100L, "key-1",
                GenerationReceiveService.DEFAULT_USER_ROLE, "hello", "CASUAL"))
                .thenReturn(new ReceivedGeneration("gen-55", 55L, 200L, true));
        when(generationRepository.find(1L, 55L))
                .thenReturn(Optional.of(new GenerationRecord(
                        1L, 55L, 100L, "gen-55", "CREATED", "key-1", "CASUAL")));

        mockMvc.perform(post("/api/v1/conversations/100/generations")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"idempotencyKey\":\"key-1\",\"userContent\":\"hello\",\"mode\":\"CASUAL\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.mode").value("CASUAL"));
    }

    @Test
    void sendGenerationUnapprovedModeMapsTo400() throws Exception {
        mockMvc.perform(post("/api/v1/conversations/100/generations")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"idempotencyKey\":\"key-1\",\"userContent\":\"hello\",\"mode\":\"YELL\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    @Test
    void sendGenerationDuplicateReceptionDoesNotEnqueueAgain() throws Exception {
        when(receiveService.receive(1L, 100L, "key-1",
                GenerationReceiveService.DEFAULT_USER_ROLE, "hello", "AUTO"))
                .thenReturn(new ReceivedGeneration("gen-55", 55L, null, false));
        when(generationRepository.find(1L, 55L))
                .thenReturn(Optional.of(new GenerationRecord(
                        1L, 55L, 100L, "gen-55", "IN_PROGRESS", "key-1")));

        mockMvc.perform(post("/api/v1/conversations/100/generations")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"idempotencyKey\":\"key-1\",\"userContent\":\"hello\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.generationId").value(55))
                .andExpect(jsonPath("$.logicalGenerationId").value("gen-55"))
                .andExpect(jsonPath("$.status").value("IN_PROGRESS"));

        verify(enqueueService, never()).enqueue(org.mockito.ArgumentMatchers.anyLong(),
                org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyLong());
    }

    @Test
    void sendGenerationMalformedConversationIdMapsTo400() throws Exception {
        mockMvc.perform(post("/api/v1/conversations/not-a-number/generations")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"idempotencyKey\":\"key-1\",\"userContent\":\"hello\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    @Test
    void sendGenerationBlankIdempotencyKeyMapsTo400() throws Exception {
        mockMvc.perform(post("/api/v1/conversations/100/generations")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"idempotencyKey\":\"  \",\"userContent\":\"hello\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    // ------------------------------------------------------------------
    // GET /api/v1/generations/{generationId}/snapshot
    // ------------------------------------------------------------------

    @Test
    void snapshotReturnsStatusAssistantMessageAndEvents() throws Exception {
        when(generationStateService.readSnapshot(1L, 55L))
                .thenReturn(new GenerationSnapshot(
                        "COMPLETED", 300L, "[{\"event\":\"chat.completed\"}]", 42L, 58L));

        mockMvc.perform(get("/api/v1/generations/55/snapshot"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("COMPLETED"))
                .andExpect(jsonPath("$.assistantMessageId").value(300))
                .andExpect(jsonPath("$.events").value("[{\"event\":\"chat.completed\"}]"))
                .andExpect(jsonPath("$.usage.inputTokens").value(42))
                .andExpect(jsonPath("$.usage.outputTokens").value(58));

        verify(generationStateService).readSnapshot(1L, 55L);
    }

    @Test
    void snapshotOmitsUsageBeforeFinalizeSettlesIt() throws Exception {
        when(generationStateService.readSnapshot(1L, 55L))
                .thenReturn(new GenerationSnapshot(
                        "IN_PROGRESS", null, "[{\"event\":\"chat.accepted\"}]", null, null));

        mockMvc.perform(get("/api/v1/generations/55/snapshot"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("IN_PROGRESS"))
                .andExpect(jsonPath("$.usage").doesNotExist());

        verify(generationStateService).readSnapshot(1L, 55L);
    }

    @Test
    void snapshotMalformedGenerationIdMapsTo400() throws Exception {
        mockMvc.perform(get("/api/v1/generations/not-a-number/snapshot"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    @Test
    void snapshotNonPositiveGenerationIdMapsTo400() throws Exception {
        mockMvc.perform(get("/api/v1/generations/0/snapshot"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }
}
