package com.virtualcompanion.runtime.cancel.web;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.virtualcompanion.modelruntime.execution.ActiveInvocationRegistry;
import com.virtualcompanion.platform.persistence.GenerationCancelService;
import com.virtualcompanion.platform.persistence.GenerationRecord;
import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import com.virtualcompanion.runtime.web.RuntimeApiExceptionHandler;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.core.MethodParameter;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;

/**
 * Standalone controller test for the generation cancel HTTP API (TASK-0179):
 * the happy path (200 with the CANCELLED generation), the
 * NOT_FOUND_OR_FORBIDDEN 404 contract for a foreign/absent id, the 400
 * INVALID_REQUEST contract for a not-cancellable state, and the 400 contract
 * for a malformed id. The
 * {@code @AuthenticationPrincipal(expression = "accountId")} resolver is
 * replicated from the relationship controller tests.
 */
class GenerationCancelControllerTest {

    private GenerationCancelService generationCancelService;
    private ActiveInvocationRegistry activeInvocationRegistry;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        generationCancelService = mock(GenerationCancelService.class);
        activeInvocationRegistry = mock(ActiveInvocationRegistry.class);
        ObjectProvider<ActiveInvocationRegistry> registryProvider = mock(ObjectProvider.class);
        when(registryProvider.getIfAvailable()).thenReturn(activeInvocationRegistry);
        GenerationCancelController controller =
                new GenerationCancelController(generationCancelService, registryProvider);
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

    private static GenerationRecord record(long id, String status) {
        return new GenerationRecord(1L, id, 100L, "gen-" + id, status, null);
    }

    @Test
    void cancelReturnsTheCancelledGeneration() throws Exception {
        when(generationCancelService.cancel(1L, 55L))
                .thenReturn(Optional.of(record(55L, "CANCELLED")));

        mockMvc.perform(post("/api/v1/generations/55/cancel"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.generationId").value(55))
                .andExpect(jsonPath("$.conversationId").value(100))
                .andExpect(jsonPath("$.logicalGenerationId").value("gen-55"))
                .andExpect(jsonPath("$.status").value("CANCELLED"));

        verify(generationCancelService).cancel(1L, 55L);
    }

    @Test
    void cancelSignalsActiveInvocationRegistryAfterDatabaseCancel() throws Exception {
        // CANCEL-A: the cooperative interrupt fires only AFTER the database
        // terminal state transition succeeded.
        when(generationCancelService.cancel(1L, 55L))
                .thenReturn(Optional.of(record(55L, "CANCELLED")));

        mockMvc.perform(post("/api/v1/generations/55/cancel"))
                .andExpect(status().isOk());

        verify(generationCancelService).cancel(1L, 55L);
        verify(activeInvocationRegistry).cancel(55L);
    }

    @Test
    void cancelDoesNotSignalRegistryWhenGenerationNotFound() throws Exception {
        when(generationCancelService.cancel(1L, 404L)).thenReturn(Optional.empty());

        mockMvc.perform(post("/api/v1/generations/404/cancel"))
                .andExpect(status().isNotFound());

        verify(activeInvocationRegistry, never()).cancel(404L);
    }

    @Test
    void cancelMapsForeignOrAbsentIdToNotFound() throws Exception {
        when(generationCancelService.cancel(1L, 404L)).thenReturn(Optional.empty());

        mockMvc.perform(post("/api/v1/generations/404/cancel"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND_OR_FORBIDDEN"));
    }

    @Test
    void cancelMapsNonCancellableStateToBadRequest() throws Exception {
        when(generationCancelService.cancel(1L, 55L))
                .thenThrow(new IllegalArgumentException(
                        "generation 55 is not cancellable in its current state"));

        mockMvc.perform(post("/api/v1/generations/55/cancel"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    @Test
    void cancelMapsInvalidIdToBadRequest() throws Exception {
        mockMvc.perform(post("/api/v1/generations/not-a-number/cancel"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        verify(generationCancelService, never()).cancel(eq(1L), eq(0L));
    }
}
