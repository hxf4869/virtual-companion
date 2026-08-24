package com.virtualcompanion.runtime.age.web;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.virtualcompanion.platform.persistence.AgeAppealService;
import com.virtualcompanion.runtime.auth.web.AuthExceptionHandler;
import com.virtualcompanion.runtime.web.RuntimeApiExceptionHandler;
import org.springframework.dao.DataIntegrityViolationException;
import java.time.Instant;
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

class AgeAppealAdminControllerTest {

    private AgeAppealService appeals;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        appeals = mock(AgeAppealService.class);
        mockMvc = MockMvcBuilders.standaloneSetup(new AgeAppealAdminController(appeals))
                .setControllerAdvice(
                        new AuthExceptionHandler(), new RuntimeApiExceptionHandler())
                .setCustomArgumentResolvers(new HandlerMethodArgumentResolver() {
                    @Override
                    public boolean supportsParameter(MethodParameter parameter) {
                        return parameter.hasParameterAnnotation(AuthenticationPrincipal.class);
                    }

                    @Override
                    public Object resolveArgument(
                            MethodParameter parameter,
                            ModelAndViewContainer mavContainer,
                            NativeWebRequest webRequest,
                            WebDataBinderFactory binderFactory) {
                        return 41L;
                    }
                })
                .build();
    }

    @Test
    void resolvesThroughHumanDecisionWithoutReturningOwnerIdentity() throws Exception {
        Instant resolvedAt = Instant.parse("2026-08-24T00:00:00Z");
        when(appeals.resolve(41L, 7L, "REVERIFY", "证据不足，重新核验"))
                .thenReturn(new AgeAppealService.Resolution(
                        7L, "REVERIFY", "AGE_REVERIFY_REQUIRED", resolvedAt));

        mockMvc.perform(post("/api/v1/auth/admin/age-appeals/7/resolve")
                        .contentType("application/json")
                        .content("{\"decision\":\"REVERIFY\","
                                + "\"resolutionNote\":\"证据不足，重新核验\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.appealId").value("7"))
                .andExpect(jsonPath("$.decision").value("REVERIFY"))
                .andExpect(jsonPath("$.ageState").value("AGE_REVERIFY_REQUIRED"))
                .andExpect(jsonPath("$.ownerUserId").doesNotExist());
        verify(appeals).resolve(41L, 7L, "REVERIFY", "证据不足，重新核验");
    }

    @Test
    void mapsFixedSqlDenialsWithoutExposingDatabaseDetails() throws Exception {
        when(appeals.resolve(41L, 7L, "SUSPEND", "manual review"))
                .thenThrow(new DataIntegrityViolationException(
                        "sql failure", new IllegalStateException(
                                "resolve_age_appeal: mutation denied")));

        mockMvc.perform(post("/api/v1/auth/admin/age-appeals/7/resolve")
                        .contentType("application/json")
                        .content("{\"decision\":\"SUSPEND\",\"resolutionNote\":\"manual review\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCESS_DENIED"))
                .andExpect(jsonPath("$.message").value(
                        "The caller lacks the required role"));

        org.mockito.Mockito.doThrow(new DataIntegrityViolationException(
                        "sql failure", new IllegalStateException(
                                "resolve_age_appeal: appeal is already resolved")))
                .when(appeals).resolve(41L, 7L, "SUSPEND", "manual review");
        mockMvc.perform(post("/api/v1/auth/admin/age-appeals/7/resolve")
                        .contentType("application/json")
                        .content("{\"decision\":\"SUSPEND\",\"resolutionNote\":\"manual review\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    @Test
    void invalidAppealIdMapsToBadRequest() throws Exception {
        mockMvc.perform(post("/api/v1/auth/admin/age-appeals/not-a-number/resolve")
                        .contentType("application/json")
                        .content("{\"decision\":\"SUSPEND\",\"resolutionNote\":\"manual review\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }
}
