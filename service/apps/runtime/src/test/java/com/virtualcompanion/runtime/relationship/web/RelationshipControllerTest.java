package com.virtualcompanion.runtime.relationship.web;

import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.virtualcompanion.platform.persistence.RelationshipRecord;
import com.virtualcompanion.platform.persistence.RelationshipService;
import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import com.virtualcompanion.runtime.web.RuntimeApiExceptionHandler;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.MethodParameter;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;

/**
 * Standalone controller test for the Relationship HTTP API (TASK-0178):
 * five endpoints happy paths, the NOT_FOUND_OR_FORBIDDEN 404 contract for a
 * foreign/absent id, and the 400 INVALID_REQUEST contract for a bad id. The
 * {@code @AuthenticationPrincipal(expression = "accountId")} resolver is
 * replicated from the auth controller tests; the owner GUC binding itself is
 * covered by the auth integration layer.
 */
class RelationshipControllerTest {

    private static final Instant NOW = Instant.parse("2026-08-12T12:00:00Z");

    private RelationshipService relationshipService;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        relationshipService = mock(RelationshipService.class);
        RelationshipController controller = new RelationshipController(relationshipService);
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
                        // The controller declares a primitive long owner id resolved
                        // through the SpEL expression; a custom resolver returns the
                        // resolved value directly (no SpEL evaluation happens here).
                        if (parameter.getParameterType() == long.class) {
                            return principal.accountId();
                        }
                        return principal;
                    }
                })
                .build();
    }

    private static RelationshipRecord record(long id, String persona, boolean active) {
        return new RelationshipRecord(id, persona, active, NOW);
    }

    @Test
    void createReturnsTheNewActiveRelationship() throws Exception {
        when(relationshipService.create(1L, "gentle-listener")).thenReturn(99L);
        when(relationshipService.get(1L, 99L)).thenReturn(
                Optional.of(record(99L, "gentle-listener", true)));

        mockMvc.perform(post("/api/v1/relationships")
                        .contentType("application/json")
                        .content("{\"personaRef\":\"gentle-listener\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.relationshipId").value(99))
                .andExpect(jsonPath("$.personaRef").value("gentle-listener"))
                .andExpect(jsonPath("$.active").value(true))
                .andExpect(jsonPath("$.createdAt").value("2026-08-12T12:00:00Z"));

        verify(relationshipService).create(1L, "gentle-listener");
    }

    @Test
    void createRejectsBlankPersonaRef() throws Exception {
        mockMvc.perform(post("/api/v1/relationships")
                        .contentType("application/json")
                        .content("{\"personaRef\":\"\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        // @Valid rejects the blank persona before the service is reached.
        verify(relationshipService, never()).create(anyLong(), anyString());
    }

    @Test
    void listReturnsCallersRelationships() throws Exception {
        when(relationshipService.list(1L)).thenReturn(List.of(
                record(1L, "gentle-listener", true),
                record(2L, "gentle-listener", false)));

        mockMvc.perform(get("/api/v1/relationships"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].relationshipId").value(1))
                .andExpect(jsonPath("$[0].active").value(true))
                .andExpect(jsonPath("$[1].relationshipId").value(2))
                .andExpect(jsonPath("$[1].active").value(false));
    }

    @Test
    void getReturnsTheCallersRelationship() throws Exception {
        when(relationshipService.get(1L, 7L)).thenReturn(
                Optional.of(record(7L, "gentle-listener", true)));

        mockMvc.perform(get("/api/v1/relationships/7"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.relationshipId").value(7))
                .andExpect(jsonPath("$.personaRef").value("gentle-listener"));
    }

    @Test
    void getMapsForeignOrAbsentIdToNotFound() throws Exception {
        when(relationshipService.get(1L, 404L)).thenReturn(Optional.empty());

        mockMvc.perform(get("/api/v1/relationships/404"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND_OR_FORBIDDEN"));
    }

    @Test
    void activatePromotesAndReturnsTheRelationship() throws Exception {
        when(relationshipService.activate(1L, 7L)).thenReturn(
                Optional.of(record(7L, "gentle-listener", true)));

        mockMvc.perform(post("/api/v1/relationships/7"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.relationshipId").value(7))
                .andExpect(jsonPath("$.active").value(true));
    }

    @Test
    void activateMapsForeignIdToNotFound() throws Exception {
        when(relationshipService.activate(1L, 404L)).thenReturn(Optional.empty());

        mockMvc.perform(post("/api/v1/relationships/404"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND_OR_FORBIDDEN"));
    }

    @Test
    void deactivateReturnsTheInactiveRelationship() throws Exception {
        when(relationshipService.deactivate(1L, 7L)).thenReturn(
                Optional.of(record(7L, "gentle-listener", false)));

        mockMvc.perform(post("/api/v1/relationships/7/deactivate"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.relationshipId").value(7))
                .andExpect(jsonPath("$.active").value(false));
    }

    @Test
    void deactivateMapsForeignIdToNotFound() throws Exception {
        when(relationshipService.deactivate(1L, 404L)).thenReturn(Optional.empty());

        mockMvc.perform(post("/api/v1/relationships/404/deactivate"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND_OR_FORBIDDEN"));
    }

    @Test
    void invalidPathIdMapsToBadRequest() throws Exception {
        mockMvc.perform(get("/api/v1/relationships/not-a-number"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        verify(relationshipService, never()).get(1L, 0L);
    }
}
