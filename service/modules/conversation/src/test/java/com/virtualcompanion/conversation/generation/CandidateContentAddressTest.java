package com.virtualcompanion.conversation.generation;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

class CandidateContentAddressTest {

    @Test
    void hash_is_deterministic_for_exact_unicode_bytes() {
        var content = new CandidateContent.Text("陪伴🙂e\u0301汉字".repeat(1_024));

        assertEquals(
                CandidateContentAddress.sha256(content),
                CandidateContentAddress.sha256(content)
        );
        assertEquals(64, CandidateContentAddress.sha256(content).length());
    }

    @Test
    void text_and_structured_domains_do_not_collide_for_same_value() {
        var value = "{\"answer\":\"ok\"}";

        assertNotEquals(
                CandidateContentAddress.sha256(new CandidateContent.Text(value)),
                CandidateContentAddress.sha256(new CandidateContent.StructuredJson(value))
        );
    }
}
