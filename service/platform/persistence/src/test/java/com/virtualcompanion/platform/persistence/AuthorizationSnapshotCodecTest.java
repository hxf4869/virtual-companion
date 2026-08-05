package com.virtualcompanion.platform.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.virtualcompanion.modelruntime.authorization.DataCategory;
import java.util.EnumSet;
import java.util.Set;
import org.junit.jupiter.api.Test;

/**
 * Pure unit test for the authorization-snapshot category codec. It needs no
 * database: the JDBC path delegates to {@code decodeCategoryNames}, which is
 * exercised here against plain string arrays. The cross-tenant behavior of the
 * JDBC store is proven by the SQL test suite under {@code infra/db/tests}.
 */
class AuthorizationSnapshotCodecTest {

    @Test
    void roundTripsEveryDataCategory() {
        Set<DataCategory> all = EnumSet.allOf(DataCategory.class);
        String[] encoded = JdbcAuthorizationSnapshotStore.encodeCategories(all);
        Set<DataCategory> decoded = JdbcAuthorizationSnapshotStore.decodeCategoryNames(encoded);
        assertEquals(all, decoded);
    }

    @Test
    void roundTripsASingleCategory() {
        Set<DataCategory> one = Set.of(DataCategory.MESSAGE_TEXT);
        Set<DataCategory> decoded = JdbcAuthorizationSnapshotStore.decodeCategoryNames(
                JdbcAuthorizationSnapshotStore.encodeCategories(one));
        assertEquals(one, decoded);
    }

    @Test
    void rejectsUnknownCategoryName() {
        assertThrows(IllegalArgumentException.class, () ->
                JdbcAuthorizationSnapshotStore.decodeCategoryNames(new String[]{"NOT_A_CATEGORY"}));
    }
}
