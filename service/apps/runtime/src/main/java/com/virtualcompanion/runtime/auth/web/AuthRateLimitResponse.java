package com.virtualcompanion.runtime.auth.web;

import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;

/** One response shape for filter- and MVC-level authentication admission rejection. */
public final class AuthRateLimitResponse {

    public static final String CODE = "AUTH_RATE_LIMITED";
    public static final String MESSAGE = "Authentication is temporarily rate limited";

    private static final String JSON = "{\"code\":\"" + CODE
            + "\",\"message\":\"" + MESSAGE + "\"}";

    private AuthRateLimitResponse() {
    }

    public static ResponseEntity<ErrorEnvelope> entity(int retryAfterSeconds) {
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .header(HttpHeaders.RETRY_AFTER, Integer.toString(Math.max(1, retryAfterSeconds)))
                .body(new ErrorEnvelope(CODE, MESSAGE));
    }

    public static void write(HttpServletResponse response, int retryAfterSeconds) throws IOException {
        response.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
        response.setHeader(HttpHeaders.RETRY_AFTER, Integer.toString(Math.max(1, retryAfterSeconds)));
        response.setCharacterEncoding("UTF-8");
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.getWriter().write(JSON);
    }
}
