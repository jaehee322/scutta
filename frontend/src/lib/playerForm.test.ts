import { describe, expect, it } from "vitest";

import { buildPlayerPayload, getDefaultClubRank, type PlayerFormValues } from "./playerForm";

const form: PlayerFormValues = {
  username: "홍길동",
  password: "20261234",
  gender: "M",
  is_freshman: true,
  club_rank: "2",
};

describe("buildPlayerPayload", () => {
  it("converts the rank input to a number without an active-account field", () => {
    expect(buildPlayerPayload(form, false)).toEqual({
      username: "홍길동",
      password: "20261234",
      gender: "M",
      is_freshman: true,
      club_rank: 2,
    });
  });

  it("omits both password and active-account state when editing", () => {
    expect(buildPlayerPayload(form, true)).toEqual({
      username: "홍길동",
      gender: "M",
      is_freshman: true,
      club_rank: 2,
    });
  });

  it("accepts every integer rank from -2 through 7", () => {
    expect(buildPlayerPayload({ ...form, club_rank: "-2" }, false).club_rank).toBe(-2);
    expect(buildPlayerPayload({ ...form, club_rank: "0" }, false).club_rank).toBe(0);
    expect(buildPlayerPayload({ ...form, club_rank: "7" }, false).club_rank).toBe(7);
  });

  it("rejects an empty, fractional, or out-of-range rank", () => {
    const message = "부수는 -2부터 7 사이의 정수";
    expect(() => buildPlayerPayload({ ...form, club_rank: "" }, false)).toThrow(message);
    expect(() => buildPlayerPayload({ ...form, club_rank: "1.5" }, false)).toThrow(message);
    expect(() => buildPlayerPayload({ ...form, club_rank: "-3" }, false)).toThrow(message);
    expect(() => buildPlayerPayload({ ...form, club_rank: "8" }, false)).toThrow(message);
  });
});

describe("getDefaultClubRank", () => {
  it.each([
    ["M", true, 5],
    ["M", false, 4],
    ["F", true, 7],
    ["F", false, 6],
  ] as const)("returns the default for gender %s and first-year %s", (gender, isFreshman, expected) => {
    expect(getDefaultClubRank(gender, isFreshman)).toBe(expected);
  });
});
