package com.virtualcompanion.runtime.auth.tenant;

import static org.assertj.core.api.Assertions.assertThat;

import com.virtualcompanion.runtime.auth.jwt.GoJwtCompatibilityTest;
import java.nio.file.Files;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * G3: Java OwnerContext.proofFor matches the committed HMAC golden vector
 * that Go ProofFor also produces.
 */
class GoOwnerProofCompatibilityTest {

    @Test
    void javaProofMatchesSharedGoldenVector() throws Exception {
        String json = Files.readString(GoJwtCompatibilityTest.vectorsPath());
        String secret = GoJwtCompatibilityTest.nestedString(json, "ownerHMAC", "secret");
        OwnerContext ownerContext = new OwnerContext(
                org.mockito.Mockito.mock(JdbcTemplate.class),
                org.mockito.Mockito.mock(TransactionTemplate.class),
                secret);
        String proof = ownerContext.proofFor(42L, "1234", "5678", "abcdef");
        assertThat(proof).isEqualTo(GoJwtCompatibilityTest.nestedString(json, "ownerHMAC", "proofHex"));
        assertThat(proof).doesNotContain(secret);
    }
}
