import type { PlayerSummary } from "../types";

const normalizeName = (value: string) => value.trim().toLocaleLowerCase("ko-KR");

export function findPlayerByName(players: PlayerSummary[], query: string): PlayerSummary | undefined {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return undefined;

  return players.find((player) => player.username === trimmedQuery);
}

export function searchPlayers(
  players: PlayerSummary[],
  query: string,
  limit = 6,
): PlayerSummary[] {
  const normalizedQuery = normalizeName(query);
  if (!normalizedQuery || limit <= 0) return [];

  return players
    .filter((player) => normalizeName(player.username).includes(normalizedQuery))
    .sort((left, right) => {
      const leftStartsWith = normalizeName(left.username).startsWith(normalizedQuery);
      const rightStartsWith = normalizeName(right.username).startsWith(normalizedQuery);
      if (leftStartsWith !== rightStartsWith) return leftStartsWith ? -1 : 1;
      return left.username.localeCompare(right.username, "ko-KR");
    })
    .slice(0, limit);
}
