package com.virtualcompanion.runtime.generation.web;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.virtualcompanion.platform.persistence.GenerationReceiveService;
import com.virtualcompanion.platform.persistence.GenerationReceiveService.ReceivedGeneration;
import com.virtualcompanion.platform.persistence.GenerationRecord;
import com.virtualcompanion.platform.persistence.GenerationRepository;
import com.virtualcompanion.platform.persistence.GenerationStateService;
import com.virtualcompanion.platform.persistence.GenerationStateService.GenerationSnapshot;
import com.virtualcompanion.platform.persistence.WorkItemEnqueueService;
import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import com.virtualcompanion.runtime.web.RuntimeApiExceptionHandler;
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
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        receiveService = mock(GenerationReceiveService.class);
        enqueueService = mock(WorkItemEnqueueService.class);
        generationRepository = mock(GenerationRepository.class);
        generationStateService = mock(GenerationStateService.class);
        GenerationController controller = new GenerationController(
                receiveService, enqueueService, generationRepository, generationStateService);
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
