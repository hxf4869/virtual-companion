package com.virtualcompanion.platform.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.virtualcompanion.modelruntime.registry.AdmissionStatus;
import com.virtualcompanion.modelruntime.registry.ProviderId;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * S0-11-A: durable admission mapping from {@code vc.provider_deployment}.
 * Missing rows are not admitted; unknown states fail closed.
 */
class JdbcProviderAdmissionAuthorityTest {

    @Test
    void missingRowIsNotAdmitted() {
        JdbcProviderAdmissionAuthority authority = authorityWith(
                id -> Optional.empty());

        assertTrue(authority.statusOf(new ProviderId("missing")).isEmpty());
    }

    @Test
    void admittedRowMapsToAdmitted() {
        JdbcProviderAdmissionAuthority authority = authorityWith(id -> Optional.of(
                new ProviderDeploymentRecord(id, "FAKE", List.of(), "ADMITTED")));

        assertEquals(
                AdmissionStatus.ADMITTED,
                authority.statusOf(new ProviderId("loopback-1")).orElseThrow());
    }

    @Test
    void disabledRowMapsToDisabled() {
        JdbcProviderAdmissionAuthority authority = authorityWith(id -> Optional.of(
                new ProviderDeploymentRecord(id, "FAKE", List.of(), "DISABLED")));

        assertEquals(
                AdmissionStatus.DISABLED,
                authority.statusOf(new ProviderId("loopback-1")).orElseThrow());
    }

    @Test
    void unknownAdmissionStateFailsClosed() {
        JdbcProviderAdmissionAuthority authority = authorityWith(id -> Optional.of(
                new ProviderDeploymentRecord(id, "FAKE", List.of(), "PENDING")));

        IllegalStateException thrown = assertThrows(
                IllegalStateException.class,
                () -> authority.statusOf(new ProviderId("loopback-1")));
        assertTrue(thrown.getMessage().contains("unknown admission_state"));
    }

    @Test
    void nullProviderIdIsRejected() {
        JdbcProviderAdmissionAuthority authority = authorityWith(id -> Optional.empty());
        assertThrows(NullPointerException.class, () -> authority.statusOf(null));
    }

    private static JdbcProviderAdmissionAuthority authorityWith(
            java.util.function.Function<String, Optional<ProviderDeploymentRecord>> rows) {
        JdbcProviderDeploymentRepository repository = new JdbcProviderDeploymentRepository(
                Mockito.mock(JdbcTemplate.class)) {
            @Override
            public Optional<ProviderDeploymentRecord> findByProviderId(String providerId) {
                return rows.apply(providerId);
            }
        };
        return new JdbcProviderAdmissionAuthority(repository);
    }
}
