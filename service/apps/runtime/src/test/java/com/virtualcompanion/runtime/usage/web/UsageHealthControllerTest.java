package com.virtualcompanion.runtime.usage.web;

import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.virtualcompanion.platform.persistence.UsageHealthService;
import com.virtualcompanion.platform.persistence.UsageHealthService.UsageHealthStatus;
import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import com.virtualcompanion.runtime.web.RuntimeApiExceptionHandler;
import java.time.Instant;
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
 * Standalone controller test for the usage-health HTTP API (USAGE-HEALTH /
 * §20.7): read-only GET, prefs PUT, heartbeat POST, reminder POST, and 400
 * for unapproved intervals / results.
 */
class UsageHealthControllerTest {

    private static final Instant STARTED = Instant.parse("2026-08-18T00:00:00Z");

    private UsageHealthService usageHealthService;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        usageHealthService = mock(UsageHealthService.class);
        UsageHealthController controller = new UsageHealthController(usageHealthService);
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

    @Test
    void getReturnsTheReadOnlyStatus() throws Exception {
        when(usageHealthService.get(1L)).thenReturn(healthStatus(120, 30, 12, false));

        mockMvc.perform(get("/api/v1/usage-health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.reminderAfterMinutes").value(120))
                .andExpect(jsonPath("$.sessionGapMinutes").value(30))
                .andExpect(jsonPath("$.continuousMinutes").value(12))
                .andExpect(jsonPath("$.reminderDue").value(false))
                .andExpect(jsonPath("$.sessionStartedAt").value("2026-08-18T00:00:00Z"));

        verify(usageHealthService).get(1L);
        verify(usageHealthService, never()).heartbeat(anyLong());
    }

    @Test
    void putWritesApprovedPrefs() throws Exception {
        when(usageHealthService.updatePrefs(1L, 60, 15)).thenReturn(healthStatus(60, 15, 0, false));

        mockMvc.perform(put("/api/v1/usage-health")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reminderAfterMinutes\":60,\"sessionGapMinutes\":15}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.reminderAfterMinutes").value(60))
                .andExpect(jsonPath("$.sessionGapMinutes").value(15));
    }

    @Test
    void putUnapprovedIntervalMapsTo400() throws Exception {
        when(usageHealthService.updatePrefs(anyLong(), anyInt(), anyInt()))
                .thenThrow(new IllegalArgumentException("reminderAfterMinutes is not an approved interval"));

        mockMvc.perform(put("/api/v1/usage-health")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reminderAfterMinutes\":99,\"sessionGapMinutes\":15}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    @Test
    void heartbeatDelegatesToTheMutatingService() throws Exception {
        when(usageHealthService.heartbeat(1L)).thenReturn(healthStatus(120, 30, 125, true));

        mockMvc.perform(post("/api/v1/usage-health/heartbeat"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.continuousMinutes").value(125))
                .andExpect(jsonPath("$.reminderDue").value(true));

        verify(usageHealthService).heartbeat(1L);
    }

    @Test
    void reminderRecordsTheApprovedResult() throws Exception {
        when(usageHealthService.recordReminder(1L, "CONTINUED")).thenReturn(healthStatus(120, 30, 125, false));

        mockMvc.perform(post("/api/v1/usage-health/reminder")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"result\":\"CONTINUED\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.reminderDue").value(false));
    }

    @Test
    void reminderUnapprovedResultMapsTo400() throws Exception {
        when(usageHealthService.recordReminder(anyLong(), anyString()))
                .thenThrow(new IllegalArgumentException("usage reminder result is not approved"));

        mockMvc.perform(post("/api/v1/usage-health/reminder")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"result\":\"SNOOZE\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    private static UsageHealthStatus healthStatus(
            int after, int gap, int continuous, boolean due) {
        return new UsageHealthStatus(after, gap, continuous, due, STARTED);
    }
}
