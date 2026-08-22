package com.virtualcompanion.platform.persistence;

import com.virtualcompanion.modelruntime.routing.QuotaBook;
import com.virtualcompanion.modelruntime.routing.QuotaReservation;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Durable {@link QuotaBook} over {@code vc.product_quota_account} (S0-11-C).
 *
 * <p>Reserve/settle/release go through SECURITY DEFINER functions so runtime
 * roles never take table DML. The owner account row is locked during reserve
 * so concurrent prepares cannot oversell. Remaining survives restart.
 */
public final class JdbcProductQuotaBook implements QuotaBook {

    static final String RESERVE_SQL =
            "SELECT out_reservation_id, out_remaining FROM vc.reserve_product_quota(?, ?, ?, ?)";
    static final String RELEASE_SQL =
            "SELECT vc.release_product_quota(?, ?)";
    static final String SETTLE_SQL =
            "SELECT vc.settle_product_quota(?, ?)";
    static final String REMAINING_SQL =
            "SELECT vc.product_quota_remaining(?)";

    private final JdbcTemplate jdbc;
    private final long defaultAllowance;

    public JdbcProductQuotaBook(JdbcTemplate jdbc, long defaultAllowance) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
        if (defaultAllowance < 0) {
            throw new IllegalArgumentException("defaultAllowance must be non-negative");
        }
        this.defaultAllowance = defaultAllowance;
    }

    @Override
    public Optional<QuotaReservation> reserve(String ownerUserId, long units) {
        throw new IllegalStateException(
                "durable quota reserve requires a generation id");
    }

    @Override
    public Optional<QuotaReservation> reserve(
            String ownerUserId, String generationId, long units) {
        Objects.requireNonNull(ownerUserId, "ownerUserId must not be null");
        Objects.requireNonNull(generationId, "generationId must not be null");
        if (ownerUserId.isBlank() || generationId.isBlank()) {
            throw new IllegalArgumentException("ownerUserId and generationId must not be blank");
        }
        if (units <= 0) {
            throw new IllegalArgumentException("units must be positive");
        }
        long owner = parseId(ownerUserId, "ownerUserId");
        long generation = parseId(generationId, "generationId");
        List<QuotaReservation> rows = jdbc.query(
                RESERVE_SQL,
                (rs, rowNum) -> new QuotaReservation(
                        rs.getString("out_reservation_id"),
                        ownerUserId,
                        units,
                        rs.getLong("out_remaining")),
                owner,
                generation,
                units,
                defaultAllowance);
        if (rows.isEmpty() || rows.getFirst().reservationId() == null) {
            return Optional.empty();
        }
        return Optional.of(rows.getFirst());
    }

    @Override
    public long release(QuotaReservation reservation) {
        Objects.requireNonNull(reservation, "reservation must not be null");
        Long remaining = jdbc.queryForObject(
                RELEASE_SQL,
                Long.class,
                parseId(reservation.ownerUserId(), "ownerUserId"),
                reservation.reservationId());
        return remaining == null ? 0L : remaining;
    }

    @Override
    public void settle(QuotaReservation reservation) {
        Objects.requireNonNull(reservation, "reservation must not be null");
        Boolean settled = jdbc.queryForObject(
                SETTLE_SQL,
                Boolean.class,
                parseId(reservation.ownerUserId(), "ownerUserId"),
                reservation.reservationId());
        if (!Boolean.TRUE.equals(settled)) {
            throw new IllegalStateException(
                    "settle_product_quota did not settle " + reservation.reservationId());
        }
    }

    @Override
    public long remaining(String ownerUserId) {
        Objects.requireNonNull(ownerUserId, "ownerUserId must not be null");
        Long remaining = jdbc.queryForObject(
                REMAINING_SQL,
                Long.class,
                parseId(ownerUserId, "ownerUserId"));
        return remaining == null ? 0L : remaining;
    }

    private static long parseId(String raw, String name) {
        try {
            long value = Long.parseLong(raw);
            if (value <= 0) {
                throw new IllegalArgumentException(name + " must be a positive id");
            }
            return value;
        } catch (NumberFormatException bad) {
            throw new IllegalArgumentException(name + " must be a numeric id", bad);
        }
    }
}
