import { describe, expect, it, vi } from "vitest";

import {
  classifyDisconnect,
  installStreamLifecycle,
  nextResumeDelayMs,
} from "./stream-recovery";

describe("classifyDisconnect", () => {
  it("distinguishes network, permission, service, and terminal faults", () => {
    expect(classifyDisconnect({ navigatorOnline: false })).toBe("network");
    expect(classifyDisconnect({ resumeStatus: 403 })).toBe("permission");
    expect(classifyDisconnect({ resumeStatus: 503 })).toBe("service");
    expect(classifyDisconnect({ outcome: "cancelled" })).toBe("terminal");
    expect(classifyDisconnect({ outcome: "blocked" })).toBe("terminal");
    expect(classifyDisconnect({ outcome: "exhausted" })).toBe("unknown");
  });
});

describe("nextResumeDelayMs", () => {
  it("grows with jitter and stays bounded", () => {
    expect(nextResumeDelayMs(0, () => 0.5)).toBe(250);
    expect(nextResumeDelayMs(1, () => 0.5)).toBe(500);
    expect(nextResumeDelayMs(8, () => 0.5)).toBe(8000);
    const low = nextResumeDelayMs(0, () => 0);
    const high = nextResumeDelayMs(0, () => 1);
    expect(low).toBeLessThan(high);
    expect(low).toBeGreaterThan(0);
  });
});

describe("installStreamLifecycle", () => {
  it("recovers on visibility visible and on online, and unsubscribe stops further calls", () => {
    const listeners = new Map<string, EventListener>();
    const onRecover = vi.fn();
    const stop = installStreamLifecycle({
      addEventListener: (name, handler) => {
        listeners.set(name, handler as EventListener);
      },
      removeEventListener: (name) => {
        listeners.delete(name);
      },
      getVisibility: () => "visible",
      onRecover,
    });
    listeners.get("visibilitychange")?.(new Event("visibilitychange"));
    listeners.get("online")?.(new Event("online"));
    expect(onRecover).toHaveBeenCalledWith("visibility");
    expect(onRecover).toHaveBeenCalledWith("online");
    stop();
    expect(listeners.size).toBe(0);
  });

  it("ignores hidden visibility so a background tab does not start a second generation", () => {
    const onRecover = vi.fn();
    installStreamLifecycle({
      addEventListener: (_name, handler) => {
        if (_name === "visibilitychange") {
          (handler as EventListener)(new Event("visibilitychange"));
        }
      },
      removeEventListener: () => undefined,
      getVisibility: () => "hidden",
      onRecover,
    });
    expect(onRecover).not.toHaveBeenCalled();
  });
});
