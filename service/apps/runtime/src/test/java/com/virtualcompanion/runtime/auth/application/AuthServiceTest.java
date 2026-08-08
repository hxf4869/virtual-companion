package com.virtualcompanion.runtime.auth.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.virtualcompanion.platform.persistence.IdentityAccountRepository;
import com.virtualcompanion.platform.persistence.IdentityAccountRepository.AuthenticatedIdentity;
import com.virtualcompanion.platform.persistence.IdentityRefreshTokenRepository;
import com.virtualcompanion.platform.persistence.IdentityRefreshTokenRepository.RotatedSession;
import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import com.virtualcompanion.runtime.auth.web.AuthErrorException;
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
    private AuthService service;

    @BeforeEach
    void setUp() {
        accounts = mock(IdentityAccountRepository.class);
        sessions = mock(IdentityRefreshTokenRepository.class);
        passwordEncoder = mock(PasswordEncoder.class);
        jwt = mock(JwtTokenService.class);
        when(passwordEncoder.encode(anyString())).thenReturn("$2a$10$dummyhashplaceholder");
        when(jwt.accessTtl()).thenReturn(Duration.ofHours(2));
        when(jwt.issueAccessToken(anyLong(), anyString(), anyString())).thenReturn("access-token");
        service = new AuthService(accounts, sessions, passwordEncoder, jwt, Duration.ofDays(7));
    }

    @Test
    void loginSuccessIssuesTokensAndAudits() {
        when(accounts.authenticate("alice"))
                .thenReturn(Optional.of(new AuthenticatedIdentity(7, "USER", "ACTIVE", "hash")));
        when(passwordEncoder.matches("pw", "hash")).thenReturn(true);

        IssuedSession session = service.login("alice", "pw");
        AuthResponse response = session.response();

        assertThat(response.accessToken()).isEqualTo("access-token");
        assertThat(session.refreshToken()).isNotBlank();
        assertThat(response.tokenType()).isEqualTo("Bearer");
        assertThat(response.accountId()).isEqualTo("7");
        assertThat(response.role()).isEqualTo("USER");
        verify(accounts).recordLoginSuccess(7, "alice");

        // Only the sha256 hash of the returned raw token is persisted.
        ArgumentCaptor<String> hashCaptor = ArgumentCaptor.forClass(String.class);
        verify(sessions).issue(eq(7L), hashCaptor.capture(), any());
        assertThat(hashCaptor.getValue()).isEqualTo(RefreshTokens.sha256Hex(session.refreshToken()));
    }

    @Test
    void wrongPasswordIsIndistinguishableFromUnknownUser() {
        when(accounts.authenticate("alice"))
                .thenReturn(Optional.of(new AuthenticatedIdentity(7, "USER", "ACTIVE", "hash")));
        when(passwordEncoder.matches("wrong", "hash")).thenReturn(false);

        assertThatThrownBy(() -> service.login("alice", "wrong"))
                .isInstanceOf(AuthErrorException.class)
                .satisfies(e -> {
                    assertThat(((AuthErrorException) e).code()).isEqualTo("NOT_FOUND_OR_FORBIDDEN");
                    assertThat(((AuthErrorException) e).status()).isEqualTo(HttpStatus.NOT_FOUND);
                });
        verify(accounts).recordLoginFailure("alice");
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
                .thenReturn(Optional.of(new RotatedSession(7, "USER", "ACTIVE", "alice")));

        IssuedSession session = service.refresh("raw-refresh-token");
        AuthResponse response = session.response();

        assertThat(response.accountId()).isEqualTo("7");
        assertThat(response.role()).isEqualTo("USER");
        assertThat(response.accessToken()).isEqualTo("access-token");
        assertThat(session.refreshToken()).isNotBlank();

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
    void logoutRevokesOnlyTheOwnedSessionHash() {
        service.logout(7, "raw-refresh-token");

        verify(sessions).logout(7, RefreshTokens.sha256Hex("raw-refresh-token"));
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
    void adminCreatesAccountWithBcryptHashAndNormalizedUsername() {
        JwtTokenService.Principal admin = new JwtTokenService.Principal(1, "ADMIN", "root");
        // The raw (unnormalized) username is passed to the repository; the V14
        // function normalizes it to lowercase.
        when(accounts.createAccount(eq(1L), eq("Bob"), anyString(), eq("USER"), eq("Bob User")))
                .thenReturn(42L);

        AccountResponse response = service.createAccount(
                admin, new CreateAccountRequest("Bob", "s3cret", "USER", "Bob User"));

        assertThat(response.accountId()).isEqualTo("42");
        assertThat(response.username()).isEqualTo("bob");
        assertThat(response.role()).isEqualTo("USER");
        assertThat(response.status()).isEqualTo("ACTIVE");
        verify(passwordEncoder).encode("s3cret");
    }

    @Test
    void adminCreatesAdminAccountWhenRoleExplicit() {
        JwtTokenService.Principal admin = new JwtTokenService.Principal(1, "ADMIN", "root");
        when(accounts.createAccount(eq(1L), eq("Ops"), anyString(), eq("ADMIN"), eq("Ops")))
                .thenReturn(43L);

        AccountResponse response = service.createAccount(
                admin, new CreateAccountRequest("Ops", "pw", "admin", "Ops"));

        assertThat(response.role()).isEqualTo("ADMIN");
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
                        admin, new CreateAccountRequest("Bob", "pw", "USER", "Bob")))
                .isInstanceOf(AuthErrorException.class)
                .satisfies(e -> assertThat(((AuthErrorException) e).code()).isEqualTo("NOT_FOUND_OR_FORBIDDEN"));
    }

    @Test
    void invalidRoleFailsClosed() {
        JwtTokenService.Principal admin = new JwtTokenService.Principal(1, "ADMIN", "root");

        assertThatThrownBy(() -> service.createAccount(
                        admin, new CreateAccountRequest("Bob", "pw", "SUPERUSER", "Bob")))
                .isInstanceOf(AuthErrorException.class)
                .satisfies(e -> assertThat(((AuthErrorException) e).code()).isEqualTo("NOT_FOUND_OR_FORBIDDEN"));
        verify(accounts, never()).createAccount(anyLong(), anyString(), anyString(), anyString(), anyString());
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

        long id = service.seedAdmin("root", "secret", "Root Admin");

        assertThat(id).isEqualTo(9);
        verify(passwordEncoder).encode("secret");
    }
}
