package com.virtualcompanion.runtime.emergencycontact;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * EMERGENCY-CONTACT (§20.14) deployment configuration.
 *
 * <p>{@code enabled} is the capability switch: §20.14 requires a legal,
 * safety and professional review BEFORE the capability is turned on
 * (未完成评审时宁可不启用), so the default is {@code false} — every
 * emergency-contact endpoint then fails closed with 403
 * BETA_OPERATIONS_NOT_READY and the H5 hides the entry. The Beta deployment
 * flips it to true only after the review is recorded (B0-02 §4).
 *
 * <p>{@code encryption-key} is the application-layer AES-256 key (base64, 32
 * bytes) used to encrypt the stored contact value (§17.4 应用层加密 — the
 * database never sees plaintext). The default is a FIXED DEVELOPMENT-ONLY
 * key; a real deployment must inject its own key via configuration (never
 * committed), keeping the key outside the database.
 *
 * <p>{@code verified-method} and {@code consent-version} pin HOW the
 * contact-side acceptance happened and WHICH version of the conditions the
 * contact accepted (§20.14 step 4 — 保存验证时间、方式和版本). The Alpha
 * verification channel is simulated: no email/SMS is ever sent.
 */
@ConfigurationProperties("virtual-companion.emergency-contact")
public record EmergencyContactProperties(
        @DefaultValue("false")
        boolean enabled,
        @DefaultValue("ZGV2LW9ubHktYWxwaGEta2V5LWRvLW5vdC11c2UtaW4=")
        String encryptionKey,
        @DefaultValue("SIMULATED_EMAIL_LINK")
        String verifiedMethod,
        @DefaultValue("2026-08")
        String consentVersion) {
}
