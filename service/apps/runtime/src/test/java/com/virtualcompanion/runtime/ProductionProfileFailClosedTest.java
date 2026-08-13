package com.virtualcompanion.runtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.springframework.boot.builder.SpringApplicationBuilder;

/**
 * 条件风险 3（TASK-0102）：production profile 必须强制认证与数据源开启。两个
 * 开关在 production profile 下没有默认值——缺少 VC_AUTH_ENABLED /
 * VC_AUTH_DATASOURCE_ENABLED 时占位符解析失败，应用启动即失败（fail-closed）；
 * 显式设置后正常启动。无活库要求：DataSource bean 惰性连接，默认不运行 Flyway。
 *
 * <p>P1-11（TASK-0155）：production profile 同时强制显式声明迁移开关与 migrator
 * 凭据（VC_FLYWAY_ENABLED / VC_MIGRATOR_DB_*），缺失即启动失败；应用内 Flyway
 * 使用独立 migrator datasource（与 runtime VC_DB_* 分离），其连接失败会暴露
 * migrator 主机/端口而非 runtime 地址。
 */
class ProductionProfileFailClosedTest {

    @Test
    void productionProfileWithoutAuthEnvironmentFailsToStart() {
        // The missing VC_AUTH_ENABLED placeholder surfaces wrapped in a
        // BeanDefinitionStoreException during component scanning; walk the
        // cause chain and assert the placeholder name appears (fail-closed).
        assertThatThrownBy(() -> new SpringApplicationBuilder(VirtualCompanionRuntimeApplication.class)
                .profiles("production")
                .run())
                .satisfies(t -> assertThat(chainMessages(t))
                        .containsAnyOf("VC_AUTH_ENABLED", "VC_AUTH_DATASOURCE_ENABLED"));
    }

    @Test
    void productionProfileWithAuthEnvironmentStarts() {
        try (org.springframework.context.ConfigurableApplicationContext context =
                new SpringApplicationBuilder(VirtualCompanionRuntimeApplication.class)
                        .profiles("production")
                        .properties(
                                "VC_AUTH_ENABLED=true",
                                "VC_AUTH_DATASOURCE_ENABLED=true",
                                "VC_FLYWAY_ENABLED=false",
                                "VC_JWT_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
                                "VC_OWNER_BINDING_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef",
                                "VC_DB_URL=jdbc:postgresql://127.0.0.1:5432/vc",
                                "VC_DB_USERNAME=vc",
                                "VC_DB_PASSWORD=vc")
                        .run()) {
            assertThat(context.isRunning()).isTrue();
        }
    }

    @Test
    void productionProfileWithFlywayEnabledButMissingMigratorCredentialsFailsToStart() {
        // P1-11 fail-fast: enabling in-app Flyway without the migrator
        // datasource credentials must refuse startup with the missing variable
        // named, never a silent "maybe migrated" state.
        assertThatThrownBy(() -> new SpringApplicationBuilder(VirtualCompanionRuntimeApplication.class)
                .profiles("production")
                .properties(
                        "VC_AUTH_ENABLED=true",
                        "VC_AUTH_DATASOURCE_ENABLED=true",
                        "VC_FLYWAY_ENABLED=true",
                        "VC_JWT_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
                        "VC_OWNER_BINDING_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef",
                        "VC_DB_URL=jdbc:postgresql://127.0.0.1:5432/vc",
                        "VC_DB_USERNAME=vc",
                        "VC_DB_PASSWORD=vc")
                        .run())
                .satisfies(t -> assertThat(chainMessages(t))
                        .contains("VC_MIGRATOR_DB_URL"));
    }

    @Test
    void productionProfileFlywayConnectsThroughSeparateMigratorDatasource() {
        // P1-11 separation proof: the runtime URL points at a dead port while
        // the migrator URL points at another dead port. Startup must fail on
        // the migrator connection (Flyway uses spring.flyway.*, not VC_DB_*),
        // so the failure message exposes the migrator port, not the runtime one.
        assertThatThrownBy(() -> new SpringApplicationBuilder(VirtualCompanionRuntimeApplication.class)
                .profiles("production")
                .properties(
                        "VC_AUTH_ENABLED=true",
                        "VC_AUTH_DATASOURCE_ENABLED=true",
                        "VC_FLYWAY_ENABLED=true",
                        "VC_JWT_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
                        "VC_DB_URL=jdbc:postgresql://127.0.0.1:59999/vc",
                        "VC_DB_USERNAME=vc",
                        "VC_DB_PASSWORD=vc",
                        "VC_OWNER_BINDING_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef",
                        "VC_MIGRATOR_DB_URL=jdbc:postgresql://127.0.0.1:5433/vc",
                        "VC_MIGRATOR_DB_USERNAME=postgres",
                        "VC_MIGRATOR_DB_PASSWORD=vc")
                        .run())
                .satisfies(t -> {
                    String messages = chainMessages(t);
                    assertThat(messages).contains("5433");
                    assertThat(messages).doesNotContain("59999");
                });
    }

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
}
