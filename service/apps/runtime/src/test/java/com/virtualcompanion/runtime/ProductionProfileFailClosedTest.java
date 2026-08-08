package com.virtualcompanion.runtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.springframework.boot.builder.SpringApplicationBuilder;

/**
 * 条件风险 3（TASK-0102）：production profile 必须强制认证与数据源开启。两个
 * 开关在 production profile 下没有默认值——缺少 VC_AUTH_ENABLED /
 * VC_AUTH_DATASOURCE_ENABLED 时占位符解析失败，应用启动即失败（fail-closed）；
 * 显式设置后正常启动。无活库要求：runtime 不依赖 Flyway，DataSource bean 惰性
 * 连接。
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
                .satisfies(t -> assertThat(chainMessages(t)).contains("VC_AUTH_ENABLED"));
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

    @Test
    void productionProfileWithAuthEnvironmentStarts() {
        try (org.springframework.context.ConfigurableApplicationContext context =
                new SpringApplicationBuilder(VirtualCompanionRuntimeApplication.class)
                        .profiles("production")
                        .properties(
                                "VC_AUTH_ENABLED=true",
                                "VC_AUTH_DATASOURCE_ENABLED=true",
                                "VC_JWT_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
                                "VC_DB_URL=jdbc:postgresql://127.0.0.1:5432/vc",
                                "VC_DB_USERNAME=vc",
                                "VC_DB_PASSWORD=vc")
                        .run()) {
            assertThat(context.isRunning()).isTrue();
        }
    }
}
