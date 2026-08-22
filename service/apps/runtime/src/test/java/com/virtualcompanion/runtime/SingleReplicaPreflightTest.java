package com.virtualcompanion.runtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.virtualcompanion.runtime.replica.SingleReplicaPreflightEnvironmentPostProcessor;
import org.junit.jupiter.api.Test;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.StandardEnvironment;

/**
 * S0-33 / §12.7: the DECLARED replica count is part of the hard gate — a
 * deployment that declares anything other than 1 must refuse startup in EVERY
 * profile, before any bean exists, with a deterministic message naming the
 * variable. No remote feature flag can bypass this: there is no switch, the
 * gate reads only the deployment declaration.
 */
class SingleReplicaPreflightTest {

    private static final String PROPERTY =
            SingleReplicaPreflightEnvironmentPostProcessor.REPLICAS_PROPERTY;

    private static final String[] SINGLE_REPLICA_PRODUCTION_ENV = {
        "VC_AUTH_ENABLED=true",
        "VC_AUTH_DATASOURCE_ENABLED=true",
        "VC_FLYWAY_ENABLED=false",
        "VC_JWT_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        "VC_OWNER_BINDING_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef",
        "VC_DB_URL=jdbc:postgresql://127.0.0.1:5432/vc",
        "VC_DB_USERNAME=vc",
        "VC_DB_PASSWORD=vc",
        "VC_CRYPTO_REST_KEY=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="
    };

    private static String chainMessages(Throwable throwable) {
        StringBuilder sb = new StringBuilder();
        for (Throwable cause = throwable; cause != null; cause = cause.getCause()) {
            if (sb.length() > 0) {
                sb.append(" | ");
            }
            sb.append(cause.getClass().getSimpleName()).append(": ")
                    .append(cause.getMessage() == null ? "" : cause.getMessage());
        }
        return sb.toString();
    }

    private static ConfigurableEnvironment environmentWith(String property, String value) {
        ConfigurableEnvironment environment = new StandardEnvironment();
        environment.getPropertySources().addFirst(
                new org.springframework.core.env.MapPropertySource(
                        "single-replica-test",
                        java.util.Map.of(property, value)));
        return environment;
    }

    // -- direct processor semantics -----------------------------------

    @Test
    void undeclaredReplicaCountDefaultsToSingle() {
        ConfigurableEnvironment environment = new StandardEnvironment();
        assertThat(environment.getProperty(PROPERTY)).isNull();

        new SingleReplicaPreflightEnvironmentPostProcessor()
                .postProcessEnvironment(environment, null);

        // No exception: the application.yaml default (1) applies.
    }

    @Test
    void declaredTwoReplicasAreRejected() {
        ConfigurableEnvironment environment = environmentWith(PROPERTY, "2");

        assertThatThrownBy(() -> new SingleReplicaPreflightEnvironmentPostProcessor()
                .postProcessEnvironment(environment, null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("VC_RUNTIME_REPLICAS")
                .hasMessageContaining("2")
                .hasMessageContaining("WILL NOT START");
    }

    @Test
    void nonNumericReplicaCountIsRejected() {
        ConfigurableEnvironment environment = environmentWith(PROPERTY, "many");

        assertThatThrownBy(() -> new SingleReplicaPreflightEnvironmentPostProcessor()
                .postProcessEnvironment(environment, null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("VC_RUNTIME_REPLICAS")
                .hasMessageContaining("must be an integer");
    }

    @Test
    void declaredSingleReplicaIsAccepted() {
        ConfigurableEnvironment environment = environmentWith(PROPERTY, "1");

        new SingleReplicaPreflightEnvironmentPostProcessor()
                .postProcessEnvironment(environment, null);
    }

    // -- boot-level gate ----------------------------------------------

    @Test
    void productionBootWithDeclaredTwoReplicasFailsToStart() {
        assertThatThrownBy(() -> new SpringApplicationBuilder(
                        VirtualCompanionRuntimeApplication.class)
                .profiles("production")
                .properties(SINGLE_REPLICA_PRODUCTION_ENV)
                .properties("VC_RUNTIME_REPLICAS=2")
                .run())
                .satisfies(t -> assertThat(chainMessages(t))
                        .contains("VC_RUNTIME_REPLICAS")
                        .contains("exactly 1 is permitted"));
    }

    @Test
    void defaultProfileBootWithDeclaredTwoReplicasAlsoFailsToStart() {
        // The gate is profile-independent: the runtime is unsafe in dev and
        // smoke stacks too while shared state is process-local.
        assertThatThrownBy(() -> new SpringApplicationBuilder(
                        VirtualCompanionRuntimeApplication.class)
                .properties("VC_RUNTIME_REPLICAS=2")
                .run())
                .satisfies(t -> assertThat(chainMessages(t))
                        .contains("VC_RUNTIME_REPLICAS")
                        .contains("exactly 1 is permitted"));
    }

    @Test
    void singleReplicaBootStarts() {
        try (org.springframework.context.ConfigurableApplicationContext context =
                new SpringApplicationBuilder(VirtualCompanionRuntimeApplication.class)
                        .properties("VC_RUNTIME_REPLICAS=1")
                        .run()) {
            assertThat(context.isRunning()).isTrue();
        }
    }
}