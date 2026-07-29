package com.virtualcompanion.runtime.baseline;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class BaselineControllerTest {

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        var properties = new TechnicalBaselineProperties(
                "TECHNICAL_ALPHA",
                "HTTP_SSE",
                "25-LTS",
                "4.1.0",
                "2.0.0",
                "2.1.0");
        var controller = new BaselineController(new BaselineService(properties));
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
                .andExpect(jsonPath("$.catalogs.memoryScopes[1]").value("RELATIONSHIP"));
    }

    @Test
    void baselineEndpointIsReadOnly() throws Exception {
        mockMvc.perform(post("/api/internal/baseline"))
                .andExpect(status().isMethodNotAllowed());
    }
}
