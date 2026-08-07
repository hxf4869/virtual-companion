package com.virtualcompanion.runtime.auth.config;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.web.FilterChainProxy;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

/**
 * Proves the Spring Security configuration loads and enforces the Bearer-only
 * contract when the auth subsystem is enabled, WITHOUT a live database: the
 * security chain is created while the DataSource stays disabled, so a plain
 * protected route is reachable with a valid token and rejected otherwise.
 *
 * <p>{@code @AutoConfigureMockMvc} is not used (it lives in a separate
 * autoconfigure artifact in this Boot line); the {@link FilterChainProxy} bean
 * (the actual Filter that owns every SecurityFilterChain) is applied to a
 * manually built MockMvc so the full application MVC stack is exercised.
 */
@SpringBootTest(properties = {
        "virtual-companion.auth.enabled=true",
        "virtual-companion.auth.jwt-secret=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
})
class AuthSecurityIntegrationTest {

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private FilterChainProxy springSecurityFilterChain;

    @Autowired
    private JwtTokenService jwtTokenService;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context)
                .addFilters(springSecurityFilterChain)
                .build();
    }

    @Test
    void unauthenticatedProtectedRouteReturnsAuthenticationRequired() throws Exception {
        mockMvc.perform(get("/api/internal/baseline"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"));
    }

    @Test
    void protectedRouteSucceedsWithValidBearerToken() throws Exception {
        String token = jwtTokenService.issueAccessToken(7L, "USER", "alice");

        mockMvc.perform(get("/api/internal/baseline")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk());
    }

    @Test
    void protectedRouteRejectsGarbageBearerToken() throws Exception {
        mockMvc.perform(get("/api/internal/baseline")
                        .header("Authorization", "Bearer not-a-valid-token"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void healthStaysPublic() throws Exception {
        mockMvc.perform(get("/actuator/health"))
                .andExpect(status().isOk());
    }
}
