package com.virtualcompanion.runtime.web;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.virtualcompanion.platform.persistence.IdentityAccountRepository;
import com.virtualcompanion.platform.persistence.IdentityAccountRepository.AuthenticatedIdentity;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.password.PasswordEncoder;

/**
 * ADR-0006 §7.7 (DOGFOOD-08): unit tests for the shared current-password
 * gate used by the export/consent slices — correct/wrong/blank passwords,
 * principal binding, and the timing-equalized unknown-account path that
 * never separates "wrong password" from "account gone".
 */
class CurrentPasswordGuardTest {

    private IdentityAccountRepository accounts;
    private PasswordEncoder passwordEncoder;
    private CurrentPasswordGuard guard;

    @BeforeEach
    void setUp() {
        accounts = mock(IdentityAccountRepository.class);
        passwordEncoder = mock(PasswordEncoder.class);
        when(passwordEncoder.encode(anyString())).thenReturn("$2a$10$dummyhashplaceholder");
        guard = new CurrentPasswordGuard(accounts, passwordEncoder);
    }

    @Test
    void acceptsTheMatchingPasswordOfTheActivePrincipalAccount() {
        when(accounts.authenticate("alice"))
                .thenReturn(Optional.of(new AuthenticatedIdentity(7, "USER", "ACTIVE", "hash")));
        when(passwordEncoder.matches("Current-Pass-1!", "hash")).thenReturn(true);

        assertThatCode(() -> guard.assertCurrentPassword(7, "alice", "Current-Pass-1!"))
                .doesNotThrowAnyException();
        verify(passwordEncoder).matches("Current-Pass-1!", "hash");
    }

    @Test
    void wrongPasswordMapsToTheNonDisclosingMismatchException() {
        when(accounts.authenticate("alice"))
                .thenReturn(Optional.of(new AuthenticatedIdentity(7, "USER", "ACTIVE", "hash")));
        when(passwordEncoder.matches("wrong", "hash")).thenReturn(false);

        assertThatThrownBy(() -> guard.assertCurrentPassword(7, "alice", "wrong"))
                .isInstanceOf(CurrentPasswordMismatchException.class)
                .hasMessageNotContaining("password is wrong");
    }

    @Test
    void blankOrNullPasswordIsAnInvalidRequestBeforeAnyLookup() {
        for (String blank : new String[] {null, "", "   "}) {
            assertThatThrownBy(() -> guard.assertCurrentPassword(7, "alice", blank))
                    .isInstanceOf(IllegalArgumentException.class);
        }
        verifyNoInteractions(accounts);
        verify(passwordEncoder, never()).matches(anyString(), anyString());
    }

    @Test
    void unknownAccountStillRunsTheDummyCompareAndNeverDisclosesExistence() {
        when(accounts.authenticate("alice")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> guard.assertCurrentPassword(7, "alice", "Current-Pass-1!"))
                .isInstanceOf(CurrentPasswordMismatchException.class);
        // Timing equalization: the absent identity still pays one real
        // BCrypt compare against the constructor's dummy hash.
        verify(passwordEncoder).matches("Current-Pass-1!", "$2a$10$dummyhashplaceholder");
    }

    @Test
    void bindsToThePrincipalAccountIdAndRequiresAnActiveIdentity() {
        // Same username, different stored account id: fail closed.
        when(accounts.authenticate("alice"))
                .thenReturn(Optional.of(new AuthenticatedIdentity(8, "USER", "ACTIVE", "hash")));
        when(passwordEncoder.matches("Current-Pass-1!", "hash")).thenReturn(true);
        assertThatThrownBy(() -> guard.assertCurrentPassword(7, "alice", "Current-Pass-1!"))
                .isInstanceOf(CurrentPasswordMismatchException.class);

        // Non-ACTIVE status: fail closed identically.
        when(accounts.authenticate("alice"))
                .thenReturn(Optional.of(new AuthenticatedIdentity(7, "USER", "DISABLED", "hash")));
        assertThatThrownBy(() -> guard.assertCurrentPassword(7, "alice", "Current-Pass-1!"))
                .isInstanceOf(CurrentPasswordMismatchException.class);
    }

    @Test
    void rejectsAnUnverifiedIdentityContextBeforeAnyLookup() {
        assertThatThrownBy(() -> guard.assertCurrentPassword(0, "alice", "pw"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> guard.assertCurrentPassword(7, " ", "pw"))
                .isInstanceOf(IllegalArgumentException.class);
        verifyNoInteractions(accounts);
    }
}
