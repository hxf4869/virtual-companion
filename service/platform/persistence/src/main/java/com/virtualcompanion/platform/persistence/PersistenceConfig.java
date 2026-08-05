package com.virtualcompanion.platform.persistence;

import javax.sql.DataSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Spring configuration for the persistence baseline.
 *
 * <p>Flyway auto-runs the {@code db/migration} scripts on startup because
 * {@code flyway-core} is on the classpath and a {@link DataSource} is configured
 * by the runtime application. This class only exposes a {@link JdbcTemplate}
 * for the JDBC skeletons; the migration scripts themselves own the schema,
 * the minimal-privilege roles and the FORCE ROW LEVEL SECURITY policies.
 */
@Configuration
public class PersistenceConfig {

    @Bean
    public JdbcTemplate jdbcTemplate(DataSource dataSource) {
        return new JdbcTemplate(dataSource);
    }
}
