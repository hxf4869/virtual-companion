package com.virtualcompanion.runtime.web;

/**
 * Signals that a resource referenced by an HTTP request is absent or not owned
 * by the caller (TASK-0178). Mapped by {@link RuntimeApiExceptionHandler} to a
 * 404 {@code NOT_FOUND_OR_FORBIDDEN} so existence is never disclosed across
 * owners.
 */
public class ResourceNotFoundException extends RuntimeException {

    public ResourceNotFoundException(String resourceType) {
        super(resourceType + " not found or not owned by the caller");
    }
}
