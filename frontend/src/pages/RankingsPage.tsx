import { Medal, Trophy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { PageLoader } from "../components/Loading";
import { Notice } from "../components/Notice";
import { PlayerMatchHistoryModal } from "../components/PlayerMatchHistoryModal";
import type { PlayerSummary, RankingCategory, RankingsResponse } from "../types";

const categoryMeta: Record<
  RankingCategory,
  { label: string; shortLabel: string; unit: string }
> = {
  matches: { label: "경기 수", shortLabel: "경기", unit: "판" },
  wins: { label: "승리 수", shortLabel: "승리", unit: "승" },
  losses: { label: "패배 수", shortLabel: "패배", unit: "패" },
  opponents: { label: "상대 수", shortLabel: "상대", unit: "명" },
};

const categories = Object.keys(categoryMeta) as RankingCategory[];

export function RankingsPage() {
  const { user } = useAuth();
  const [data, setData] = useState<RankingsResponse | null>(null);
  const [category, setCategory] = useState<RankingCategory>("matches");
  const [error, setError] = useState("");
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerSummary | null>(null);

  useEffect(() => {
    apiRequest<RankingsResponse>("/rankings")
      .then(setData)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "랭킹을 불러오지 못했습니다."));
  }, []);

  const table = useMemo(
    () => data?.categories.find((item) => item.category === category),
    [category, data],
  );

  if (!data && !error) return <PageLoader />;

  return (
    <div className="page">
      <header className="page-heading">
        <h1>랭킹</h1>
      </header>

      {error && <Notice>{error}</Notice>}

      <div className="segmented-control" role="group" aria-label="랭킹 부문">
        {categories.map((item) => (
          <button
            type="button"
            aria-pressed={category === item}
            key={item}
            className={category === item ? "is-active" : ""}
            onClick={() => setCategory(item)}
          >
            {categoryMeta[item].shortLabel}
          </button>
        ))}
      </div>

      {table && (
        <>
          <section className="ranking-card">
            <div className="ranking-header-row">
              <span>순위</span>
              <span>선수</span>
              <span>{categoryMeta[category].label}</span>
            </div>
            <div>
              {table.entries.map((entry) => {
                const isMe = entry.player.id === user?.id;
                return (
                  <button
                    type="button"
                    className={`ranking-row ${isMe ? "is-me" : ""}`}
                    key={entry.player.id}
                    aria-label={[
                      `${entry.rank}위 ${entry.player.username}`,
                      isMe ? "나" : null,
                      entry.player.club_rank !== null ? `${entry.player.club_rank}부` : null,
                      `${categoryMeta[category].label} ${entry.value}${categoryMeta[category].unit}`,
                      "경기 기록 보기",
                    ].filter(Boolean).join(", ")}
                    aria-haspopup="dialog"
                    onClick={(event) => {
                      event.currentTarget.focus();
                      setSelectedPlayer(entry.player);
                    }}
                  >
                    <span
                      className={`rank-number rank-number--${entry.rank}`}
                      aria-label={`${entry.rank}위`}
                    >
                      {entry.rank <= 3 ? (
                        <Medal size={21} strokeWidth={2.2} aria-hidden="true" />
                      ) : (
                        entry.rank
                      )}
                    </span>
                    <span className="ranking-player">
                      <span className="avatar-circle">{entry.player.username.slice(0, 1)}</span>
                      <span className="ranking-player__info">
                        <strong>
                          <span className="ranking-player__name">{entry.player.username}</span>
                          {entry.player.club_rank !== null && (
                            <span className="ranking-player__club-rank">
                              {entry.player.club_rank}부
                            </span>
                          )}
                          {isMe && <small>나</small>}
                        </strong>
                      </span>
                    </span>
                    <span className="ranking-value">
                      <strong>{entry.value}</strong>
                      <span>{categoryMeta[category].unit}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <aside className="ranking-note">
            <Trophy size={20} />
            <p>동점자는 같은 순위로 표시되고 다음 순위는 건너뛰어요.</p>
          </aside>
        </>
      )}
      {selectedPlayer && user && (
        <PlayerMatchHistoryModal
          key={`${selectedPlayer.id}-${user.id}`}
          player={selectedPlayer}
          viewerId={user.id}
          onClose={() => setSelectedPlayer(null)}
        />
      )}
    </div>
  );
}
