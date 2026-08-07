package com.virtualcompanion.runtime.auth.tenant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

class OwnerContextTest {

    @Test
    void ownerMappingIsDirectUserToOwnerId() {
        // user_id == owner_user_id: the account id maps straight to the RLS GUC.
        assertThat(OwnerContext.ownerSettingValue(42L)).isEqualTo("42");
        assertThat(OwnerContext.ownerSettingValue(1000001L)).isEqualTo("1000001");
    }

    @Test
    void rejectsNonPositiveOwnerId() {
        assertThatThrownBy(() -> OwnerContext.ownerSettingValue(0L))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> OwnerContext.ownerSettingValue(-1L))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void asOwnerBindsTransactionScopedContextAndRunsWork() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        TransactionTemplate transactions = mock(TransactionTemplate.class);
        doAnswer(invocation -> {
            Consumer<?> consumer = invocation.getArgument(0);
            consumer.accept(null);
            return null;
        }).when(transactions).executeWithoutResult(any());
        OwnerContext ownerContext = new OwnerContext(jdbc, transactions);
        AtomicBoolean ran = new AtomicBoolean(false);

        ownerContext.asOwner(42L, () -> ran.set(true));

        assertThat(ran.get()).isTrue();
        verify(jdbc).update("SELECT set_config('vc.owner_user_id', ?, true)", "42");
    }

    @Test
    void asOwnerRejectsNonPositiveOwnerBeforeAnyWork() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        TransactionTemplate transactions = mock(TransactionTemplate.class);
        OwnerContext ownerContext = new OwnerContext(jdbc, transactions);

        assertThatThrownBy(() -> ownerContext.asOwner(0L, () -> { }))
                .isInstanceOf(IllegalArgumentException.class);
        verify(transactions, org.mockito.Mockito.never()).executeWithoutResult(any());
    }
}
