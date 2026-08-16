package com.virtualcompanion.runtime.generation.web;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.virtualcompanion.platform.persistence.GenerationFeedbackRecord;
import com.virtualcompanion.platform.persistence.GenerationFeedbackService;
import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import com.virtualcompanion.runtime.web.RuntimeApiExceptionHandler;
import java.time.Instant;
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
 * Standalone controller test for the generation feedback HTTP slice (FEEDBACK
 * / FR-CHAT-003): a valid submission records and echoes the row, an unapproved
 * kind maps to 400 INVALID_REQUEST, and a foreign or absent generation maps to
 * 404 NOT_FOUND_OR_FORBIDDEN (existence never disclosed).
 */
class GenerationFeedbackControllerTest {

    private static final Instant NOW = Instant.parse("2026-08-16T10:00:00Z");

    private GenerationFeedbackService feedbackService;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        feedbackService = mock(GenerationFeedbackService.class);
        GenerationFeedbackController controller = new GenerationFeedbackController(feedbackService);
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

    @Test
    void recordFeedbackReturnsTheRecordedRow() throws Exception {
        when(feedbackService.record(1L, 55L, "FACTUAL_ERROR", "数字不对"))
                .thenReturn(Optional.of(new GenerationFeedbackRecord(
                        55L, "FACTUAL_ERROR", "数字不对", NOW)));

        mockMvc.perform(post("/api/v1/generations/55/feedback")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"kind\":\"FACTUAL_ERROR\",\"note\":\"数字不对\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.generationId").value(55))
                .andExpect(jsonPath("$.kind").value("FACTUAL_ERROR"))
                .andExpect(jsonPath("$.note").value("数字不对"))
                .andExpect(jsonPath("$.createdAt").value("2026-08-16T10:00:00Z"));
    }

    @Test
    void recordFeedbackWithoutNoteIsAccepted() throws Exception {
        when(feedbackService.record(1L, 55L, "UNSAFE", null))
                .thenReturn(Optional.of(new GenerationFeedbackRecord(55L, "UNSAFE", null, NOW)));

        mockMvc.perform(post("/api/v1/generations/55/feedback")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"kind\":\"UNSAFE\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.kind").value("UNSAFE"));
    }

    @Test
    void recordFeedbackUnapprovedKindMapsTo400() throws Exception {
        mockMvc.perform(post("/api/v1/generations/55/feedback")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"kind\":\"TOO_SLOW\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    @Test
    void recordFeedbackAbsentGenerationMapsTo404() throws Exception {
        when(feedbackService.record(1L, 999L, "UNSAFE", null)).thenReturn(Optional.empty());

        mockMvc.perform(post("/api/v1/generations/999/feedback")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"kind\":\"UNSAFE\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND_OR_FORBIDDEN"));
    }
}
