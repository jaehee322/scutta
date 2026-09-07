import { describe, expect, it, vi } from "vitest";

import {
  getAuthSessionVersion,
  invalidateAuthSession,
  subscribeAuthSessionChange,
} from "./authSession";

describe("session invalidation", () => {
  it("notifies queued work after the previous session becomes stale", () => {
    const originalVersion = getAuthSessionVersion();
    const seenVersions: number[] = [];
    const listener = vi.fn(() => seenVersions.push(getAuthSessionVersion()));
    const unsubscribe = subscribeAuthSessionChange(listener);

    invalidateAuthSession();
    expect(seenVersions).toEqual([originalVersion + 1]);
    unsubscribe();
    invalidateAuthSession();
    expect(listener).toHaveBeenCalledOnce();
  });
});
