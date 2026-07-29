package com.virtualcompanion.modelruntime.port;

import com.virtualcompanion.modelruntime.contract.ModelProtocolEvent;

import java.util.Optional;

/**
 * Sequential adapter event session.
 *
 * <p>A session emits monotonically ordered events and exactly one terminal
 * event. After the terminal event, {@link #next()} returns empty. Cancellation
 * and close are idempotent. Implementations must normalize provider failures
 * instead of exposing provider exception types.</p>
 */
public interface ModelProtocolSession extends AutoCloseable {

    Optional<ModelProtocolEvent> next();

    void cancel();

    @Override
    void close();
}
