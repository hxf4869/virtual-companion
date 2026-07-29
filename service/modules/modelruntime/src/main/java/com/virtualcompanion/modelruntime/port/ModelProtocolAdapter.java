package com.virtualcompanion.modelruntime.port;

import com.virtualcompanion.catalog.ModelProtocol;
import com.virtualcompanion.modelruntime.contract.ModelProtocolCapabilities;
import com.virtualcompanion.modelruntime.contract.ModelProtocolRequest;

/**
 * Supplier-neutral internal model protocol port.
 */
public interface ModelProtocolAdapter {

    ModelProtocol protocol();

    ModelProtocolCapabilities capabilities();

    ModelProtocolSession open(ModelProtocolRequest request);
}
