package com.virtualcompanion.runtime.servicemode.web;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import com.virtualcompanion.runtime.servicemode.ServiceModeService;
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
 * Standalone controller test for the service-mode endpoint (SVC-MODE /
 * FR-RES-005): the authenticated caller receives the current mode and its
 * plain summary.
 */
class ServiceModeControllerTest {

    private ServiceModeService serviceModeService;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        serviceModeService = mock(ServiceModeService.class);
        ServiceModeController controller = new ServiceModeController(serviceModeService);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
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
    void returnsTheCurrentModeAndSummary() throws Exception {
        when(serviceModeService.current(1L))
                .thenReturn(new ServiceModeService.Status("ZERO_LLM", "当前为无生成模型的受限服务"));

        mockMvc.perform(get("/api/v1/service-mode"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.mode").value("ZERO_LLM"))
                .andExpect(jsonPath("$.summary").value("当前为无生成模型的受限服务"));
    }
}
