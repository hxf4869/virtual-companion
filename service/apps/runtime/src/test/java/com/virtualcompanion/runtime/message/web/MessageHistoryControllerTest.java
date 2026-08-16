package com.virtualcompanion.runtime.message.web;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.virtualcompanion.platform.persistence.MessageHistoryRecord;
import com.virtualcompanion.platform.persistence.MessageHistoryService;
import com.virtualcompanion.platform.persistence.MessageRepository;
import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import com.virtualcompanion.runtime.web.RuntimeApiExceptionHandler;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.MethodParameter;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;

/**
 * Standalone controller test for the message history HTTP API (TASK-0179) and
 * single-message deletion (MSG-DELETE): happy-path pagination, the empty-page
 * contract for a foreign/absent conversation (the OpenAPI endpoint has no
 * 404), the 400 INVALID_REQUEST contract for a malformed id, cursor or limit,
 * the confirmed-delete response, and the 404 NOT_FOUND_OR_FORBIDDEN contract
 * for a foreign or absent message. The
 * {@code @AuthenticationPrincipal(expression = "accountId")} resolver is
 * replicated from the relationship controller tests; the owner GUC binding
 * itself is covered by the auth integration layer.
 */
class MessageHistoryControllerTest {

    private static final Instant NOW = Instant.parse("2026-08-12T12:00:00Z");

    private MessageHistoryService messageHistoryService;
    private MessageRepository messageRepository;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        messageHistoryService = mock(MessageHistoryService.class);
        messageRepository = mock(MessageRepository.class);
        MessageHistoryController controller =
                new MessageHistoryController(messageHistoryService, messageRepository);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new RuntimeApiExceptionHandler())
                .setCustomArgumentResolvers(new HandlerMethodArgumentResolver() {
                    @Override
                    public boolean supportsParameter(MethodParameter parameter) {
                        return parameter.hasParameterAnnotation(AuthenticationPrincipal.class);
                    }

                    @Override
                    public Object resolveArgument(MethodParameter parameter,
                            ModelAndViewContainer mavContainer, NativeWebRequest webRequest,
                            WebDataBinderFactory binderFactory) {
                        JwtTokenService.Principal principal =
                                new JwtTokenService.Principal(1, "USER", "alice");
                        if (parameter.getParameterType() == long.class) {
                            return principal.accountId();
                        }
                        return principal;
                    }
                })
                .build();
    }

    private static MessageHistoryRecord message(long id, String role, String content) {
        return new MessageHistoryRecord(id, role, content, NOW);
    }

    @Test
    void listMessagesReturnsTheCallersPage() throws Exception {
        when(messageHistoryService.listMessages(1L, 100L, 5L, 20)).thenReturn(List.of(
                message(6L, "assistant", "hi"),
                message(7L, "user", "hello")));

        mockMvc.perform(get("/api/v1/conversations/100/messages")
                        .param("after", "5")
                        .param("limit", "20"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].messageId").value(6))
                .andExpect(jsonPath("$[0].conversationId").value(100))
                .andExpect(jsonPath("$[0].role").value("assistant"))
                .andExpect(jsonPath("$[0].content").value("hi"))
                .andExpect(jsonPath("$[0].createdAt").value("2026-08-12T12:00:00Z"))
                .andExpect(jsonPath("$[1].messageId").value(7));

        verify(messageHistoryService).listMessages(1L, 100L, 5L, 20);
    }

    @Test
    void listMessagesReturnsEmptyPageForForeignOrAbsentConversation() throws Exception {
        when(messageHistoryService.listMessages(1L, 999L, null, null)).thenReturn(List.of());

        mockMvc.perform(get("/api/v1/conversations/999/messages"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));

        verify(messageHistoryService).listMessages(1L, 999L, null, null);
    }

    @Test
    void listMessagesWithoutQueryParamsDelegatesDefaultsToTheService() throws Exception {
        when(messageHistoryService.listMessages(1L, 100L, null, null)).thenReturn(List.of());

        mockMvc.perform(get("/api/v1/conversations/100/messages"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));

        verify(messageHistoryService).listMessages(1L, 100L, null, null);
    }

    @Test
    void listMessagesRejectsNonNumericAfterCursor() throws Exception {
        mockMvc.perform(get("/api/v1/conversations/100/messages").param("after", "abc"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    @Test
    void listMessagesRejectsNonNumericLimit() throws Exception {
        mockMvc.perform(get("/api/v1/conversations/100/messages").param("limit", "abc"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    @Test
    void listMessagesRejectsInvalidConversationId() throws Exception {
        mockMvc.perform(get("/api/v1/conversations/not-a-number/messages"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    // ---- MSG-DELETE (V37) ----

    @Test
    void deleteMessageReturnsOkOnAConfirmedDelete() throws Exception {
        when(messageRepository.deleteMessage(1L, 100L, 7L)).thenReturn(true);

        mockMvc.perform(delete("/api/v1/conversations/100/messages/7"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ok").value(true));

        verify(messageRepository).deleteMessage(1L, 100L, 7L);
    }

    @Test
    void deleteMessageMapsForeignOrAbsentTo404() throws Exception {
        when(messageRepository.deleteMessage(1L, 100L, 999L)).thenReturn(false);

        mockMvc.perform(delete("/api/v1/conversations/100/messages/999"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND_OR_FORBIDDEN"));
    }

    @Test
    void deleteMessageRejectsMalformedIds() throws Exception {
        mockMvc.perform(delete("/api/v1/conversations/not-a-number/messages/7"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));

        mockMvc.perform(delete("/api/v1/conversations/100/messages/not-a-number"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    // ---- MEM-NEG (V44): 不记住 negative-memory marker ----

    @Test
    void setNoMemoryFlipsTheMarkerAndReturnsTheUpdatedMessage() throws Exception {
        when(messageRepository.setNoMemory(1L, 100L, 7L, true)).thenReturn(true);
        when(messageHistoryService.listMessages(1L, 100L, 6L, 1))
                .thenReturn(List.of(new MessageHistoryRecord(
                        7L, "user", "这条不要记住", java.time.Instant.parse("2026-08-17T08:00:00Z"), true)));

        mockMvc.perform(patch("/api/v1/conversations/100/messages/7")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"noMemory\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.messageId").value(7))
                .andExpect(jsonPath("$.noMemory").value(true));

        verify(messageRepository).setNoMemory(1L, 100L, 7L, true);
    }

    @Test
    void setNoMemoryMapsForeignOrAbsentTo404() throws Exception {
        when(messageRepository.setNoMemory(1L, 100L, 999L, true)).thenReturn(false);

        mockMvc.perform(patch("/api/v1/conversations/100/messages/999")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"noMemory\":true}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND_OR_FORBIDDEN"));
    }

    @Test
    void setNoMemoryRejectsMalformedIds() throws Exception {
        mockMvc.perform(patch("/api/v1/conversations/not-a-number/messages/7")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"noMemory\":true}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }
}
