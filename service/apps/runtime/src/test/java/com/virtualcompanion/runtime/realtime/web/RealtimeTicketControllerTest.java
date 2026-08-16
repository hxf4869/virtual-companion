package com.virtualcompanion.runtime.realtime.web;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.virtualcompanion.platform.persistence.RealtimeTicketRepository;
import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import com.virtualcompanion.runtime.web.RuntimeApiExceptionHandler;
import java.sql.SQLException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.MethodParameter;
import org.springframework.dao.DataAccessException;
import org.springframework.http.MediaType;
import org.springframework.jdbc.BadSqlGrammarException;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;

/**
 * Standalone controller test for the realtime ticket HTTP API (TASK-0182): the
 * happy mint path, the 404 NOT_FOUND_OR_FORBIDDEN contract for a foreign or
 * absent generation (ensure_realtime_stream raised inside issue_realtime_ticket
 * surfaces as a DataAccessException), the 503 passthrough for a schema
 * unavailable BadSqlGrammarException, and the 400 INVALID_REQUEST contract for
 * malformed bodies and non-positive / negative counters. The
 * {@code @AuthenticationPrincipal(expression = "accountId")} resolver is
 * replicated from the memory / message-history controller tests; the owner GUC
 * binding itself is covered by the auth integration layer.
 */
class RealtimeTicketControllerTest {

    private RealtimeTicketRepository ticketRepository;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        ticketRepository = mock(RealtimeTicketRepository.class);
        RealtimeTicketController controller = new RealtimeTicketController(ticketRepository);
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

    private static String ticketBody(String generationId, String sessionId, String origin,
            String streamEpoch, String afterSeq) {
        return "{\"generationId\":\"" + generationId + "\","
                + "\"sessionId\":\"" + sessionId + "\","
                + "\"origin\":\"" + origin + "\","
                + "\"streamEpoch\":\"" + streamEpoch + "\","
                + "\"afterSeq\":\"" + afterSeq + "\"}";
    }

    private static boolean hasCauseOfType(Throwable t, Class<? extends Throwable> type) {
        Throwable cur = t;
        while (cur != null) {
            if (type.isInstance(cur)) {
                return true;
            }
            cur = cur.getCause();
        }
        return false;
    }

    @Test
    void createTicketReturnsTheMintedTicket() throws Exception {
        when(ticketRepository.issue(
                1L, 7L, "sess-1", "https://app.example", "FETCH_SSE", 2L, 0L))
                .thenReturn(new RealtimeTicketRepository.IssuedTicket(99L, "secret-uuid"));

        mockMvc.perform(post("/api/v1/realtime/tickets")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(ticketBody("7", "sess-1", "https://app.example", "2", "0")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ticketId").value(99))
                .andExpect(jsonPath("$.secret").value("secret-uuid"));

        // owner from principal, transport fixed FETCH_SSE, afterSeq=0 passes through.
        verify(ticketRepository).issue(
                1L, 7L, "sess-1", "https://app.example", "FETCH_SSE", 2L, 0L);
    }

    @Test
    void createTicketMapsForeignOrAbsentGenerationTo404() throws Exception {
        // ensure_realtime_stream raises inside issue_realtime_ticket for a
        // foreign / absent generation; this surfaces as a non-BadSqlGrammar
        // DataAccessException that must map to 404, not disclose existence.
        when(ticketRepository.issue(
                1L, 999L, "sess-1", "https://app.example", "FETCH_SSE", 2L, 5L))
                .thenThrow(new DataAccessException("generation not found") {
                });

        mockMvc.perform(post("/api/v1/realtime/tickets")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(ticketBody("999", "sess-1", "https://app.example", "2", "5")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND_OR_FORBIDDEN"));
    }

    @Test
    void createTicketMapsBadSqlGrammarTo503SchemaUnavailable() throws Exception {
        // A schema-unavailable BadSqlGrammarException must NOT be translated to
        // 404; the global advice maps it to 503 SCHEMA_UNAVAILABLE (same
        // mapping as the auth advice's P1-11 rule).
        when(ticketRepository.issue(
                1L, 7L, "sess-1", "https://app.example", "FETCH_SSE", 2L, 0L))
                .thenThrow(new BadSqlGrammarException(
                        "issue", "SELECT out_ticket_id, out_secret FROM vc.issue_realtime_ticket(...)",
                        new SQLException("schema unavailable", "42P01")));

        mockMvc.perform(post("/api/v1/realtime/tickets")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(ticketBody("7", "sess-1", "https://app.example", "2", "0")))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("SCHEMA_UNAVAILABLE"));
    }

    @Test
    void createTicketRejectsNonNumericGenerationIdAs400() throws Exception {
        mockMvc.perform(post("/api/v1/realtime/tickets")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(ticketBody("not-a-number", "sess-1", "https://app.example", "2", "0")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    @Test
    void createTicketRejectsZeroGenerationIdAs400() throws Exception {
        mockMvc.perform(post("/api/v1/realtime/tickets")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(ticketBody("0", "sess-1", "https://app.example", "2", "0")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    @Test
    void createTicketRejectsZeroStreamEpochAs400() throws Exception {
        mockMvc.perform(post("/api/v1/realtime/tickets")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(ticketBody("7", "sess-1", "https://app.example", "0", "0")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    @Test
    void createTicketRejectsNegativeAfterSeqAs400() throws Exception {
        mockMvc.perform(post("/api/v1/realtime/tickets")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(ticketBody("7", "sess-1", "https://app.example", "2", "-1")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    @Test
    void createTicketRejectsMissingSessionIdAs400() throws Exception {
        mockMvc.perform(post("/api/v1/realtime/tickets")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"generationId\":\"7\",\"origin\":\"https://app.example\","
                                + "\"streamEpoch\":\"2\",\"afterSeq\":\"0\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    @Test
    void createTicketRejectsMissingOriginAs400() throws Exception {
        mockMvc.perform(post("/api/v1/realtime/tickets")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"generationId\":\"7\",\"sessionId\":\"sess-1\","
                                + "\"streamEpoch\":\"2\",\"afterSeq\":\"0\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }
}
