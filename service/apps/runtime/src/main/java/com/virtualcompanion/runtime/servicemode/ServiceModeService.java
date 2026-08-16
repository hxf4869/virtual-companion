package com.virtualcompanion.runtime.servicemode;

import com.virtualcompanion.runtime.modelproviders.ModelProviderProperties;
import java.util.Objects;
import org.springframework.stereotype.Service;

/**
 * Current generation-service mode for the authenticated caller (FR-RES-005).
 *
 * <p>Technical Alpha reaches exactly two of the service-modes catalog codes:
 *
 * <ul>
 *   <li>{@code FULL_AI} — the master provider switch is on, so the generation
 *       path can attempt live model deployments;</li>
 *   <li>{@code ZERO_LLM} — the master switch is off (the default), so every
 *       generation resolves to the deterministic record mode.</li>
 * </ul>
 *
 * <p>{@code DEGRADED_AI}, {@code SAFETY_RESTRICTED} and {@code MAINTENANCE}
 * exist in the catalog but are never reported here — no reachable state
 * produces them, and the client must never invent one. The summary is plain
 * operational copy (never role-played content), so the UI can show the state
 * without pretending the companion is "tired" or otherwise anthropomorphizing
 * an outage (FR-RES-005).
 */
@Service
public class ServiceModeService {

    public static final String MODE_FULL_AI = "FULL_AI";
    public static final String MODE_ZERO_LLM = "ZERO_LLM";

    private final ModelProviderProperties properties;

    public ServiceModeService(ModelProviderProperties properties) {
        this.properties = Objects.requireNonNull(properties, "properties must not be null");
    }

    /** The current mode and its plain-language summary. */
    public Status current() {
        if (properties.enabled()) {
            return new Status(MODE_FULL_AI, "正常模型服务");
        }
        return new Status(MODE_ZERO_LLM, "当前为无生成模型的受限服务：消息会保存为记录，可查看历史和记忆中心");
    }

    /** Wire status (OpenAPI {@code ServiceModeStatus}). */
    public record Status(String mode, String summary) {
        public Status {
            Objects.requireNonNull(mode, "mode must not be null");
            if (mode.isBlank()) {
                throw new IllegalArgumentException("mode must not be blank");
            }
            Objects.requireNonNull(summary, "summary must not be null");
            if (summary.isBlank()) {
                throw new IllegalArgumentException("summary must not be blank");
            }
        }
    }
}
