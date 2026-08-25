package com.virtualcompanion.runtime.export.web;

import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.virtualcompanion.platform.persistence.ExportRecord;
import com.virtualcompanion.platform.persistence.ExportService;
import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import com.virtualcompanion.runtime.export.ExportObjectStorage;
import com.virtualcompanion.runtime.web.CurrentPasswordGuard;
import com.virtualcompanion.runtime.web.CurrentPasswordMismatchException;
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
import org.springframework.validation.beanvalidation.LocalValidatorFactoryBean;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;

/**
 * Standalone controller test for the data-export HTTP API (DATA-EXPORT /
 * FR-DATA-002): enqueue with the once-issued download token (V76), the bare
 * status view, the one-time download, the 400 INVALID_REQUEST for a second
 * in-flight export, and the 404 NOT_FOUND_OR_FORBIDDEN for a
 * foreign/absent/consumed export. ADR-0006 §7.7 (DOGFOOD-08): the create
 * call must carry the caller's current password and fail closed without it.
 */
class ExportControllerTest {

    private static final Instant NOW = Instant.parse("2026-08-17T12:00:00Z");

    private ExportService exportService;
    private CurrentPasswordGuard currentPasswordGuard;
    private LocalValidatorFactoryBean validator;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        exportService = mock(ExportService.class);
        currentPasswordGuard = mock(CurrentPasswordGuard.class);
        validator = new LocalValidatorFactoryBean();
        validator.afterPropertiesSet();
        mockMvc = buildMockMvc(new ExportController(exportService, currentPasswordGuard));
    }

    /** Standalone MockMvc with the principal resolver and the shared advice. */
    private MockMvc buildMockMvc(ExportController controller) {
        return MockMvcBuilders.standaloneSetup(controller)
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

    private static ExportRecord pending(long id) {
        return new ExportRecord(id, "PENDING", NOW, null, null, null);
    }

    private static ExportRecord ready(long id) {
        return new ExportRecord(id, "READY", NOW, NOW, NOW.plusSeconds(3600), null);
    }

    @Test
    void postVerifiesTheCurrentPasswordThenEnqueuesAndReturnsTheOnceIssuedToken()
            throws Exception {
        when(exportService.create(eq(1L), anyString())).thenReturn(9L);
        when(exportService.get(1L, 9L)).thenReturn(Optional.of(pending(9L)));

        mockMvc.perform(post("/api/v1/exports")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"currentPassword\":\"Current-Pass-1!\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.exportId").value(9))
                .andExpect(jsonPath("$.status").value("PENDING"))
                .andExpect(jsonPath("$.downloadToken").isNotEmpty())
                .andExpect(jsonPath("$.downloadUrl")
                        .value(org.hamcrest.Matchers.startsWith(
                                "/api/v1/exports/9/download?token=")));

        verify(currentPasswordGuard).assertCurrentPassword(1L, "alice", "Current-Pass-1!");
    }

    @Test
    void postWithoutARequestBodyFailsClosedTo400() throws Exception {
        mockMvc.perform(post("/api/v1/exports"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));

        verify(currentPasswordGuard, never()).assertCurrentPassword(anyLong(), anyString(), anyString());
        verify(exportService, never()).create(anyLong(), anyString());
    }

    @Test
    void postWithABlankCurrentPasswordFailsClosedTo400() throws Exception {
        mockMvc.perform(post("/api/v1/exports")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"currentPassword\":\"   \"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));

        verify(currentPasswordGuard, never()).assertCurrentPassword(anyLong(), anyString(), anyString());
        verify(exportService, never()).create(anyLong(), anyString());
    }

    @Test
    void postWithAWrongCurrentPasswordNeverEnqueuesAnExport() throws Exception {
        doThrow(new CurrentPasswordMismatchException())
                .when(currentPasswordGuard).assertCurrentPassword(1L, "alice", "wrong");

        mockMvc.perform(post("/api/v1/exports")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"currentPassword\":\"wrong\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND_OR_FORBIDDEN"));

        verify(exportService, never()).create(anyLong(), anyString());
    }

    @Test
    void postSecondInflightExportMapsTo400() throws Exception {
        when(exportService.create(eq(1L), anyString()))
                .thenThrow(new IllegalArgumentException("an export is already in flight"));

        mockMvc.perform(post("/api/v1/exports")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"currentPassword\":\"Current-Pass-1!\"}"))
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

    // ------------------------------------------------------------------
    // DOGFOOD-02 (V109) object mode: the document lives in the bucket; the
    // download fetches it server-side, returns the same body, then deletes
    // the object and clears the pointer. A delete failure never fails the
    // already-delivered response (the expiry sweep retries).
    // ------------------------------------------------------------------

    private static final class FakeStorage
            implements com.virtualcompanion.runtime.export.ExportObjectStorage {
        final java.util.Map<String, byte[]> objects = new java.util.HashMap<>();
        boolean failDeletes;
        String lastDeletedKey;

        @Override
        public void put(String key, byte[] bytes) {
            objects.put(key, bytes.clone());
        }

        @Override
        public byte[] get(String key) {
            byte[] bytes = objects.get(key);
            if (bytes == null) {
                throw new IllegalStateException("missing object");
            }
            return bytes;
        }

        @Override
        public void delete(String key) {
            if (failDeletes) {
                throw new IllegalStateException("delete failed");
            }
            lastDeletedKey = key;
            objects.remove(key);
        }

        @Override
        public java.util.List<String> list(String prefix) {
            return objects.keySet().stream()
                    .filter(key -> key.startsWith(prefix))
                    .sorted()
                    .collect(java.util.stream.Collectors.toList());
        }

        @Override
        public com.virtualcompanion.runtime.export.ExportObjectStorage.ObjectListing
                listPage(String prefix, String startAfter, int limit) {
            return new com.virtualcompanion.runtime.export.ExportObjectStorage.ObjectListing(
                    list(prefix), null);
        }
    }

    /** Real cipher with a fixed test key so envelope decryption is exercised. */
    private static final com.virtualcompanion.platform.persistence.RestFieldCipher
            TEST_CIPHER = new com.virtualcompanion.platform.persistence.RestFieldCipher(
            java.util.Base64.getEncoder().encodeToString(new byte[32]));

    private static ExportService.ExportDownload objectDownload(String key) {
        return new ExportService.ExportDownload(null, key, 27L, NOW.plusSeconds(3600));
    }

    @Test
    void objectModeDownloadFetchesTheObjectDeletesItAndReturnsTheBody()
            throws Exception {
        FakeStorage storage = new FakeStorage();
        // The bucket holds the OPAQUE envelope, never the plaintext JSON.
        storage.put("exports/1/9.json", TEST_CIPHER.encrypt("{\"exportId\":\"9\"}")
                .getBytes(java.nio.charset.StandardCharsets.UTF_8));
        mockMvc = buildMockMvc(
                new ExportController(exportService, currentPasswordGuard, storage, TEST_CIPHER, null));
        when(exportService.consume(1L, 9L, "secret-tok"))
                .thenReturn(Optional.of(objectDownload("exports/1/9.json")));

        mockMvc.perform(get("/api/v1/exports/9/download").param("token", "secret-tok"))
                .andExpect(status().isOk())
                .andExpect(content().json("{\"exportId\":\"9\"}"));

        verify(exportService).clearObject(1L, 9L, "exports/1/9.json");
        org.junit.jupiter.api.Assertions.assertTrue(
                storage.objects.isEmpty(), "object must be deleted after download");
    }

    @Test
    void objectModeDeleteFailureStillDeliversTheDocumentAndKeepsThePointer()
            throws Exception {
        FakeStorage storage = new FakeStorage();
        storage.put("exports/1/9.json", TEST_CIPHER.encrypt("{\"exportId\":\"9\"}")
                .getBytes(java.nio.charset.StandardCharsets.UTF_8));
        storage.failDeletes = true;
        mockMvc = buildMockMvc(
                new ExportController(exportService, currentPasswordGuard, storage, TEST_CIPHER, null));
        when(exportService.consume(1L, 9L, "secret-tok"))
                .thenReturn(Optional.of(objectDownload("exports/1/9.json")));

        mockMvc.perform(get("/api/v1/exports/9/download").param("token", "secret-tok"))
                .andExpect(status().isOk())
                .andExpect(content().json("{\"exportId\":\"9\"}"));

        verify(exportService, never()).clearObject(anyLong(), anyLong(), anyString());
    }

    @Test
    void objectModeMissingObjectAfterConsumeIsATerminal500() throws Exception {
        FakeStorage storage = new FakeStorage(); // nothing uploaded
        mockMvc = buildMockMvc(
                new ExportController(exportService, currentPasswordGuard, storage, TEST_CIPHER, null));
        when(exportService.consume(1L, 9L, "secret-tok"))
                .thenReturn(Optional.of(objectDownload("exports/1/9.json")));

        mockMvc.perform(get("/api/v1/exports/9/download").param("token", "secret-tok"))
                .andExpect(status().isInternalServerError());
    }

    @Test
    void activeDeletionIntentRefusesNewExportRequests() throws Exception {
        // DOGFOOD-STABILIZATION-02 (ADR-0006 §7 order): once the deletion
        // intent is persisted the export door closes so the pre-cascade
        // cleanup loop cannot race a fresh seal.
        com.virtualcompanion.platform.persistence.AccountDeletionIntentService intents =
                mock(com.virtualcompanion.platform.persistence.AccountDeletionIntentService.class);
        when(intents.activeCurrent(1L)).thenReturn(true);
        mockMvc = buildMockMvc(
                new ExportController(exportService, currentPasswordGuard, null, null, intents));

        mockMvc.perform(post("/api/v1/exports")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"currentPassword\":\"Current-Pass-1!\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));

        verify(exportService, never()).create(anyLong(), anyString());
    }
}
