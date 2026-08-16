package com.virtualcompanion.runtime.observability;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import java.io.IOException;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

/**
 * Unit tests for {@link RequestIdFilter} (REQUEST-ID / FR-CHAT-001): a
 * generated UUID when the header is absent, transparent echo of a valid
 * caller-supplied token, replacement of malformed headers, and MDC cleanup so
 * a reused thread never leaks the previous request's id.
 */
class RequestIdFilterTest {

    private final RequestIdFilter filter = new RequestIdFilter();

    @AfterEach
    void tearDown() {
        MDC.remove(RequestIdFilter.MDC_KEY);
    }

    @Test
    void generatesAUuidWhenTheHeaderIsAbsent() throws ServletException, IOException {
        MockHttpServletRequest request = new MockHttpServletRequest();
        MockHttpServletResponse response = new MockHttpServletResponse();
        final String[] seenInsideChain = new String[1];
        FilterChain chain = (req, res) -> seenInsideChain[0] = MDC.get(RequestIdFilter.MDC_KEY);

        filter.doFilter(request, response, chain);

        String echoed = response.getHeader(RequestIdFilter.HEADER);
        assertThat(echoed).isNotNull();
        assertThat(UUID.fromString(echoed)).isNotNull(); // valid UUID shape
        assertThat(seenInsideChain[0]).isEqualTo(echoed);
    }

    @Test
    void echoesAValidCallerSuppliedToken() throws ServletException, IOException {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader(RequestIdFilter.HEADER, "req_2026-08-17.abc-123");
        MockHttpServletResponse response = new MockHttpServletResponse();
        final String[] seenInsideChain = new String[1];
        FilterChain chain = (req, res) -> seenInsideChain[0] = MDC.get(RequestIdFilter.MDC_KEY);

        filter.doFilter(request, response, chain);

        assertThat(response.getHeader(RequestIdFilter.HEADER)).isEqualTo("req_2026-08-17.abc-123");
        assertThat(seenInsideChain[0]).isEqualTo("req_2026-08-17.abc-123");
    }

    @Test
    void replacesMalformedHeadersInsteadOfEchoingThem() throws ServletException, IOException {
        // Overlong value.
        MockHttpServletRequest overlong = new MockHttpServletRequest();
        overlong.addHeader(RequestIdFilter.HEADER, "x".repeat(RequestIdFilter.MAX_LENGTH + 1));
        MockHttpServletResponse response = new MockHttpServletResponse();
        filter.doFilter(overlong, response, new MockFilterChain());
        assertThat(response.getHeader(RequestIdFilter.HEADER)).isNotEqualTo(overlong.getHeader(RequestIdFilter.HEADER));

        // Whitespace / control characters.
        MockHttpServletRequest dirty = new MockHttpServletRequest();
        dirty.addHeader(RequestIdFilter.HEADER, "ok\ninjected");
        MockHttpServletResponse dirtyResponse = new MockHttpServletResponse();
        filter.doFilter(dirty, dirtyResponse, new MockFilterChain());
        assertThat(dirtyResponse.getHeader(RequestIdFilter.HEADER)).isNotEqualTo("ok\ninjected");
        assertThat(UUID.fromString(dirtyResponse.getHeader(RequestIdFilter.HEADER))).isNotNull();
    }

    @Test
    void removesTheMdcEntryAfterTheRequest() throws ServletException, IOException {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader(RequestIdFilter.HEADER, "first-request");
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, new MockFilterChain());

        // The finally block cleared the entry: a later (reused) thread must
        // not see the previous request's id.
        assertThat(MDC.get(RequestIdFilter.MDC_KEY)).isNull();
    }

    @Test
    void keepsTheIdAcrossAThrowingChain() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain throwing = (req, res) -> {
            throw new IllegalStateException("downstream failure");
        };

        try {
            filter.doFilter(request, response, throwing);
        } catch (Exception expected) {
            // The response still carries the id and the MDC is cleared.
            assertThat(response.getHeader(RequestIdFilter.HEADER)).isNotNull();
            assertThat(MDC.get(RequestIdFilter.MDC_KEY)).isNull();
            return;
        }
        throw new AssertionError("expected the downstream failure to propagate");
    }
}
