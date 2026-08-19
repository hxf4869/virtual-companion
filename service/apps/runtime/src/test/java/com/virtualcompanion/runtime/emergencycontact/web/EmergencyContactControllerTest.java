package com.virtualcompanion.runtime.emergencycontact.web;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.virtualcompanion.platform.persistence.EmergencyContactRecord;
import com.virtualcompanion.platform.persistence.EmergencyContactService;
import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import com.virtualcompanion.runtime.emergencycontact.EmergencyContactCipher;
import com.virtualcompanion.runtime.emergencycontact.EmergencyContactProperties;
import com.virtualcompanion.runtime.web.RuntimeApiExceptionHandler;
import java.time.Instant;
import java.util.Base64;
import java.util.Optional;
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
 * Standalone controller test for the emergency-contact HTTP API (§20.14):
 * the capability switch fails closed (403 BETA_OPERATIONS_NOT_READY on every
 * endpoint while §20.14 review is pending) and the enabled flow round-trips
 * the (decrypted) card.
 */
class EmergencyContactControllerTest {

    private static final Instant NOW = Instant.parse("2026-08-19T08:00:00Z");
    private static final String KEY = Base64.getEncoder().encodeToString(new byte[32]);

    private EmergencyContactService service;
    private MockMvc enabledMock;

    @BeforeEach
    void setUp() {
        service = mock(EmergencyContactService.class);
        enabledMock = buildMockMvc(true);
    }

    private MockMvc buildMockMvc(boolean enabled) {
        EmergencyContactController controller = new EmergencyContactController(
                service,
                new EmergencyContactCipher(KEY),
                new EmergencyContactProperties(
                        enabled, KEY, "SIMULATED_EMAIL_LINK", "2026-08"));
        return MockMvcBuilders.standaloneSetup(controller)
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
                        return new JwtTokenService.Principal(1, "USER", "alice").accountId();
                    }
                })
                .build();
    }

    private static EmergencyContactRecord draftRecord(String cipher) {
        return new EmergencyContactRecord(
                41L, "妈妈", cipher, "DRAFT", null, null, null, null,
                null, NOW, NOW);
    }

    @Test
    void disabledCapabilityFailsClosedOnEveryEndpoint() throws Exception {
        MockMvc disabled = buildMockMvc(false);
        disabled.perform(get("/api/v1/emergency-contact"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("BETA_OPERATIONS_NOT_READY"));
        disabled.perform(put("/api/v1/emergency-contact")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"label\":\"妈妈\",\"contact\":\"13800000000\"}"))
                .andExpect(status().isForbidden());
        disabled.perform(post("/api/v1/emergency-contact/verify-start"))
                .andExpect(status().isForbidden());
        disabled.perform(post("/api/v1/emergency-contact/verify-confirm")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"token\":\"abc\"}"))
                .andExpect(status().isForbidden());
        disabled.perform(post("/api/v1/emergency-contact/revoke"))
                .andExpect(status().isForbidden());
        verifyNoInteractions(service);
    }

    @Test
    void enabledCapabilitySavesAndReturnsTheDecryptedCard() throws Exception {
        String cipher = new EmergencyContactCipher(KEY).encrypt("+86 138 0000 0000");
        when(service.upsert(1L, "妈妈", cipher)).thenReturn(41L);
        when(service.get(1L)).thenReturn(Optional.of(draftRecord(cipher)));

        enabledMock.perform(put("/api/v1/emergency-contact")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"label\":\"妈妈\",\"contact\":\"+86 138 0000 0000\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("41"))
                .andExpect(jsonPath("$.label").value("妈妈"))
                .andExpect(jsonPath("$.contact").value("+86 138 0000 0000"))
                .andExpect(jsonPath("$.status").value("DRAFT"))
                .andExpect(jsonPath("$.autoSaved").doesNotExist());

        enabledMock.perform(get("/api/v1/emergency-contact"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.contact").value("+86 138 0000 0000"));
    }
}
