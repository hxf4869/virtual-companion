package com.virtualcompanion.runtime.auth.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.virtualcompanion.runtime.auth.config.AuthRequestBodyLimitFilter;
import com.virtualcompanion.runtime.auth.application.AuthService;
import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import java.util.Arrays;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.core.MethodParameter;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.validation.beanvalidation.LocalValidatorFactoryBean;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;

class AuthControllerValidationTest {

    private AuthService authService;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        authService = mock(AuthService.class);
        AuthController controller = new AuthController(authService);
        LocalValidatorFactoryBean validator = new LocalValidatorFactoryBean();
        validator.afterPropertiesSet();
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
                .setValidator(validator)
                .setControllerAdvice(new AuthExceptionHandler())
                .setCustomArgumentResolvers(adminPrincipalResolver())
                .addFilters(new AuthRequestBodyLimitFilter())
                .build();
    }

    @ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {
        "/api/v1/auth/login",
        "/api/v1/auth/admin/accounts"
    })
    void oneOverBodyIsRejectedBeforeJsonAndService(String path) throws Exception {
        byte[] body = new byte[AuthInputLimits.MAX_REQUEST_BODY_BYTES + 1];
        Arrays.fill(body, (byte) 'b');
        body[AuthInputLimits.MAX_REQUEST_BODY_BYTES] = 'B';

        MvcResult result = mockMvc.perform(post(path)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"))
                .andExpect(jsonPath("$.message").value("The request is invalid"))
                .andReturn();

        assertThat(result.getResponse().getContentAsString()).doesNotContain("16385", "BBBB");
        verifyNoInteractions(authService);
    }

    @ParameterizedTest
    @MethodSource("invalidLoginBodies")
    void invalidLoginBodyReturnsFixedEnvelopeWithoutCallingService(String body, String sentinel)
            throws Exception {
        assertInvalid("/api/v1/auth/login", body, sentinel);
    }

    @ParameterizedTest
    @MethodSource("invalidAccountBodies")
    void invalidAccountBodyReturnsFixedEnvelopeWithoutCallingService(String body, String sentinel)
            throws Exception {
        assertInvalid("/api/v1/auth/admin/accounts", body, sentinel);
    }

    private void assertInvalid(String path, String body, String sentinel) throws Exception {
        MockHttpServletRequestBuilder request = post(path).contentType(MediaType.APPLICATION_JSON);
        if (body != null) {
            request.content(body);
        }

        MvcResult result = mockMvc.perform(request)
                .andExpect(status().isBadRequest())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"))
                .andExpect(jsonPath("$.message").value("The request is invalid"))
                .andExpect(jsonPath("$.details").doesNotExist())
                .andReturn();

        String response = result.getResponse().getContentAsString();
        assertThat(response).doesNotContain("username", "password", "displayName", "rejected");
        if (sentinel != null && !sentinel.isEmpty()) {
            assertThat(response).doesNotContain(sentinel);
        }
        verifyNoInteractions(authService);
    }

    private static HandlerMethodArgumentResolver adminPrincipalResolver() {
        return new HandlerMethodArgumentResolver() {
            @Override
            public boolean supportsParameter(MethodParameter parameter) {
                return parameter.hasParameterAnnotation(AuthenticationPrincipal.class);
            }

            @Override
            public Object resolveArgument(MethodParameter parameter,
                    ModelAndViewContainer mavContainer, NativeWebRequest webRequest,
                    WebDataBinderFactory binderFactory) {
                return new JwtTokenService.Principal(1, "ADMIN", "root");
            }
        };
    }

    private static Stream<Arguments> invalidLoginBodies() {
        String tooLongUsername = "u".repeat(129);
        String tooLongPassword = "p".repeat(1025);
        return Stream.of(
                Arguments.of(null, ""),
                Arguments.of("null", ""),
                Arguments.of("{", ""),
                Arguments.of("{}", ""),
                Arguments.of("{\"username\":null,\"password\":\"pw\"}", ""),
                Arguments.of("{\"username\":\"alice\",\"password\":null}", ""),
                Arguments.of("{\"username\":\"\",\"password\":\"pw\"}", ""),
                Arguments.of("{\"username\":\"   \",\"password\":\"pw\"}", ""),
                Arguments.of("{\"username\":\"alice\",\"password\":\"   \"}", ""),
                Arguments.of("{\"username\":\"" + tooLongUsername + "\",\"password\":\"pw\"}",
                        tooLongUsername),
                Arguments.of("{\"username\":\"alice\",\"password\":\"" + tooLongPassword + "\"}",
                        tooLongPassword));
    }

    private static Stream<Arguments> invalidAccountBodies() {
        String tooLongUsername = "u".repeat(129);
        String tooLongPassword = "p".repeat(1025);
        String tooLongDisplayName = "d".repeat(257);
        String tooLongRole = "r".repeat(17);
        return Stream.of(
                Arguments.of(null, ""),
                Arguments.of("null", ""),
                Arguments.of("{", ""),
                Arguments.of("{}", ""),
                Arguments.of("{\"username\":null,\"password\":\"pw\",\"displayName\":\"User\"}", ""),
                Arguments.of("{\"username\":\"bob\",\"password\":null,\"displayName\":\"User\"}", ""),
                Arguments.of("{\"username\":\"bob\",\"password\":\"pw\",\"displayName\":null}", ""),
                Arguments.of("{\"username\":\"\",\"password\":\"pw\",\"displayName\":\"User\"}", ""),
                Arguments.of("{\"username\":\"   \",\"password\":\"pw\",\"displayName\":\"User\"}", ""),
                Arguments.of("{\"username\":\"bob\",\"password\":\"   \",\"displayName\":\"User\"}", ""),
                Arguments.of("{\"username\":\"bob\",\"password\":\"pw\",\"displayName\":\"   \"}", ""),
                Arguments.of("{\"username\":\"" + tooLongUsername
                        + "\",\"password\":\"pw\",\"displayName\":\"User\"}", tooLongUsername),
                Arguments.of("{\"username\":\"bob\",\"password\":\"" + tooLongPassword
                        + "\",\"displayName\":\"User\"}", tooLongPassword),
                Arguments.of("{\"username\":\"bob\",\"password\":\"pw\",\"displayName\":\""
                        + tooLongDisplayName + "\"}", tooLongDisplayName),
                Arguments.of("{\"username\":\"bob\",\"password\":\"pw\",\"role\":\""
                        + tooLongRole + "\",\"displayName\":\"User\"}", tooLongRole),
                Arguments.of("{\"username\":\"bob\",\"password\":\"pw\",\"role\":\"\","
                        + "\"displayName\":\"User\"}", ""),
                Arguments.of("{\"username\":\"bob\",\"password\":\"pw\",\"role\":\"MANAGER\","
                        + "\"displayName\":\"User\"}", "MANAGER"));
    }
}
