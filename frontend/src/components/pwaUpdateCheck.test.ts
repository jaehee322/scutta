import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PWA_UPDATE_CHECK_INTERVAL_MS, startPwaUpdateChecks } from "./pwaUpdateCheck";

type RegistrationStub = {
  -readonly [Key in "active" | "waiting" | "installing"]: ServiceWorkerRegistration[Key];
} & {
  update: ReturnType<typeof vi.fn<() => Promise<ServiceWorkerRegistration>>>;
};

let browserWindow: EventTarget;
let browserDocument: EventTarget & { visibilityState: string };
let browserNavigator: { onLine: boolean };
let cleanup: (() => void) | undefined;

function worker(state: ServiceWorkerState = "activated"): ServiceWorker {
  return { state } as ServiceWorker;
}

function registration(overrides: Partial<RegistrationStub> = {}): RegistrationStub {
  const result: RegistrationStub = {
    active: worker(),
    waiting: null,
    installing: null,
    update: vi.fn<() => Promise<ServiceWorkerRegistration>>(),
    ...overrides,
  };
  result.update.mockResolvedValue(result as unknown as ServiceWorkerRegistration);
  return result;
}

function start(value: RegistrationStub) {
  const callbacks = { onWaiting: vi.fn(), onResume: vi.fn() };
  cleanup = startPwaUpdateChecks(value as unknown as ServiceWorkerRegistration, callbacks);
  return callbacks;
}

function showPage(persisted: boolean) {
  browserWindow.dispatchEvent(Object.assign(new Event("pageshow"), { persisted }));
}

function setVisibility(value: "visible" | "hidden") {
  browserDocument.visibilityState = value;
  browserDocument.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-13T00:00:00Z"));
  browserWindow = Object.assign(new EventTarget(), {
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  });
  browserDocument = Object.assign(new EventTarget(), { visibilityState: "visible" });
  browserNavigator = { onLine: true };
  vi.stubGlobal("window", browserWindow);
  vi.stubGlobal("document", browserDocument);
  vi.stubGlobal("navigator", browserNavigator);
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("startPwaUpdateChecks", () => {
  it("checks immediately and every visible minute without reopening a dismissed notice", async () => {
    const value = registration();
    const callbacks = start(value);
    expect(value.update).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(PWA_UPDATE_CHECK_INTERVAL_MS - 1);
    expect(value.update).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(value.update).toHaveBeenCalledTimes(2);
    expect(callbacks.onWaiting).not.toHaveBeenCalled();
    expect(callbacks.onResume).not.toHaveBeenCalled();
  });

  it("skips hidden-page checks and checks when the app becomes visible", async () => {
    browserDocument.visibilityState = "hidden";
    const value = registration();
    const callbacks = start(value);
    await vi.advanceTimersByTimeAsync(PWA_UPDATE_CHECK_INTERVAL_MS * 3);
    browserWindow.dispatchEvent(new Event("online"));
    showPage(true);
    expect(value.update).not.toHaveBeenCalled();
    expect(callbacks.onResume).not.toHaveBeenCalled();
    setVisibility("visible");
    expect(value.update).toHaveBeenCalledOnce();
    expect(callbacks.onResume).toHaveBeenCalledOnce();
  });

  it("does not access the network offline and retries when connectivity returns", async () => {
    browserNavigator.onLine = false;
    const value = registration();
    const callbacks = start(value);
    await vi.advanceTimersByTimeAsync(PWA_UPDATE_CHECK_INTERVAL_MS);
    expect(value.update).not.toHaveBeenCalled();
    browserNavigator.onLine = true;
    browserWindow.dispatchEvent(new Event("online"));
    expect(value.update).toHaveBeenCalledOnce();
    expect(callbacks.onResume).not.toHaveBeenCalled();
  });

  it("coalesces resume events and permits another check after the ten-second gap", async () => {
    const value = registration();
    const callbacks = start(value);
    await vi.advanceTimersByTimeAsync(0);
    setVisibility("visible");
    showPage(true);
    browserWindow.dispatchEvent(new Event("online"));
    expect(value.update).toHaveBeenCalledOnce();
    expect(callbacks.onResume).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(9_999);
    setVisibility("visible");
    expect(value.update).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    showPage(true);
    expect(value.update).toHaveBeenCalledTimes(2);
  });

  it("reopens the notice on an actual return but not ordinary pageshow or minute checks", async () => {
    const value = registration({ waiting: worker("installed") });
    const callbacks = start(value);
    showPage(false);
    await vi.advanceTimersByTimeAsync(PWA_UPDATE_CHECK_INTERVAL_MS);
    expect(callbacks.onWaiting).toHaveBeenCalledTimes(2);
    expect(callbacks.onResume).not.toHaveBeenCalled();
    setVisibility("hidden");
    setVisibility("visible");
    expect(callbacks.onResume).toHaveBeenCalledOnce();
    showPage(true);
    expect(callbacks.onResume).toHaveBeenCalledTimes(2);
    expect(value.update).not.toHaveBeenCalled();
  });

  it("offers an already prepared update offline without another download", () => {
    browserNavigator.onLine = false;
    const value = registration({ waiting: worker("installed") });
    const callbacks = start(value);
    expect(callbacks.onWaiting).toHaveBeenCalledOnce();
    expect(callbacks.onResume).not.toHaveBeenCalled();
    expect(value.update).not.toHaveBeenCalled();
  });

  it("does not present an initial installation as an update", async () => {
    const value = registration({ active: null, waiting: worker("installed") });
    const callbacks = start(value);
    await vi.advanceTimersByTimeAsync(PWA_UPDATE_CHECK_INTERVAL_MS);
    expect(callbacks.onWaiting).not.toHaveBeenCalled();
    expect(value.update).not.toHaveBeenCalled();
  });

  it("waits for an installing worker instead of starting duplicate checks", async () => {
    const value = registration({ installing: worker("installing") });
    const callbacks = start(value);
    await vi.advanceTimersByTimeAsync(PWA_UPDATE_CHECK_INTERVAL_MS);
    expect(value.update).not.toHaveBeenCalled();
    expect(callbacks.onWaiting).not.toHaveBeenCalled();
    value.installing = null;
    value.waiting = worker("installed");
    browserWindow.dispatchEvent(new Event("online"));
    expect(callbacks.onWaiting).toHaveBeenCalledOnce();
    expect(value.update).not.toHaveBeenCalled();
  });

  it("does not offer a redundant initial-install worker after it becomes active", async () => {
    const value = registration({ active: null, installing: worker("installing") });
    const callbacks = start(value);
    value.installing = null;
    value.active = worker();
    await vi.advanceTimersByTimeAsync(PWA_UPDATE_CHECK_INTERVAL_MS);
    expect(value.update).toHaveBeenCalledOnce();
    expect(callbacks.onWaiting).not.toHaveBeenCalled();
  });

  it("keeps only one update request in flight across timers and return events", async () => {
    const value = registration();
    let finish: (result: ServiceWorkerRegistration) => void = () => undefined;
    value.update.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    start(value);
    await vi.advanceTimersByTimeAsync(PWA_UPDATE_CHECK_INTERVAL_MS * 2);
    setVisibility("visible");
    showPage(true);
    browserWindow.dispatchEvent(new Event("online"));
    expect(value.update).toHaveBeenCalledOnce();
    finish(value as unknown as ServiceWorkerRegistration);
    await vi.advanceTimersByTimeAsync(0);
    browserWindow.dispatchEvent(new Event("online"));
    expect(value.update).toHaveBeenCalledTimes(2);
  });

  it("immediately notices a waiting worker after a successful check", async () => {
    const value = registration();
    value.update.mockImplementation(async () => {
      value.waiting = worker("installed");
      return value as unknown as ServiceWorkerRegistration;
    });
    const callbacks = start(value);
    await vi.advanceTimersByTimeAsync(0);
    expect(callbacks.onWaiting).toHaveBeenCalledOnce();
    expect(callbacks.onResume).not.toHaveBeenCalled();
  });

  it("defers a result that arrives while hidden until the app returns", async () => {
    const value = registration();
    let finish: (result: ServiceWorkerRegistration) => void = () => undefined;
    value.update.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const callbacks = start(value);
    setVisibility("hidden");
    value.waiting = worker("installed");
    finish(value as unknown as ServiceWorkerRegistration);
    await vi.advanceTimersByTimeAsync(0);
    expect(callbacks.onWaiting).not.toHaveBeenCalled();
    setVisibility("visible");
    expect(callbacks.onWaiting).toHaveBeenCalledOnce();
  });

  it("allows an immediate online retry after failure instead of retaining the cooldown", async () => {
    const value = registration();
    value.update.mockRejectedValueOnce(new Error("network unavailable"));
    const callbacks = start(value);
    await vi.advanceTimersByTimeAsync(0);
    browserWindow.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(value.update).toHaveBeenCalledTimes(2);
    expect(callbacks.onWaiting).not.toHaveBeenCalled();
    expect(callbacks.onResume).not.toHaveBeenCalled();
  });

  it("does not postpone checks if the system clock moves backwards", async () => {
    const value = registration();
    start(value);
    await vi.advanceTimersByTimeAsync(0);
    vi.setSystemTime(new Date("2026-09-12T23:00:00Z"));
    setVisibility("visible");
    expect(value.update).toHaveBeenCalledTimes(2);
  });

  it("cleans up timers and event listeners without acting on a late result", async () => {
    const value = registration();
    let finish: (result: ServiceWorkerRegistration) => void = () => undefined;
    value.update.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const callbacks = start(value);
    expect(vi.getTimerCount()).toBe(1);
    cleanup?.();
    expect(vi.getTimerCount()).toBe(0);
    value.waiting = worker("installed");
    finish(value as unknown as ServiceWorkerRegistration);
    await vi.advanceTimersByTimeAsync(PWA_UPDATE_CHECK_INTERVAL_MS * 2);
    setVisibility("visible");
    showPage(true);
    browserWindow.dispatchEvent(new Event("online"));
    expect(value.update).toHaveBeenCalledOnce();
    expect(callbacks.onWaiting).not.toHaveBeenCalled();
    expect(callbacks.onResume).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
