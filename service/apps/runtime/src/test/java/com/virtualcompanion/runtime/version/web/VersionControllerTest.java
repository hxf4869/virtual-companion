package com.virtualcompanion.runtime.version.web;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

/**
 * Standalone controller test for the public {@code GET /api/v1/version}
 * endpoint: the version is always present (OpenAPI {@code required}) and the
 * commit is optional (absent deployments serve {@code null}). No security
 * resolver is needed — the endpoint is public ({@code security: []}); the
 * permitAll rule itself is covered by the auth security integration layer.
 */
class VersionControllerTest {

    @Test
    void getVersionReturnsVersionAndCommit() throws Exception {
        VersionController controller = new VersionController("0.1.0-SNAPSHOT", "ecde04f");
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        mockMvc.perform(get("/api/v1/version"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value("0.1.0-SNAPSHOT"))
                .andExpect(jsonPath("$.commit").value("ecde04f"));
    }

    @Test
    void getVersionWithoutCommitServesNullCommit() throws Exception {
        VersionController controller = new VersionController("0.1.0-SNAPSHOT", null);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        mockMvc.perform(get("/api/v1/version"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value("0.1.0-SNAPSHOT"))
                .andExpect(jsonPath("$.commit").doesNotExist());
    }
}
