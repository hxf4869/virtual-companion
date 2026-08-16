package com.virtualcompanion.runtime.conversation.web;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.virtualcompanion.platform.persistence.ConversationCreateService;
import com.virtualcompanion.platform.persistence.ConversationListRecord;
import com.virtualcompanion.platform.persistence.ConversationListService;
import com.virtualcompanion.platform.persistence.ConversationRepository;
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
 * Standalone controller test for the conversation intake endpoint (TASK-0174):
 * a conversation is created under one of the caller's relationships and the
 * allocated id is returned; a non-positive or malformed relationship id maps to
 * 400 INVALID_REQUEST. The {@code @AuthenticationPrincipal} resolver is
 * replicated from the message-history / memory controller tests; the owner GUC
 * binding itself is covered by the auth integration layer.
 */
class ConversationControllerTest {

    // ---- CONV-MGMT: delete + rename ----

    @Test
    void deleteConversationReturnsOkOnConfirmedDelete() throws Exception {
        when(conversationRepository.delete(1L, 100L)).thenReturn(true);

        mockMvc.perform(delete("/api/v1/conversations/100"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ok").value(true));

        verify(conversationRepository).delete(1L, 100L);
    }

    @Test
    void deleteConversationMapsForeignOrAbsentTo404() throws Exception {
        when(conversationRepository.delete(1L, 100L)).thenReturn(false);

        mockMvc.perform(delete("/api/v1/conversations/100"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND_OR_FORBIDDEN"));
    }

    @Test
    void renameConversationReturnsTheAppliedTitle() throws Exception {
        when(conversationRepository.rename(1L, 100L, "周二的夜聊")).thenReturn(true);

        mockMvc.perform(patch("/api/v1/conversations/100")
                        .contentType("application/json")
                        .content("{\"title\":\"周二的夜聊\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.conversationId").value(100))
                .andExpect(jsonPath("$.title").value("周二的夜聊"));

        verify(conversationRepository).rename(1L, 100L, "周二的夜聊");
    }

    @Test
    void renameConversationMapsForeignOrAbsentTo404() throws Exception {
        when(conversationRepository.rename(1L, 100L, "x")).thenReturn(false);

        mockMvc.perform(patch("/api/v1/conversations/100")
                        .contentType("application/json")
                        .content("{\"title\":\"x\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND_OR_FORBIDDEN"));
    }


    private ConversationCreateService conversationCreateService;
    private ConversationListService conversationListService;
    private ConversationRepository conversationRepository;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        conversationCreateService = mock(ConversationCreateService.class);
        conversationListService = mock(ConversationListService.class);
        conversationRepository = mock(ConversationRepository.class);
        ConversationController controller = new ConversationController(
                conversationCreateService, conversationListService, conversationRepository);
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

    @Test
    void createReturnsTheAllocatedConversationId() throws Exception {
        when(conversationCreateService.create(1L, 7L, false)).thenReturn(120L);

        mockMvc.perform(post("/api/v1/conversations")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"relationshipId\":7}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.conversationId").value(120));

        verify(conversationCreateService).create(1L, 7L, false);
    }

    @Test
    void createPassesTheIncognitoFlagThrough() throws Exception {
        when(conversationCreateService.create(1L, 7L, true)).thenReturn(121L);

        mockMvc.perform(post("/api/v1/conversations")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"relationshipId\":7,\"incognito\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.conversationId").value(121));

        verify(conversationCreateService).create(1L, 7L, true);
    }

    @Test
    void createNonPositiveRelationshipIdMapsTo400() throws Exception {
        mockMvc.perform(post("/api/v1/conversations")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"relationshipId\":0}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    @Test
    void createMissingBodyMapsTo400() throws Exception {
        mockMvc.perform(post("/api/v1/conversations")
                        .contentType(MediaType.APPLICATION_JSON))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    // ---- CONV-HIST list ----

    @Test
    void listReturnsTheCallersConversationsWithPreview() throws Exception {
        Instant now = Instant.parse("2026-08-16T08:00:00Z");
        when(conversationListService.listConversations(1L, 7L, null, null))
                .thenReturn(List.of(
                        new ConversationListRecord(100L, 7L, now, "assistant", "好的，我在听", "周二的夜聊"),
                        new ConversationListRecord(101L, 7L, now, null, null, null)));

        mockMvc.perform(get("/api/v1/conversations").param("relationshipId", "7"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].conversationId").value(100))
                .andExpect(jsonPath("$[0].relationshipId").value(7))
                .andExpect(jsonPath("$[0].lastMessageRole").value("assistant"))
                .andExpect(jsonPath("$[0].lastMessagePreview").value("好的，我在听"))
                .andExpect(jsonPath("$[1].conversationId").value(101))
                .andExpect(jsonPath("$[1].lastMessageRole").isEmpty())
                .andExpect(jsonPath("$[1].lastMessagePreview").isEmpty());

        verify(conversationListService).listConversations(1L, 7L, null, null);
    }

    @Test
    void listPassesCursorAndLimitThrough() throws Exception {
        when(conversationListService.listConversations(1L, null, 42L, 20)).thenReturn(List.of());

        mockMvc.perform(get("/api/v1/conversations").param("after", "42").param("limit", "20"))
                .andExpect(status().isOk());

        verify(conversationListService).listConversations(1L, null, 42L, 20);
    }

    @Test
    void listMalformedParametersMapTo400() throws Exception {
        mockMvc.perform(get("/api/v1/conversations").param("after", "not-a-number"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));

        mockMvc.perform(get("/api/v1/conversations").param("limit", "many"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }
}
