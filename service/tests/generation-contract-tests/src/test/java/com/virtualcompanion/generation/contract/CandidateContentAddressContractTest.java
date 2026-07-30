package com.virtualcompanion.generation.contract;

import com.virtualcompanion.conversation.generation.CandidateContent;
import com.virtualcompanion.conversation.generation.CandidateContentAddress;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class CandidateContentAddressContractTest {

    @Test
    void unicode_emoji_combining_character_and_long_text_have_a_stable_address() {
        var value = "陪伴🙂e\u0301汉字".repeat(4_096);
        var content = new CandidateContent.Text(value);

        var first = CandidateContentAddress.sha256(content);
        var second = CandidateContentAddress.sha256(
                new CandidateContent.Text(value)
        );

        assertEquals(
                "9474a53ec6d54149647d9e31066f135f"
                        + "7c107b338807d35e398296c25da9f039",
                first
        );
        assertEquals(first, second);
        assertTrue(first.matches("[0-9a-f]{64}"));
    }

    @Test
    void exact_utf8_bytes_are_preserved_instead_of_unicode_normalization() {
        var decomposed = CandidateContentAddress.sha256(
                new CandidateContent.Text("e\u0301")
        );
        var precomposed = CandidateContentAddress.sha256(
                new CandidateContent.Text("\u00e9")
        );

        assertNotEquals(decomposed, precomposed);
    }

    @Test
    void text_and_structured_json_are_domain_separated_for_the_same_value() {
        var value = "{\"answer\":\"ok\"}";
        var text = CandidateContentAddress.sha256(
                new CandidateContent.Text(value)
        );
        var structured = CandidateContentAddress.sha256(
                new CandidateContent.StructuredJson(value)
        );

        assertEquals(
                "2c5729ed90c244cd51e57d5f92ef10e"
                        + "5c4b861f74a1a3b5666f30bce10d2a7fc",
                text
        );
        assertEquals(
                "011609b8cb5cc7ef03504963442aaa29"
                        + "cfbf39883c98f1534b7d769e94952709",
                structured
        );
        assertNotEquals(text, structured);
    }
}
