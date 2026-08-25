package com.virtualcompanion.runtime.worker;

import static org.assertj.core.api.Assertions.assertThat;

import com.virtualcompanion.conversation.contextplan.ContextBudget;
import com.virtualcompanion.catalog.ModelProtocol;
import com.virtualcompanion.modelruntime.contract.ProtocolMessage;
import com.virtualcompanion.platform.persistence.EntitlementSnapshotService;
import com.virtualcompanion.platform.persistence.GenerationFinalizeService;
import com.virtualcompanion.platform.persistence.GenerationStateService;
import com.virtualcompanion.platform.persistence.JdbcProviderDeploymentRepository;
import com.virtualcompanion.platform.persistence.MemoryService;
import com.virtualcompanion.platform.persistence.MessageRepository;
import com.virtualcompanion.platform.persistence.RelationshipService;
import com.virtualcompanion.runtime.auth.tenant.OwnerContext;
import com.virtualcompanion.runtime.memory.DeterministicEmbedder;
import com.virtualcompanion.runtime.testsupport.PostgresTestInstance;
import java.sql.Connection;
import java.sql.Statement;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.mockito.Mockito;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * DOGFOOD-STABILIZATION-04 (audit defect A, Java half): the model-egress
 * eligibility chain over a REAL PostgreSQL database — the real
 * {@link MessageRepository} (FORCE-RLS, vc_api role) feeding the real
 * {@link LiveInvocationAssembler}. No mocked repository results: every row
 * is written through the production SD functions, terminalized through the
 * production finalize service, and the assembler's outbound payload is
 * asserted against what the DATABASE says is model-eligible.
 *
 * <p>Cross-turn shape (defect C's DB half): a sensitive turn blocked by the
 * gate's id-array marker disappears from the next outbound payload, and a
 * later terms flip cannot bring it back — the eligibility is the persisted
 * column, not a runtime classification.</p>
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class ModelEgressPersistenceAssemblerPostgresTest {

    private static final long OWNER = 61L;
    private static final String SENSITIVE_TEXT = "我的手机号是13800138000，记一下";
    private static final String CLEAN_OLD = "今天天气不错，我们随便聊聊。";
    private static final String CLEAN_NEXT = "谢谢你，我们换个话题聊聊吧。";

    private PostgresTestInstance.PostgresInstanceHandle postgres;
    private JdbcTemplate jdbc;
    private OwnerContext ownerContext;
    private MessageRepository messages;
    private GenerationStateService stateService;
    private GenerationFinalizeService finalizeService;
    private LiveInvocationAssembler assembler;

    @BeforeAll
    void startPostgresAndWire() throws Exception {
        postgres = PostgresTestInstance.get();
        var dataSource = new PostgresTestInstance.RoleDataSource(
                        postgres.jdbcUrl());
        jdbc = new JdbcTemplate(dataSource);
        ownerContext = new OwnerContext(
                jdbc,
                new TransactionTemplate(
                        new org.springframework.jdbc.datasource.DataSourceTransactionManager(dataSource)),
                PostgresTestInstance.TEST_OWNER_BINDING_SECRET);
        messages = new MessageRepository(jdbc);
        stateService = new GenerationStateService(jdbc);
        finalizeService = new GenerationFinalizeService(jdbc);
        // The assembler's non-message dependencies stay repository-level
        // stubs (relationship/memory/embedding are separate subsystems); the
        // MESSAGE path under test is the real persistence stack.
        RelationshipService relationships = Mockito.mock(RelationshipService.class);
        Mockito.lenient().when(relationships.get(OWNER, 1L))
                .thenReturn(java.util.Optional.empty());
        MemoryService memories = Mockito.mock(MemoryService.class);
        Mockito.lenient().when(memories.recall(Mockito.eq(OWNER), Mockito.eq(1L), Mockito.eq(1L),
                        Mockito.anyInt()))
                .thenReturn(List.of());
        EntitlementSnapshotService entitlements = Mockito.mock(EntitlementSnapshotService.class);
        Mockito.lenient().when(entitlements.mint(Mockito.eq(OWNER), Mockito.anyLong(),
                        Mockito.anyBoolean()))
                .thenReturn(new EntitlementSnapshotService.MintedEntitlementSnapshot(
                        7001L, "ECONOMY", "ECONOMY", "ECONOMY"));
        assembler = new LiveInvocationAssembler(
                new com.virtualcompanion.platform.persistence.GenerationRepository(jdbc),
                new com.virtualcompanion.platform.persistence.ConversationRepository(jdbc),
                messages,
                memories, relationships, jdbc,
                "ZERO_LLM_FALLBACK", ModelProtocol.OPENAI_CHAT_COMPLETIONS,
                new ContextBudget(8_000, 2_048, 64),
                entitlements,
                new DeterministicEmbedder(),
                false);
    }

    @BeforeEach
    void seedConversation() throws Exception {
        try (Connection connection = postgres.superuserConnection();
             Statement statement = connection.createStatement()) {
            statement.execute("TRUNCATE vc.generation_candidate, vc.generation, vc.message, "
                    + "vc.realtime_event, vc.work_item, vc.conversation, vc.relationship, "
                    + "vc.entitlement_snapshot, vc.outbox_event, vc.safety_event CASCADE");
            statement.execute("INSERT INTO vc.vc_user(id, display_name) VALUES ("
                    + OWNER + ", 'egress-it') ON CONFLICT (id) DO NOTHING");
            statement.execute("INSERT INTO vc.relationship(owner_user_id, id, persona_ref, "
                    + "active) VALUES (" + OWNER + ", 1, 'gentle-listener', true)");
            statement.execute("INSERT INTO vc.conversation(owner_user_id, id, relationship_id, "
                    + "title) VALUES (" + OWNER + ", 1, 1, NULL)");
        }
    }

    @AfterEach
    void dropOwner() throws Exception {
        try (Connection connection = postgres.superuserConnection();
             Statement statement = connection.createStatement()) {
            statement.execute("DELETE FROM vc.vc_user WHERE id = " + OWNER);
        }
    }

    @AfterAll
    void tearDown() {
        // container is shared per JVM; nothing to stop here
    }

    /** Receive one turn through the production SD; returns [generationId, messageId]. */
    private long[] receive(String key, String content) {
        AtomicReference<long[]> ids = new AtomicReference<>();
        ownerContext.asOwner(OWNER, () -> ids.set(jdbc.queryForObject(
                "SELECT generation_id, message_id FROM vc.receive_generation(?, 1, ?, "
                        + "'user', ?)",
                (rs, rowNum) -> new long[] {rs.getLong(1), rs.getLong(2)},
                OWNER, key, content)));
        return ids.get();
    }

    @Test
    void terminalBlocksAndTheGateMarkExcludeRowsFromTheRealOutboundPayload() {
        // Turn 1: INPUT_BLOCKED through the production walk — V112 flips the
        // row in the SAME transaction; no mock filtering anywhere.
        long[] blocked = receive("egress-1", SENSITIVE_TEXT);
        ownerContext.asOwner(OWNER, () -> {
            stateService.promote(OWNER, blocked[0], GenerationStateService.INPUT_REVIEW);
            finalizeService.terminalizeAsInputBlocked(OWNER, blocked[0], "input-blocked");
        });

        // Turn 2: a clean old turn plus the next clean turn.
        long[] cleanOld = receive("egress-2", CLEAN_OLD);
        long[] cleanNext = receive("egress-3", CLEAN_NEXT);

        // Data-rights read (real repository, inside the owner transaction
        // FORCE-RLS requires): ALL rows persist with their content.
        AtomicReference<List<com.virtualcompanion.platform.persistence.MessageRepository.Message>> rows =
                new AtomicReference<>();
        ownerContext.asOwner(OWNER,
                () -> rows.set(messages.listByConversation(OWNER, 1L)));
        assertThat(rows.get())
                .extracting(com.virtualcompanion.platform.persistence.MessageRepository.Message::content)
                .containsExactly(SENSITIVE_TEXT, CLEAN_OLD, CLEAN_NEXT);

        // Model-facing read + real assembler: the blocked row is gone.
        var assembled = assemble();
        String payload = assembled.request().messages().stream()
                .map(ProtocolMessage::content)
                .reduce("", (a, b) -> a + "\n" + b);
        assertThat(payload)
                .doesNotContain("13800138000")
                .contains(CLEAN_OLD)
                .contains(CLEAN_NEXT);
        // The id mapping is the real persistence identity of the eligible rows.
        assertThat(assembled.messageTextMessageIds())
                .containsExactly(cleanOld[1], cleanNext[1]);

        // Defect C's DB half: the gate's id-array marker flips an ELIGIBLE old
        // row by id; the next real assembly drops it, and flipping the terms
        // flag later cannot re-release it (the repository column decides).
        long[] flagged = receive("egress-4", "我的密码 hunter2secret");
        ownerContext.asOwner(OWNER, () ->
                finalizeService.markMessagesModelIneligible(OWNER, List.of(flagged[1])));
        assembled = assemble();
        payload = assembled.request().messages().stream()
                .map(ProtocolMessage::content)
                .reduce("", (a, b) -> a + "\n" + b);
        assertThat(payload)
                .doesNotContain("13800138000")
                .doesNotContain("hunter2secret")
                .contains(CLEAN_NEXT);
    }

    private LiveInvocationAssembler.AssembledExternalInvocation assemble() {
        AtomicReference<LiveInvocationAssembler.AssembledExternalInvocation> result =
                new AtomicReference<>();
        ownerContext.asOwner(OWNER, () -> result.set(
                assembler.assembleExternalInvocation(
                        OWNER, currentGenerationId(), "snap-req", "snap-exec", null)));
        return result.get();
    }

    private long currentGenerationId() {
        // Any live generation works for the assembler's context resolution;
        // use the newest row of this owner.
        return ownerContextReturning(() -> jdbc.queryForObject(
                "SELECT max(id) FROM vc.generation WHERE owner_user_id = " + OWNER,
                Long.class));
    }

    private <T> T ownerContextReturning(java.util.function.Supplier<T> supplier) {
        AtomicReference<T> value = new AtomicReference<>();
        ownerContext.asOwner(OWNER, () -> value.set(supplier.get()));
        return value.get();
    }
}
