package com.virtualcompanion.runtime.auth.config;

import com.virtualcompanion.runtime.auth.application.AuthAbuseGuard;
import com.virtualcompanion.runtime.auth.jwt.JwtAuthenticationFilter;
import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import com.virtualcompanion.runtime.auth.tenant.OwnerContext;
import com.virtualcompanion.runtime.auth.tenant.OwnerInjectionFilter;
import java.time.Duration;
import java.util.List;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

/**
 * Spring Security wiring for the self-hosted identity component. Active only
 * when {@code virtual-companion.auth.enabled=true} (the default context stays
 * database- and secret-free for tests/baseline). Policy:
 *
 * <ul>
 *   <li>Hybrid session: the refresh token lives in the HttpOnly
 *       {@code vc_refresh} cookie, the access token stays a stateless Bearer
 *       token. State-changing requests that carry the session cookies must
 *       pass the {@link CookieCsrfGuardFilter} (double-submit CSRF token +
 *       Origin allow-list); Bearer-only requests without cookies are not
 *       CSRF-bound.</li>
 *   <li>{@code POST /api/v1/auth/login} and {@code /api/v1/auth/refresh} are
 *       public; {@code GET /api/v1/version} is public (OpenAPI
 *       {@code security: []}); {@code GET /api/internal/baseline} is public
 *       (P1-08, Owner decision 2026-08-08); the health endpoint stays public;
 *       every other
 *       route requires a valid Bearer token, and an unauthenticated request is
 *       answered with {@code 401 AUTHENTICATION_REQUIRED} (never an existence
 *       hint).</li>
 *   <li>Passwords are hashed with Spring Security's BCrypt encoder (no
 *       self-written crypto).</li>
 * </ul>
 */
@Configuration
@ConditionalOnProperty(name = "virtual-companion.auth.enabled", havingValue = "true")
public class AuthSecurityConfig {

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public JwtTokenService jwtTokenService(
            @Value("${virtual-companion.auth.jwt-secret:}") String secret,
            @Value("${virtual-companion.auth.access-token-ttl:2h}") Duration accessTtl,
            @Value("${virtual-companion.auth.issuer:virtual-companion}") String issuer) {
        return new JwtTokenService(secret, accessTtl, issuer);
    }

    @Bean
    public JwtAuthenticationFilter jwtAuthenticationFilter(JwtTokenService jwtTokenService) {
        return new JwtAuthenticationFilter(jwtTokenService);
    }

    /**
     * P1-04 owner injector (TASK-0168). Registered after {@link JwtAuthenticationFilter}
     * so the server-verified principal's accountId is bound to the
     * {@code vc.owner_user_id} GUC before any FORCE-RLS business query. Uses an
     * {@link ObjectProvider} so the filter bean exists even when the
     * DataSource is disabled (it then no-ops), keeping the database-free
     * test/baseline context starting cleanly.
     */
    @Bean
    public OwnerInjectionFilter ownerInjectionFilter(ObjectProvider<OwnerContext> ownerContext) {
        return new OwnerInjectionFilter(ownerContext);
    }

    @Bean
    public AuthAbuseGuard authAbuseGuard() {
        return new AuthAbuseGuard();
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource(
            @Value("${virtual-companion.auth.cors-allowed-origins:}") List<String> allowedOrigins) {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOrigins(allowedOrigins);
        config.setAllowedMethods(List.of("GET", "POST", "PATCH", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("Authorization", "Content-Type", CookieCsrfGuardFilter.CSRF_HEADER));
        config.setAllowCredentials(false);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return source;
    }

    @Bean
    public SecurityFilterChain securityFilterChain(
            HttpSecurity http,
            @Value("${virtual-companion.auth.cors-allowed-origins:}") List<String> allowedOrigins,
            AuthAbuseGuard authAbuseGuard,
            JwtAuthenticationFilter jwtAuthenticationFilter,
            OwnerInjectionFilter ownerInjectionFilter) throws Exception {
        CookieCsrfGuardFilter cookieCsrfGuardFilter = new CookieCsrfGuardFilter(allowedOrigins);
        AuthSourceAdmissionFilter authSourceAdmissionFilter =
                new AuthSourceAdmissionFilter(authAbuseGuard);
        AuthRequestBodyLimitFilter authRequestBodyLimitFilter = new AuthRequestBodyLimitFilter();
        http
                .csrf(AbstractHttpConfigurer::disable)
                .cors(Customizer.withDefaults())
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/api/v1/auth/login", "/api/v1/auth/refresh").permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/v1/version").permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/internal/baseline").permitAll()
                        .requestMatchers("/actuator/health").permitAll()
                        .anyRequest().authenticated())
                .exceptionHandling(ex -> ex.authenticationEntryPoint(
                        (request, response, authException) -> {
                            response.setStatus(org.springframework.http.HttpStatus.UNAUTHORIZED.value());
                            response.setCharacterEncoding("UTF-8");
                            response.setContentType("application/json");
                            response.getWriter().write(
                                    "{\"code\":\"AUTHENTICATION_REQUIRED\","
                                            + "\"message\":\"A valid bearer token is required\"}");
                        }))
                .addFilterBefore(jwtAuthenticationFilter, UsernamePasswordAuthenticationFilter.class)
                .addFilterAfter(ownerInjectionFilter, JwtAuthenticationFilter.class)
                .addFilterBefore(authRequestBodyLimitFilter, JwtAuthenticationFilter.class)
                .addFilterBefore(authSourceAdmissionFilter, AuthRequestBodyLimitFilter.class)
                .addFilterBefore(cookieCsrfGuardFilter, AuthSourceAdmissionFilter.class);
        return http.build();
    }
}
