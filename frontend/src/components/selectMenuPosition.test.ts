import { describe, expect, it } from "vitest";

import { getSelectMenuPosition } from "./selectMenuPosition";

describe("select menu visible bounds", () => {
  const layout = { width: 390, height: 800 };
  const rect = { top: 340, bottom: 390, left: 24, width: 342 };

  it("preserves the ordinary downward menu without a keyboard", () => {
    expect(getSelectMenuPosition(rect, layout, 8)).toEqual({
      placement: "down", left: 24, width: 342, maxHeight: 288, top: 396,
    });
  });

  it("opens above a keyboard without confusing visual and layout coordinates", () => {
    const position = getSelectMenuPosition(rect, layout, 8,
      { offsetTop: 0, offsetLeft: 0, width: 390, height: 400 });
    expect(position?.placement).toBe("up");
    expect(position?.bottom).toBe(466);
    expect(layout.height - position!.bottom!).toBeLessThanOrEqual(400 - 12);
    expect(layout.height - position!.bottom! - position!.maxHeight).toBeGreaterThanOrEqual(12);
  });

  it("keeps a zoomed or panned menu inside the visible width and height", () => {
    const visible = { offsetTop: 200, offsetLeft: 60, width: 250, height: 250 };
    const position = getSelectMenuPosition(rect, layout, 8, visible)!;
    expect(position.left).toBeGreaterThanOrEqual(visible.offsetLeft + 12);
    expect(position.left + position.width).toBeLessThanOrEqual(visible.offsetLeft + visible.width - 12);
    expect(layout.height - position.bottom! - position.maxHeight).toBeGreaterThanOrEqual(212);
  });

  it("closes a menu when its trigger has scrolled out of view", () => {
    expect(getSelectMenuPosition({ ...rect, top: 500, bottom: 550 }, layout, 8,
      { offsetTop: 0, offsetLeft: 0, width: 390, height: 400 })).toBeNull();
  });
});
