package com.virtualcompanion.runtime.auth.config;

import com.virtualcompanion.platform.persistence.IdentityAccountRepository;
import com.virtualcompanion.platform.persistence.IdentityRefreshTokenRepository;
import com.virtualcompanion.runtime.auth.application.AuthAbuseGuard;
import com.virtualcompanion.runtime.auth.application.AuthService;
import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import com.virtualcompanion.runtime.auth.tenant.OwnerContext;
import com.virtualcompanion.runtime.auth.web.AuthController;
import com.zaxxer.hikari.HikariDataSource;
import java.time.Duration;
import javax.sql.DataSource;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Database wiring for the identity subsystem, active only when
 * {@code virtual-companion.auth.datasource-enabled=true} (a live PostgreSQL 18
 * running the V14 migration). The DataSource reads injected credentials
 * (VC_DB_URL / VC_DB_USERNAME / VC_DB_PASSWORD) and fails fast when a required
 * value is missing; the identity repositories are bound to the V14 SECURITY
 * DEFINER functions. With a DataSource bean present, Flyway and the JDBC
 * auto-configuration activate and apply the migrations on startup.
 *
 * <p>Deliberately NOT component-scanned by the runtime's base package (it is a
 * runtime-local config), so the default context -- and the tests -- stay free
 * of any database requirement.
 */
@Configuration
@ConditionalOnProperty(
        name = {"virtual-companion.auth.enabled", "virtual-companion.auth.datasource-enabled"},
        havingValue = "true")
public class AuthDataSourceConfig {

    @Bean
    public DataSource authDataSource(
            @Value("${virtual-companion.auth.datasource.url:}") String url,
            @Value("${virtual-companion.auth.datasource.username:}") String username,
            @Value("${virtual-companion.auth.datasource.password:}") String password) {
        if (url == null || url.isBlank()) {
            throw new IllegalStateException(
                    "virtual-companion.auth.datasource.url (VC_DB_URL) is required when the auth datasource is enabled");
        }
        HikariDataSource dataSource = new HikariDataSource();
        dataSource.setJdbcUrl(url);
        dataSource.setUsername(username);
        dataSource.setPassword(password);
        dataSource.setMaximumPoolSize(5);
        return dataSource;
    }

    @Bean
    public JdbcTemplate authJdbcTemplate(DataSource authDataSource) {
        return new JdbcTemplate(authDataSource);
    }

    @Bean
    public IdentityAccountRepository identityAccountRepository(JdbcTemplate authJdbcTemplate) {
        return new IdentityAccountRepository(authJdbcTemplate);
    }

    @Bean
    public IdentityRefreshTokenRepository identityRefreshTokenRepository(JdbcTemplate authJdbcTemplate) {
        return new IdentityRefreshTokenRepository(authJdbcTemplate);
    }

    @Bean
    public DataSourceTransactionManager authTransactionManager(DataSource authDataSource) {
        return new DataSourceTransactionManager(authDataSource);
    }

    @Bean
    public TransactionTemplate authTransactionTemplate(DataSourceTransactionManager authTransactionManager) {
        return new TransactionTemplate(authTransactionManager);
    }

    @Bean
    public OwnerContext ownerContext(
            JdbcTemplate authJdbcTemplate,
            TransactionTemplate authTransactionTemplate) {
        return new OwnerContext(authJdbcTemplate, authTransactionTemplate);
    }

    @Bean
    public AuthService authService(
            IdentityAccountRepository identityAccountRepository,
            IdentityRefreshTokenRepository identityRefreshTokenRepository,
            PasswordEncoder passwordEncoder,
            JwtTokenService jwtTokenService,
            @Value("${virtual-companion.auth.refresh-token-ttl:7d}") Duration refreshTtl) {
        return new AuthService(
                identityAccountRepository,
                identityRefreshTokenRepository,
                passwordEncoder,
                jwtTokenService,
                refreshTtl);
    }

    @Bean
    public AuthController authController(AuthService authService, AuthAbuseGuard authAbuseGuard) {
        return new AuthController(authService, authAbuseGuard);
    }

    @Bean
    public AdminSeedRunner adminSeedRunner(
            AuthService authService,
            @Value("${virtual-companion.auth.admin-seed.username:}") String username,
            @Value("${virtual-companion.auth.admin-seed.password:}") String password,
            @Value("${virtual-companion.auth.admin-seed.display-name:}") String displayName) {
        return new AdminSeedRunner(authService, username, password, displayName);
    }
}
