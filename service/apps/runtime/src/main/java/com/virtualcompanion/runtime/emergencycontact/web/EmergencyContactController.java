package com.virtualcompanion.runtime.emergencycontact.web;

import com.virtualcompanion.platform.persistence.EmergencyContactRecord;
import com.virtualcompanion.platform.persistence.EmergencyContactService;
import com.virtualcompanion.runtime.emergencycontact.EmergencyContactCipher;
import com.virtualcompanion.runtime.emergencycontact.EmergencyContactProperties;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.dao.DataAccessException;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Emergency contact HTTP API (EMERGENCY-CONTACT / §20.14).
 *
 * <p>The lifecycle: save as DRAFT (requires the standing EMERGENCY_CONTACT
 * consent — re-verified in SQL), mint a one-time verification invite token
 * (Alpha: the caller relays it manually, nothing is sent), confirm the
 * contact-side acceptance (binding when/how/version, 180-day validity), and
 * withdraw. An unverified contact is only ever a DRAFT and can never be used
 * for an actual liaison — actual liaison stays a human action outside this
 * API (不由模型自动触发). The contact value is stored application-encrypted;
 * decryption happens only here, and every read is audited in SQL.
 *
 * <p>Authenticated: the principal's account id is the owner id; the owner GUC
 * is bound upstream by the owner-injection filter.
 */
@RestController
@RequestMapping("/api/v1")
@ConditionalOnProperty(
        name = "virtual-companion.auth.datasource-enabled",
        havingValue = "true")
public class EmergencyContactController {

    private final EmergencyContactService emergencyContactService;
    private final EmergencyContactCipher cipher;
    private final EmergencyContactProperties properties;

    public EmergencyContactController(
            EmergencyContactService emergencyContactService,
            EmergencyContactCipher cipher,
            EmergencyContactProperties properties) {
        this.emergencyContactService = emergencyContactService;
        this.cipher = cipher;
        this.properties = properties;
    }

    /** The live contact card (decrypted), or null when nothing is saved. */
    @GetMapping("/emergency-contact")
    public EmergencyContactResponse get(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId) {
        return emergencyContactService.get(ownerUserId)
                .map(record -> toResponse(record, true))
                .orElse(null);
    }

    /** Save or change the contact; a change demotes back to DRAFT. */
    @PutMapping("/emergency-contact")
    public EmergencyContactResponse save(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @Valid @RequestBody EmergencyContactSaveRequest request) {
        try {
            emergencyContactService.upsert(
                    ownerUserId, request.label(), cipher.encrypt(request.contact()));
        } catch (DataAccessException e) {
            // SQL rejections (missing consent, unapproved values) are client
            // precondition failures, not internal errors.
            throw new IllegalArgumentException("emergency contact save rejected");
        }
        return get(ownerUserId);
    }

    /**
     * Mint a one-time verification invite. Alpha: the token is displayed to
     * the caller for manual relay — no email/SMS is ever sent.
     */
    @PostMapping("/emergency-contact/verify-start")
    public VerificationInviteResponse startVerification(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId) {
        EmergencyContactService.VerificationInvite invite;
        try {
            invite = emergencyContactService.startVerification(ownerUserId);
        } catch (DataAccessException e) {
            throw new IllegalArgumentException(
                    "emergency contact verification start rejected");
        }
        return new VerificationInviteResponse(
                Long.toString(invite.id()),
                invite.token(),
                invite.invitedAt().toString());
    }

    /** The (simulated) contact-side acceptance of the invite token. */
    @PostMapping("/emergency-contact/verify-confirm")
    public EmergencyContactResponse confirm(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @Valid @RequestBody VerificationConfirmRequest request) {
        try {
            emergencyContactService.confirmVerification(
                    ownerUserId,
                    request.token(),
                    properties.verifiedMethod(),
                    properties.consentVersion());
        } catch (DataAccessException e) {
            throw new IllegalArgumentException(
                    "emergency contact verification rejected");
        }
        return get(ownerUserId);
    }

    /** Withdraw the live contact (terminal; a new one starts fresh). */
    @PostMapping("/emergency-contact/revoke")
    public RevokeResponse revoke(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId) {
        boolean revoked;
        try {
            revoked = emergencyContactService.revoke(ownerUserId);
        } catch (DataAccessException e) {
            throw new IllegalArgumentException("emergency contact revoke rejected");
        }
        return new RevokeResponse(revoked);
    }

    private EmergencyContactResponse toResponse(
            EmergencyContactRecord record, boolean withContact) {
        return new EmergencyContactResponse(
                Long.toString(record.id()),
                record.label(),
                withContact ? cipher.decrypt(record.contactCipher()) : null,
                record.status(),
                record.consentVersion(),
                record.invitedAt() == null ? null : record.invitedAt().toString(),
                record.verifiedAt() == null ? null : record.verifiedAt().toString(),
                record.verifiedMethod(),
                record.verifiedExpiresAt() == null
                        ? null : record.verifiedExpiresAt().toString(),
                record.createdAt().toString(),
                record.updatedAt().toString());
    }

    /** Save body (OpenAPI {@code EmergencyContactSaveRequest}). */
    public record EmergencyContactSaveRequest(
            @NotBlank @Size(max = EmergencyContactService.MAX_LABEL_LENGTH) String label,
            @NotBlank @Size(max = 512) String contact) {
    }

    /** Verify-confirm body (OpenAPI {@code EmergencyContactVerifyConfirmRequest}). */
    public record VerificationConfirmRequest(
            @NotBlank @Size(max = 128) String token) {
    }

    /** Card body (OpenAPI {@code EmergencyContact}). */
    public record EmergencyContactResponse(
            String id, String label, String contact, String status,
            String consentVersion, String invitedAt, String verifiedAt,
            String verifiedMethod, String verifiedExpiresAt,
            String createdAt, String updatedAt) {
    }

    /** Invite body (OpenAPI {@code EmergencyContactVerificationInvite}). */
    public record VerificationInviteResponse(
            String id, String token, String invitedAt) {
    }

    /** Revoke body (OpenAPI {@code EmergencyContactRevokeResult}). */
    public record RevokeResponse(boolean revoked) {
    }
}
