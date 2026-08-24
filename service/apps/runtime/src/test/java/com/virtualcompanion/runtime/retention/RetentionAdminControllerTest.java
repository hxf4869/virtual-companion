package com.virtualcompanion.runtime.retention;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.virtualcompanion.platform.persistence.RetentionLegalHoldService;
import com.virtualcompanion.runtime.auth.web.AuthExceptionHandler;
import com.virtualcompanion.runtime.web.RuntimeApiExceptionHandler;
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

class RetentionAdminControllerTest {

    private RetentionLegalHoldService holds;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        holds = mock(RetentionLegalHoldService.class);
        mockMvc = MockMvcBuilders.standaloneSetup(new RetentionAdminController(holds))
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
                            ModelAndViewContainer container,
                            NativeWebRequest request,
                            WebDataBinderFactory binderFactory) {
                        return 41L;
                    }
                })
                .build();
    }

    @Test
    void setsAndReleasesOnlyFixedCodeLegalHoldRequests() throws Exception {
        when(holds.set(41L, 7L, "NORMAL_CHAT", "LEGAL")).thenReturn(9L);
        when(holds.release(41L, 9L)).thenReturn(true);

        mockMvc.perform(post("/api/v1/auth/admin/retention-holds")
                        .contentType("application/json")
                        .content("{\"ownerUserId\":\"7\",\"category\":\"NORMAL_CHAT\","
                                + "\"reasonCode\":\"LEGAL\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.holdId").value("9"))
                .andExpect(jsonPath("$.status").value("ACTIVE"));
        mockMvc.perform(delete("/api/v1/auth/admin/retention-holds/9"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.released").value(true));

        verify(holds).set(41L, 7L, "NORMAL_CHAT", "LEGAL");
        verify(holds).release(41L, 9L);
    }

    @Test
    void rejectsMalformedOwnerWithoutCallingSql() throws Exception {
        mockMvc.perform(post("/api/v1/auth/admin/retention-holds")
                        .contentType("application/json")
                        .content("{\"ownerUserId\":\"bad\",\"category\":\"ALL\","
                                + "\"reasonCode\":\"LEGAL\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }
}
