import type { MatchRead } from "../types";

export interface MatchPerspective {
  opponentName: string;
  opponentId: number;
  myScore: number;
  opponentScore: number;
  won: boolean;
}

export function getMatchPerspective(match: MatchRead, userId: number): MatchPerspective {
  const amPlayer1 = match.player1.id === userId;
  return {
    opponentName: amPlayer1 ? match.player2.username : match.player1.username,
    opponentId: amPlayer1 ? match.player2.id : match.player1.id,
    myScore: amPlayer1 ? match.score1 : match.score2,
    opponentScore: amPlayer1 ? match.score2 : match.score1,
    won: match.winner_id === userId,
  };
}

export function toMatchScore(outcome: "win" | "loss", score: "3:0" | "2:1") {
  const [winnerScore, loserScore] = score.split(":").map(Number);
  return outcome === "win"
    ? { my_score: winnerScore, opponent_score: loserScore }
    : { my_score: loserScore, opponent_score: winnerScore };
}

export function formatKoreanDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    weekday: "short",
  }).format(new Date(year, month - 1, day));
}

export function formatKoreanDateTime(playedOn: string, playedAt: string | null): string {
  const dateLabel = formatKoreanDate(playedOn);
  if (!playedAt) return dateLabel;

  const instant = new Date(playedAt);
  if (Number.isNaN(instant.getTime())) return dateLabel;

  const timeLabel = new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Seoul",
  }).format(instant);
  return `${dateLabel} · ${timeLabel}`;
}
