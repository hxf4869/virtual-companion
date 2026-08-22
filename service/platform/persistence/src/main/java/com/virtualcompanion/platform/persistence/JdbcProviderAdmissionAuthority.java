package com.virtualcompanion.platform.persistence;

import com.virtualcompanion.modelruntime.registry.AdmissionStatus;
import com.virtualcompanion.modelruntime.registry.ProviderAdmissionAuthority;
import com.virtualcompanion.modelruntime.registry.ProviderId;
import java.util.Objects;
import java.util.Optional;

/**
 * JDBC {@link ProviderAdmissionAuthority} over {@code vc.provider_deployment}
 * (S0-11-A).
 *
 * <p>Runtime roles have SELECT only; admission transitions stay with the
 * coordinator. A missing row is empty (not admitted). An unknown
 * {@code admission_state} fails closed rather than being treated as
 * {@code ADMITTED}. The gated registry re-reads this on every lookup, so a
 * coordinator disable is observed before the next outbound.
 */
public final class JdbcProviderAdmissionAuthority implements ProviderAdmissionAuthority {

    private final JdbcProviderDeploymentRepository repository;

    public JdbcProviderAdmissionAuthority(JdbcProviderDeploymentRepository repository) {
        this.repository = Objects.requireNonNull(repository, "repository must not be null");
    }

    @Override
    public Optional<AdmissionStatus> statusOf(ProviderId providerId) {
        Objects.requireNonNull(providerId, "providerId must not be null");
        return repository.findByProviderId(providerId.value())
                .map(record -> parseStatus(record.admissionState()));
    }

    private static AdmissionStatus parseStatus(String admissionState) {
        try {
            return AdmissionStatus.valueOf(admissionState);
        } catch (IllegalArgumentException unknown) {
            throw new IllegalStateException(
                    "unknown admission_state " + admissionState, unknown);
        }
    }
}
