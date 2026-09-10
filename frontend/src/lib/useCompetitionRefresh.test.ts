import { describe, expect, it } from "vitest";

import { millisecondsUntilNextKoreanMidnight } from "./useCompetitionRefresh";

describe("millisecondsUntilNextKoreanMidnight", () => {
  it("counts down to UTC 15:00, when the next Korean date starts", () => {
    expect(millisecondsUntilNextKoreanMidnight(Date.parse("2026-09-10T14:59:59.000Z"))).toBe(1_000);
    expect(millisecondsUntilNextKoreanMidnight(Date.parse("2026-09-10T14:59:59.999Z"))).toBe(1);
  });

  it("schedules the following midnight when already exactly at the boundary", () => {
    expect(millisecondsUntilNextKoreanMidnight(Date.parse("2026-09-10T15:00:00.000Z"))).toBe(86_400_000);
    expect(millisecondsUntilNextKoreanMidnight(Date.parse("2026-09-10T15:00:00.001Z"))).toBe(86_399_999);
  });

  it("uses Korean dates independently of the timestamp's original offset", () => {
    expect(millisecondsUntilNextKoreanMidnight(Date.parse("2026-09-11T09:00:00+09:00"))).toBe(54_000_000);
    expect(millisecondsUntilNextKoreanMidnight(Date.parse("2026-09-10T20:00:00-04:00"))).toBe(54_000_000);
  });

  it.each([
    "2026-09-30T14:59:59.999Z",
    "2026-12-31T14:59:59.999Z",
    "2028-02-29T14:59:59.999Z",
  ])("handles calendar boundaries at %s", (date) => {
    expect(millisecondsUntilNextKoreanMidnight(Date.parse(date))).toBe(1);
  });
});
