package com.virtualcompanion.runtime.auth.config;

import com.virtualcompanion.runtime.auth.web.AuthInputLimits;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import org.springframework.http.MediaType;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Bounds the raw JSON entity before Spring/Jackson can materialize it. The
 * body is read only for the two JSON auth endpoints and replayed to MVC when it
 * fits the limit, so the downstream request sees byte-identical input.
 */
public class AuthRequestBodyLimitFilter extends OncePerRequestFilter {

    private static final String LOGIN_PATH = "/api/v1/auth/login";
    private static final String ACCOUNT_PATH = "/api/v1/auth/admin/accounts";
    private static final String INVALID_REQUEST_BODY =
            "{\"code\":\"INVALID_REQUEST\",\"message\":\"The request is invalid\"}";

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain chain) throws ServletException, IOException {
        if (!isTarget(request)) {
            chain.doFilter(request, response);
            return;
        }

        if (request.getContentLengthLong() > AuthInputLimits.MAX_REQUEST_BODY_BYTES) {
            reject(response);
            return;
        }

        byte[] body;
        try (InputStream input = request.getInputStream()) {
            body = readAtMost(input, AuthInputLimits.MAX_REQUEST_BODY_BYTES + 1);
        }
        if (body.length > AuthInputLimits.MAX_REQUEST_BODY_BYTES) {
            reject(response);
            return;
        }

        chain.doFilter(new ReplayableBodyRequest(request, body), response);
    }

    static boolean isTarget(HttpServletRequest request) {
        if (request == null || !"POST".equalsIgnoreCase(request.getMethod())) {
            return false;
        }
        String path = request.getRequestURI();
        if (path == null) {
            path = request.getServletPath();
        }
        String contextPath = request.getContextPath();
        if (path == null) {
            return false;
        }
        if (contextPath != null && !contextPath.isEmpty() && path.startsWith(contextPath)) {
            path = path.substring(contextPath.length());
        }
        return LOGIN_PATH.equals(path) || ACCOUNT_PATH.equals(path);
    }

    private static byte[] readAtMost(InputStream input, int maximumBytes) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream(Math.min(maximumBytes, 8 * 1024));
        byte[] buffer = new byte[Math.min(maximumBytes, 8 * 1024)];
        while (output.size() < maximumBytes) {
            int remaining = maximumBytes - output.size();
            int read = input.read(buffer, 0, Math.min(buffer.length, remaining));
            if (read < 0) {
                break;
            }
            if (read == 0) {
                int one = input.read();
                if (one < 0) {
                    break;
                }
                output.write(one);
            } else {
                output.write(buffer, 0, read);
            }
        }
        return output.toByteArray();
    }

    private static void reject(HttpServletResponse response) throws IOException {
        response.setStatus(HttpServletResponse.SC_BAD_REQUEST);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.getWriter().write(INVALID_REQUEST_BODY);
    }

    private static final class ReplayableBodyRequest extends HttpServletRequestWrapper {

        private final byte[] body;

        private ReplayableBodyRequest(HttpServletRequest request, byte[] body) {
            super(request);
            this.body = body;
        }

        @Override
        public ServletInputStream getInputStream() {
            ByteArrayInputStream input = new ByteArrayInputStream(body);
            return new ServletInputStream() {
                @Override
                public int read() {
                    return input.read();
                }

                @Override
                public int read(byte[] bytes, int offset, int length) {
                    return input.read(bytes, offset, length);
                }

                @Override
                public int available() {
                    return input.available();
                }

                @Override
                public boolean isFinished() {
                    return input.available() == 0;
                }

                @Override
                public boolean isReady() {
                    return true;
                }

                @Override
                public void setReadListener(ReadListener readListener) {
                    throw new UnsupportedOperationException(
                            "asynchronous request reading is not supported");
                }
            };
        }

        @Override
        public BufferedReader getReader() throws IOException {
            String encoding = getCharacterEncoding();
            Charset charset = encoding == null
                    ? StandardCharsets.UTF_8
                    : Charset.forName(encoding);
            return new BufferedReader(new InputStreamReader(getInputStream(), charset));
        }

        @Override
        public int getContentLength() {
            return body.length;
        }

        @Override
        public long getContentLengthLong() {
            return body.length;
        }
    }
}
