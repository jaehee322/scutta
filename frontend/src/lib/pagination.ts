export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface PageAnchor {
  offset: number;
  total: number;
  itemId: number | null;
}

export type PageAppendResult<T> =
  | { status: "appended"; value: PaginatedResponse<T> }
  | { status: "stale" };

export function tryAppendPage<T extends { id: number }>(
  current: PaginatedResponse<T>,
  incoming: PaginatedResponse<T>,
  anchor?: PageAnchor,
): PageAppendResult<T> {
  const expectedOffset = current.offset + current.items.length;
  const currentIds = new Set(current.items.map((item) => item.id));
  const overlapsCurrentPage = incoming.items.some((item) => currentIds.has(item.id));

  if (
    incoming.total !== current.total ||
    incoming.offset !== expectedOffset ||
    overlapsCurrentPage
  ) {
    return { status: "stale" };
  }

  if (anchor) {
    const anchorIndex = anchor.offset - current.offset;
    const expectedAnchorId = current.items[anchorIndex]?.id ?? null;
    if (
      anchor.total !== current.total ||
      anchor.offset !== incoming.offset - 1 ||
      anchor.itemId !== expectedAnchorId
    ) {
      return { status: "stale" };
    }
  }

  return {
    status: "appended",
    value: {
      items: [...current.items, ...incoming.items],
      total: incoming.total,
      limit: current.limit,
      offset: current.offset,
    },
  };
}

export function getNextOffset<T>(page: PaginatedResponse<T>): number {
  if (page.items.length === 0) return page.total;
  return Math.min(page.total, page.offset + page.items.length);
}

export function hasNextPage<T>(
  page: PaginatedResponse<T> | null,
  nextOffset: number,
): boolean {
  return page !== null && nextOffset < page.total;
}

export function isPageOutOfSync<T>(
  page: PaginatedResponse<T> | null,
  nextOffset: number,
): boolean {
  return page !== null && nextOffset >= page.total && page.items.length !== page.total;
}
