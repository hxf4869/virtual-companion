package com.virtualcompanion.modelruntime.contract;

/**
 * Provider-neutral requested response representation.
 */
public sealed interface ResponseMode
        permits ResponseMode.Text, ResponseMode.StructuredJson {

    record Text() implements ResponseMode {
    }

    record StructuredJson(String schemaName, String jsonSchema) implements ResponseMode {

        public StructuredJson {
            schemaName = ContractChecks.requireNonBlank(schemaName, "schemaName");
            jsonSchema = ContractChecks.requireNonBlank(jsonSchema, "jsonSchema");
        }
    }
}
