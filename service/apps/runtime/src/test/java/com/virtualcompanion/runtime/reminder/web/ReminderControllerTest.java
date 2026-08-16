package com.virtualcompanion.runtime.reminder.web;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.virtualcompanion.platform.persistence.ReminderRecord;
import com.virtualcompanion.platform.persistence.ReminderService;
import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import com.virtualcompanion.runtime.web.RuntimeApiExceptionHandler;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
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
 * Standalone controller test for the reminder HTTP API (REMINDER /
 * FR-NOTIFY-001): create/list/update/delete happy paths, the 400
 * INVALID_REQUEST contract for unapproved codes and malformed instants, and
 * the 404 NOT_FOUND_OR_FORBIDDEN contract for foreign/absent reminders.
 */
class ReminderControllerTest {

    private static final Instant NOW = Instant.parse("2026-08-16T12:00:00Z");

    private ReminderService reminderService;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        reminderService = mock(ReminderService.class);
        ReminderController controller = new ReminderController(reminderService);
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

    private static ReminderRecord record() {
        return new ReminderRecord(
                55L, 10L, "晚上十点提醒我准备休息", NOW, "WEEKLY", "ACTIVE", NOW, NOW);
    }

    @Test
    void createReturnsTheNewReminder() throws Exception {
        when(reminderService.create(1L, 10L, "晚上十点提醒我准备休息", NOW, "NONE"))
                .thenReturn(55L);
        when(reminderService.get(1L, 55L)).thenReturn(Optional.of(record()));

        mockMvc.perform(post("/api/v1/relationships/10/reminders")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\":\"晚上十点提醒我准备休息\",\"remindAt\":\"2026-08-16T12:00:00Z\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.reminderId").value(55))
                .andExpect(jsonPath("$.relationshipId").value(10))
                .andExpect(jsonPath("$.status").value("ACTIVE"));
    }

    @Test
    void createUnapprovedRecurrenceMapsTo400() throws Exception {
        mockMvc.perform(post("/api/v1/relationships/10/reminders")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\":\"每周日提醒\",\"remindAt\":\"2026-08-16T12:00:00Z\","
                                + "\"recurrence\":\"MONTHLY\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    @Test
    void updateUnapprovedStatusMapsTo400() throws Exception {
        mockMvc.perform(patch("/api/v1/reminders/55")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\":\"text\",\"remindAt\":\"2026-08-16T12:00:00Z\","
                                + "\"recurrence\":\"NONE\",\"status\":\"DONE\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    @Test
    void createMalformedInstantMapsTo400() throws Exception {
        mockMvc.perform(post("/api/v1/relationships/10/reminders")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\":\"text\",\"remindAt\":\"not-an-instant\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    @Test
    void listReturnsTheSoonestFirstPage() throws Exception {
        when(reminderService.list(1L, 10L, null, null)).thenReturn(List.of(record()));

        mockMvc.perform(get("/api/v1/relationships/10/reminders"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].reminderId").value(55));
    }

    @Test
    void updateReturnsTheUpdatedReminder() throws Exception {
        when(reminderService.update(eq(1L), eq(55L), eq("text"), any(), eq("NONE"), eq("DISMISSED")))
                .thenReturn(Optional.of(record()));

        mockMvc.perform(patch("/api/v1/reminders/55")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\":\"text\",\"remindAt\":\"2026-08-16T12:00:00Z\","
                                + "\"recurrence\":\"NONE\",\"status\":\"DISMISSED\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.reminderId").value(55));
    }

    @Test
    void updateForeignOrAbsentMapsTo404() throws Exception {
        when(reminderService.update(eq(1L), eq(999L), eq("text"), any(), eq("NONE"), eq("DISMISSED")))
                .thenReturn(Optional.empty());

        mockMvc.perform(patch("/api/v1/reminders/999")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\":\"text\",\"remindAt\":\"2026-08-16T12:00:00Z\","
                                + "\"recurrence\":\"NONE\",\"status\":\"DISMISSED\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND_OR_FORBIDDEN"));
    }

    @Test
    void deleteReturnsOkOnAConfirmedDelete() throws Exception {
        when(reminderService.delete(1L, 55L)).thenReturn(true);

        mockMvc.perform(delete("/api/v1/reminders/55"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ok").value(true));
    }

    @Test
    void deleteForeignOrAbsentMapsTo404() throws Exception {
        when(reminderService.delete(1L, 999L)).thenReturn(false);

        mockMvc.perform(delete("/api/v1/reminders/999"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND_OR_FORBIDDEN"));
    }
}
