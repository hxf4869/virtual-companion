package com.virtualcompanion.runtime.version.web;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Service version endpoint (OpenAPI {@code getVersion}). Implements the last
 * controller-less OpenAPI contract face: {@code GET /api/v1/version} returns
 * the build version ({@code virtual-companion.version.version}, filtered from
 * the Maven {@code project.version} at build time) and an optional commit
 * identity injected at deploy time ({@code VC_COMMIT}).
 *
 * <p>Public and unauthenticated (OpenAPI {@code security: []}); the auth
 * security chain permits it explicitly while auth is enabled, and there is no
 * security chain at all when auth is disabled.
 */
@RestController
@RequestMapping("/api/v1")
public class VersionController {

    private final String version;
    private final String commit;

    public VersionController(
            @Value("${virtual-companion.version.version}") String version,
            @Value("${virtual-companion.version.commit:}") String commit) {
        this.version = version;
        this.commit = commit;
    }

    @GetMapping("/version")
    public VersionResponse getVersion() {
        return new VersionResponse(version, commit);
    }

    /** Response body (OpenAPI {@code VersionResponse}). */
    public record VersionResponse(String version, String commit) {
    }
}
