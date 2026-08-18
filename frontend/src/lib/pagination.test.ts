import { describe, expect, it } from "vitest";

import {
  getNextOffset,
  hasNextPage,
  isPageOutOfSync,
  type PaginatedResponse,
  tryAppendPage,
} from "./pagination";

type Item = { id: number; label: string };

const page = (
  items: Item[],
  { total = items.length, limit = 2, offset = 0 } = {},
): PaginatedResponse<Item> => ({ items, total, limit, offset });

describe("paginated responses", () => {
  it("appends a new page without mutating either response", () => {
    const current = page([{ id: 3, label: "3" }, { id: 2, label: "2" }], { total: 3 });
    const incoming = page([{ id: 1, label: "1" }], { total: 3, offset: 2 });

    const result = tryAppendPage(current, incoming, { offset: 1, total: 3, itemId: 2 });

    expect(result.status).toBe("appended");
    if (result.status !== "appended") throw new Error("expected an appended page");
    expect(result.value.items.map((item) => item.id)).toEqual([3, 2, 1]);
    expect(current.items).toHaveLength(2);
    expect(incoming.items).toHaveLength(1);
    expect(hasNextPage(result.value, getNextOffset(incoming))).toBe(false);
  });

  it("marks overlapping pages as stale instead of hiding a shifted boundary", () => {
    const current = page([{ id: 3, label: "old" }, { id: 2, label: "2" }], { total: 4 });
    const incoming = page(
      [{ id: 3, label: "updated" }, { id: 1, label: "1" }],
      { total: 4, offset: 2 },
    );

    const result = tryAppendPage(current, incoming);

    expect(result).toEqual({ status: "stale" });
  });

  it("stops retrying when a server returns an empty final page", () => {
    const empty = page([], { total: 5, offset: 4 });

    expect(getNextOffset(empty)).toBe(5);
    expect(hasNextPage(empty, getNextOffset(empty))).toBe(false);
  });

  it("detects when concurrent changes make the consumed total and unique items differ", () => {
    const merged = page(
      [{ id: 3, label: "3" }, { id: 2, label: "2" }, { id: 1, label: "1" }],
      { total: 4 },
    );

    expect(isPageOutOfSync(merged, 4)).toBe(true);
    expect(isPageOutOfSync(page(merged.items, { total: 3 }), 3)).toBe(false);
  });

  it.each([
    { initialTotal: 201, nextTotal: 200, pageSize: 200 },
    { initialTotal: 51, nextTotal: 50, pageSize: 50 },
  ])(
    "marks a concurrent deletion ($initialTotal → $nextTotal) as stale",
    ({ initialTotal, nextTotal, pageSize }) => {
      const items = Array.from({ length: pageSize }, (_, index) => ({
        id: initialTotal - index,
        label: String(initialTotal - index),
      }));
      const current = page(items, { total: initialTotal, limit: pageSize });
      const incoming = page([], { total: nextTotal, limit: pageSize, offset: pageSize });

      expect(tryAppendPage(current, incoming)).toEqual({ status: "stale" });
    },
  );

  it("marks a same-total boundary anchor change as stale", () => {
    const current = page(
      [{ id: 4, label: "4" }, { id: 3, label: "3" }],
      { total: 4 },
    );
    const incoming = page([{ id: 2, label: "2" }], { total: 4, offset: 2 });

    expect(
      tryAppendPage(current, incoming, { offset: 1, total: 4, itemId: 99 }),
    ).toEqual({ status: "stale" });
  });

  it("marks an unexpected server offset as stale", () => {
    const current = page([{ id: 3, label: "3" }, { id: 2, label: "2" }], { total: 3 });
    const incoming = page([{ id: 1, label: "1" }], { total: 3, offset: 1 });

    expect(tryAppendPage(current, incoming)).toEqual({ status: "stale" });
  });
});
