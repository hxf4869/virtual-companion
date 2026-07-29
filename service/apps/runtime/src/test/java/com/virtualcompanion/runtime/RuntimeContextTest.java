package com.virtualcompanion.runtime;

import static org.assertj.core.api.Assertions.assertThat;

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

    @Test
    void applicationContextProvidesHealthEndpoint() {
        assertThat(healthEndpoint.health().getStatus()).isEqualTo(Status.UP);
    }

    @Test
    void bindsDeclaredTechnicalBaseline() {
        assertThat(baselineProperties.javaVersion()).isEqualTo("25-LTS");
        assertThat(baselineProperties.springBootVersion()).isEqualTo("4.1.0");
        assertThat(baselineProperties.springAiVersion()).isEqualTo("2.0.0");
        assertThat(baselineProperties.springModulithVersion()).isEqualTo("2.1.0");
    }
}
