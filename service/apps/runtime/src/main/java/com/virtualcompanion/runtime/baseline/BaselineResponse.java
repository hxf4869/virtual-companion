package com.virtualcompanion.runtime.baseline;

import java.util.List;

public record BaselineResponse(
        String application,
        String phase,
        String transport,
        Technology technology,
        Catalogs catalogs,
        TechnicalAlphaCapabilities capabilities) {

    public record Technology(
            String javaVersion,
            String springBootVersion,
            String springAiVersion,
            String springModulithVersion) {
    }

    public record Catalogs(
            String source,
            List<String> riskLevels,
            List<String> generationStates,
            List<String> memoryScopes,
            List<String> modelProtocols,
            List<String> serviceModes) {
    }
}
