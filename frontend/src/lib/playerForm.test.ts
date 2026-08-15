import { describe, expect, it } from "vitest";

import { buildPlayerPayload, type PlayerFormValues } from "./playerForm";

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

  it("rejects an empty or non-positive rank", () => {
    expect(() => buildPlayerPayload({ ...form, club_rank: "" }, false)).toThrow("부수는 1 이상의 정수");
    expect(() => buildPlayerPayload({ ...form, club_rank: "0" }, false)).toThrow("부수는 1 이상의 정수");
  });
});
