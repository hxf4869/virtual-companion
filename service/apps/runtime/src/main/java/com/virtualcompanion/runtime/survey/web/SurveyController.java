package com.virtualcompanion.runtime.survey.web;

import com.virtualcompanion.platform.persistence.SurveyService;
import jakarta.validation.Valid;
import java.time.LocalDate;
import java.util.List;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * B1-SURVEY (§26.5 / R45): 被理解感评分采集. One score (1..5) per owner per
 * day, captured 随机会话后; the Beta product gate is computed offline from
 * {@code vc.survey_response}. Active only when the auth datasource is live.
 */
@RestController
@RequestMapping("/api/v1")
// Same lifecycle as the other datasource-backed controllers: only wired when
// the auth datasource is live (the survey SDs live on that pool).
@org.springframework.boot.autoconfigure.condition.ConditionalOnProperty(
        name = "virtual-companion.auth.datasource-enabled",
        havingValue = "true")
public class SurveyController {

    private final SurveyService surveyService;

    public SurveyController(SurveyService surveyService) {
        this.surveyService = surveyService;
    }

    public record SurveyRequest(
            @jakarta.validation.constraints.Min(1) @jakarta.validation.constraints.Max(5)
            int score,
            String conversationId) {
    }

    public record SurveyAcceptedResponse(boolean accepted) {
    }

    @PostMapping("/survey")
    public SurveyAcceptedResponse record(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @jakarta.validation.Valid @RequestBody SurveyRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("A request body is required");
        }
        Long conversation = null;
        if (request.conversationId() != null && !request.conversationId().isBlank()) {
            try {
                conversation = Long.parseLong(request.conversationId());
            } catch (NumberFormatException e) {
                throw new org.springframework.web.server.ResponseStatusException(
                        org.springframework.http.HttpStatus.BAD_REQUEST, "INVALID_REQUEST");
            }
        }
        boolean accepted = surveyService.record(ownerUserId, conversation, request.score());
        return new SurveyAcceptedResponse(accepted);
    }

    /** The owner's own scoring history, newest first. */
    @GetMapping("/survey")
    public List<SurveyRowResponse> list(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @RequestParam(value = "after", required = false) String after,
            @RequestParam(value = "limit", defaultValue = "50") int limit) {
        LocalDate afterDate = after == null || after.isBlank() ? null : parseDate(after);
        int safeLimit = Math.clamp(limit, 1, 200);
        return surveyService.list(ownerUserId, afterDate, safeLimit).stream()
                .map(row -> new SurveyRowResponse(row.date().toString(), row.score()))
                .toList();
    }

    private static LocalDate parseDate(String raw) {
        try {
            return LocalDate.parse(raw);
        } catch (java.time.format.DateTimeParseException e) {
            // Map to the contract's 400 INVALID_REQUEST instead of the
            // catch-all 500 (same shape as MemoryController.parseInstant).
            throw new IllegalArgumentException("after is not a valid date: " + raw, e);
        }
    }

    public record SurveyRowResponse(String date, short score) {
    }
}
