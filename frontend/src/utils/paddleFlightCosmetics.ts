import { apiRequest, jsonBody } from "../api/client";
import { getAuthSessionVersion, subscribeAuthSessionChange } from "../auth/authSession";
import type { PaddleFlightChestReward, PaddleFlightCosmetics, PaddleFlightEquipped } from "../types";

interface CosmeticsSnapshot {
  inventory: PaddleFlightCosmetics | null;
  loading: boolean;
  savingEquipment: boolean;
  pendingCount: number;
  processingCount: number;
  error: string;
  lastReward: (PaddleFlightChestReward & { claim_id: string }) | null;
}

interface CosmeticsStoreOptions {
  read: (signal: AbortSignal) => Promise<PaddleFlightCosmetics>;
  equip: (equipped: PaddleFlightEquipped, signal: AbortSignal) => Promise<PaddleFlightCosmetics>;
  claim: (id: string, signal: AbortSignal) => Promise<PaddleFlightChestReward>;
  getSessionVersion: () => number;
  storage: () => Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
}

const EMPTY: CosmeticsSnapshot = {
  inventory: null, loading: false, savingEquipment: false,
  pendingCount: 0, processingCount: 0, error: "", lastReward: null,
};
const CLAIM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createPaddleFlightClaimId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createPaddleFlightCosmeticsStore(options: CosmeticsStoreOptions) {
  let snapshot: CosmeticsSnapshot = { ...EMPTY };
  let confirmed: PaddleFlightCosmetics | null = null;
  let equipmentOverride: PaddleFlightEquipped | null = null;
  let activeUser: number | undefined;
  let generation = 0;
  let revision = 0;
  let loadPromise: Promise<void> | null = null;
  let writeQueue = Promise.resolve();
  const controllers = new Set<AbortController>();
  const pending = new Set<string>();
  const processing = new Set<string>();
  const listeners = new Set<() => void>();
  const storagePrefix = () => `scutta.paddle-flight.chests.${activeUser}.`;

  const publish = (changes: Partial<CosmeticsSnapshot> = {}) => {
    snapshot = {
      ...snapshot, ...changes,
      inventory: confirmed ? { ...confirmed, equipped: equipmentOverride ?? confirmed.equipped } : null,
      pendingCount: pending.size,
      processingCount: processing.size,
    };
    for (const listener of listeners) listener();
  };
  const persistClaim = (claimId: string, completed = false) => {
    if (activeUser === undefined) return;
    try {
      const storage = options.storage();
      // Separate keys keep one browser tab from replacing another tab's queue.
      const key = storagePrefix() + claimId;
      if (completed) storage.removeItem(key);
      else storage.setItem(key, "pending");
    } catch {
      // The live queue still works if browser storage is unavailable.
    }
  };
  const invalidate = () => {
    generation += 1;
    for (const controller of controllers) controller.abort();
    controllers.clear();
    pending.clear();
    processing.clear();
    activeUser = undefined;
    confirmed = null;
    equipmentOverride = null;
    loadPromise = null;
    writeQueue = Promise.resolve();
    snapshot = { ...EMPTY };
    publish();
  };
  const operation = () => {
    const controller = new AbortController();
    const version = generation;
    const session = options.getSessionVersion();
    controllers.add(controller);
    return {
      controller,
      isCurrent: () => generation === version && session === options.getSessionVersion() && !controller.signal.aborted,
      finish: () => controllers.delete(controller),
    };
  };
  const processClaim = (claimId: string) => {
    if (processing.has(claimId)) return;
    processing.add(claimId);
    const op = operation();
    publish();
    const task = writeQueue.then(async () => {
      if (!op.isCurrent()) return;
      try {
        const reward = await options.claim(claimId, op.controller.signal);
        if (!op.isCurrent()) return;
        revision += 1;
        confirmed = reward.cosmetics;
        pending.delete(claimId);
        persistClaim(claimId, true);
        publish({ lastReward: { ...reward, claim_id: claimId }, error: "" });
      } catch (caught) {
        if (op.isCurrent()) {
          publish({ error: caught instanceof Error ? caught.message : "상자 보상을 저장하지 못했습니다." });
        }
      } finally {
        op.finish();
        if (op.isCurrent()) {
          processing.delete(claimId);
          publish();
        }
      }
    });
    writeQueue = task.catch(() => undefined);
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    invalidate,
    load(userId: number) {
      if (activeUser !== userId) {
        invalidate();
        activeUser = userId;
        try {
          const storage = options.storage();
          const prefix = storagePrefix();
          for (let index = 0; index < storage.length; index += 1) {
            const key = storage.key(index);
            if (!key?.startsWith(prefix)) continue;
            const id = key.slice(prefix.length);
            if (CLAIM_ID.test(id) && storage.getItem(key) === "pending") pending.add(id);
          }
        } catch { /* No recoverable pending claims. */ }
      }
      if (loadPromise) return loadPromise;
      const op = operation();
      const requestRevision = revision;
      publish({ loading: true, error: "" });
      loadPromise = options.read(op.controller.signal)
        .then((inventory) => {
          if (op.isCurrent() && requestRevision === revision) {
            confirmed = inventory;
            publish();
          }
        })
        .catch((caught) => {
          if (op.isCurrent()) publish({ error: caught instanceof Error ? caught.message : "스킨을 불러오지 못했습니다." });
        })
        .finally(() => {
          op.finish();
          if (op.isCurrent()) {
            loadPromise = null;
            publish({ loading: false });
          }
        });
      for (const id of pending) processClaim(id);
      return loadPromise;
    },
    collect(claimId: string) {
      if (activeUser === undefined || !CLAIM_ID.test(claimId) || pending.has(claimId)) return;
      pending.add(claimId);
      persistClaim(claimId);
      processClaim(claimId);
    },
    retryClaims() {
      publish({ error: "" });
      for (const id of pending) processClaim(id);
    },
    equip(equipped: PaddleFlightEquipped) {
      if (!confirmed || snapshot.savingEquipment) return;
      equipmentOverride = equipped;
      const op = operation();
      publish({ savingEquipment: true, error: "" });
      const task = writeQueue.then(async () => {
        if (!op.isCurrent()) return;
        try {
          const inventory = await options.equip(equipped, op.controller.signal);
          if (!op.isCurrent()) return;
          revision += 1;
          confirmed = inventory;
        } catch (caught) {
          if (op.isCurrent()) publish({ error: caught instanceof Error ? caught.message : "스킨 선택을 저장하지 못했습니다." });
        } finally {
          op.finish();
          if (op.isCurrent()) {
            equipmentOverride = null;
            publish({ savingEquipment: false });
          }
        }
      });
      writeQueue = task.catch(() => undefined);
    },
  };
}

export const paddleFlightCosmetics = createPaddleFlightCosmeticsStore({
  read: (signal) => apiRequest("/minigames/paddle-flight/cosmetics", { signal }),
  equip: (equipped, signal) => apiRequest("/minigames/paddle-flight/cosmetics", {
    method: "PATCH", body: jsonBody(equipped), signal,
  }),
  claim: (claimId, signal) => apiRequest("/minigames/paddle-flight/cosmetics/chests", {
    method: "POST", body: jsonBody({ claim_id: claimId }), signal,
  }),
  getSessionVersion: getAuthSessionVersion,
  storage: () => window.localStorage,
});

subscribeAuthSessionChange(() => paddleFlightCosmetics.invalidate());
