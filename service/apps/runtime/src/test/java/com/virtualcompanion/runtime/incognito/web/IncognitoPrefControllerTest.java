package com.virtualcompanion.runtime.incognito.web;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.virtualcompanion.platform.persistence.IncognitoPrefService;
import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import com.virtualcompanion.runtime.web.RuntimeApiExceptionHandler;
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

class IncognitoPrefControllerTest {

    private IncognitoPrefService service;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        service = mock(IncognitoPrefService.class);
        mockMvc = MockMvcBuilders.standaloneSetup(new IncognitoPrefController(service))
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
    void getReturnsTheDefault() throws Exception {
        when(service.get(1L)).thenReturn(false);

        mockMvc.perform(get("/api/v1/incognito-pref"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.defaultIncognito").value(false));
        verify(service).get(1L);
    }

    @Test
    void putWritesTheDefault() throws Exception {
        when(service.update(1L, true)).thenReturn(true);

        mockMvc.perform(put("/api/v1/incognito-pref")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"defaultIncognito\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.defaultIncognito").value(true));
        verify(service).update(1L, true);
    }
}
