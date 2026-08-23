package com.virtualcompanion.runtime.auth.web;

import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;

/**
 * S0-15 review-fix: an account created (or reset) by an admin with
 * {@code password_must_change=true} holds a session that may ONLY change its
 * password (or log out / keep it alive via refresh) until the change happens.
 * Every other Bearer request is rejected before any business logic runs —
 * the flag is enforced, not decorative.
 */
public final class PasswordChangeRequiredResponse {

    public static final String CODE = "PASSWORD_CHANGE_REQUIRED";
    public static final String MESSAGE =
            "Set a new password before using the service";

    private static final String JSON = "{\"code\":\"" + CODE
            + "\",\"message\":\"" + MESSAGE + "\"}";

    private PasswordChangeRequiredResponse() {
    }

    public static void write(HttpServletResponse response) throws IOException {
        response.setStatus(HttpStatus.FORBIDDEN.value());
        response.setCharacterEncoding("UTF-8");
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.getWriter().write(JSON);
    }
}
