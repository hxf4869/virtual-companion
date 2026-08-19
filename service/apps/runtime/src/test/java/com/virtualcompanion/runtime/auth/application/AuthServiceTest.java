package com.virtualcompanion.runtime.auth.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.virtualcompanion.platform.persistence.AdminConsoleService;
import com.virtualcompanion.platform.persistence.EntitlementSnapshotService;
import com.virtualcompanion.platform.persistence.IdentityAccountRepository;
import com.virtualcompanion.platform.persistence.IdentityAccountRepository.AuthenticatedIdentity;
import com.virtualcompanion.platform.persistence.IdentityRefreshTokenRepository;
import com.virtualcompanion.platform.persistence.InviteCodeService;
import com.virtualcompanion.platform.persistence.IdentityRefreshTokenRepository.RotatedSession;
import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import com.virtualcompanion.runtime.auth.web.AuthErrorException;
import com.virtualcompanion.runtime.auth.web.AuthInputLimits;
import com.virtualcompanion.runtime.auth.web.AuthRequests.CreateAccountRequest;
import com.virtualcompanion.runtime.auth.web.AuthResponses.AccountResponse;
import com.virtualcompanion.runtime.auth.web.AuthResponses.AuthResponse;
import com.virtualcompanion.runtime.auth.web.AuthResponses.IssuedSession;
import java.time.Duration;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;

class AuthServiceTest {

    private IdentityAccountRepository accounts;
    private IdentityRefreshTokenRepository sessions;
    private PasswordEncoder passwordEncoder;
    private JwtTokenService jwt;
    private AdminConsoleService adminConsole;
    private EntitlementSnapshotService entitlementSnapshotService;
    private InviteCodeService inviteCodes;
    private AuthService service;

    @BeforeEach
    void setUp() {
        accounts = mock(IdentityAccountRepository.class);
        sessions = mock(IdentityRefreshTokenRepository.class);
        passwordEncoder = mock(PasswordEncoder.class);
        jwt = mock(JwtTokenService.class);
        adminConsole = mock(AdminConsoleService.class);
        entitlementSnapshotService = mock(EntitlementSnapshotService.class);
        inviteCodes = mock(InviteCodeService.class);
        when(passwordEncoder.encode(anyString())).thenReturn("$2a$10$dummyhashplaceholder");
        when(jwt.accessTtl()).thenReturn(Duration.ofHours(2));
        when(jwt.issueAccessToken(anyLong(), anyString(), anyString())).thenReturn("access-token");
        service = new AuthService(
                accounts, sessions, passwordEncoder, jwt, Duration.ofDays(7),
                adminConsole, entitlementSnapshotService, inviteCodes);
    }

    @Test
    void loginSuccessIssuesTokensAndAudits() {
        when(accounts.authenticate("alice"))
                .thenReturn(Optional.of(new AuthenticatedIdentity(7, "USER", "ACTIVE", "hash")));
        String rawPassword = "  p w password-sentinel  ";
        when(passwordEncoder.matches(rawPassword, "hash")).thenReturn(true);

        IssuedSession session = service.login("  ALICE  ", rawPassword);
        AuthResponse response = session.response();

        assertThat(response.accessToken()).isEqualTo("access-token");
        assertThat(session.refreshToken()).isNotBlank();
        assertThat(response.tokenType()).isEqualTo("Bearer");
        assertThat(response.accountId()).isEqualTo("7");
        assertThat(response.role()).isEqualTo("USER");
        verify(accounts).recordLoginSuccess(7, "alice");
        verify(passwordEncoder).matches(rawPassword, "hash");
        verify(jwt).issueAccessToken(7L, "USER", "alice");

        // Only the sha256 hash of the returned raw token is persisted.
        ArgumentCaptor<String> hashCaptor = ArgumentCaptor.forClass(String.class);
        verify(sessions).issue(eq(7L), hashCaptor.capture(), any());
        assertThat(hashCaptor.getValue()).isEqualTo(RefreshTokens.sha256Hex(session.refreshToken()));
    }

    @Test
    void wrongPasswordIsIndistinguishableFromUnknownUser() {
        when(accounts.authenticate("alice"))
                .thenReturn(Optional.of(new AuthenticatedIdentity(7, "USER", "ACTIVE", "hash")));
        String rawPassword = "  wrong password-sentinel  ";
        when(passwordEncoder.matches(rawPassword, "hash")).thenReturn(false);

        assertThatThrownBy(() -> service.login("  ALICE  ", rawPassword))
                .isInstanceOf(AuthErrorException.class)
                .satisfies(e -> {
                    assertThat(((AuthErrorException) e).code()).isEqualTo("NOT_FOUND_OR_FORBIDDEN");
                    assertThat(((AuthErrorException) e).status()).isEqualTo(HttpStatus.NOT_FOUND);
                });
        verify(accounts).authenticate("alice");
        verify(accounts).recordLoginFailure("alice");
        verify(passwordEncoder).matches(rawPassword, "hash");
        verify(sessions, never()).issue(anyLong(), anyString(), any());
    }

    @Test
    void unknownUsernameFailsClosedWithoutDisclosingExistence() {
        when(accounts.authenticate("nobody")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.login("nobody", "whatever"))
                .isInstanceOf(AuthErrorException.class)
                .satisfies(e -> assertThat(((AuthErrorException) e).code()).isEqualTo("NOT_FOUND_OR_FORBIDDEN"));
        verify(accounts).recordLoginFailure("nobody");
    }

    @Test
    void disabledAccountLoginFailsClosedToAuthenticationRequired() {
        when(accounts.authenticate("alice"))
                .thenReturn(Optional.of(new AuthenticatedIdentity(7, "USER", "DISABLED", "hash")));
        when(passwordEncoder.matches("pw", "hash")).thenReturn(true);

        assertThatThrownBy(() -> service.login("alice", "pw"))
                .isInstanceOf(AuthErrorException.class)
                .satisfies(e -> {
                    assertThat(((AuthErrorException) e).code()).isEqualTo("AUTHENTICATION_REQUIRED");
                    assertThat(((AuthErrorException) e).status()).isEqualTo(HttpStatus.UNAUTHORIZED);
                });
        verify(accounts).recordLoginFailure("alice");
    }

    @Test
    void refreshRotatesSessionAndReissuesTokens() {
        when(sessions.rotate(anyString(), anyString(), any()))
                .thenReturn(Optional.of(new RotatedSession(7, "USER", "ACTIVE", "  ALICE  ")));

        IssuedSession session = service.refresh("raw-refresh-token");
        AuthResponse response = session.response();

        assertThat(response.accountId()).isEqualTo("7");
        assertThat(response.role()).isEqualTo("USER");
        assertThat(response.accessToken()).isEqualTo("access-token");
        assertThat(session.refreshToken()).isNotBlank();
        verify(jwt).issueAccessToken(7L, "USER", "alice");

        // The old hash is used for lookup, never the raw token.
        ArgumentCaptor<String> oldHash = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> newHash = ArgumentCaptor.forClass(String.class);
        verify(sessions).rotate(oldHash.capture(), newHash.capture(), any());
        assertThat(oldHash.getValue()).isEqualTo(RefreshTokens.sha256Hex("raw-refresh-token"));

        // P1-06: the returned plaintext token is exactly the one whose hash was
        // rotated in, and refresh never creates a second (hidden) session.
        assertThat(newHash.getValue()).isEqualTo(RefreshTokens.sha256Hex(session.refreshToken()));
        verify(sessions, never()).issue(anyLong(), anyString(), any());
    }

    @Test
    void refreshNeverIssuesWhenRotationFails() {
        when(sessions.rotate(anyString(), anyString(), any())).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.refresh("stale-token"))
                .isInstanceOf(AuthErrorException.class)
                .satisfies(e -> {
                    assertThat(((AuthErrorException) e).code()).isEqualTo("AUTHENTICATION_REQUIRED");
                    assertThat(((AuthErrorException) e).status()).isEqualTo(HttpStatus.UNAUTHORIZED);
                });

        // A failed refresh must not leave any hidden session behind (P1-06).
        verify(sessions, never()).issue(anyLong(), anyString(), any());
    }

    @Test
    void refreshAcceptsExact512ByteCookie() {
        String rawToken = "r".repeat(AuthInputLimits.MAX_REFRESH_TOKEN_UTF8_BYTES);
        when(sessions.rotate(anyString(), anyString(), any()))
                .thenReturn(Optional.of(new RotatedSession(7, "USER", "ACTIVE", "alice")));

        service.refresh(rawToken);

        verify(sessions).rotate(eq(RefreshTokens.sha256Hex(rawToken)), anyString(), any());
    }

    @Test
    void refreshRejectsNullBlankAndOneOverCookieBeforeHashOrJdbc() {
        assertInvalidRefresh(null);
        assertInvalidRefresh("");
        assertInvalidRefresh("   ");
        assertInvalidRefresh("r".repeat(AuthInputLimits.MAX_REFRESH_TOKEN_UTF8_BYTES + 1));
    }

    @Test
    void logoutRevokesOnlyTheOwnedSessionHash() {
        service.logout(7, "raw-refresh-token");

        verify(sessions).logout(7, RefreshTokens.sha256Hex("raw-refresh-token"));
    }

    @Test
    void logoutAcceptsExact512ByteCookie() {
        String rawToken = "r".repeat(AuthInputLimits.MAX_REFRESH_TOKEN_UTF8_BYTES);

        service.logout(7, rawToken);

        verify(sessions).logout(7, RefreshTokens.sha256Hex(rawToken));
    }

    @Test
    void logoutRejectsOneOverCookieBeforeHashOrJdbc() {
        String rawToken = "r".repeat(AuthInputLimits.MAX_REFRESH_TOKEN_UTF8_BYTES + 1);
        clearInvocations(accounts, sessions, passwordEncoder, jwt);

        assertThatThrownBy(() -> service.logout(7, rawToken))
                .isInstanceOf(AuthErrorException.class)
                .satisfies(e -> {
                    assertThat(((AuthErrorException) e).code()).isEqualTo("AUTHENTICATION_REQUIRED");
                    assertThat(((AuthErrorException) e).status()).isEqualTo(HttpStatus.UNAUTHORIZED);
                });
        verifyNoInteractions(accounts, sessions, passwordEncoder, jwt);
    }

    @Test
    void logoutIsIdempotentAndNeverThrowsForForeignToken() {
        // The service never discloses whether a token existed; the repository
        // returns false for a foreign/unknown token and the caller still gets ok.
        when(sessions.logout(anyLong(), anyString())).thenReturn(false);
        assertThat(service.logout(7, "foreign-token").ok()).isTrue();
        assertThat(service.logout(7, "foreign-token").ok()).isTrue();
        verify(sessions, org.mockito.Mockito.times(2)).logout(7, RefreshTokens.sha256Hex("foreign-token"));
    }

    @Test
    void adminCreatesAccountWithBcryptHashNormalizedUsernameAndDefaultRole() {
        JwtTokenService.Principal admin = new JwtTokenService.Principal(1, "ADMIN", "root");
        when(accounts.createAccount(eq(1L), eq("bob"), anyString(), eq("USER"), eq("Bob User")))
                .thenReturn(42L);

        AccountResponse response = service.createAccount(
                admin, new CreateAccountRequest("  Bob  ", "Str0ng!Pw", null, "  Bob User  "));

        assertThat(response.accountId()).isEqualTo("42");
        assertThat(response.username()).isEqualTo("bob");
        assertThat(response.role()).isEqualTo("USER");
        assertThat(response.status()).isEqualTo("ACTIVE");
        verify(passwordEncoder).encode("Str0ng!Pw");
    }

    @Test
    void adminCreatesAdminAccountWhenRoleExplicit() {
        JwtTokenService.Principal admin = new JwtTokenService.Principal(1, "ADMIN", "root");
        when(accounts.createAccount(eq(1L), eq("ops"), anyString(), eq("ADMIN"), eq("Ops")))
                .thenReturn(43L);

        AccountResponse response = service.createAccount(
                admin, new CreateAccountRequest("  Ops  ", "Str0ng!Pw", "admin", "  Ops  "));

        assertThat(response.role()).isEqualTo("ADMIN");
    }

    // ---- ADMIN-ACCTS (V31): registry list + disable ----

    @Test
    void adminListsTheAccountRegistry() {
        JwtTokenService.Principal admin = new JwtTokenService.Principal(1, "ADMIN", "root");
        java.time.Instant created = java.time.Instant.parse("2026-08-16T08:00:00Z");
        when(accounts.listAccounts(1L)).thenReturn(java.util.List.of(
                new IdentityAccountRepository.AccountRecord(1L, "root", "ADMIN", "ACTIVE", "Root", created),
                new IdentityAccountRepository.AccountRecord(7L, "alice", "USER", "DISABLED", "Alice", created)));

        var list = service.listAccounts(admin);

        assertThat(list).hasSize(2);
        assertThat(list.get(0).accountId()).isEqualTo("1");
        assertThat(list.get(0).status()).isEqualTo("ACTIVE");
        assertThat(list.get(1).accountId()).isEqualTo("7");
        assertThat(list.get(1).status()).isEqualTo("DISABLED");
        // The registry never carries a password hash.
        assertThat(list.get(0).displayName()).isEqualTo("Root");
    }

    @Test
    void nonAdminCannotListAccounts() {
        JwtTokenService.Principal user = new JwtTokenService.Principal(7, "USER", "alice");

        assertThatThrownBy(() -> service.listAccounts(user))
                .isInstanceOf(AuthErrorException.class)
                .satisfies(e -> assertThat(((AuthErrorException) e).code()).isEqualTo("ACCESS_DENIED"));
        verify(accounts, never()).listAccounts(anyLong());
    }

    @Test
    void adminDisablesAnAccount() {
        JwtTokenService.Principal admin = new JwtTokenService.Principal(1, "ADMIN", "root");
        when(accounts.disableAccount(1L, 7L)).thenReturn(true);

        var response = service.disableAccount(admin, 7L);

        assertThat(response.accountId()).isEqualTo("7");
        assertThat(response.status()).isEqualTo("DISABLED");
        verify(accounts).disableAccount(1L, 7L);
    }

    @Test
    void nonAdminCannotDisableAccounts() {
        JwtTokenService.Principal user = new JwtTokenService.Principal(7, "USER", "alice");

        assertThatThrownBy(() -> service.disableAccount(user, 1L))
                .isInstanceOf(AuthErrorException.class)
                .satisfies(e -> assertThat(((AuthErrorException) e).code()).isEqualTo("ACCESS_DENIED"));
        verify(accounts, never()).disableAccount(anyLong(), anyLong());
    }

    // ---- ACCT-DELETE (V43, FR-AUTH-004): self-service deletion ----

    @Test
    void accountOwnerDeletesOwnAccount() {
        when(accounts.deleteAccount(7L)).thenReturn(true);

        var response = service.deleteAccount(7L);

        assertThat(response.ok()).isTrue();
        verify(accounts).deleteAccount(7L);
    }

    @Test
    void deleteAccountRejectsNonPositiveId() {
        assertThatThrownBy(() -> service.deleteAccount(0L))
                .isInstanceOf(AuthErrorException.class)
                .satisfies(e -> {
                    assertThat(((AuthErrorException) e).code()).isEqualTo("INVALID_REQUEST");
                    assertThat(((AuthErrorException) e).status()).isEqualTo(HttpStatus.BAD_REQUEST);
                });
        verify(accounts, never()).deleteAccount(anyLong());
    }

    @Test
    void deleteAccountFailsClosedWhenTheSdReportsFalse() {
        when(accounts.deleteAccount(7L)).thenReturn(false);

        assertThatThrownBy(() -> service.deleteAccount(7L))
                .isInstanceOf(AuthErrorException.class)
                .satisfies(e -> {
                    assertThat(((AuthErrorException) e).code()).isEqualTo("NOT_FOUND_OR_FORBIDDEN");
                    assertThat(((AuthErrorException) e).status()).isEqualTo(HttpStatus.NOT_FOUND);
                });
    }

    @Test
    void deleteAccountFailsClosedOnDatabaseErrors() {
        when(accounts.deleteAccount(7L))
                .thenThrow(new DataIntegrityViolationException("boom"));

        assertThatThrownBy(() -> service.deleteAccount(7L))
                .isInstanceOf(AuthErrorException.class)
                .satisfies(e -> assertThat(((AuthErrorException) e).code()).isEqualTo("NOT_FOUND_OR_FORBIDDEN"));
    }

    @Test
    void disableAccountRejectsNonPositiveTarget() {
        JwtTokenService.Principal admin = new JwtTokenService.Principal(1, "ADMIN", "root");

        assertThatThrownBy(() -> service.disableAccount(admin, 0L))
                .isInstanceOf(AuthErrorException.class)
                .satisfies(e -> {
                    assertThat(((AuthErrorException) e).code()).isEqualTo("INVALID_REQUEST");
                    assertThat(((AuthErrorException) e).status()).isEqualTo(HttpStatus.BAD_REQUEST);
                });
        verify(accounts, never()).disableAccount(anyLong(), anyLong());
    }

    // ---- ADMIN-OPS (V36): audit list + usage summary ----

    @Test
    void adminListsAuditEventsThroughTheConsole() {
        JwtTokenService.Principal admin = new JwtTokenService.Principal(1, "ADMIN", "root");
        java.time.Instant occurred = java.time.Instant.parse("2026-08-16T08:00:00Z");
        when(adminConsole.listAuditEvents(1L, 500L, 50)).thenReturn(java.util.List.of(
                new com.virtualcompanion.platform.persistence.AuditEventRecord(
                        500L, "ACCOUNT_CREATE", 7L, "alice", occurred)));

        var events = service.listAuditEvents(admin, 500L, 50);

        assertThat(events).hasSize(1);
        assertThat(events.get(0).eventType()).isEqualTo("ACCOUNT_CREATE");
        assertThat(events.get(0).accountId()).isEqualTo(7L);
        verify(adminConsole).listAuditEvents(1L, 500L, 50);
    }

    @Test
    void nonAdminCannotListAuditEvents() {
        JwtTokenService.Principal user = new JwtTokenService.Principal(7, "USER", "alice");

        assertThatThrownBy(() -> service.listAuditEvents(user, null, 50))
                .isInstanceOf(AuthErrorException.class)
                .satisfies(e -> assertThat(((AuthErrorException) e).code()).isEqualTo("ACCESS_DENIED"));
        verifyNoInteractions(adminConsole);
    }

    @Test
    void adminReadsUsageSummaryThroughTheConsole() {
        JwtTokenService.Principal admin = new JwtTokenService.Principal(1, "ADMIN", "root");
        when(adminConsole.usageSummary(1L, 14)).thenReturn(java.util.List.of(
                new com.virtualcompanion.platform.persistence.UsageSummaryRecord(
                        java.time.LocalDate.parse("2026-08-16"), 3L, 1200L, 800L,
                        new java.math.BigDecimal("0.012"))));

        var rows = service.usageSummary(admin, 14);

        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).generations()).isEqualTo(3L);
        assertThat(rows.get(0).inputTokens()).isEqualTo(1200L);
        verify(adminConsole).usageSummary(1L, 14);
    }

    @Test
    void nonAdminCannotReadUsageSummary() {
        JwtTokenService.Principal user = new JwtTokenService.Principal(7, "USER", "alice");

        assertThatThrownBy(() -> service.usageSummary(user, 14))
                .isInstanceOf(AuthErrorException.class)
                .satisfies(e -> assertThat(((AuthErrorException) e).code()).isEqualTo("ACCESS_DENIED"));
        verifyNoInteractions(adminConsole);
    }

    // ---- ENT-SNAP (V40): service-class assignment ----

    @Test
    void adminAssignsAServiceClass() {
        JwtTokenService.Principal admin = new JwtTokenService.Principal(1, "ADMIN", "root");
        when(entitlementSnapshotService.assign(1L, 7L, "PREMIUM")).thenReturn(true);

        assertThat(service.assignServiceClass(admin, 7L, "PREMIUM")).isTrue();
        verify(entitlementSnapshotService).assign(1L, 7L, "PREMIUM");
    }

    @Test
    void assignRejectsUnapprovedClassesEagerly() {
        JwtTokenService.Principal admin = new JwtTokenService.Principal(1, "ADMIN", "root");

        assertThatThrownBy(() -> service.assignServiceClass(admin, 7L, "PLATINUM"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void nonAdminCannotAssignServiceClasses() {
        JwtTokenService.Principal user = new JwtTokenService.Principal(7, "USER", "alice");

        assertThatThrownBy(() -> service.assignServiceClass(user, 1L, "ECONOMY"))
                .isInstanceOf(AuthErrorException.class)
                .satisfies(e -> assertThat(((AuthErrorException) e).code()).isEqualTo("ACCESS_DENIED"));
        verifyNoInteractions(entitlementSnapshotService);
    }

    @Test
    void adminListsServiceClassAssignments() {
        JwtTokenService.Principal admin = new JwtTokenService.Principal(1, "ADMIN", "root");
        when(entitlementSnapshotService.listAssignments(1L)).thenReturn(java.util.List.of(
                new EntitlementSnapshotService.ServiceClassAssignment(
                        7L, "alice", "ECONOMY", null, null)));

        var rows = service.listServiceClassAssignments(admin);

        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).username()).isEqualTo("alice");
        assertThat(rows.get(0).serviceClass()).isEqualTo("ECONOMY");
    }

    @Test
    void nonAdminCannotCreateAccounts() {
        JwtTokenService.Principal user = new JwtTokenService.Principal(7, "USER", "alice");

        assertThatThrownBy(() -> service.createAccount(
                        user, new CreateAccountRequest("Bob", "pw", "USER", "Bob")))
                .isInstanceOf(AuthErrorException.class)
                .satisfies(e -> {
                    assertThat(((AuthErrorException) e).code()).isEqualTo("ACCESS_DENIED");
                    assertThat(((AuthErrorException) e).status()).isEqualTo(HttpStatus.FORBIDDEN);
                });
        verify(accounts, never()).createAccount(anyLong(), anyString(), anyString(), anyString(), anyString());
    }

    @Test
    void duplicateUsernameMapsToGenericNonDisclosingError() {
        JwtTokenService.Principal admin = new JwtTokenService.Principal(1, "ADMIN", "root");
        when(accounts.createAccount(anyLong(), anyString(), anyString(), anyString(), anyString()))
                .thenThrow(new DataIntegrityViolationException("duplicate key"));

        assertThatThrownBy(() -> service.createAccount(
                        admin, new CreateAccountRequest("Bob", "Str0ng!Pw", "USER", "Bob")))
                .isInstanceOf(AuthErrorException.class)
                .satisfies(e -> assertThat(((AuthErrorException) e).code()).isEqualTo("NOT_FOUND_OR_FORBIDDEN"));
    }

    @Test
    void invalidRoleFailsClosed() {
        JwtTokenService.Principal admin = new JwtTokenService.Principal(1, "ADMIN", "root");

        assertThatThrownBy(() -> service.createAccount(
                        admin, new CreateAccountRequest("Bob", "Str0ng!Pw", "SUPERUSER", "Bob")))
                .isInstanceOf(AuthErrorException.class)
                .satisfies(e -> {
                    assertThat(((AuthErrorException) e).code()).isEqualTo("INVALID_REQUEST");
                    assertThat(((AuthErrorException) e).status()).isEqualTo(HttpStatus.BAD_REQUEST);
                });
        verify(accounts, never()).createAccount(anyLong(), anyString(), anyString(), anyString(), anyString());
    }

    @Test
    void directLoginValidationFailsClosedBeforeRepositoryOrPasswordCheck() {
        assertInvalidLogin(null, "pw");
        assertInvalidLogin("alice", null);
        assertInvalidLogin("   ", "pw");
        assertInvalidLogin("alice", "   ");
        assertInvalidLogin("u".repeat(129), "pw");
        assertInvalidLogin("alice", "p".repeat(1025));
        assertInvalidLogin(
                "u".repeat(AuthInputLimits.MAX_USERNAME_UTF8_BYTES + 1), "pw");
        assertInvalidLogin(
                "alice", "p".repeat(AuthInputLimits.MAX_PASSWORD_UTF8_BYTES + 1));
    }

    @Test
    void directAccountValidationFailsClosedBeforeRepositoryOrPasswordEncoder() {
        JwtTokenService.Principal admin = new JwtTokenService.Principal(1, "ADMIN", "root");
        assertInvalidAccount(admin, null);
        assertInvalidAccount(admin, new CreateAccountRequest(null, "pw", "USER", "User"));
        assertInvalidAccount(admin, new CreateAccountRequest("bob", null, "USER", "User"));
        assertInvalidAccount(admin, new CreateAccountRequest("bob", "pw", "USER", null));
        assertInvalidAccount(admin, new CreateAccountRequest("", "pw", "USER", "User"));
        assertInvalidAccount(admin, new CreateAccountRequest("bob", "   ", "USER", "User"));
        assertInvalidAccount(admin, new CreateAccountRequest("bob", "pw", "USER", "   "));
        assertInvalidAccount(admin, new CreateAccountRequest("u".repeat(129), "pw", "USER", "User"));
        assertInvalidAccount(admin, new CreateAccountRequest("bob", "p".repeat(1025), "USER", "User"));
        assertInvalidAccount(admin, new CreateAccountRequest("bob", "pw", "r".repeat(17), "User"));
        assertInvalidAccount(admin, new CreateAccountRequest("bob", "pw", "USER", "d".repeat(257)));
        assertInvalidAccount(admin, new CreateAccountRequest("bob", "pw", "", "User"));
        assertInvalidAccount(admin, new CreateAccountRequest("bob", "pw", "MANAGER", "User"));
        assertInvalidAccount(admin, new CreateAccountRequest(
                "u".repeat(AuthInputLimits.MAX_USERNAME_UTF8_BYTES + 1), "pw", "USER", "User"));
        assertInvalidAccount(admin, new CreateAccountRequest(
                "bob", "p".repeat(AuthInputLimits.MAX_PASSWORD_UTF8_BYTES + 1), "USER", "User"));
        assertInvalidAccount(admin, new CreateAccountRequest(
                "bob", "pw", "r".repeat(AuthInputLimits.MAX_ROLE_UTF8_BYTES + 1), "User"));
        assertInvalidAccount(admin, new CreateAccountRequest(
                "bob", "pw", "USER",
                "d".repeat(AuthInputLimits.MAX_DISPLAY_NAME_UTF8_BYTES + 1)));
    }

    @Test
    void seedAdminByteValidationFailsBeforeBcryptOrJdbc() {
        assertInvalidSeed(
                "u".repeat(AuthInputLimits.MAX_USERNAME_UTF8_BYTES + 1), "pw", "Display");
        assertInvalidSeed(
                "root", "p".repeat(AuthInputLimits.MAX_PASSWORD_UTF8_BYTES + 1), "Display");
        assertInvalidSeed(
                "root", "pw", "d".repeat(AuthInputLimits.MAX_DISPLAY_NAME_UTF8_BYTES + 1));
    }

    @Test
    void malformedUtf16FailsBeforeHashingBcryptRepositoryOrJdbc() {
        JwtTokenService.Principal admin = new JwtTokenService.Principal(1, "ADMIN", "root");
        for (String malformed : new String[] {"\uD800", "\uDC00"}) {
            assertInvalidLogin(malformed, "pw");
            assertInvalidLogin("alice", malformed);
            assertInvalidAccount(admin,
                    new CreateAccountRequest(malformed, "pw", "USER", "User"));
            assertInvalidAccount(admin,
                    new CreateAccountRequest("bob", malformed, "USER", "User"));
            assertInvalidAccount(admin,
                    new CreateAccountRequest("bob", "pw", malformed, "User"));
            assertInvalidAccount(admin,
                    new CreateAccountRequest("bob", "pw", "USER", malformed));
            assertInvalidRefresh(malformed);
            assertInvalidLogout(malformed);
            assertInvalidSeed(malformed, "pw", "Display");
            assertInvalidSeed("root", malformed, "Display");
            assertInvalidSeed("root", "pw", malformed);
        }
    }

    @Test
    void seedAdminIsSkippedWhenCredentialsAbsent() {
        long id = service.seedAdmin("   ", "pw", "Name");

        assertThat(id).isZero();
        verify(accounts, never()).seedAdmin(anyString(), anyString(), anyString());
    }

    @Test
    void seedAdminHashesPasswordBeforePersisting() {
        when(accounts.seedAdmin(eq("root"), anyString(), eq("Root Admin"))).thenReturn(9L);

        long id = service.seedAdmin("  ROOT  ", "Str0ng!Pw", "  Root Admin  ");

        assertThat(id).isEqualTo(9);
        verify(passwordEncoder).encode("Str0ng!Pw");
    }

    @Test
    void createAccountRejectsPasswordBelowMinimumLength() {
        JwtTokenService.Principal admin = new JwtTokenService.Principal(1, "ADMIN", "root");
        // 7 chars but otherwise all four classes present -> too short
        assertInvalidAccount(admin, new CreateAccountRequest("bob", "Str0ng!", null, "Bob"));
    }

    @Test
    void createAccountRejectsPasswordMissingEachComplexityClass() {
        JwtTokenService.Principal admin = new JwtTokenService.Principal(1, "ADMIN", "root");
        assertInvalidAccount(admin, new CreateAccountRequest("bob", "str0ng!pw", null, "Bob")); // no uppercase
        assertInvalidAccount(admin, new CreateAccountRequest("bob", "STR0NG!PW", null, "Bob")); // no lowercase
        assertInvalidAccount(admin, new CreateAccountRequest("bob", "Strong!pw", null, "Bob")); // no digit
        assertInvalidAccount(admin, new CreateAccountRequest("bob", "Str0ngPw", null, "Bob"));  // no symbol
    }

    @Test
    void seedAdminRejectsPasswordBelowMinimumPolicy() {
        assertInvalidSeed("root", "Str0ng!", "Root Admin");   // too short
        assertInvalidSeed("root", "str0ng!pw", "Root Admin"); // no uppercase
        assertInvalidSeed("root", "STR0NG!PW", "Root Admin"); // no lowercase
        assertInvalidSeed("root", "Strong!pw", "Root Admin"); // no digit
        assertInvalidSeed("root", "Str0ngPw", "Root Admin");  // no symbol
    }

    private void assertInvalidLogin(String username, String password) {
        clearInvocations(accounts, sessions, passwordEncoder, jwt);

        assertThatThrownBy(() -> service.login(username, password))
                .isInstanceOf(AuthErrorException.class)
                .satisfies(e -> {
                    assertThat(((AuthErrorException) e).code()).isEqualTo("INVALID_REQUEST");
                    assertThat(((AuthErrorException) e).status()).isEqualTo(HttpStatus.BAD_REQUEST);
                });

        verifyNoInteractions(accounts, sessions, passwordEncoder, jwt);
    }

    private void assertInvalidAccount(
            JwtTokenService.Principal admin, CreateAccountRequest request) {
        clearInvocations(accounts, sessions, passwordEncoder, jwt);

        assertThatThrownBy(() -> service.createAccount(admin, request))
                .isInstanceOf(AuthErrorException.class)
                .satisfies(e -> {
                    assertThat(((AuthErrorException) e).code()).isEqualTo("INVALID_REQUEST");
                    assertThat(((AuthErrorException) e).status()).isEqualTo(HttpStatus.BAD_REQUEST);
                });

        verifyNoInteractions(accounts, sessions, passwordEncoder, jwt);
    }

    private void assertInvalidRefresh(String refreshToken) {
        clearInvocations(accounts, sessions, passwordEncoder, jwt);

        assertThatThrownBy(() -> service.refresh(refreshToken))
                .isInstanceOf(AuthErrorException.class)
                .satisfies(e -> {
                    assertThat(((AuthErrorException) e).code()).isEqualTo("AUTHENTICATION_REQUIRED");
                    assertThat(((AuthErrorException) e).status()).isEqualTo(HttpStatus.UNAUTHORIZED);
                });

        verifyNoInteractions(accounts, sessions, passwordEncoder, jwt);
    }

    private void assertInvalidLogout(String refreshToken) {
        clearInvocations(accounts, sessions, passwordEncoder, jwt);

        assertThatThrownBy(() -> service.logout(7, refreshToken))
                .isInstanceOf(AuthErrorException.class)
                .satisfies(e -> {
                    assertThat(((AuthErrorException) e).code())
                            .isEqualTo("AUTHENTICATION_REQUIRED");
                    assertThat(((AuthErrorException) e).status())
                            .isEqualTo(HttpStatus.UNAUTHORIZED);
                });

        verifyNoInteractions(accounts, sessions, passwordEncoder, jwt);
    }

    private void assertInvalidSeed(String username, String password, String displayName) {
        clearInvocations(accounts, sessions, passwordEncoder, jwt);

        assertThatThrownBy(() -> service.seedAdmin(username, password, displayName))
                .isInstanceOf(AuthErrorException.class)
                .satisfies(e -> {
                    assertThat(((AuthErrorException) e).code()).isEqualTo("INVALID_REQUEST");
                    assertThat(((AuthErrorException) e).status()).isEqualTo(HttpStatus.BAD_REQUEST);
                });

        verifyNoInteractions(accounts, sessions, passwordEncoder, jwt);
    }
}
