package com.virtualcompanion.platform.persistence;

import java.util.Objects;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Account default for the next new conversation's incognito flag (INC-PREF /
 * V54 / FR-CHAT-005). Missing rows read as false.
 */
public class IncognitoPrefService {

    private final JdbcTemplate jdbc;

    public IncognitoPrefService(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    public boolean get(long ownerUserId) {
        requireOwner(ownerUserId);
        Boolean value = jdbc.queryForObject(
                "SELECT vc.get_incognito_pref(?)",
                Boolean.class,
                ownerUserId);
        return Boolean.TRUE.equals(value);
    }

    public boolean update(long ownerUserId, boolean defaultIncognito) {
        requireOwner(ownerUserId);
        Boolean value = jdbc.queryForObject(
                "SELECT vc.update_incognito_pref(?, ?)",
                Boolean.class,
                ownerUserId,
                defaultIncognito);
        return Boolean.TRUE.equals(value);
    }

    private static void requireOwner(long ownerUserId) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
    }
}
