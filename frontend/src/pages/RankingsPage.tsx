import { Medal, Trophy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { PageLoader } from "../components/Loading";
import { Notice } from "../components/Notice";
import type { RankingCategory, RankingsResponse } from "../types";

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
                  <article className={`ranking-row ${isMe ? "is-me" : ""}`} key={entry.player.id}>
                    <div
                      className={`rank-number rank-number--${entry.rank}`}
                      aria-label={`${entry.rank}위`}
                    >
                      {entry.rank <= 3 ? (
                        <Medal size={21} strokeWidth={2.2} aria-hidden="true" />
                      ) : (
                        entry.rank
                      )}
                    </div>
                    <div className="ranking-player">
                      <span className="avatar-circle">{entry.player.username.slice(0, 1)}</span>
                      <div>
                        <strong>
                          <span className="ranking-player__name">{entry.player.username}</span>
                          {entry.player.club_rank !== null && (
                            <span className="ranking-player__club-rank">
                              {entry.player.club_rank}부
                            </span>
                          )}
                          {isMe && <small>나</small>}
                        </strong>
                      </div>
                    </div>
                    <div className="ranking-value">
                      <strong>{entry.value}</strong>
                      <span>{categoryMeta[category].unit}</span>
                    </div>
                  </article>
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
    </div>
  );
}
