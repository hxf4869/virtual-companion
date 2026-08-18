package com.virtualcompanion.runtime.generation.web;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.virtualcompanion.platform.persistence.GenerationVersionService;
import com.virtualcompanion.platform.persistence.GenerationVersionService.GenerationVersion;
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

class GenerationVersionControllerTest {

    private static final Instant NOW = Instant.parse("2026-08-18T12:00:00Z");

    private GenerationVersionService versions;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        versions = mock(GenerationVersionService.class);
        mockMvc = MockMvcBuilders.standaloneSetup(new GenerationVersionController(versions))
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
                        if (parameter.getParameterType() == long.class) {
                            return 1L;
                        }
                        return new JwtTokenService.Principal(1, "USER", "alice");
                    }
                })
                .build();
    }

    @Test
    void listReturnsVersionsForTheUserMessage() throws Exception {
        when(versions.list(1L, 9L)).thenReturn(List.of(
                new GenerationVersion(55L, false, "COMPLETED", NOW, 80L),
                new GenerationVersion(56L, true, "COMPLETED", NOW, 81L)));

        mockMvc.perform(get("/api/v1/messages/9/generation-versions"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[1].generationId").value("56"))
                .andExpect(jsonPath("$[1].selected").value(true));
    }

    @Test
    void selectMissingMapsTo404() throws Exception {
        when(versions.select(1L, 99L)).thenReturn(false);

        mockMvc.perform(post("/api/v1/generations/99/select"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND_OR_FORBIDDEN"));
    }

    @Test
    void selectReturnsTheChosenVersion() throws Exception {
        when(versions.select(1L, 55L)).thenReturn(true);
        when(versions.find(1L, 55L)).thenReturn(Optional.of(
                new GenerationVersion(55L, true, "COMPLETED", NOW, 80L)));

        mockMvc.perform(post("/api/v1/generations/55/select"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.generationId").value("55"))
                .andExpect(jsonPath("$.selected").value(true));
    }
}
