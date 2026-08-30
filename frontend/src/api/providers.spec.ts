import { describe, expect, it, vi } from "vitest";

import type { AuthTransport } from "@/api/auth";
import {
  discoverProviderModels,
  listModelProviders,
  ProviderHttpError,
  saveModelProvider,
  saveModelRoutingOrder,
} from "@/api/providers";

describe("model provider API", () => {
  it("parses the secret-free provider view", async () => {
    const request = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: [{
        providerId: "acme",
        displayName: "Acme",
        protocol: "OPENAI_RESPONSES",
        baseUrl: "https://gateway.example/v1",
        credentialConfigured: true,
        credential: "must-not-be-consumed",
        state: "ENABLED",
        models: [{
          modelId: "m1",
          displayName: "Primary",
          contextWindowTokens: 256000,
          maxOutputTokens: 32000,
          priority: 1,
          state: "ENABLED",
        }],
      }],
    }));
    const providers = await listModelProviders({ request });
    expect(providers).toHaveLength(1);
    expect(providers[0].credentialConfigured).toBe(true);
    expect(providers[0]).not.toHaveProperty("credential");
    expect(providers[0].models[0].priority).toBe(1);
  });

  it("saves a provider by encoded id and preserves the typed body", async () => {
    const request = vi.fn(async () => ({ ok: true, status: 200, json: { ok: true } }));
    const body = {
      displayName: "Acme",
      protocol: "ANTHROPIC_MESSAGES" as const,
      baseUrl: "https://api.example/v1",
      credential: "secret",
      state: "DISABLED" as const,
      models: [{
        modelId: "claude-test",
        displayName: "Claude Test",
        maxOutputTokens: 4096,
        state: "ENABLED" as const,
      }],
    };
    await saveModelProvider({ request }, "acme gateway", body);
    expect(request).toHaveBeenCalledWith(
      "PUT",
      "/api/v1/admin/providers/acme%20gateway",
      body,
    );
  });

  it("sends the complete deterministic route order", async () => {
    const request = vi.fn(async () => ({ ok: true, status: 200, json: { ok: true } }));
    const routes = [
      { providerId: "p2", modelId: "m2" },
      { providerId: "p1", modelId: "m1" },
    ];
    await saveModelRoutingOrder({ request }, routes);
    expect(request).toHaveBeenCalledWith(
      "PUT",
      "/api/v1/admin/model-routing-order",
      { routes },
    );
  });

  it("discovers models explicitly without persisting them", async () => {
    const request = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: [{ modelId: "model-a", displayName: "Model A" }],
    }));
    const body = {
      protocol: "OPENAI_RESPONSES" as const,
      baseUrl: "https://gateway.example/v1",
      credential: "secret",
    };
    await expect(discoverProviderModels({ request }, "new provider", body)).resolves.toEqual([
      { modelId: "model-a", displayName: "Model A" },
    ]);
    expect(request).toHaveBeenCalledWith(
      "POST",
      "/api/v1/admin/providers/new%20provider/models/discover",
      body,
    );
  });

  it("rejects malformed success payloads and preserves non-OK status", async () => {
    const malformed: AuthTransport = {
      request: vi.fn(async () => ({ ok: true, status: 200, json: [{ providerId: "p" }] })),
    };
    await expect(listModelProviders(malformed)).rejects.toBeInstanceOf(ProviderHttpError);
    const forbidden: AuthTransport = {
      request: vi.fn(async () => ({ ok: false, status: 403, json: null })),
    };
    await expect(saveModelRoutingOrder(forbidden, [])).rejects.toMatchObject({ status: 403 });
  });
});
