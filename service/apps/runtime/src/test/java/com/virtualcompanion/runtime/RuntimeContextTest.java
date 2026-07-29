package com.virtualcompanion.runtime;

import static org.assertj.core.api.Assertions.assertThat;

import com.virtualcompanion.runtime.baseline.BaselineService;
import com.virtualcompanion.runtime.baseline.CatalogSnapshotLoader;
import com.virtualcompanion.runtime.baseline.TechnicalBaselineProperties;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.health.actuate.endpoint.HealthEndpoint;
import org.springframework.boot.health.contributor.Status;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest
class RuntimeContextTest {

    @Autowired
    private HealthEndpoint healthEndpoint;

    @Autowired
    private TechnicalBaselineProperties baselineProperties;

    @Autowired
    private BaselineService baselineService;

    @Autowired
    private CatalogSnapshotLoader catalogSnapshotLoader;

    @Test
    void applicationContextProvidesHealthEndpoint() {
        assertThat(healthEndpoint.health().getStatus()).isEqualTo(Status.UP);
    }

    @Test
    void bindsDeclaredTechnicalBaseline() {
        assertThat(baselineProperties.phase()).isEqualTo("TECHNICAL_ALPHA");
        assertThat(baselineProperties.transport()).isEqualTo("HTTP_SSE");
        assertThat(baselineProperties.javaVersion()).isEqualTo("25-LTS");
        assertThat(baselineProperties.springBootVersion()).isEqualTo("4.1.0");
        assertThat(baselineProperties.springAiVersion()).isEqualTo("2.0.0");
        assertThat(baselineProperties.springModulithVersion()).isEqualTo("2.1.0");
    }

    @Test
    void loadsFailClosedTechnicalAlphaCapabilitiesFromCatalogClasspathResource() {
        assertThat(catalogSnapshotLoader).isNotNull();

        var baseline = baselineService.current();
        assertThat(baseline.capabilities().source())
                .isEqualTo("specs/generated/catalog.snapshot.json"
                        + "#sources/product-scope.yaml/document");
        assertThat(baseline.capabilities().publicRegistrationEnabled()).isFalse();
        assertThat(baseline.capabilities().paymentEnabled()).isFalse();
        assertThat(baseline.capabilities().romanceModeEnabled()).isFalse();
        assertThat(baseline.capabilities().voiceEnabled()).isFalse();
        assertThat(baseline.capabilities().imageEnabled()).isFalse();
        assertThat(baseline.capabilities().websocketEnabled()).isFalse();
        assertThat(baseline.capabilities().betaGenerationEnabledByDefault()).isFalse();
    }
}
