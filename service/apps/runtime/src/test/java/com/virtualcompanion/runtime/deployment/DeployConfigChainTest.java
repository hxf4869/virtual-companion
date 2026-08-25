package com.virtualcompanion.runtime.deployment;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

/**
 * DOGFOOD-STABILIZATION-02 defect 3: the deployment configuration chain must
 * actually reach the code. Configuring {@code ops/deploy/.env.example} per
 * DOGFOOD.md only takes effect when every key is (a) passed through
 * {@code docker-compose.yml} into the runtime container and (b) bound to a
 * {@code virtual-companion.*} property in {@code application.yaml} — the
 * round-2 audit found a pass-through gap (no {@code VC_MODERATION_MODE}, no
 * {@code VC_PROVIDER_PLAN_*}) and a dead key
 * ({@code VC_PROVIDER_PLAN_PLAN_NAME}, doubled PLAN, documented as
 * {@code VC_PROVIDER_PLAN_NAME}). This test pins the whole chain so a key
 * that only exists in one file fails the build.
 *
 * <p>Behavioral halves of the chain (the chat-completions client and the
 * provider-plan monitor) are covered by their own unit tests; this test
 * covers the file wiring between them.</p>
 */
class DeployConfigChainTest {

    private static final Path REPO_ROOT = findRepoRoot();

    private static final List<String> PLAN_KEYS = List.of(
            "VC_PROVIDER_PLAN_ENABLED",
            "VC_PROVIDER_PLAN_NAME",
            "VC_PROVIDER_PLAN_VALID_FROM",
            "VC_PROVIDER_PLAN_VALID_UNTIL",
            "VC_PROVIDER_PLAN_TOKEN_CAP",
            "VC_PROVIDER_PLAN_REQUEST_CAP");

    /** container env key -> referenced ${VAR} in docker-compose.yml */
    private static final Pattern COMPOSE_ENV =
            Pattern.compile("^\\s+([A-Z0-9_]+):\\s*\\$\\{([A-Z0-9_]+)");

    private static final Pattern ENV_LINE =
            Pattern.compile("^([A-Z0-9_]+)=(.*)$");

    @Test
    void moderationModeIsExplicitlyChatCompletionsAcrossTheWholeChain() throws IOException {
        Map<String, String> env = envExample();
        Map<String, String> compose = composePassthroughs();

        // DOGFOOD.md prescribes chat-completions; openai-moderations is
        // refused at wiring this round, so the sample config must not
        // default into the refused branch.
        assertThat(env).containsEntry("VC_MODERATION_MODE", "chat-completions");
        assertThat(compose)
                .as("compose must pass VC_MODERATION_MODE through (dogfood default chat-completions)")
                .containsEntry("VC_MODERATION_MODE", "VC_MODERATION_MODE");
        assertThat(composeLine("VC_MODERATION_MODE"))
                .contains(":-chat-completions");
        assertThat(applicationYaml())
                .contains("mode: ${VC_MODERATION_MODE:chat-completions}");
    }

    @Test
    void everyModerationEnvKeyPassesThroughComposeAndBindsInYaml() throws IOException {
        Map<String, String> env = envExample();
        Map<String, String> compose = composePassthroughs();
        String yaml = applicationYaml();

        for (String key : env.keySet().stream()
                .filter(key -> key.startsWith("VC_MODERATION_"))
                .sorted()
                .toList()) {
            assertThat(compose)
                    .as("compose must pass %s through to the runtime container", key)
                    .containsEntry(key, key);
            assertThat(yaml)
                    .as("application.yaml must bind %s to a virtual-companion property", key)
                    .contains("${" + key + ":");
        }
        assertThat(env.keySet().stream().filter(k -> k.startsWith("VC_MODERATION_")).toList())
                .as("the moderation env surface is exactly the wired keys")
                .containsExactlyInAnyOrder(
                        "VC_MODERATION_ENABLED",
                        "VC_MODERATION_MODE",
                        "VC_MODERATION_PROVIDER_REF",
                        "VC_MODERATION_BASE_URL",
                        "VC_MODERATION_MODEL",
                        "VC_MODERATION_MODEL_VERSION",
                        "VC_MODERATION_API_KEY",
                        "VC_MODERATION_PROVIDER_TERMS_VERIFIED",
                        "VC_MODERATION_ALLOWED_HOSTS");
    }

    @Test
    void everyProviderPlanKeyPassesThroughTheWholeChain() throws IOException {
        Map<String, String> env = envExample();
        Map<String, String> compose = composePassthroughs();
        String yaml = applicationYaml();

        for (String key : PLAN_KEYS) {
            assertThat(env)
                    .as(".env.example must declare %s", key)
                    .containsKey(key);
            assertThat(compose)
                    .as("compose must pass %s through to the runtime container", key)
                    .containsEntry(key, key);
            assertThat(yaml)
                    .as("application.yaml must bind %s to a provider-plan property", key)
                    .contains("${" + key + ":");
        }
    }

    @Test
    void generationTermsGateIsFailClosedByDefaultAcrossTheWholeChain() throws IOException {
        // DOGFOOD-STABILIZATION-03 (audit defect B): the generation egress
        // sensitive gate defaults to ON (terms unverified) in every layer —
        // compose passes the flag through with a false default and
        // application.yaml binds it to the same false default, so no
        // deployment inherits an unverified-terms open path by omission.
        Map<String, String> compose = composePassthroughs();
        String yaml = applicationYaml();

        assertThat(compose)
                .as("compose must pass VC_GENERATION_PROVIDER_TERMS_VERIFIED through")
                .containsEntry(
                        "VC_GENERATION_PROVIDER_TERMS_VERIFIED",
                        "VC_GENERATION_PROVIDER_TERMS_VERIFIED");
        assertThat(composeLine("VC_GENERATION_PROVIDER_TERMS_VERIFIED"))
                .as("the compose passthrough defaults to false (fail closed)")
                .contains(":-false");
        assertThat(yaml)
                .as("application.yaml must bind the generation terms flag with a "
                        + "fail-closed default")
                .contains(
                        "generation-provider-terms-verified: "
                                + "${VC_GENERATION_PROVIDER_TERMS_VERIFIED:false}");
    }

    @Test
    void cryptoBackfillOneShotFlagPassesThroughTheWholeChain() throws IOException {
        assertThat(envExample()).containsEntry("VC_CRYPTO_BACKFILL_ENABLED", "false");
        assertThat(composePassthroughs())
                .containsEntry("VC_CRYPTO_BACKFILL_ENABLED", "VC_CRYPTO_BACKFILL_ENABLED");
        assertThat(composeLine("VC_CRYPTO_BACKFILL_ENABLED")).contains(":-false");
        assertThat(applicationYaml())
                .contains("backfill-enabled: ${VC_CRYPTO_BACKFILL_ENABLED:false}");
    }

    @Test
    void theDoubledPlanNameKeyExistsNowhere() throws IOException {
        String legacyKey = "VC_PROVIDER_PLAN_PLAN_NAME";
        assertThat(envExample())
                .as("the legacy doubled key must not survive in .env.example")
                .doesNotContainKey(legacyKey);
        assertThat(Files.readString(REPO_ROOT.resolve("ops/deploy/docker-compose.yml")))
                .doesNotContain(legacyKey);
        assertThat(applicationYaml())
                .as("application.yaml must read VC_PROVIDER_PLAN_NAME (fixed key)")
                .contains("plan-name: ${VC_PROVIDER_PLAN_NAME:}")
                .doesNotContain(legacyKey);
    }

    // ---- file parsing helpers (line-based; the files are flat env maps) ----

    private Map<String, String> envExample() throws IOException {
        Map<String, String> values = new LinkedHashMap<>();
        for (String line : Files.readAllLines(REPO_ROOT.resolve("ops/deploy/.env.example"))) {
            Matcher matcher = ENV_LINE.matcher(line);
            if (matcher.matches()) {
                values.put(matcher.group(1), matcher.group(2).trim());
            }
        }
        return values;
    }

    private Map<String, String> composePassthroughs() throws IOException {
        Map<String, String> values = new HashMap<>();
        for (String line : Files.readAllLines(REPO_ROOT.resolve("ops/deploy/docker-compose.yml"))) {
            Matcher matcher = COMPOSE_ENV.matcher(line);
            if (matcher.find()) {
                values.put(matcher.group(1), matcher.group(2));
            }
        }
        return values;
    }

    private String composeLine(String key) throws IOException {
        return Files.readAllLines(REPO_ROOT.resolve("ops/deploy/docker-compose.yml")).stream()
                .filter(line -> line.trim().startsWith(key + ":"))
                .findFirst()
                .orElse("");
    }

    private String applicationYaml() throws IOException {
        return Files.readString(REPO_ROOT.resolve(
                "service/apps/runtime/src/main/resources/application.yaml"));
    }

    private static Path findRepoRoot() {
        Path dir = Path.of("").toAbsolutePath();
        for (Path current = dir; current != null; current = current.getParent()) {
            if (Files.exists(current.resolve("ops/deploy/docker-compose.yml"))
                    && Files.exists(current.resolve(".git"))) {
                return current;
            }
        }
        throw new IllegalStateException(
                "repo root not found above " + dir + "; DeployConfigChainTest must run in-tree");
    }
}
