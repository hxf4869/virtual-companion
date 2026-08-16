package com.virtualcompanion.runtime.age.web;

import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.virtualcompanion.catalog.AgeState;
import com.virtualcompanion.platform.persistence.AgeVerificationRecord;
import com.virtualcompanion.platform.persistence.AgeVerificationService;
import com.virtualcompanion.runtime.age.AgeVerificationPort;
import com.virtualcompanion.runtime.age.SimulatedAgeVerifier;
import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import com.virtualcompanion.runtime.web.RuntimeApiExceptionHandler;
import java.time.Instant;
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

/**
 * Standalone controller test for the age-verification API (AGE-MIN /
 * FR-AUTH-002): the effective-state read with the AGE_UNKNOWN default, the
 * simulated verification walk (catalog transitions checked, append-only
 * history), and the fail-closed 400 for states that cannot reach
 * ADULT_VERIFIED.
 */
class AgeControllerTest {

    private static final Instant NOW = Instant.parse("2026-08-17T12:00:00Z");

    private AgeVerificationService ageVerificationService;
    private AgeVerificationPort port;
    private SimulatedAgeVerifier simulated;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        ageVerificationService = mock(AgeVerificationService.class);
        port = mock(AgeVerificationPort.class);
        simulated = new SimulatedAgeVerifier();
        AgeController controller =
                new AgeController(ageVerificationService, port, simulated);
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

    private static AgeVerificationRecord record(String state) {
        return new AgeVerificationRecord(
                88L, state, SimulatedAgeVerifier.PROVIDER_ALPHA_SIMULATED, NOW);
    }

    private static AgeVerificationRecord record(String state, String provider) {
        return new AgeVerificationRecord(88L, state, provider, NOW);
    }

    @Test
    void stateReturnsAgeUnknownWhenNeverVerified() throws Exception {
        when(ageVerificationService.get(1L)).thenReturn(Optional.empty());

        mockMvc.perform(get("/api/v1/age/state"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ageState").value("AGE_UNKNOWN"));
    }

    @Test
    void stateReturnsTheEffectiveRecord() throws Exception {
        when(ageVerificationService.get(1L)).thenReturn(Optional.of(record("ADULT_VERIFIED")));

        mockMvc.perform(get("/api/v1/age/state"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ageState").value("ADULT_VERIFIED"))
                .andExpect(jsonPath("$.providerRef").value("alpha-simulated"))
                .andExpect(jsonPath("$.verifiedAt").value("2026-08-17T12:00:00Z"));
    }

    @Test
    void verificationWalksTheCatalogFlowAndSealsAdultVerified() throws Exception {
        when(ageVerificationService.get(1L))
                .thenReturn(Optional.empty())
                .thenReturn(Optional.of(record("ADULT_VERIFIED")));
        when(port.verify(1L))
                .thenReturn(new AgeVerificationPort.AgeVerificationResult(
                        AgeState.ADULT_VERIFIED, SimulatedAgeVerifier.PROVIDER_ALPHA_SIMULATED, NOW));

        mockMvc.perform(post("/api/v1/age/verification"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ageState").value("ADULT_VERIFIED"))
                .andExpect(jsonPath("$.providerRef").value("alpha-simulated"));

        // The full catalog-approved flow is appended to the history:
        // AGE_UNKNOWN -> SELF_DECLARED -> VERIFICATION_REQUIRED -> VERIFIED.
        verify(ageVerificationService).record(1L, "ADULT_SELF_DECLARED", "alpha-simulated");
        verify(ageVerificationService).record(1L, "ADULT_VERIFICATION_REQUIRED", "alpha-simulated");
        verify(ageVerificationService).record(1L, "ADULT_VERIFIED", "alpha-simulated");
    }

    @Test
    void verificationIsIdempotentForAnAlreadyVerifiedOwner() throws Exception {
        when(ageVerificationService.get(1L))
                .thenReturn(Optional.of(record("ADULT_VERIFIED")))
                .thenReturn(Optional.of(record("ADULT_VERIFIED")));

        mockMvc.perform(post("/api/v1/age/verification"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ageState").value("ADULT_VERIFIED"));
    }

    @Test
    void verificationFailsClosedFromMinorOrSuspendedStates() throws Exception {
        when(ageVerificationService.get(1L))
                .thenReturn(Optional.of(record("MINOR_SUSPECTED")));

        mockMvc.perform(post("/api/v1/age/verification"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    @Test
    void verificationUsesThePortResult() throws Exception {
        when(ageVerificationService.get(1L))
                .thenReturn(Optional.empty())
                .thenReturn(Optional.of(record("ADULT_VERIFIED", "vendor-x")));
        when(port.verify(anyLong()))
                .thenReturn(new AgeVerificationPort.AgeVerificationResult(
                        AgeState.ADULT_VERIFIED, "vendor-x", NOW));

        mockMvc.perform(post("/api/v1/age/verification"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.providerRef").value("vendor-x"));
        verify(ageVerificationService).record(1L, "ADULT_VERIFIED", "vendor-x");
    }
}
