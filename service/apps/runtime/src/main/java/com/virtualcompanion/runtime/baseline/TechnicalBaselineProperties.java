package com.virtualcompanion.runtime.baseline;

import jakarta.validation.constraints.NotBlank;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@ConfigurationProperties("virtual-companion.baseline")
@Validated
public record TechnicalBaselineProperties(
        @NotBlank String phase,
        @NotBlank String transport,
        @NotBlank String javaVersion,
        @NotBlank String springBootVersion,
        @NotBlank String springAiVersion,
        @NotBlank String springModulithVersion) {
}
