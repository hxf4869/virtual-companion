package com.virtualcompanion.runtime.memory.web;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.virtualcompanion.platform.persistence.MemoryEvidenceRecord;
import com.virtualcompanion.platform.persistence.MemoryRecord;
import com.virtualcompanion.platform.persistence.MemoryService;
import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import com.virtualcompanion.runtime.web.RuntimeApiExceptionHandler;
import java.time.Instant;
import java.util.List;
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
 * Standalone controller test for the memory HTTP API (TASK-0180): the 8
 * OpenAPI endpoints' happy paths, the 404 NOT_FOUND_OR_FORBIDDEN contract for
 * foreign/absent resources (including the dead-end update / non-pending
 * confirm-reject cases), and the 400 INVALID_REQUEST contract for malformed
 * ids, bodies, scopes and the includeDeleted query value. The
 * {@code @AuthenticationPrincipal(expression = "accountId")} resolver is
 * replicated from the message-history controller tests; the owner GUC binding
 * itself is covered by the auth integration layer.
 */
class MemoryControllerTest {

    private static final Instant NOW = Instant.parse("2026-08-12T12:00:00Z");

    private MemoryService memoryService;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        memoryService = mock(MemoryService.class);
        MemoryController controller = new MemoryController(memoryService);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new RuntimeApiExceptionHandler())
                .setCustomArgumentResolvers(new HandlerMethodArgumentResolver() {
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
                })
                .build();
    }

    private static MemoryRecord memory(long id, String status) {
        return new MemoryRecord(id, 7L, "SESSION", "summary-" + id, status, 100L, null, NOW);
    }

    private static String jsonBody(String scope, String summary, String conversationId) {
        return "{\"scope\":\"" + scope + "\",\"summary\":\"" + summary + "\""
                + (conversationId == null ? "" : ",\"conversationId\":\"" + conversationId + "\"")
                + "}";
    }

    // ------------------------------------------------------------------
    // createMemoryCandidate
    // ------------------------------------------------------------------

    @Test
    void createMemoryCandidateReturnsTheCreatedCandidate() throws Exception {
        when(memoryService.create(1L, 7L, "SESSION", "likes hiking", 100L, List.of("ref-1")))
                .thenReturn(Optional.of(new MemoryRecord(
                        42L, 7L, "SESSION", "likes hiking", "PENDING_CONFIRMATION", 100L, null, NOW)));

        mockMvc.perform(post("/api/v1/relationships/7/memories/candidates")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"scope\":\"SESSION\",\"summary\":\"likes hiking\","
                                + "\"conversationId\":\"100\",\"evidence\":[\"ref-1\"]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.memoryId").value(42))
                .andExpect(jsonPath("$.scope").value("SESSION"))
                .andExpect(jsonPath("$.summary").value("likes hiking"))
                .andExpect(jsonPath("$.status").value("PENDING_CONFIRMATION"))
                .andExpect(jsonPath("$.conversationId").value(100))
                .andExpect(jsonPath("$.createdAt").value("2026-08-12T12:00:00Z"));

        verify(memoryService).create(1L, 7L, "SESSION", "likes hiking", 100L, List.of("ref-1"));
    }

    @Test
    void createMemoryCandidateMapsForeignRelationshipTo404() throws Exception {
        when(memoryService.create(1L, 99L, "SESSION", "s", 100L, null))
                .thenReturn(Optional.empty());

        mockMvc.perform(post("/api/v1/relationships/99/memories/candidates")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(jsonBody("SESSION", "s", "100")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND_OR_FORBIDDEN"));
    }

    @Test
    void createMemoryCandidateRejectsNonAlphaScopeAs400() throws Exception {
        when(memoryService.create(1L, 7L, "ACCOUNT_PRIVATE", "s", null, null))
                .thenThrow(new IllegalArgumentException("scope is not enabled in Alpha: ACCOUNT_PRIVATE"));

        mockMvc.perform(post("/api/v1/relationships/7/memories/candidates")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(jsonBody("ACCOUNT_PRIVATE", "s", null)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    @Test
    void createMemoryCandidateRejectsMissingSummaryAs400() throws Exception {
        mockMvc.perform(post("/api/v1/relationships/7/memories/candidates")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"scope\":\"SESSION\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    @Test
    void createMemoryCandidateRejectsInvalidRelationshipIdAs400() throws Exception {
        mockMvc.perform(post("/api/v1/relationships/not-a-number/memories/candidates")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(jsonBody("SESSION", "s", "100")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    // ------------------------------------------------------------------
    // listMemories
    // ------------------------------------------------------------------

    @Test
    void listMemoriesReturnsTheCallersMemory() throws Exception {
        when(memoryService.list(1L, 7L, null)).thenReturn(List.of(memory(42L, "ACCEPTED")));

        mockMvc.perform(get("/api/v1/relationships/7/memories"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].memoryId").value(42))
                .andExpect(jsonPath("$[0].scope").value("SESSION"))
                .andExpect(jsonPath("$[0].status").value("ACCEPTED"));

        verify(memoryService).list(1L, 7L, null);
    }

    @Test
    void listMemoriesPassesIncludeDeletedThrough() throws Exception {
        when(memoryService.list(1L, 7L, true)).thenReturn(List.of());

        mockMvc.perform(get("/api/v1/relationships/7/memories").param("includeDeleted", "true"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));

        verify(memoryService).list(1L, 7L, true);
    }

    @Test
    void listMemoriesEchoesDeletedAtWhenIncludeDeleted() throws Exception {
        Instant deletedAt = Instant.parse("2026-08-18T12:00:00Z");
        MemoryRecord deleted = new MemoryRecord(
                42L, 7L, "RELATIONSHIP", "gone", "ACCEPTED", null, deletedAt, NOW);
        when(memoryService.list(1L, 7L, true)).thenReturn(List.of(deleted));

        mockMvc.perform(get("/api/v1/relationships/7/memories").param("includeDeleted", "true"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].memoryId").value(42))
                .andExpect(jsonPath("$[0].deletedAt").value("2026-08-18T12:00:00Z"));
    }

    @Test
    void listMemoriesReturnsEmptyArrayForForeignRelationship() throws Exception {
        when(memoryService.list(1L, 999L, null)).thenReturn(List.of());

        mockMvc.perform(get("/api/v1/relationships/999/memories"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void listMemoriesRejectsMalformedIncludeDeletedAs400() throws Exception {
        mockMvc.perform(get("/api/v1/relationships/7/memories").param("includeDeleted", "maybe"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    // ------------------------------------------------------------------
    // getMemory
    // ------------------------------------------------------------------

    @Test
    void getMemoryReturnsTheMemory() throws Exception {
        when(memoryService.get(1L, 42L)).thenReturn(Optional.of(memory(42L, "ACCEPTED")));

        mockMvc.perform(get("/api/v1/memories/42"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.memoryId").value(42))
                .andExpect(jsonPath("$.conversationId").value(100));

        verify(memoryService).get(1L, 42L);
    }

    @Test
    void getMemoryMapsForeignOrAbsentMemoryTo404() throws Exception {
        when(memoryService.get(1L, 99L)).thenReturn(Optional.empty());

        mockMvc.perform(get("/api/v1/memories/99"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND_OR_FORBIDDEN"));
    }

    @Test
    void getMemoryRejectsInvalidMemoryIdAs400() throws Exception {
        mockMvc.perform(get("/api/v1/memories/not-a-number"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    // ------------------------------------------------------------------
    // updateMemory
    // ------------------------------------------------------------------

    @Test
    void updateMemoryReturnsTheUpdatedMemory() throws Exception {
        when(memoryService.update(1L, 55L, "new summary"))
                .thenReturn(Optional.of(memory(55L, "ACCEPTED")));

        mockMvc.perform(patch("/api/v1/memories/55")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"summary\":\"new summary\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.memoryId").value(55))
                .andExpect(jsonPath("$.status").value("ACCEPTED"));

        verify(memoryService).update(1L, 55L, "new summary");
    }

    @Test
    void updateMemoryMapsDeadEndOrForeignTo404() throws Exception {
        when(memoryService.update(1L, 55L, "new")).thenReturn(Optional.empty());

        mockMvc.perform(patch("/api/v1/memories/55")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"summary\":\"new\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND_OR_FORBIDDEN"));
    }

    @Test
    void updateMemoryRejectsBlankSummaryAs400() throws Exception {
        mockMvc.perform(patch("/api/v1/memories/55")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"summary\":\"\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    // ------------------------------------------------------------------
    // deleteMemory
    // ------------------------------------------------------------------

    @Test
    void deleteMemoryReturnsThePreDeleteSnapshot() throws Exception {
        when(memoryService.delete(1L, 55L)).thenReturn(Optional.of(memory(55L, "ACCEPTED")));

        mockMvc.perform(delete("/api/v1/memories/55"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.memoryId").value(55))
                .andExpect(jsonPath("$.status").value("ACCEPTED"));

        verify(memoryService).delete(1L, 55L);
    }

    @Test
    void deleteMemoryMapsForeignOrAlreadyDeletedTo404() throws Exception {
        when(memoryService.delete(1L, 99L)).thenReturn(Optional.empty());

        mockMvc.perform(delete("/api/v1/memories/99"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND_OR_FORBIDDEN"));
    }

    // ------------------------------------------------------------------
    // confirmMemoryCandidate / rejectMemoryCandidate
    // ------------------------------------------------------------------

    @Test
    void confirmMemoryCandidateReturnsTheAcceptedMemory() throws Exception {
        when(memoryService.confirm(1L, 55L)).thenReturn(Optional.of(memory(55L, "ACCEPTED")));

        mockMvc.perform(post("/api/v1/memories/55/confirm"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.memoryId").value(55))
                .andExpect(jsonPath("$.status").value("ACCEPTED"));

        verify(memoryService).confirm(1L, 55L);
    }

    @Test
    void confirmMemoryCandidateMapsNonPendingTo404() throws Exception {
        when(memoryService.confirm(1L, 55L)).thenReturn(Optional.empty());

        mockMvc.perform(post("/api/v1/memories/55/confirm"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND_OR_FORBIDDEN"));
    }

    @Test
    void rejectMemoryCandidateReturnsTheRejectedMemory() throws Exception {
        when(memoryService.reject(1L, 55L)).thenReturn(Optional.of(memory(55L, "REJECTED")));

        mockMvc.perform(post("/api/v1/memories/55/reject"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.memoryId").value(55))
                .andExpect(jsonPath("$.status").value("REJECTED"));

        verify(memoryService).reject(1L, 55L);
    }

    @Test
    void rejectMemoryCandidateMapsNonPendingTo404() throws Exception {
        when(memoryService.reject(1L, 55L)).thenReturn(Optional.empty());

        mockMvc.perform(post("/api/v1/memories/55/reject"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND_OR_FORBIDDEN"));
    }

    // ------------------------------------------------------------------
    // listMemoryEvidence
    // ------------------------------------------------------------------

    @Test
    void listMemoryEvidenceReturnsTheSourceChain() throws Exception {
        when(memoryService.listEvidence(1L, 55L))
                .thenReturn(List.of(new MemoryEvidenceRecord(11L, "ref-1", NOW)));

        mockMvc.perform(get("/api/v1/memories/55/evidence"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].evidenceId").value(11))
                .andExpect(jsonPath("$[0].sourceRef").value("ref-1"))
                .andExpect(jsonPath("$[0].createdAt").value("2026-08-12T12:00:00Z"));

        verify(memoryService).listEvidence(1L, 55L);
    }

    @Test
    void listMemoryEvidenceReturnsEmptyArrayForForeignOrAbsentMemory() throws Exception {
        when(memoryService.listEvidence(1L, 99L)).thenReturn(List.of());

        mockMvc.perform(get("/api/v1/memories/99/evidence"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }
}
