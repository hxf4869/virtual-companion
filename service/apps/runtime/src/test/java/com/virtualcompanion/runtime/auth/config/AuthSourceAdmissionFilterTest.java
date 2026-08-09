package com.virtualcompanion.runtime.auth.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.virtualcompanion.runtime.auth.application.AuthAbuseGuard;
import com.virtualcompanion.runtime.auth.application.AuthAbuseGuard.AdmissionLease;
import com.virtualcompanion.runtime.auth.application.AuthAbuseGuard.Route;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class AuthSourceAdmissionFilterTest {

    @Test
    void forwardedHeadersCannotSplitTheServletSourceWindow() throws Exception {
        AuthSourceAdmissionFilter filter = new AuthSourceAdmissionFilter(new AuthAbuseGuard());

        for (int i = 0; i < 20; i++) {
            MockHttpServletResponse response = invoke(
                    filter, request("POST", AuthSourceAdmissionFilter.LOGIN_PATH,
                            "192.0.2.10", "198.51.100." + i));
            assertThat(response.getStatus()).isEqualTo(200);
        }

        CountingRequest rejected = request(
                "POST", AuthSourceAdmissionFilter.LOGIN_PATH, "192.0.2.10", "203.0.113.99");
        AtomicBoolean chainCalled = new AtomicBoolean();
        MockHttpServletResponse response = new MockHttpServletResponse();
        AuthRequestBodyLimitFilter bodyFilter = new AuthRequestBodyLimitFilter();
        filter.doFilter(rejected, response, (request, servletResponse) -> bodyFilter.doFilter(
                request, servletResponse,
                (downstreamRequest, downstreamResponse) -> chainCalled.set(true)));

        assertThat(response.getStatus()).isEqualTo(429);
        assertThat(response.getHeader("Retry-After")).matches("[1-9][0-9]*");
        assertThat(response.getContentType()).startsWith("application/json");
        assertThat(response.getContentAsString())
                .isEqualTo("{\"code\":\"AUTH_RATE_LIMITED\","
                        + "\"message\":\"Authentication is temporarily rate limited\"}")
                .doesNotContain("192.0.2.10", "203.0.113.99", "source");
        assertThat(rejected.reads()).isZero();
        assertThat(chainCalled).isFalse();
    }

    @Test
    void bulkheadRejectionDoesNotEnterTheBodyFilterOrWait() throws Exception {
        AuthAbuseGuard guard = new AuthAbuseGuard();
        AuthSourceAdmissionFilter sourceFilter = new AuthSourceAdmissionFilter(guard);
        AuthRequestBodyLimitFilter bodyFilter = new AuthRequestBodyLimitFilter();
        List<AdmissionLease> leases = new ArrayList<>();
        for (int i = 0; i < 4; i++) {
            leases.add(guard.admitSource(Route.LOGIN, "192.0.2." + (70 + i)));
        }

        try {
            CountingRequest rejected = request(
                    "POST", AuthSourceAdmissionFilter.LOGIN_PATH, "192.0.2.80", null);
            AtomicBoolean chainCalled = new AtomicBoolean();
            MockHttpServletResponse response = new MockHttpServletResponse();
            sourceFilter.doFilter(rejected, response, (request, servletResponse) -> bodyFilter.doFilter(
                    request, servletResponse,
                    (downstreamRequest, downstreamResponse) -> chainCalled.set(true)));

            assertThat(response.getStatus()).isEqualTo(429);
            assertThat(response.getHeader("Retry-After")).isEqualTo("1");
            assertThat(rejected.reads()).isZero();
            assertThat(chainCalled).isFalse();
        } finally {
            leases.forEach(AdmissionLease::close);
        }
    }

    @Test
    void leaseCoversBodyAndCompleteDownstreamThenReleases() throws Exception {
        AuthAbuseGuard guard = new AuthAbuseGuard();
        AuthSourceAdmissionFilter sourceFilter = new AuthSourceAdmissionFilter(guard);
        AuthRequestBodyLimitFilter bodyFilter = new AuthRequestBodyLimitFilter();
        CountDownLatch release = new CountDownLatch(1);
        List<Future<MockHttpServletResponse>> futures = new ArrayList<>();
        List<CountingRequest> requests = new ArrayList<>();

        try (var executor = Executors.newFixedThreadPool(4)) {
            for (int i = 0; i < 4; i++) {
                CountDownLatch entered = new CountDownLatch(1);
                CountingRequest request = request(
                        "POST", AuthSourceAdmissionFilter.LOGIN_PATH, "192.0.2." + (90 + i), null);
                requests.add(request);
                futures.add(executor.submit(() -> {
                    MockHttpServletResponse response = new MockHttpServletResponse();
                    sourceFilter.doFilter(request, response, (servletRequest, servletResponse) ->
                            bodyFilter.doFilter(servletRequest, servletResponse,
                                    (downstreamRequest, downstreamResponse) -> {
                                        entered.countDown();
                                        await(release);
                                    }));
                    return response;
                }));
                assertThat(entered.await(2, TimeUnit.SECONDS)).isTrue();
            }

            CountingRequest rejected = request(
                    "POST", AuthSourceAdmissionFilter.LOGIN_PATH, "192.0.2.100", null);
            AtomicBoolean fifthChainCalled = new AtomicBoolean();
            MockHttpServletResponse rejectedResponse = new MockHttpServletResponse();
            sourceFilter.doFilter(rejected, rejectedResponse, (servletRequest, servletResponse) ->
                    bodyFilter.doFilter(servletRequest, servletResponse,
                            (downstreamRequest, downstreamResponse) -> fifthChainCalled.set(true)));
            assertThat(rejectedResponse.getStatus()).isEqualTo(429);
            assertThat(rejectedResponse.getHeader("Retry-After")).isEqualTo("1");
            assertThat(rejected.reads()).isZero();
            assertThat(fifthChainCalled).isFalse();

            release.countDown();
            executor.shutdown();
            assertThat(executor.awaitTermination(3, TimeUnit.SECONDS)).isTrue();
        } finally {
            release.countDown();
        }
        for (Future<MockHttpServletResponse> future : futures) {
            assertThat(future.get(1, TimeUnit.SECONDS).getStatus()).isEqualTo(200);
        }
        assertThat(requests).allSatisfy(request -> assertThat(request.reads()).isEqualTo(1));

        CountingRequest afterRelease = request(
                "POST", AuthSourceAdmissionFilter.LOGIN_PATH, "192.0.2.101", null);
        AtomicBoolean afterChainCalled = new AtomicBoolean();
        MockHttpServletResponse afterResponse = new MockHttpServletResponse();
        sourceFilter.doFilter(afterRelease, afterResponse, (servletRequest, servletResponse) ->
                bodyFilter.doFilter(servletRequest, servletResponse,
                        (downstreamRequest, downstreamResponse) -> afterChainCalled.set(true)));
        assertThat(afterResponse.getStatus()).isEqualTo(200);
        assertThat(afterRelease.reads()).isEqualTo(1);
        assertThat(afterChainCalled).isTrue();
    }

    @Test
    void downstreamExceptionStillReleasesTheBulkheadLease() throws Exception {
        AuthAbuseGuard guard = new AuthAbuseGuard();
        AuthSourceAdmissionFilter filter = new AuthSourceAdmissionFilter(guard);
        CountingRequest request = request(
                "POST", AuthSourceAdmissionFilter.LOGIN_PATH, "192.0.2.110", null);

        assertThatThrownBy(() -> filter.doFilter(
                request, new MockHttpServletResponse(),
                (servletRequest, servletResponse) -> {
                    throw new ServletException("expected downstream failure");
                })).isInstanceOf(ServletException.class);

        List<AdmissionLease> leases = new ArrayList<>();
        try {
            for (int i = 0; i < 4; i++) {
                leases.add(guard.admitSource(Route.REFRESH, "192.0.2." + (120 + i)));
            }
            assertThat(leases).hasSize(4);
        } finally {
            leases.forEach(AdmissionLease::close);
        }
    }

    @Test
    void loginAndRefreshSourceScopesAreIndependent() throws Exception {
        AuthSourceAdmissionFilter filter = new AuthSourceAdmissionFilter(new AuthAbuseGuard());
        for (int i = 0; i < 20; i++) {
            assertThat(invoke(filter, request(
                    "POST", AuthSourceAdmissionFilter.LOGIN_PATH, "192.0.2.11", null)).getStatus())
                    .isEqualTo(200);
        }

        assertThat(invoke(filter, request(
                "POST", AuthSourceAdmissionFilter.REFRESH_PATH, "192.0.2.11", null)).getStatus())
                .isEqualTo(200);
    }

    @Test
    void onlyExactPostRoutesConsumeAdmissionOrAcquireTheBulkhead() throws Exception {
        AuthSourceAdmissionFilter filter = new AuthSourceAdmissionFilter(new AuthAbuseGuard());
        String[] paths = {
                AuthSourceAdmissionFilter.LOGIN_PATH + "/",
                "/prefix" + AuthSourceAdmissionFilter.LOGIN_PATH,
                "/api/v1/auth/logout",
                "/api/v1/auth/admin/accounts"
        };
        for (String path : paths) {
            CountingRequest request = request("POST", path, null, null);
            AtomicBoolean called = new AtomicBoolean();
            MockHttpServletResponse response = new MockHttpServletResponse();
            filter.doFilter(request, response, (servletRequest, servletResponse) -> called.set(true));
            assertThat(called).isTrue();
            assertThat(response.getStatus()).isEqualTo(200);
        }

        assertThat(invoke(filter, request(
                "GET", AuthSourceAdmissionFilter.LOGIN_PATH, null, null)).getStatus()).isEqualTo(200);
    }

    @Test
    void mvcEquivalentNonCanonicalAuthPathsAreRejectedBeforeBodyRead() throws Exception {
        AuthSourceAdmissionFilter filter = new AuthSourceAdmissionFilter(new AuthAbuseGuard());

        for (String path : List.of(
                "/api/v1/auth/l%6Fgin",
                "/api/v1/auth/login;v=1",
                "/api/v1/auth/refr%65sh",
                "/api/v1/auth/refresh;v=1",
                "/api/v1/auth/log%6Fut",
                "/api/v1/auth/logout;v=1",
                "/api/v1/auth/admin/acc%6Funts",
                "/api/v1/auth/admin/acc%6funts",
                "/api/v1/auth/admin/accounts;v=1")) {
            CountingRequest request = request("POST", path, "192.0.2.140", null);
            AtomicBoolean chainCalled = new AtomicBoolean();
            MockHttpServletResponse response = new MockHttpServletResponse();

            filter.doFilter(
                    request,
                    response,
                    (servletRequest, servletResponse) -> chainCalled.set(true));

            assertThat(response.getStatus()).isEqualTo(400);
            assertThat(response.getContentAsString())
                    .isEqualTo("{\"code\":\"INVALID_REQUEST\","
                            + "\"message\":\"The request is invalid\"}");
            assertThat(request.reads()).isZero();
            assertThat(chainCalled).isFalse();
        }
    }

    @Test
    void malformedPercentRequestTargetsAreRejectedWithoutBodyReadOrException() throws Exception {
        AuthSourceAdmissionFilter filter = new AuthSourceAdmissionFilter(new AuthAbuseGuard());

        for (String path : List.of(
                "/api/v1/auth/%",
                "/api/v1/auth/login%2",
                "/api/v1/auth/admin/accounts%ZZ")) {
            CountingRequest request = request("POST", path, "192.0.2.141", null);
            AtomicBoolean chainCalled = new AtomicBoolean();
            MockHttpServletResponse response = new MockHttpServletResponse();

            filter.doFilter(request, response, (servletRequest, servletResponse) ->
                    chainCalled.set(true));

            assertThat(response.getStatus()).isEqualTo(400);
            assertThat(response.getContentAsString())
                    .isEqualTo("{\"code\":\"INVALID_REQUEST\","
                            + "\"message\":\"The request is invalid\"}");
            assertThat(request.reads()).isZero();
            assertThat(chainCalled).isFalse();
        }
    }

    @Test
    void sharedResolverHandlesContextPathAndLeavesUnknownRoutesUntargeted() {
        for (AuthRequestTarget.Route route : AuthRequestTarget.Route.values()) {
            MockHttpServletRequest canonical = new MockHttpServletRequest(
                    "POST", "/ctx" + route.path());
            canonical.setContextPath("/ctx");

            AuthRequestTarget.Match match = AuthRequestTarget.resolve(canonical);

            assertThat(match.status()).isEqualTo(AuthRequestTarget.Status.CANONICAL);
            assertThat(match.route()).isEqualTo(route);
        }
        assertThat(AuthRequestTarget.Route.ADMIN_ACCOUNTS.bodyLimited()).isTrue();
        assertThat(AuthRequestTarget.resolve(
                        new MockHttpServletRequest("GET", AuthSourceAdmissionFilter.LOGIN_PATH))
                .status()).isEqualTo(AuthRequestTarget.Status.NOT_TARGET);
        assertThat(AuthRequestTarget.resolve(
                        new MockHttpServletRequest("POST", "/api/v1/auth/unknown"))
                .status()).isEqualTo(AuthRequestTarget.Status.NOT_TARGET);
    }

    private static MockHttpServletResponse invoke(
            AuthSourceAdmissionFilter filter, CountingRequest request) throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        filter.doFilter(request, response, (servletRequest, servletResponse) -> {
            // Successful admission reaches the downstream chain.
        });
        return response;
    }

    private static CountingRequest request(
            String method, String path, String remoteAddress, String forwardedFor) {
        CountingRequest request = new CountingRequest(method, path);
        if (remoteAddress != null) {
            request.setRemoteAddr(remoteAddress);
        }
        if (forwardedFor != null) {
            request.addHeader("X-Forwarded-For", forwardedFor);
            request.addHeader("Forwarded", "for=" + forwardedFor);
            request.addHeader("X-Real-IP", forwardedFor);
        }
        request.setContent("never-read".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        return request;
    }

    private static void await(CountDownLatch latch) throws ServletException {
        try {
            if (!latch.await(3, TimeUnit.SECONDS)) {
                throw new ServletException("timed out waiting for the test release");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ServletException(e);
        }
    }

    private static final class CountingRequest extends MockHttpServletRequest {
        private final AtomicInteger reads = new AtomicInteger();

        private CountingRequest(String method, String requestUri) {
            super(method, requestUri);
        }

        @Override
        public ServletInputStream getInputStream() {
            reads.incrementAndGet();
            return super.getInputStream();
        }

        private int reads() {
            return reads.get();
        }
    }
}
