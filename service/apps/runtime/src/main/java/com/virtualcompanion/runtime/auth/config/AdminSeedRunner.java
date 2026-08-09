package com.virtualcompanion.runtime.auth.config;

import com.virtualcompanion.runtime.auth.application.AuthService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;

/**
 * Platform-initialization: seed the single ADMIN account at startup from
 * injected credentials (VC_ADMIN_USERNAME / VC_ADMIN_PASSWORD /
 * VC_ADMIN_DISPLAY_NAME via the approved channel). The seed is idempotent (the
 * V14 function no-ops when an ADMIN already exists), so a restart never
 * duplicates or overrides the bootstrap account. When no credentials are
 * injected the runner skips silently -- the operator decides when to bootstrap.
 *
 * <p>The password is hashed with BCrypt in the JVM and only the hash is stored;
 * it is never logged, placed in a URL or written to the repository.
 */
public class AdminSeedRunner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(AdminSeedRunner.class);

    private final AuthService authService;
    private final String username;
    private final String password;
    private final String displayName;

    public AdminSeedRunner(AuthService authService, String username, String password, String displayName) {
        this.authService = authService;
        this.username = username;
        this.password = password;
        this.displayName = displayName;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (username == null || username.isBlank()
                || password == null || password.isBlank()) {
            log.info("admin seed skipped (no injected credentials)");
            return;
        }
        authService.seedAdmin(username, password, displayName);
        log.info("admin seed ensured");
    }
}
