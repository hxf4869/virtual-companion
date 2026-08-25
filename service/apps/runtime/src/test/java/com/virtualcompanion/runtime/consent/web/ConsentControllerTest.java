package com.virtualcompanion.runtime.consent.web;

import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.virtualcompanion.platform.persistence.ConsentRecord;
import com.virtualcompanion.platform.persistence.ConsentService;
import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import com.virtualcompanion.runtime.web.CurrentPasswordGuard;
import com.virtualcompanion.runtime.web.CurrentPasswordMismatchException;
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
import org.springframework.validation.beanvalidation.LocalValidatorFactoryBean;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;

/**
 * Standalone controller test for the consent HTTP API (CONSENT /
 * FR-AUTH-003): grant/revoke round trip, the effective-state list, the 400
 * INVALID_REQUEST contract for unapproved types, and version length clamping.
 * ADR-0006 §7.7 (DOGFOOD-08): a revocation must pass the current-password
 * gate; a grant never asks for one.
 */
class ConsentControllerTest {

    private static final Instant NOW = Instant.parse("2026-08-16T12:00:00Z");

    private ConsentService consentService;
    private CurrentPasswordGuard currentPasswordGuard;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        consentService = mock(ConsentService.class);
        currentPasswordGuard = mock(CurrentPasswordGuard.class);
        ConsentController controller = new ConsentController(consentService, currentPasswordGuard);
        LocalValidatorFactoryBean validator = new LocalValidatorFactoryBean();
        validator.afterPropertiesSet();
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
                .setValidator(validator)
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
                        if (parameter.getParameterType() == String.class) {
                            return principal.username();
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

        // ADR-0006 §7.7: the grant direction is low-risk — no password gate.
        verify(currentPasswordGuard, never())
                .assertCurrentPassword(anyLong(), anyString(), anyString());
    }

    @Test
    void putRevocationPassesTheCurrentPasswordGateAndAppends() throws Exception {
        when(consentService.record(1L, "MODEL_TRAINING", "2026-08", false)).thenReturn(80L);
        when(consentService.findLatestByType(1L, "MODEL_TRAINING"))
                .thenReturn(Optional.of(new ConsentRecord(80L, "MODEL_TRAINING", "2026-08",
                        false, NOW, NOW)));

        mockMvc.perform(put("/api/v1/consents")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"consentType\":\"MODEL_TRAINING\",\"version\":\"2026-08\","
                                + "\"granted\":false,\"currentPassword\":\"Current-Pass-1!\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.granted").value(false));

        verify(currentPasswordGuard).assertCurrentPassword(1L, "alice", "Current-Pass-1!");
    }

    @Test
    void putRevocationWithoutAPasswordFailsClosedAndNeverAppends() throws Exception {
        doThrow(new IllegalArgumentException("The request is invalid"))
                .when(currentPasswordGuard)
                .assertCurrentPassword(eq(1L), eq("alice"), isNull());

        mockMvc.perform(put("/api/v1/consents")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"consentType\":\"MODEL_TRAINING\",\"version\":\"2026-08\","
                                + "\"granted\":false}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));

        verify(currentPasswordGuard).assertCurrentPassword(eq(1L), eq("alice"), isNull());
        verify(consentService, never()).record(anyLong(), anyString(), anyString(), eq(false));
    }

    @Test
    void putRevocationWithAWrongPasswordMapsToTheNonDisclosing404() throws Exception {
        doThrow(new CurrentPasswordMismatchException())
                .when(currentPasswordGuard).assertCurrentPassword(1L, "alice", "wrong");

        mockMvc.perform(put("/api/v1/consents")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"consentType\":\"MODEL_TRAINING\",\"version\":\"2026-08\","
                                + "\"granted\":false,\"currentPassword\":\"wrong\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND_OR_FORBIDDEN"));

        verify(consentService, never()).record(anyLong(), anyString(), anyString(), eq(false));
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
