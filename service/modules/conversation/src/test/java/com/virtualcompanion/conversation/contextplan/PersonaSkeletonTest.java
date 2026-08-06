package com.virtualcompanion.conversation.contextplan;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.Arrays;
import java.util.Locale;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

/**
 * Tests for {@link PersonaSkeleton}, including a structural guard that the
 * record carries no provider-specific component (provider/model/api/adapter),
 * which is the TASK-0019 supplier-neutrality acceptance.
 */
class PersonaSkeletonTest {

    private static final Pattern PROVIDER_SPECIFIC = Pattern.compile("provider|model|api|adapter|vendor|supplier");

    @Test
    void gentleListenerShapeIsProviderNeutral() {
        PersonaSkeleton persona = PersonaSkeleton.gentleListener();
        assertEquals("gentle-listener", persona.templateId());
        assertEquals(InteractionMode.LISTEN, persona.defaultMode());
    }

    @Test
    void hasNoProviderSpecificComponentNames() {
        String[] componentNames = Arrays.stream(PersonaSkeleton.class.getRecordComponents())
                .map(c -> c.getName().toLowerCase(Locale.ROOT))
                .toArray(String[]::new);
        assertFalse(componentNames.length == 0, "PersonaSkeleton must declare components");
        for (String name : componentNames) {
            assertFalse(PROVIDER_SPECIFIC.matcher(name).find(),
                    "PersonaSkeleton has a provider-specific component: " + name);
        }
    }

    @Test
    void rejectsBlankFields() {
        assertThrows(IllegalArgumentException.class,
                () -> new PersonaSkeleton("  ", "d", "t", InteractionMode.LISTEN, "r"));
        assertThrows(IllegalArgumentException.class,
                () -> new PersonaSkeleton("t", "  ", "t", InteractionMode.LISTEN, "r"));
        assertThrows(NullPointerException.class,
                () -> new PersonaSkeleton("t", "d", "t", null, "r"));
    }
}
