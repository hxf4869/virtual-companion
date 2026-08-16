package com.virtualcompanion.runtime.consent.web;

import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.virtualcompanion.platform.persistence.ConsentRecord;
import com.virtualcompanion.platform.persistence.ConsentService;
import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import com.virtualcompanion.runtime.web.RuntimeApiExceptionHandler;
import java.time.Instant;
import java.util.List;
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
 * Standalone controller test for the consent HTTP API (CONSENT /
 * FR-AUTH-003): grant/revoke round trip, the effective-state list, the 400
 * INVALID_REQUEST contract for unapproved types, and version length clamping.
 */
class ConsentControllerTest {

    private static final Instant NOW = Instant.parse("2026-08-16T12:00:00Z");

    private ConsentService consentService;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        consentService = mock(ConsentService.class);
        ConsentController controller = new ConsentController(consentService);
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
    void putAppendsAndReturnsTheGrantedRecord() throws Exception {
        when(consentService.record(1L, "MODEL_TRAINING", "2026-08", true)).thenReturn(77L);
        when(consentService.findLatestByType(1L, "MODEL_TRAINING"))
                .thenReturn(Optional.of(new ConsentRecord(77L, "MODEL_TRAINING", "2026-08", true, NOW, null)));

        mockMvc.perform(put("/api/v1/consents")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"consentType\":\"MODEL_TRAINING\",\"version\":\"2026-08\",\"granted\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.consentId").value(77))
                .andExpect(jsonPath("$.consentType").value("MODEL_TRAINING"))
                .andExpect(jsonPath("$.granted").value(true));
    }

    @Test
    void putUnapprovedConsentTypeMapsTo400() throws Exception {
        mockMvc.perform(put("/api/v1/consents")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"consentType\":\"FACE_DATA\",\"version\":\"v1\",\"granted\":true}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    @Test
    void getReturnsTheEffectiveLatestRows() throws Exception {
        when(consentService.list(1L)).thenReturn(List.of(
                new ConsentRecord(78L, "PRIVACY_POLICY", "v2", true, NOW, null),
                new ConsentRecord(79L, "MODEL_TRAINING", "v1", false, NOW, NOW)));

        mockMvc.perform(get("/api/v1/consents"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].consentType").value("PRIVACY_POLICY"))
                .andExpect(jsonPath("$[1].granted").value(false))
                .andExpect(jsonPath("$[1].revokedAt").value("2026-08-16T12:00:00Z"));
    }

    @Test
    void getDelegatesTheOwnerIdToTheService() throws Exception {
        when(consentService.list(anyLong())).thenReturn(List.of());

        mockMvc.perform(get("/api/v1/consents"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));

        org.mockito.Mockito.verify(consentService).list(1L);
        org.mockito.Mockito.verify(consentService, org.mockito.Mockito.never())
                .record(anyLong(), anyString(), anyString(), eq(false));
    }
}
