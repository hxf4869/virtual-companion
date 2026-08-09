package com.virtualcompanion.runtime.auth.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.http.MediaType.APPLICATION_JSON_VALUE;

import com.virtualcompanion.runtime.auth.web.AuthInputLimits;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Arrays;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class AuthRequestBodyLimitFilterTest {

    private final AuthRequestBodyLimitFilter filter = new AuthRequestBodyLimitFilter();

    @ParameterizedTest
    @ValueSource(ints = {
        AuthInputLimits.MAX_REQUEST_BODY_BYTES - 1,
        AuthInputLimits.MAX_REQUEST_BODY_BYTES
    })
    void exactAndBelowBodiesAreReplayedByteIdentically(int size) throws Exception {
        byte[] body = body(size);
        TrackingRequest request = request("POST", "/api/v1/auth/login", body, body.length, "");
        AtomicReference<byte[]> forwarded = new AtomicReference<>();

        FilterResult result = run(request, forwarded);

        assertThat(result.chainCalled()).isTrue();
        assertThat(forwarded.get()).containsExactly(body);
        assertThat(request.input().bytesRead()).isEqualTo(size);
        assertThat(request.input().closed()).isTrue();
    }

    @Test
    void knownLengthOneOverIsRejectedWithoutReadingBody() throws Exception {
        byte[] body = body(AuthInputLimits.MAX_REQUEST_BODY_BYTES + 1);
        TrackingRequest request = request(
                "POST", "/api/v1/auth/login", body, body.length, "");

        FilterResult result = run(request, new AtomicReference<>());

        assertInvalid(result, body);
        assertThat(request.input().bytesRead()).isZero();
        assertThat(request.input().closed()).isFalse();
    }

    @Test
    void unknownLengthOneOverReadsOnlyTheSingleProbeAndLeavesSentinel() throws Exception {
        byte[] body = body(AuthInputLimits.MAX_REQUEST_BODY_BYTES + 2);
        TrackingRequest request = request(
                "POST", "/api/v1/auth/login", body, -1, "");

        FilterResult result = run(request, new AtomicReference<>());

        assertInvalid(result, body);
        assertThat(result.chainCalled()).isFalse();
        assertThat(request.input().bytesRead())
                .isEqualTo(AuthInputLimits.MAX_REQUEST_BODY_BYTES + 1);
        assertThat(request.input().available()).isEqualTo(1);
        assertThat(request.input().closed()).isTrue();
    }

    @Test
    void declaredLengthCannotBeTrustedWhenActualBodyIsOneOver() throws Exception {
        byte[] body = body(AuthInputLimits.MAX_REQUEST_BODY_BYTES + 1);
        TrackingRequest request = request(
                "POST", "/api/v1/auth/login", body,
                AuthInputLimits.MAX_REQUEST_BODY_BYTES, "");

        FilterResult result = run(request, new AtomicReference<>());

        assertInvalid(result, body);
        assertThat(request.input().bytesRead())
                .isEqualTo(AuthInputLimits.MAX_REQUEST_BODY_BYTES + 1);
    }

    @Test
    void contextPathIsExcludedBeforeExactPathMatching() throws Exception {
        byte[] body = body(AuthInputLimits.MAX_REQUEST_BODY_BYTES + 1);
        TrackingRequest request = request(
                "POST", "/ctx/api/v1/auth/login", body, body.length, "/ctx");

        FilterResult result = run(request, new AtomicReference<>());

        assertInvalid(result, body);
        assertThat(request.input().bytesRead()).isZero();
    }

    @Test
    void otherMethodAndPathDoNotReadOrWrapBody() throws Exception {
        byte[] body = body(AuthInputLimits.MAX_REQUEST_BODY_BYTES + 1);
        TrackingRequest getRequest = request("GET", "/api/v1/auth/login", body, body.length, "");
        TrackingRequest otherRequest = request("POST", "/api/v1/auth/refresh", body, body.length, "");

        FilterResult getResult = runWithoutReading(getRequest);
        FilterResult otherResult = runWithoutReading(otherRequest);

        assertThat(getResult.chainCalled()).isTrue();
        assertThat(otherResult.chainCalled()).isTrue();
        assertThat(getRequest.input().bytesRead()).isZero();
        assertThat(otherRequest.input().bytesRead()).isZero();
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "/api/v1/auth/admin/acc%6Funts",
        "/api/v1/auth/admin/acc%6funts",
        "/api/v1/auth/admin/accounts;v=1",
        "/api/v1/%61uth/admin/accounts"
    })
    void nonCanonicalAdminAliasesAreRejectedBeforeBodyRead(String path) throws Exception {
        byte[] body = body(AuthInputLimits.MAX_REQUEST_BODY_BYTES + 1);
        TrackingRequest request = request("POST", path, body, body.length, "");

        FilterResult result = runWithoutReading(request);

        assertInvalid(result, body);
        assertThat(request.input().bytesRead()).isZero();
        assertThat(request.input().closed()).isFalse();
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "/api/v1/auth/%",
        "/api/v1/auth/login%2",
        "/api/v1/auth/admin/accounts%ZZ"
    })
    void malformedPercentTargetsAreRejectedBeforeBodyRead(String path) throws Exception {
        byte[] body = body(AuthInputLimits.MAX_REQUEST_BODY_BYTES + 1);
        TrackingRequest request = request("POST", path, body, body.length, "");

        FilterResult result = runWithoutReading(request);

        assertInvalid(result, body);
        assertThat(request.input().bytesRead()).isZero();
        assertThat(request.input().closed()).isFalse();
    }

    private static FilterResult run(
            TrackingRequest request, AtomicReference<byte[]> forwardedBody) throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        AtomicBoolean chainCalled = new AtomicBoolean();
        FilterChain chain = (servletRequest, servletResponse) -> {
            chainCalled.set(true);
            forwardedBody.set(servletRequest.getInputStream().readAllBytes());
        };

        new AuthRequestBodyLimitFilter().doFilter(request, response, chain);
        return new FilterResult(response, chainCalled.get());
    }

    private static FilterResult runWithoutReading(TrackingRequest request) throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        AtomicBoolean chainCalled = new AtomicBoolean();
        FilterChain chain = (servletRequest, servletResponse) -> chainCalled.set(true);

        new AuthRequestBodyLimitFilter().doFilter(request, response, chain);
        return new FilterResult(response, chainCalled.get());
    }

    private static void assertInvalid(FilterResult result, byte[] body) throws IOException {
        String responseBody = result.response().getContentAsString();
        assertThat(result.response().getStatus()).isEqualTo(400);
        assertThat(result.response().getContentType()).contains(APPLICATION_JSON_VALUE);
        assertThat(result.response().getCharacterEncoding()).isEqualTo("UTF-8");
        assertThat(responseBody)
                .isEqualTo("{\"code\":\"INVALID_REQUEST\",\"message\":\"The request is invalid\"}");
        assertThat(responseBody).doesNotContain(Integer.toString(body.length));
        assertThat(result.chainCalled()).isFalse();
    }

    private static byte[] body(int size) {
        byte[] body = new byte[size];
        Arrays.fill(body, (byte) 'a');
        if (size > AuthInputLimits.MAX_REQUEST_BODY_BYTES) {
            body[AuthInputLimits.MAX_REQUEST_BODY_BYTES] = 'X';
            if (size > AuthInputLimits.MAX_REQUEST_BODY_BYTES + 1) {
                body[AuthInputLimits.MAX_REQUEST_BODY_BYTES + 1] = 'S';
            }
        }
        return body;
    }

    private static TrackingRequest request(
            String method, String path, byte[] body, long contentLength, String contextPath) {
        MockHttpServletRequest base = new MockHttpServletRequest(method, path);
        base.setContentType(APPLICATION_JSON_VALUE);
        return new TrackingRequest(base, body, contentLength, contextPath);
    }

    private record FilterResult(MockHttpServletResponse response, boolean chainCalled) {
    }

    private static final class TrackingRequest extends jakarta.servlet.http.HttpServletRequestWrapper {

        private final TrackingInputStream input;
        private final long contentLength;
        private final String contextPath;

        private TrackingRequest(
                HttpServletRequest request, byte[] body, long contentLength, String contextPath) {
            super(request);
            this.input = new TrackingInputStream(body);
            this.contentLength = contentLength;
            this.contextPath = contextPath;
        }

        @Override
        public ServletInputStream getInputStream() {
            return input;
        }

        @Override
        public long getContentLengthLong() {
            return contentLength;
        }

        @Override
        public int getContentLength() {
            return contentLength < 0 ? -1 : (int) contentLength;
        }

        @Override
        public String getContextPath() {
            return contextPath;
        }

        private TrackingInputStream input() {
            return input;
        }
    }

    private static final class TrackingInputStream extends ServletInputStream {

        private final ByteArrayInputStream delegate;
        private int bytesRead;
        private boolean closed;

        private TrackingInputStream(byte[] body) {
            this.delegate = new ByteArrayInputStream(body);
        }

        @Override
        public int read() {
            int value = delegate.read();
            if (value >= 0) {
                bytesRead++;
            }
            return value;
        }

        @Override
        public int read(byte[] bytes, int offset, int length) {
            int count = delegate.read(bytes, offset, length);
            if (count > 0) {
                bytesRead += count;
            }
            return count;
        }

        @Override
        public int available() {
            return delegate.available();
        }

        @Override
        public void close() throws IOException {
            closed = true;
            delegate.close();
        }

        @Override
        public boolean isFinished() {
            return delegate.available() == 0;
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

        private int bytesRead() {
            return bytesRead;
        }

        private boolean closed() {
            return closed;
        }
    }
}
