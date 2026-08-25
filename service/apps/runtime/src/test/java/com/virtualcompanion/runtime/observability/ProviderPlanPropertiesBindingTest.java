package com.virtualcompanion.runtime.observability;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.bind.BindResult;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.context.properties.source.MapConfigurationPropertySource;

/**
 * DOGFOOD-05 (ADR-0006 §3.3): the application.yaml bridge maps every
 * VC_PROVIDER_PLAN_* variable through an empty-default placeholder, so after
 * placeholder expansion an unset variable arrives as an EMPTY STRING on the
 * kebab-case property. Because empty strings fail to bind as LocalDate/Long,
 * the properties record carries Strings and normalizes blanks to null — an
 * unset plan fact stays absent, never zero. (The short VC_* env names resolve
 * through the yaml placeholders, exactly like VC_MODEL_PROVIDERS_ENABLED.)
 */
class ProviderPlanPropertiesBindingTest {

    private ProviderPlanProperties bind(Map<String, String> yamlLevelValues) {
        MapConfigurationPropertySource source =
                new MapConfigurationPropertySource(new HashMap<>(yamlLevelValues));
        BindResult<ProviderPlanProperties> bound = new Binder(source)
                .bind("virtual-companion.provider-plan", ProviderPlanProperties.class);
        return bound.orElseGet(() -> new ProviderPlanProperties(
                false, null, null, null, null, null));
    }

    @Test
    void emptyBridgeDefaultsBindAsAbsentWithoutCaps() {
        // Every VC_PROVIDER_PLAN_* unset -> yaml placeholder expansion yields
        // empty strings; the record must normalize them all to null.
        // enabled has a NON-empty yaml bridge default (false), so the empty
        // placeholder case applies only to the String plan facts.
        ProviderPlanProperties properties = bind(Map.of(
                "virtual-companion.provider-plan.plan-name", "",
                "virtual-companion.provider-plan.valid-from", "",
                "virtual-companion.provider-plan.valid-until", "",
                "virtual-companion.provider-plan.token-cap", "",
                "virtual-companion.provider-plan.request-cap", ""));

        assertThat(properties.enabled()).isFalse();
        assertThat(properties.planName()).isNull();
        assertThat(properties.validFrom()).isNull();
        assertThat(properties.validUntil()).isNull();
        assertThat(properties.tokenCap()).isNull();
        assertThat(properties.requestCap()).isNull();
    }

    @Test
    void populatedPlanFactsBindVerbatimAsTrimmedStrings() {
        ProviderPlanProperties properties = bind(Map.of(
                "virtual-companion.provider-plan.enabled", "true",
                "virtual-companion.provider-plan.plan-name", " private-dogfood-plan ",
                "virtual-companion.provider-plan.valid-from", "2026-08-24",
                "virtual-companion.provider-plan.valid-until", "2026-08-30",
                "virtual-companion.provider-plan.token-cap", "1000000",
                "virtual-companion.provider-plan.request-cap", "500"));

        assertThat(properties.enabled()).isTrue();
        assertThat(properties.planName()).isEqualTo("private-dogfood-plan");
        assertThat(properties.validFrom()).isEqualTo("2026-08-24");
        assertThat(properties.validUntil()).isEqualTo("2026-08-30");
        assertThat(properties.tokenCap()).isEqualTo("1000000");
        assertThat(properties.requestCap()).isEqualTo("500");
    }

    @Test
    void partiallyStatedPlanKeepsTheUnstatedFactsNull() {
        ProviderPlanProperties properties = bind(Map.of(
                "virtual-companion.provider-plan.enabled", "true",
                "virtual-companion.provider-plan.valid-from", "2026-08-24",
                "virtual-companion.provider-plan.valid-until", "2026-08-31"));

        assertThat(properties.enabled()).isTrue();
        assertThat(properties.validFrom()).isEqualTo("2026-08-24");
        assertThat(properties.planName()).isNull();
        assertThat(properties.tokenCap()).isNull();
        assertThat(properties.requestCap()).isNull();
    }
}
