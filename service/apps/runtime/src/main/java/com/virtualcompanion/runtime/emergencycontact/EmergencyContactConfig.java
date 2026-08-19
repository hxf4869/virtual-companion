package com.virtualcompanion.runtime.emergencycontact;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * EMERGENCY-CONTACT wiring: the application-layer cipher bean, built from the
 * deployment-injected key. Bound to the same datasource flag as the
 * controller — the lifecycle lives in the database (V65).
 */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(
        name = "virtual-companion.auth.datasource-enabled",
        havingValue = "true")
public class EmergencyContactConfig {

    @Bean
    public EmergencyContactCipher emergencyContactCipher(
            EmergencyContactProperties properties) {
        return new EmergencyContactCipher(properties.encryptionKey());
    }
}
