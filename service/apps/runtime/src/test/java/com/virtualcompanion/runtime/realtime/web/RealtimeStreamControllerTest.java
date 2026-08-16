package com.virtualcompanion.runtime.realtime.web;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.asyncDispatch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.virtualcompanion.platform.persistence.GenerationRecord;
import com.virtualcompanion.platform.persistence.GenerationRepository;
import com.virtualcompanion.platform.persistence.RealtimeResumeService;
import com.virtualcompanion.platform.persistence.ResumeResult;
import com.virtualcompanion.platform.persistence.RealtimeTicketRepository;
import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import com.virtualcompanion.runtime.realtime.LiveDeltaBroker;
import com.virtualcompanion.runtime.web.RuntimeApiExceptionHandler;
import java.sql.SQLException;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.MethodParameter;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.BadSqlGrammarException;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;

/**
 * Standalone controller test for the realtime Fetch-SSE resume stream
 * (TASK-0184). Each resume_stream disposition maps to its SSE event(s);
 * ticket-consume failure and a foreign/absent generation fail closed as a
 * single stream.denied event (no existence disclosure); only a malformed or
 * missing parameter before the stream opens maps to 400 INVALID_REQUEST; a
 * schema-unavailable BadSqlGrammarException is re-thrown (503) rather than
 * masked as stream.denied. The {@code @AuthenticationPrincipal} resolver is
 * replicated from the ticket / memory controller tests; the owner GUC binding
 * is covered by the auth integration layer.
 */
class RealtimeStreamControllerTest {

    private static final long OWNER = 1L;
    private static final long GENERATION = 7L;
    private static final long TICKET = 99L;
    private static final String SECRET = "secret-uuid";
    private static final String SESSION = "sess-1";
    private static final String ORIGIN = "https://app.example";
    private static final long EPOCH = 2L;

    private RealtimeTicketRepository ticketRepository;
    private RealtimeResumeService resumeService;
    private GenerationRepository generationRepository;
    private LiveDeltaBroker deltaBroker;
    private RealtimeStreamController controller;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        ticketRepository = mock(RealtimeTicketRepository.class);
        resumeService = mock(RealtimeResumeService.class);
        generationRepository = mock(GenerationRepository.class);
        deltaBroker = mock(LiveDeltaBroker.class);
        controller = new RealtimeStreamController(
                ticketRepository, resumeService, generationRepository, deltaBroker);
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

    /** The RESUMED tests run against a TERMINAL generation so the live tail
     *  completes immediately (no broker subscription). */
    private void stubTerminalGeneration() {
        when(generationRepository.find(OWNER, GENERATION)).thenReturn(Optional.of(
                new GenerationRecord(OWNER, GENERATION, 5L, "lg-7", "COMPLETED", null)));
    }

    private MvcResult openStream(String lastEventId) throws Exception {
        var requestBuilder = get("/api/v1/realtime/streams/{id}", String.valueOf(GENERATION))
                .param("ticketId", String.valueOf(TICKET))
                .param("secret", SECRET)
                .param("sessionId", SESSION)
                .param("origin", ORIGIN)
                .param("streamEpoch", String.valueOf(EPOCH));
        if (lastEventId != null) {
            requestBuilder.header("Last-Event-ID", lastEventId);
        }
        return mockMvc.perform(requestBuilder)
                .andExpect(status().isOk())
                .andExpect(request().asyncStarted())
                .andReturn();
    }

    private static String durableEvents(String event, long seq) {
        return "[{\"schemaVersion\":1,\"event\":\"" + event + "\",\"generationId\":"
                + GENERATION + ",\"streamEpoch\":" + EPOCH + ",\"eventSeq\":" + seq
                + ",\"committedAt\":\"2026-08-13T00:00:00Z\",\"payload\":{\"k\":\"v\"}}]";
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
    void openStreamEmitsDurableEventsOnResumed() throws Exception {
        when(ticketRepository.consume(
                OWNER, TICKET, SECRET, GENERATION, SESSION, ORIGIN,
                "FETCH_SSE", EPOCH, 0L)).thenReturn(true);
        when(resumeService.resume(OWNER, GENERATION, EPOCH, 0L))
                .thenReturn(new ResumeResult("RESUMED", durableEvents("chat.accepted", 3L), "null"));
        stubTerminalGeneration();

        mockMvc.perform(asyncDispatch(openStream(null)))
                .andExpect(status().isOk())
                .andExpect(content().string(org.hamcrest.Matchers.containsString("event:chat.accepted")))
                .andExpect(content().string(org.hamcrest.Matchers.containsString("id:3")));

        verify(ticketRepository).consume(
                OWNER, TICKET, SECRET, GENERATION, SESSION, ORIGIN, "FETCH_SSE", EPOCH, 0L);
        verify(resumeService).resume(OWNER, GENERATION, EPOCH, 0L);
        verify(deltaBroker, never()).subscribe(anyLong());
    }

    @Test
    void openStreamEmitsSnapshotAndDurableEventsOnTerminalSnapshot() throws Exception {
        when(ticketRepository.consume(
                OWNER, TICKET, SECRET, GENERATION, SESSION, ORIGIN,
                "FETCH_SSE", EPOCH, 0L)).thenReturn(true);
        when(resumeService.resume(OWNER, GENERATION, EPOCH, 0L))
                .thenReturn(new ResumeResult(
                        "TERMINAL_SNAPSHOT",
                        durableEvents("chat.completed", 5L),
                        "{\"status\":\"COMPLETED\",\"assistantMessageId\":42,\"generationId\":7}"));

        mockMvc.perform(asyncDispatch(openStream(null)))
                .andExpect(status().isOk())
                .andExpect(content().string(org.hamcrest.Matchers.containsString("event:snapshot")))
                .andExpect(content().string(org.hamcrest.Matchers.containsString("event:chat.completed")))
                .andExpect(content().string(org.hamcrest.Matchers.containsString("id:5")));
    }

    @Test
    void openStreamEmitsGapEventOnGapExpired() throws Exception {
        when(ticketRepository.consume(
                OWNER, TICKET, SECRET, GENERATION, SESSION, ORIGIN,
                "FETCH_SSE", EPOCH, 0L)).thenReturn(true);
        when(resumeService.resume(OWNER, GENERATION, EPOCH, 0L))
                .thenReturn(new ResumeResult("GAP_EXPIRED", "[]", "null"));

        mockMvc.perform(asyncDispatch(openStream(null)))
                .andExpect(status().isOk())
                .andExpect(content().string(org.hamcrest.Matchers.containsString("event:stream.gap")));
    }

    @Test
    void openStreamEmitsResetEventOnResetRequired() throws Exception {
        when(ticketRepository.consume(
                OWNER, TICKET, SECRET, GENERATION, SESSION, ORIGIN,
                "FETCH_SSE", EPOCH, 0L)).thenReturn(true);
        when(resumeService.resume(OWNER, GENERATION, EPOCH, 0L))
                .thenReturn(new ResumeResult("RESET_REQUIRED", "[]", "null"));

        mockMvc.perform(asyncDispatch(openStream(null)))
                .andExpect(status().isOk())
                .andExpect(content().string(org.hamcrest.Matchers.containsString("event:stream.reset")));
    }

    @Test
    void openStreamEmitsDeniedOnNotFoundOrForbidden() throws Exception {
        when(ticketRepository.consume(
                OWNER, TICKET, SECRET, GENERATION, SESSION, ORIGIN,
                "FETCH_SSE", EPOCH, 0L)).thenReturn(true);
        when(resumeService.resume(OWNER, GENERATION, EPOCH, 0L))
                .thenReturn(new ResumeResult("NOT_FOUND_OR_FORBIDDEN", "[]", "null"));

        mockMvc.perform(asyncDispatch(openStream(null)))
                .andExpect(status().isOk())
                .andExpect(content().string(org.hamcrest.Matchers.containsString("event:stream.denied")));
    }

    @Test
    void openStreamEmitsDeniedWhenTicketConsumeFails() throws Exception {
        // Any ticket failure (invalid secret / expired / replay / binding mismatch)
        // surfaces from consume_realtime_ticket as a DataAccessException and must
        // fail closed as a single stream.denied without disclosing existence; the
        // resume_stream call is never reached.
        when(ticketRepository.consume(
                OWNER, TICKET, SECRET, GENERATION, SESSION, ORIGIN,
                "FETCH_SSE", EPOCH, 0L)).thenThrow(new DataAccessException("ticket invalid") {
                });

        mockMvc.perform(asyncDispatch(openStream(null)))
                .andExpect(status().isOk())
                .andExpect(content().string(org.hamcrest.Matchers.containsString("event:stream.denied")));

        verify(resumeService, never()).resume(OWNER, GENERATION, EPOCH, 0L);
    }

    @Test
    void openStreamForwardsLastEventIdAsAfterSeqCursor() throws Exception {
        when(ticketRepository.consume(
                OWNER, TICKET, SECRET, GENERATION, SESSION, ORIGIN,
                "FETCH_SSE", EPOCH, 5L)).thenReturn(true);
        when(resumeService.resume(OWNER, GENERATION, EPOCH, 5L))
                .thenReturn(new ResumeResult("RESUMED", durableEvents("chat.accepted", 6L), "null"));
        stubTerminalGeneration();

        mockMvc.perform(asyncDispatch(openStream("5")))
                .andExpect(status().isOk())
                .andExpect(content().string(org.hamcrest.Matchers.containsString("id:6")));

        verify(ticketRepository).consume(
                OWNER, TICKET, SECRET, GENERATION, SESSION, ORIGIN, "FETCH_SSE", EPOCH, 5L);
    }

    // ---- STREAM-LIVE: live tail ----

    private void stubRunningGeneration() {
        when(generationRepository.find(OWNER, GENERATION)).thenReturn(Optional.of(
                new GenerationRecord(OWNER, GENERATION, 5L, "lg-7", "IN_PROGRESS", null)));
    }

    @Test
    void openStreamTailForwardsLiveDeltasUntilTheEndMarker() throws Exception {
        when(ticketRepository.consume(
                OWNER, TICKET, SECRET, GENERATION, SESSION, ORIGIN,
                "FETCH_SSE", EPOCH, 0L)).thenReturn(true);
        when(resumeService.resume(OWNER, GENERATION, EPOCH, 0L))
                .thenReturn(new ResumeResult("RESUMED", durableEvents("chat.accepted", 1L), "null"));
        stubRunningGeneration();
        LiveDeltaBroker.Subscriber subscriber = mock(LiveDeltaBroker.Subscriber.class);
        when(deltaBroker.subscribe(GENERATION)).thenReturn(subscriber);
        when(subscriber.poll(anyLong())).thenReturn(
                new LiveDeltaBroker.LiveEvent(EPOCH, 2L, "chat.delta", "Hel"),
                new LiveDeltaBroker.LiveEvent(EPOCH, 3L, "chat.delta", "lo"),
                LiveDeltaBroker.LiveEvent.end(),
                null);

        mockMvc.perform(asyncDispatch(openStream(null)))
                .andExpect(status().isOk())
                .andExpect(content().string(org.hamcrest.Matchers.containsString("event:chat.delta")))
                .andExpect(content().string(org.hamcrest.Matchers.containsString("id:2")))
                .andExpect(content().string(org.hamcrest.Matchers.containsString("\"payload\":\"Hel\"")));

        verify(deltaBroker).subscribe(GENERATION);
    }

    @Test
    void openStreamTailCompletesWhenTheDeadlineExpiresWithoutEnd() throws Exception {
        when(ticketRepository.consume(
                OWNER, TICKET, SECRET, GENERATION, SESSION, ORIGIN,
                "FETCH_SSE", EPOCH, 0L)).thenReturn(true);
        when(resumeService.resume(OWNER, GENERATION, EPOCH, 0L))
                .thenReturn(new ResumeResult("RESUMED", durableEvents("chat.accepted", 1L), "null"));
        stubRunningGeneration();
        LiveDeltaBroker.Subscriber subscriber = mock(LiveDeltaBroker.Subscriber.class);
        when(deltaBroker.subscribe(GENERATION)).thenReturn(subscriber);
        when(subscriber.poll(anyLong())).thenReturn(null);
        // Test hook: an already-expired deadline completes without waiting the
        // full 120s; the poll may run once, then the loop exits.
        controller.liveTailTimeoutMillis = 1L;

        mockMvc.perform(asyncDispatch(openStream(null)))
                .andExpect(status().isOk())
                .andExpect(content().string(org.hamcrest.Matchers.containsString("event:chat.accepted")));

        verify(deltaBroker).subscribe(GENERATION);
    }

    @Test
    void openStreamTailCompletesImmediatelyForAnAbsentGeneration() throws Exception {
        when(ticketRepository.consume(
                OWNER, TICKET, SECRET, GENERATION, SESSION, ORIGIN,
                "FETCH_SSE", EPOCH, 0L)).thenReturn(true);
        when(resumeService.resume(OWNER, GENERATION, EPOCH, 0L))
                .thenReturn(new ResumeResult("RESUMED", durableEvents("chat.accepted", 1L), "null"));
        when(generationRepository.find(OWNER, GENERATION)).thenReturn(Optional.empty());

        mockMvc.perform(asyncDispatch(openStream(null)))
                .andExpect(status().isOk());

        verify(deltaBroker, never()).subscribe(anyLong());
    }

    @Test
    void openStreamRejectsMissingSecretAs400() throws Exception {
        mockMvc.perform(get("/api/v1/realtime/streams/{id}", String.valueOf(GENERATION))
                        .param("ticketId", String.valueOf(TICKET))
                        .param("sessionId", SESSION)
                        .param("origin", ORIGIN)
                        .param("streamEpoch", String.valueOf(EPOCH)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    @Test
    void openStreamRejectsMissingTicketIdAs400() throws Exception {
        mockMvc.perform(get("/api/v1/realtime/streams/{id}", String.valueOf(GENERATION))
                        .param("secret", SECRET)
                        .param("sessionId", SESSION)
                        .param("origin", ORIGIN)
                        .param("streamEpoch", String.valueOf(EPOCH)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    @Test
    void openStreamRejectsNonNumericGenerationIdAs400() throws Exception {
        mockMvc.perform(get("/api/v1/realtime/streams/{id}", "not-a-number")
                        .param("ticketId", String.valueOf(TICKET))
                        .param("secret", SECRET)
                        .param("sessionId", SESSION)
                        .param("origin", ORIGIN)
                        .param("streamEpoch", String.valueOf(EPOCH)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    @Test
    void openStreamRejectsZeroStreamEpochAs400() throws Exception {
        mockMvc.perform(get("/api/v1/realtime/streams/{id}", String.valueOf(GENERATION))
                        .param("ticketId", String.valueOf(TICKET))
                        .param("secret", SECRET)
                        .param("sessionId", SESSION)
                        .param("origin", ORIGIN)
                        .param("streamEpoch", "0"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    @Test
    void openStreamPropagatesBadSqlGrammarInsteadOfDeny() {
        // A schema-unavailable BadSqlGrammarException must NOT be masked as
        // stream.denied; it is re-thrown so the global advice can map 503.
        when(ticketRepository.consume(
                OWNER, TICKET, SECRET, GENERATION, SESSION, ORIGIN,
                "FETCH_SSE", EPOCH, 0L)).thenThrow(new BadSqlGrammarException(
                        "consume", "SELECT vc.consume_realtime_ticket(...)",
                        new SQLException("schema unavailable", "42P01")));

        Exception thrown = assertThrows(Exception.class, () -> openStream(null));
        assertTrue(hasCauseOfType(thrown, BadSqlGrammarException.class));
    }
}
