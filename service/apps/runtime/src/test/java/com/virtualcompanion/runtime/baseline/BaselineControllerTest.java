package com.virtualcompanion.runtime.baseline;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import tools.jackson.databind.json.JsonMapper;

class BaselineControllerTest {

    private CatalogSnapshotLoader catalogSnapshotLoader;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        catalogSnapshotLoader = new CatalogSnapshotLoader(JsonMapper.builder().build());
        var controller = new BaselineController(new BaselineService(
                baselineProperties("TECHNICAL_ALPHA", "HTTP_SSE"),
                catalogSnapshotLoader));
        mockMvc = MockMvcBuilders.standaloneSetup(controller).build();
    }

    @Test
    void returnsTechnicalAndGeneratedCatalogBaseline() throws Exception {
        mockMvc.perform(get("/api/internal/baseline"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.phase").value("TECHNICAL_ALPHA"))
                .andExpect(jsonPath("$.transport").value("HTTP_SSE"))
                .andExpect(jsonPath("$.technology.javaVersion").value("25-LTS"))
                .andExpect(jsonPath("$.catalogs.source").value("specs/generated/java"))
                .andExpect(jsonPath("$.catalogs.riskLevels[0]").value("R0_NORMAL"))
                .andExpect(jsonPath("$.catalogs.generationStates[0]").value("CREATED"))
                .andExpect(jsonPath("$.catalogs.memoryScopes[1]").value("RELATIONSHIP"))
                .andExpect(jsonPath("$.capabilities.source").value(
                        "specs/generated/catalog.snapshot.json"
                                + "#sources/product-scope.yaml/document"))
                .andExpect(jsonPath("$.capabilities.publicRegistrationEnabled").value(false))
                .andExpect(jsonPath("$.capabilities.paymentEnabled").value(false))
                .andExpect(jsonPath("$.capabilities.romanceModeEnabled").value(false))
                .andExpect(jsonPath("$.capabilities.voiceEnabled").value(false))
                .andExpect(jsonPath("$.capabilities.imageEnabled").value(false))
                .andExpect(jsonPath("$.capabilities.websocketEnabled").value(false))
                .andExpect(jsonPath("$.capabilities.betaGenerationEnabledByDefault").value(false))
                .andExpect(jsonPath("$.capabilities.phase").doesNotExist())
                .andExpect(jsonPath("$.capabilities.transport").doesNotExist())
                .andExpect(jsonPath("$.sources").doesNotExist())
                .andExpect(jsonPath("$.generatedEnums").doesNotExist());
    }

    @Test
    void baselineEndpointIsReadOnly() throws Exception {
        mockMvc.perform(post("/api/internal/baseline"))
                .andExpect(status().isMethodNotAllowed());
    }

    @Test
    void rejectsPhaseDriftAgainstCatalogSnapshot() {
        assertThatThrownBy(() -> new BaselineService(
                        baselineProperties("BETA", "HTTP_SSE"),
                        catalogSnapshotLoader))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("phase");
    }

    @Test
    void rejectsTransportDriftAgainstCatalogSnapshot() {
        assertThatThrownBy(() -> new BaselineService(
                        baselineProperties("TECHNICAL_ALPHA", "WEBSOCKET"),
                        catalogSnapshotLoader))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("transport");
    }

    private static TechnicalBaselineProperties baselineProperties(String phase, String transport) {
        return new TechnicalBaselineProperties(
                phase,
                transport,
                "25-LTS",
                "4.1.0",
                "2.0.0",
                "2.1.0");
    }
}
