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
 *   <li>{@code FULL_AI} — the master provider switch is on and the deployment
 *       runs at its entitled service class;</li>
 *   <li>{@code DEGRADED_AI} (V62, §12.10 D2) — the master switch is on but the
 *       deployment declares a degradation (running one class below the
 *       entitlement); the snapshot records 应得 vs 实际;</li>
 *   <li>{@code ZERO_LLM} — the master switch is off (the default), so every
 *       generation resolves to the deterministic record mode.</li>
 * </ul>
 *
 * <p>{@code SAFETY_RESTRICTED} and {@code MAINTENANCE}
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
    public static final String MODE_DEGRADED_AI = "DEGRADED_AI";

    private final ModelProviderProperties properties;

    public ServiceModeService(ModelProviderProperties properties) {
        this.properties = Objects.requireNonNull(properties, "properties must not be null");
    }

    /** The current mode and its plain-language summary. */
    public Status current() {
        if (properties.enabled()) {
            if (properties.degraded()) {
                // §12.10 D2 / FR-ENT-006: 降级不是用户选择，明说较低等级运行。
                return new Status(MODE_DEGRADED_AI,
                        "当前以较低服务等级运行（降级）：可以继续对话，质量可能低于正常水平");
            }
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
