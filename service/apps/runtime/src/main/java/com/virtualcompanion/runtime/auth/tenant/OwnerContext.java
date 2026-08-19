package com.virtualcompanion.runtime.auth.tenant;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Server-side tenant-context mapping (INV-TENANT-001, TASK-0191). The
 * authenticated account id IS the owner_user_id -- the mapping is direct and
 * derived solely from the server-verified identity, never from a request
 * field or a development header. {@link #asOwner} runs a unit of work inside
 * one transaction with the owner bound through the V27
 * {@code vc.set_owner_context} SECURITY DEFINER establisher, so every
 * FORCE-RLS business query in the work sees exactly the caller's rows and a
 * missing or forged context fails closed.
 *
 * <p>TASK-0191 P0 remediation: the raw transaction-scoped GUC is no longer
 * trusted by the database. The establisher requires a domain-separated HMAC
 * proof (owner + backend pid + transaction id + fresh nonce, keyed by
 * {@code VC_OWNER_BINDING_SECRET}) that only this process can compute, so a
 * session-side {@code SET vc.owner_user_id}, a forged binding GUC or a stolen
 * runtime-role connection cannot establish an arbitrary owner. The proof is
 * transaction- and connection-bound and never reused. Neither the key nor the
 * proof is ever logged or embedded in exception messages.
 */
public class OwnerContext {

    /** V27 domain tag; must equal vc._owner_binding_message's prefix. */
    static final String BINDING_DOMAIN = "vc-owner-binding-v1";

    private static final int NONCE_BYTES = 16;

    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    private final byte[] bindingSecret;

    public OwnerContext(
            JdbcTemplate jdbc,
            TransactionTemplate transactions,
            String ownerBindingSecret) {
        if (ownerBindingSecret == null || ownerBindingSecret.isBlank()) {
            throw new IllegalStateException(
                    "virtual-companion.auth.owner-binding-secret (VC_OWNER_BINDING_SECRET) is required"
                            + " when the auth datasource is enabled");
        }
        byte[] key = ownerBindingSecret.getBytes(StandardCharsets.UTF_8);
        if (key.length < 32) {
            throw new IllegalStateException(
                    "VC_OWNER_BINDING_SECRET must carry at least 32 bytes of key material");
        }
        this.jdbc = jdbc;
        this.transactions = transactions;
        this.bindingSecret = key;
    }

    /**
     * Run {@code work} within one transaction bound to {@code ownerUserId}.
     * The mapping is direct: user_id == owner_user_id.
     */
    public void asOwner(long ownerUserId, Runnable work) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        transactions.executeWithoutResult(status -> {
            Map<String, Object> ids = jdbc.queryForMap(
                    "SELECT pg_backend_pid() AS pid, pg_current_xact_id()::text AS xact");
            String nonce = newNonce();
            String proof = proofFor(ownerUserId, String.valueOf(ids.get("pid")), String.valueOf(ids.get("xact")), nonce);
            // set_owner_context RETURNS void: the SELECT form still produces
            // one result row, which update() cannot absorb (pgjdbc: "a result
            // was returned when none was expected" — found by the B0-05
            // supplier-failure drill, 2026-08-19), so the row is drained.
            jdbc.query("SELECT vc.set_owner_context(?, ?, ?)", rs -> {
                rs.next();
                return null;
            }, ownerUserId, nonce, proof);
            work.run();
        });
    }

    /** The canonical domain-separated binding message for one context tuple. */
    static String bindingMessage(long ownerUserId, String backendPid, String xactId, String nonce) {
        return BINDING_DOMAIN
                + "|" + ownerUserId
                + "|" + backendPid
                + "|" + xactId
                + "|" + nonce;
    }

    /** Hex HMAC-SHA256 proof over the binding message with the process key. */
    String proofFor(long ownerUserId, String backendPid, String xactId, String nonce) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(bindingSecret, "HmacSHA256"));
            byte[] digest = mac.doFinal(
                    bindingMessage(ownerUserId, backendPid, xactId, nonce).getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(digest.length * 2);
            for (byte b : digest) {
                hex.append(Character.forDigit((b >> 4) & 0xF, 16));
                hex.append(Character.forDigit(b & 0xF, 16));
            }
            return hex.toString();
        } catch (Exception e) {
            throw new IllegalStateException("owner binding proof computation failed", e);
        }
    }

    private static String newNonce() {
        byte[] raw = new byte[NONCE_BYTES];
        new SecureRandom().nextBytes(raw);
        StringBuilder hex = new StringBuilder(raw.length * 2);
        for (byte b : raw) {
            hex.append(Character.forDigit((b >> 4) & 0xF, 16));
            hex.append(Character.forDigit(b & 0xF, 16));
        }
        return hex.toString();
    }

    /** Constant-time equality helper for proof comparisons in tests. */
    static boolean constantTimeEquals(String a, String b) {
        return MessageDigest.isEqual(
                a.getBytes(StandardCharsets.US_ASCII), b.getBytes(StandardCharsets.US_ASCII));
    }
}
