package com.virtualcompanion.runtime.baseline;

import com.virtualcompanion.catalog.GenerationState;
import com.virtualcompanion.catalog.MemoryScope;
import com.virtualcompanion.catalog.ModelProtocol;
import com.virtualcompanion.catalog.RiskLevel;
import com.virtualcompanion.catalog.ServiceMode;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import java.util.function.Function;
import org.springframework.stereotype.Service;

@Service
public class BaselineService {

    private static final String APPLICATION_NAME = "virtual-companion-runtime";
    private static final String CATALOG_SOURCE = "specs/generated/java";

    private final TechnicalBaselineProperties properties;
    private final TechnicalAlphaCapabilities capabilities;

    public BaselineService(
            TechnicalBaselineProperties properties,
            CatalogSnapshotLoader catalogSnapshotLoader) {
        this.properties = Objects.requireNonNull(properties, "properties");

        var snapshot = Objects.requireNonNull(catalogSnapshotLoader, "catalogSnapshotLoader").load();
        requireMatch("phase", properties.phase(), snapshot.phase());
        requireMatch("transport", properties.transport(), snapshot.transport());
        this.capabilities = snapshot.capabilities();
    }

    public BaselineResponse current() {
        return new BaselineResponse(
                APPLICATION_NAME,
                properties.phase(),
                properties.transport(),
                new BaselineResponse.Technology(
                        properties.javaVersion(),
                        properties.springBootVersion(),
                        properties.springAiVersion(),
                        properties.springModulithVersion()),
                new BaselineResponse.Catalogs(
                        CATALOG_SOURCE,
                        codes(RiskLevel.values(), RiskLevel::code),
                        codes(GenerationState.values(), GenerationState::code),
                        codes(MemoryScope.values(), MemoryScope::code),
                        codes(ModelProtocol.values(), ModelProtocol::code),
                        codes(ServiceMode.values(), ServiceMode::code)),
                capabilities);
    }

    private static <T> List<String> codes(T[] values, Function<T, String> codeExtractor) {
        return Arrays.stream(values).map(codeExtractor).toList();
    }

    private static void requireMatch(String field, String configured, String catalogValue) {
        if (!Objects.equals(configured, catalogValue)) {
            throw new IllegalStateException(
                    "Technical baseline %s does not match the catalog snapshot".formatted(field));
        }
    }
}
