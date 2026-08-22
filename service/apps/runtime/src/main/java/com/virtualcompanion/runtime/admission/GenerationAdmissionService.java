package com.virtualcompanion.runtime.admission;

import com.virtualcompanion.catalog.AgeState;
import com.virtualcompanion.platform.persistence.AgeVerificationService;
import com.virtualcompanion.platform.persistence.ConsentRecord;
import com.virtualcompanion.platform.persistence.ConsentService;
import com.virtualcompanion.platform.persistence.IdentityAccountRepository;
import com.virtualcompanion.platform.persistence.ReleaseGate;
import com.virtualcompanion.platform.persistence.ServiceWindowService;
import com.virtualcompanion.runtime.observability.AlertNotifier;
import com.virtualcompanion.runtime.observability.AlertSeverity;
import com.virtualcompanion.runtime.servicemode.BetaServiceWindow;
import com.virtualcompanion.runtime.web.ServiceWindowClosedException;
import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Reads account, age, consents and the Beta window, then applies
 * {@link GenerationAdmissionPolicy}. Any thrown reader exception becomes
 * {@code admission-read-failed}.
 */
public final class GenerationAdmissionService implements GenerationAdmission {

    private final GenerationAdmissionPolicy policy = new GenerationAdmissionPolicy();
    private final IdentityAccountRepository accounts;
    private final AgeVerificationService ageVerificationService;
    private final ConsentService consentService;
    private final BetaServiceWindow serviceWindow;
    private final ServiceWindowService serviceWindowService;
    private final AlertNotifier alertNotifier;
    private final boolean betaGenerationEnabled;
    private final boolean enforceConfigured;
    private final Set<String> requiredConsentTypes;
    private final ReleaseGate releaseGate;

    public GenerationAdmissionService(
            IdentityAccountRepository accounts,
            AgeVerificationService ageVerificationService,
            ConsentService consentService,
            BetaServiceWindow serviceWindow,
            ServiceWindowService serviceWindowService,
            AlertNotifier alertNotifier,
            boolean betaGenerationEnabled,
            boolean enforceConfigured,
            List<String> requiredConsentTypes) {
        this(
                accounts,
                ageVerificationService,
                consentService,
                serviceWindow,
                serviceWindowService,
                alertNotifier,
                betaGenerationEnabled,
                enforceConfigured,
                requiredConsentTypes,
                null);
    }

    public GenerationAdmissionService(
            IdentityAccountRepository accounts,
            AgeVerificationService ageVerificationService,
            ConsentService consentService,
            BetaServiceWindow serviceWindow,
            ServiceWindowService serviceWindowService,
            AlertNotifier alertNotifier,
            boolean betaGenerationEnabled,
            boolean enforceConfigured,
            List<String> requiredConsentTypes,
            ReleaseGate releaseGate) {
        this.accounts = Objects.requireNonNull(accounts);
        this.ageVerificationService = Objects.requireNonNull(ageVerificationService);
        this.consentService = Objects.requireNonNull(consentService);
        this.serviceWindow = Objects.requireNonNull(serviceWindow);
        this.serviceWindowService = Objects.requireNonNull(serviceWindowService);
        this.alertNotifier = Objects.requireNonNull(alertNotifier);
        this.betaGenerationEnabled = betaGenerationEnabled;
        this.enforceConfigured = enforceConfigured;
        this.requiredConsentTypes = requiredConsentTypes == null
                ? Set.of()
                : requiredConsentTypes.stream()
                        .filter(type -> type != null && !type.isBlank())
                        .map(String::trim)
                        .collect(Collectors.toUnmodifiableSet());
        this.releaseGate = releaseGate;
    }

    @Override
    public void assertAdmitted(long ownerUserId) {
        GenerationAdmissionPolicy.Facts facts;
        try {
            facts = loadFacts(ownerUserId);
        } catch (RuntimeException e) {
            throw new AdmissionDeniedException(GenerationAdmissionPolicy.ADMISSION_READ_FAILED);
        }
        Optional<String> reason = policy.rejectReason(facts);
        if (reason.isEmpty()) {
            return;
        }
        String code = reason.get();
        if ("daily-active-limit".equals(code)) {
            alertNotifier.alert(
                    AlertSeverity.P2,
                    "DAU_CAP_REACHED",
                    "daily active users reached the beta cap; new actives refused");
            throw new ServiceWindowClosedException(code);
        }
        if ("outside-generation-window".equals(code) || "service-paused".equals(code)) {
            throw new ServiceWindowClosedException(code);
        }
        throw new AdmissionDeniedException(code);
    }

    private GenerationAdmissionPolicy.Facts loadFacts(long ownerUserId) {
        String status = accounts.statusOf(ownerUserId);
        boolean accountActive = "ACTIVE".equals(status);
        AgeState age = ageVerificationService.get(ownerUserId)
                .map(row -> AgeState.valueOf(row.ageState()))
                .orElse(AgeState.AGE_UNKNOWN);
        Set<String> granted = new LinkedHashSet<>();
        for (ConsentRecord row : consentService.list(ownerUserId)) {
            if (row.granted()) {
                granted.add(row.consentType());
            }
        }
        Optional<String> windowReject = Optional.empty();
        boolean enforce = enforceConfigured || serviceWindow.enabled();
        if (serviceWindow.enabled()) {
            Instant now = Instant.now();
            ServiceWindowService.WindowState state =
                    serviceWindowService.state(ownerUserId, serviceWindow.dayStart(now));
            windowReject = serviceWindow.rejectReason(
                    now, state.dailyActiveUsers(), state.ownerActiveToday());
        }
        boolean liveExpansionAllowed = releaseGate == null || releaseGate.allowsLiveExpansion();
        return new GenerationAdmissionPolicy.Facts(
                true,
                accountActive,
                betaGenerationEnabled,
                enforce,
                age,
                granted,
                requiredConsentTypes,
                windowReject,
                liveExpansionAllowed);
    }
}
