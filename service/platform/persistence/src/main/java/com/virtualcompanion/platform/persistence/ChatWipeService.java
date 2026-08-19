package com.virtualcompanion.platform.persistence;

import java.util.Objects;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Account-wide chat wipe over the V57 SD functions (CHAT-WIPE, FR-DATA-003
 * 全部聊天删除).
 *
 * <p>The wipe cancels in-flight GENERATION / MEMORY_EXTRACT work items under
 * the caller's conversations, then deletes every conversation across all
 * relationships (FK cascade removes messages and generations). Relationships,
 * confirmed memories, reminders and account-level rows survive. All access
 * is owner-scoped and re-verified in SQL (trusted-owner pattern).
 */
public class ChatWipeService {

    /** Preview counts (what a wipe would clear right now). */
    public record ChatWipePreview(
            long conversationCount, long messageCount, long inFlightCount) {
    }

    /** Execution result (what a wipe actually cleared). */
    public record ChatWipeResult(
            long conversationsDeleted, long messagesDeleted, long workItemsCancelled) {
    }

    private final JdbcTemplate jdbc;

    public ChatWipeService(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    /** Counts of what a wipe would clear right now. */
    public ChatWipePreview preview(long ownerUserId) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        return jdbc.queryForObject(
                "SELECT out_conversation_count, out_message_count, out_in_flight_count "
                        + "FROM vc.preview_chat_wipe(?)",
                (rs, rowNum) -> new ChatWipePreview(
                        rs.getLong("out_conversation_count"),
                        rs.getLong("out_message_count"),
                        rs.getLong("out_in_flight_count")),
                ownerUserId);
    }

    /** Execute the wipe; returns what was cleared (zeroes on a repeat). */
    public ChatWipeResult wipeAll(long ownerUserId) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        return jdbc.queryForObject(
                "SELECT out_conversations_deleted, out_messages_deleted, "
                        + "out_work_items_cancelled FROM vc.wipe_all_chats(?)",
                (rs, rowNum) -> new ChatWipeResult(
                        rs.getLong("out_conversations_deleted"),
                        rs.getLong("out_messages_deleted"),
                        rs.getLong("out_work_items_cancelled")),
                ownerUserId);
    }
}
