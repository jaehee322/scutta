import { describe, expect, it } from "vitest";

import type { PlayerSummary } from "../types";
import { findPlayerByName, searchPlayers } from "./playerSearch";

const players: PlayerSummary[] = [
  { id: 1, username: "김민지", gender: "F", is_freshman: false, club_rank: 3 },
  { id: 2, username: "민준", gender: "M", is_freshman: true, club_rank: 5 },
  { id: 3, username: "박민수", gender: "M", is_freshman: false, club_rank: 2 },
  { id: 4, username: "Alex", gender: "F", is_freshman: false, club_rank: 4 },
  { id: 5, username: "alex", gender: "M", is_freshman: false, club_rank: 5 },
];

describe("searchPlayers", () => {
  it("returns matching players and puts prefix matches first", () => {
    expect(searchPlayers(players, "민").map((player) => player.username)).toEqual([
      "민준",
      "김민지",
      "박민수",
    ]);
  });

  it("matches Latin names without case sensitivity and limits results", () => {
    const result = searchPlayers(players, "al", 1);
    expect(result).toHaveLength(1);
    expect(result[0]?.username.toLocaleLowerCase("ko-KR")).toBe("alex");
  });

  it("does not suggest players for an empty query", () => {
    expect(searchPlayers(players, "   ")).toEqual([]);
  });
});

describe("findPlayerByName", () => {
  it("only resolves a complete existing player name with the exact case", () => {
    expect(findPlayerByName(players, "  Alex ")?.id).toBe(4);
    expect(findPlayerByName(players, "alex")?.id).toBe(5);
    expect(findPlayerByName(players, "ALEX")?.id).toBeUndefined();
    expect(findPlayerByName(players, "민")?.id).toBeUndefined();
    expect(findPlayerByName(players, "없는 선수")?.id).toBeUndefined();
  });
});
