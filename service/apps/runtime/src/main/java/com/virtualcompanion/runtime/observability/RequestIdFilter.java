package com.virtualcompanion.runtime.observability;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * REQUEST-ID (FR-CHAT-001: 每次请求具有 request_id): end-to-end request
 * correlation for the HTTP layer.
 *
 * <p>Every request carries a {@code X-Request-Id}: a caller-supplied value is
 * echoed when it is a short, printable token (RFC 7230 token characters only),
 * otherwise the server generates a UUID. The id is written to the MDC
 * ({@code requestId}) for the whole request so every log line of that request
 * is correlatable, echoed in the {@code X-Request-Id} response header so the
 * client can attach it to a support report, and removed in {@code finally} so
 * a leaked thread can never carry another request's id (the servlet container
 * may reuse threads).
 *
 * <p>Registered as the highest-priority container filter (a plain
 * {@code @Component}, independent of the auth switch) so the id exists even
 * for anonymous, rejected or baseline requests — the request id is an
 * observability primitive, not an authentication feature. The raw value never
 * reaches logs except through the MDC key (a malformed header is replaced,
 * never logged verbatim).
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestIdFilter extends OncePerRequestFilter {

    /** The correlation header, echoed on the response. */
    public static final String HEADER = "X-Request-Id";

    /** The SLF4J MDC key populated for the duration of the request. */
    public static final String MDC_KEY = "requestId";

    /** Maximum accepted length of a caller-supplied request id. */
    static final int MAX_LENGTH = 64;

    /** RFC 7230 token characters only — printable, no whitespace, no quotes. */
    private static final String ALLOWED = "[A-Za-z0-9._~-]+";

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {
        String incoming = request.getHeader(HEADER);
        String requestId = isValid(incoming)
                ? incoming
                : UUID.randomUUID().toString();
        MDC.put(MDC_KEY, requestId);
        response.setHeader(HEADER, requestId);
        try {
            filterChain.doFilter(request, response);
        } finally {
            MDC.remove(MDC_KEY);
        }
    }

    /**
     * A caller-supplied request id is accepted only when it is a short,
     * printable token; anything else (blank, overlong, control characters,
     * whitespace, quotes) is replaced by a generated UUID — a header can
     * never smuggle content into logs or responses.
     */
    static boolean isValid(String value) {
        return value != null
                && value.length() >= 1
                && value.length() <= MAX_LENGTH
                && value.matches(ALLOWED);
    }
}
