package com.virtualcompanion.runtime.servicemode;

import static org.assertj.core.api.Assertions.assertThat;

import com.virtualcompanion.runtime.modelproviders.ModelProviderProperties;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Unit tests for {@link ServiceModeService} (SVC-MODE / FR-RES-005): the mode
 * is a pure function of the provider master switch, the summary is plain
 * operational copy, and no other catalog mode is ever reported.
 */
class ServiceModeServiceTest {

    private static ModelProviderProperties providers(boolean enabled) {
        return new ModelProviderProperties(enabled, "/run/secrets", List.of());
    }

    @Test
    void disabledMasterSwitchReportsZeroLlm() {
        ServiceModeService service = new ServiceModeService(providers(false));

        ServiceModeService.Status status = service.current();

        assertThat(status.mode()).isEqualTo("ZERO_LLM");
        assertThat(status.summary()).isNotBlank();
        assertThat(status.summary()).contains("受限");
    }

    @Test
    void enabledMasterSwitchReportsFullAi() {
        ServiceModeService service = new ServiceModeService(providers(true));

        ServiceModeService.Status status = service.current();

        assertThat(status.mode()).isEqualTo("FULL_AI");
        assertThat(status.summary()).isNotBlank();
    }

    @Test
    void statusRejectsBlankFields() {
        org.junit.jupiter.api.Assertions.assertThrows(IllegalArgumentException.class,
                () -> new ServiceModeService.Status("  ", "summary"));
        org.junit.jupiter.api.Assertions.assertThrows(IllegalArgumentException.class,
                () -> new ServiceModeService.Status("FULL_AI", " "));
    }
}
