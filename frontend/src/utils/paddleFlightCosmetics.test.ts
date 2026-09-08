import { describe, expect, it, vi } from "vitest";

import type { PaddleFlightChestReward, PaddleFlightCosmetics, PaddleFlightEquipped } from "../types";
import { createPaddleFlightCosmeticsStore } from "./paddleFlightCosmetics";

const firstId = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";
const base: PaddleFlightCosmetics = {
  owned: ["bg_classic", "paddle_classic", "ball_classic"],
  equipped: { background: "bg_classic", paddle: "paddle_classic", ball: "ball_classic" },
  opened_chests: 0,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function settle() {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}
function setup() {
  const data = new Map<string, string>();
  const read = vi.fn(async () => base);
  const equip = vi.fn(async (equipped: PaddleFlightEquipped) => ({ ...base, equipped }));
  const claim = vi.fn(async (_id: string): Promise<PaddleFlightChestReward> => ({
    cosmetics: { ...base, owned: [...base.owned, "ball_sky"], opened_chests: 1 },
    skin_id: "ball_sky", duplicate: false,
  }));
  const storage = () => ({
    get length() { return data.size; },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  });
  const options = { read, equip, claim, storage, getSessionVersion: () => 0 };
  return { store: createPaddleFlightCosmeticsStore(options), options, read, equip, claim, data };
}

describe("paddle flight cosmetic persistence", () => {
  it("serializes chest claims and ignores duplicate collection while pending", async () => {
    const { store, claim } = setup();
    await store.load(7);
    const first = deferred<PaddleFlightChestReward>();
    claim.mockImplementationOnce(() => first.promise);
    store.collect(firstId);
    store.collect(firstId);
    store.collect(secondId);
    await settle();
    expect(claim).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().pendingCount).toBe(2);
    first.resolve({ cosmetics: { ...base, opened_chests: 1 }, skin_id: "ball_sky", duplicate: false });
    await settle();
    expect(claim).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().pendingCount).toBe(0);
  });

  it("restores a failed claim on reconnect with the same account and id", async () => {
    const { store, options, claim, data } = setup();
    await store.load(7);
    claim.mockRejectedValueOnce(new Error("offline"));
    store.collect(firstId);
    await settle();
    expect(store.getSnapshot().pendingCount).toBe(1);
    expect(data.get(`scutta.paddle-flight.chests.7.${firstId}`)).toBe("pending");
    const reconnected = createPaddleFlightCosmeticsStore(options);
    await reconnected.load(7);
    await settle();
    expect(claim.mock.calls.map(([id]) => id)).toEqual([firstId, firstId]);
    expect(reconnected.getSnapshot().inventory?.owned).toContain("ball_sky");
    expect(data.has(`scutta.paddle-flight.chests.7.${firstId}`)).toBe(false);
  });

  it("never replays another player's pending claims or accepts their late responses", async () => {
    const { store, claim, data } = setup();
    await store.load(7);
    const result = deferred<PaddleFlightChestReward>();
    claim.mockImplementationOnce(() => result.promise);
    store.collect(firstId);
    await settle();
    await store.load(8);
    result.resolve({ cosmetics: { ...base, owned: ["ball_solar"], opened_chests: 50 }, skin_id: "ball_solar", duplicate: false });
    await settle();
    expect(store.getSnapshot().inventory).toEqual(base);
    expect(store.getSnapshot().lastReward).toBe(null);
    expect(claim).toHaveBeenCalledTimes(1);
    expect(data.get(`scutta.paddle-flight.chests.7.${firstId}`)).toBe("pending");
  });

  it("does not let an older initial read erase a newly awarded skin", async () => {
    const { store, read } = setup();
    const initial = deferred<PaddleFlightCosmetics>();
    read.mockImplementationOnce(() => initial.promise);
    const loading = store.load(7);
    store.collect(firstId);
    await settle();
    initial.resolve(base);
    await loading;
    expect(store.getSnapshot().inventory?.owned).toContain("ball_sky");
  });

  it("previews a choice immediately, preserves pending loot, and rolls back a failed save", async () => {
    const { store, equip } = setup();
    await store.load(7);
    store.collect(firstId);
    await settle();
    const chosen = { ...base.equipped, ball: "ball_sky" };
    const saving = deferred<PaddleFlightCosmetics>();
    equip.mockImplementationOnce(() => saving.promise);
    store.equip(chosen);
    expect(store.getSnapshot().inventory?.equipped).toEqual(chosen);
    store.equip(base.equipped);
    await settle();
    expect(equip).toHaveBeenCalledTimes(1);
    saving.reject(new Error("connection lost"));
    await settle();
    expect(store.getSnapshot().inventory?.equipped).toEqual(base.equipped);
    expect(store.getSnapshot().inventory?.owned).toContain("ball_sky");
    expect(store.getSnapshot().savingEquipment).toBe(false);
  });

  it("keeps live rewards working when browser storage throws", async () => {
    const { options } = setup();
    const store = createPaddleFlightCosmeticsStore({ ...options, storage: () => { throw new Error("denied"); } });
    await store.load(7);
    store.collect(firstId);
    await settle();
    expect(store.getSnapshot().inventory?.owned).toContain("ball_sky");
    expect(store.getSnapshot().pendingCount).toBe(0);
  });

  it("keeps another tab's failed reward after saving a new reward", async () => {
    const { store, options, claim, data } = setup();
    const otherTab = createPaddleFlightCosmeticsStore(options);
    await store.load(7);
    await otherTab.load(7);
    claim.mockRejectedValueOnce(new Error("offline"));
    store.collect(firstId);
    await settle();
    otherTab.collect(secondId);
    await settle();
    expect(data.get(`scutta.paddle-flight.chests.7.${firstId}`)).toBe("pending");
    expect(data.has(`scutta.paddle-flight.chests.7.${secondId}`)).toBe(false);
  });
});
