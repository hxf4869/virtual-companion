package com.virtualcompanion.runtime.modelproviders;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest
class ModelProviderPropertiesBindingTest {

    @Autowired
    private ModelProviderProperties properties;

    @Test
    void defaultsAreFailClosed() {
        assertFalse(properties.enabled(), "live providers must be off by default");
        assertEquals("/run/secrets", properties.secretRoot());
        assertTrue(properties.deployments().isEmpty());
    }
}
