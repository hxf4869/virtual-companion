package com.virtualcompanion.platform.persistence;

import java.time.Instant;
import java.util.Objects;

/**
 * One {@code vc.emergency_contact} row surfaced by the V65 SECURITY DEFINER
 * functions (§20.14).
 *
 * <p>The contact value is application-layer encrypted: {@code contactCipher}
 * carries base64(iv||AES-GCM ciphertext) and is only ever decrypted in the
 * Java service with a deployment-injected key — SQL never sees plaintext.
 * A {@code DRAFT} row is never usable for an actual liaison (未验证前只能
 * 保存为草稿); {@code VERIFIED} binds when/how/under-which-version the
 * contact-side acceptance happened; {@code REVOKED} is terminal.
 */
public record EmergencyContactRecord(
        long id,
        String label,
        String contactCipher,
        String status,
        String consentVersion,
        Instant invitedAt,
        Instant verifiedAt,
        String verifiedMethod,
        Instant verifiedExpiresAt,
        Instant createdAt,
        Instant updatedAt) {

    public EmergencyContactRecord {
        if (id <= 0) {
            throw new IllegalArgumentException("id must be positive");
        }
        Objects.requireNonNull(label, "label must not be null");
        if (label.isBlank()) {
            throw new IllegalArgumentException("label must not be blank");
        }
        Objects.requireNonNull(contactCipher, "contactCipher must not be null");
        if (contactCipher.isBlank()) {
            throw new IllegalArgumentException("contactCipher must not be blank");
        }
        Objects.requireNonNull(status, "status must not be null");
        if (!status.equals("DRAFT") && !status.equals("VERIFIED") && !status.equals("REVOKED")) {
            throw new IllegalArgumentException("status is not an approved emergency contact status");
        }
        if (createdAt == null || updatedAt == null) {
            throw new IllegalArgumentException("createdAt/updatedAt must not be null");
        }
    }
}
