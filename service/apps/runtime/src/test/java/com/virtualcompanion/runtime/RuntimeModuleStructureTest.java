package com.virtualcompanion.runtime;

import org.junit.jupiter.api.Test;
import org.springframework.modulith.core.ApplicationModules;

class RuntimeModuleStructureTest {

    @Test
    void applicationModuleStructureIsValid() {
        ApplicationModules.of(VirtualCompanionRuntimeApplication.class).verify();
    }
}
