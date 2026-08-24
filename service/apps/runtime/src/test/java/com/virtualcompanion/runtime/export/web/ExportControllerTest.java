package com.virtualcompanion.runtime.export.web;

import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.virtualcompanion.platform.persistence.ExportRecord;
import com.virtualcompanion.platform.persistence.ExportService;
import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import com.virtualcompanion.runtime.web.RuntimeApiExceptionHandler;
import java.time.Instant;
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
 * Standalone controller test for the data-export HTTP API (DATA-EXPORT /
 * FR-DATA-002): enqueue with the once-issued download token (V76), the bare
 * status view, the one-time download, the 400 INVALID_REQUEST for a second
 * in-flight export, and the 404 NOT_FOUND_OR_FORBIDDEN for a
 * foreign/absent/consumed export.
 */
class ExportControllerTest {

    private static final Instant NOW = Instant.parse("2026-08-17T12:00:00Z");

    private ExportService exportService;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        exportService = mock(ExportService.class);
        ExportController controller = new ExportController(exportService);
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

    private static ExportRecord pending(long id) {
        return new ExportRecord(id, "PENDING", NOW, null, null, null);
    }

    private static ExportRecord ready(long id) {
        return new ExportRecord(id, "READY", NOW, NOW, NOW.plusSeconds(3600), null);
    }

    @Test
    void postEnqueuesAndReturnsTheOnceIssuedToken() throws Exception {
        when(exportService.create(eq(1L), anyString())).thenReturn(9L);
        when(exportService.get(1L, 9L)).thenReturn(Optional.of(pending(9L)));

        mockMvc.perform(post("/api/v1/exports"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.exportId").value(9))
                .andExpect(jsonPath("$.status").value("PENDING"))
                .andExpect(jsonPath("$.downloadToken").isNotEmpty())
                .andExpect(jsonPath("$.downloadUrl")
                        .value(org.hamcrest.Matchers.startsWith(
                                "/api/v1/exports/9/download?token=")));
    }

    @Test
    void postSecondInflightExportMapsTo400() throws Exception {
        when(exportService.create(eq(1L), anyString()))
                .thenThrow(new IllegalArgumentException("an export is already in flight"));

        mockMvc.perform(post("/api/v1/exports"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    @Test
    void statusNeverCarriesTheTokenOrUrl() throws Exception {
        when(exportService.get(1L, 9L)).thenReturn(Optional.of(ready(9L)));

        mockMvc.perform(get("/api/v1/exports/9"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("READY"))
                .andExpect(jsonPath("$.expiresAt").value("2026-08-17T13:00:00Z"))
                .andExpect(jsonPath("$.downloadToken").doesNotExist())
                .andExpect(jsonPath("$.downloadUrl").doesNotExist())
                .andExpect(content().string(org.hamcrest.Matchers.not(
                        org.hamcrest.Matchers.containsString("\"downloadToken\""))))
                .andExpect(content().string(org.hamcrest.Matchers.not(
                        org.hamcrest.Matchers.containsString("\"downloadUrl\""))));
    }

    @Test
    void statusMapsForeignOrAbsentTo404() throws Exception {
        when(exportService.get(1L, 999L)).thenReturn(Optional.empty());

        mockMvc.perform(get("/api/v1/exports/999"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND_OR_FORBIDDEN"));
    }

    @Test
    void downloadConsumesTheTokenAndReturnsTheDocument() throws Exception {
        when(exportService.consume(1L, 9L, "secret-tok"))
                .thenReturn(Optional.of(new ExportService.ExportDownload(
                        "{\"exportId\":\"9\"}", NOW.plusSeconds(3600))));

        mockMvc.perform(get("/api/v1/exports/9/download").param("token", "secret-tok"))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(content().json("{\"exportId\":\"9\"}"));
    }

    @Test
    void secondDownloadMapsTo404() throws Exception {
        when(exportService.consume(1L, 9L, "secret-tok")).thenReturn(Optional.empty());

        mockMvc.perform(get("/api/v1/exports/9/download").param("token", "secret-tok"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND_OR_FORBIDDEN"));
    }
}
