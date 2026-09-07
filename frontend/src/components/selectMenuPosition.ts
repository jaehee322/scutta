const VIEWPORT_MARGIN = 12;
const MENU_GAP = 6;
const MENU_MAX_HEIGHT = 288;

export type MenuPosition = {
  placement: "up" | "down";
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
};

export function getSelectMenuPosition(
  rect: { top: number; bottom: number; left: number; width: number },
  layout: { width: number; height: number },
  optionCount: number,
  visible?: { offsetTop: number; offsetLeft: number; width: number; height: number } | null,
): MenuPosition | null {
  const viewportTop = visible?.offsetTop ?? 0;
  const viewportLeft = visible?.offsetLeft ?? 0;
  const viewportBottom = viewportTop + (visible?.height ?? layout.height);
  const viewportRight = viewportLeft + (visible?.width ?? layout.width);
  if (rect.bottom < viewportTop || rect.top > viewportBottom) return null;

  const availableBelow = Math.max(0, viewportBottom - rect.bottom - MENU_GAP - VIEWPORT_MARGIN);
  const availableAbove = Math.max(0, rect.top - viewportTop - MENU_GAP - VIEWPORT_MARGIN);
  const estimatedHeight = Math.min(optionCount * 46 + 12, MENU_MAX_HEIGHT);
  const placement = availableBelow < Math.min(estimatedHeight, 160)
    && availableAbove > availableBelow ? "up" : "down";
  const availableWidth = Math.max(0, viewportRight - viewportLeft - VIEWPORT_MARGIN * 2);
  const width = Math.min(Math.max(rect.width, 180), availableWidth);
  const left = Math.min(
    Math.max(rect.left, viewportLeft + VIEWPORT_MARGIN),
    Math.max(viewportLeft + VIEWPORT_MARGIN, viewportRight - VIEWPORT_MARGIN - width),
  );
  return {
    placement,
    left,
    width,
    maxHeight: Math.min(MENU_MAX_HEIGHT, placement === "up" ? availableAbove : availableBelow),
    // Fixed-position bottom remains relative to the layout viewport, even with a keyboard.
    ...(placement === "up"
      ? { bottom: layout.height - rect.top + MENU_GAP }
      : { top: rect.bottom + MENU_GAP }),
  };
}
