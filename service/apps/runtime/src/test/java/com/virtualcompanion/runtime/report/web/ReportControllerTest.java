package com.virtualcompanion.runtime.report.web;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.virtualcompanion.platform.persistence.ReportRecord;
import com.virtualcompanion.platform.persistence.ReportService;
import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import com.virtualcompanion.runtime.web.ResourceNotFoundException;
import com.virtualcompanion.runtime.web.RuntimeApiExceptionHandler;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.OptionalLong;
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
 * Standalone controller test for the report intake API (REPORT-BE V56,
 * FR-DATA-001 / §20.15): create with an optional message anchor, the 404
 * existence hiding for a foreign anchor, owner-scoped keyset listing and the
 * unapproved-reason 400.
 */
class ReportControllerTest {

    private static final Instant NOW = Instant.parse("2026-08-19T12:00:00Z");

    private ReportService reportService;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        reportService = mock(ReportService.class);
        ReportController controller = new ReportController(reportService);
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

    private static ReportRecord submitted(long id, Long messageId) {
        return new ReportRecord(
                id, messageId, "UNSAFE_CONTENT", "让我不安", "SUBMITTED", "", NOW, null);
    }

    @Test
    void createReturnsTheAppendedRecord() throws Exception {
        when(reportService.create(1L, 10L, "UNSAFE_CONTENT", "让我不安"))
                .thenReturn(OptionalLong.of(5L));
        when(reportService.get(1L, 5L))
                .thenReturn(Optional.of(submitted(5L, 10L)));

        mockMvc.perform(post("/api/v1/reports")
                        .contentType("application/json")
                        .content("{\"messageId\":\"10\",\"reason\":\"UNSAFE_CONTENT\",\"note\":\"  让我不安  \"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("5"))
                .andExpect(jsonPath("$.messageId").value("10"))
                .andExpect(jsonPath("$.status").value("SUBMITTED"))
                .andExpect(jsonPath("$.resolvedAt").doesNotExist());
    }

    @Test
    void createHidesExistenceForAForeignMessageAnchor() throws Exception {
        when(reportService.create(1L, 999L, "OTHER", "x"))
                .thenReturn(OptionalLong.empty());

        mockMvc.perform(post("/api/v1/reports")
                        .contentType("application/json")
                        .content("{\"messageId\":\"999\",\"reason\":\"OTHER\",\"note\":\"x\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND_OR_FORBIDDEN"));
    }

    @Test
    void createRejectsAnUnapprovedReason() throws Exception {
        mockMvc.perform(post("/api/v1/reports")
                        .contentType("application/json")
                        .content("{\"reason\":\"NOT_A_REASON\",\"note\":\"x\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    @Test
    void listReturnsTheOwnerPage() throws Exception {
        when(reportService.list(1L, null, null))
                .thenReturn(List.of(submitted(5L, null)));

        mockMvc.perform(get("/api/v1/reports"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value("5"))
                .andExpect(jsonPath("$[0].messageId").doesNotExist());
    }

    @Test
    void getHidesExistenceForAForeignReport() throws Exception {
        // The service maps a foreign/absent row to empty; the controller
        // raises ResourceNotFoundException and the advice renders the uniform
        // 404 (existence never disclosed).
        when(reportService.get(1L, 9L))
                .thenThrow(new ResourceNotFoundException("report"));

        mockMvc.perform(get("/api/v1/reports/9"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND_OR_FORBIDDEN"));
    }
}
