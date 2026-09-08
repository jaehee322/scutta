import { useCallback, useEffect, useId, useRef, useState } from "react";

import { apiRequest } from "../api/client";
import { formatKoreanDateTime, getMatchPerspective } from "../lib/match";
import { getNextOffset, hasNextPage, isPageOutOfSync, tryAppendPage } from "../lib/pagination";
import type { PlayerMatchHistoryResponse, PlayerSummary } from "../types";
import { Modal } from "./Modal";
import { Notice } from "./Notice";

const PAGE_SIZE = 5;

function PlayerMatchHistorySection({
  player,
  viewerId,
  headToHead = false,
}: {
  player: PlayerSummary;
  viewerId: number;
  headToHead?: boolean;
}) {
  const headingId = useId();
  const [page, setPage] = useState<PlayerMatchHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const path = `/players/${player.id}/matches?head_to_head=${headToHead}`;

  const load = useCallback(async (current: PlayerMatchHistoryResponse | null = null) => {
    if (requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError("");
    const offset = current ? getNextOffset(current) : 0;
    try {
      const [nextPage, anchorPage] = await Promise.all([
        apiRequest<PlayerMatchHistoryResponse>(`${path}&limit=${PAGE_SIZE}&offset=${offset}`, {
          signal: controller.signal,
        }),
        current && offset > 0
          ? apiRequest<PlayerMatchHistoryResponse>(`${path}&limit=1&offset=${offset - 1}`, {
              signal: controller.signal,
            })
          : Promise.resolve(null),
      ]);
      if (controller.signal.aborted) return;
      if (current) {
        const result = tryAppendPage(current, nextPage, anchorPage ? {
          offset: offset - 1,
          total: anchorPage.total,
          itemId: anchorPage.items[0]?.id ?? null,
        } : undefined);
        if (result.status === "stale") {
          setStale(true);
          return;
        }
        setPage({ ...result.value, wins: nextPage.wins, losses: nextPage.losses });
      } else {
        setPage(nextPage);
      }
      setStale(false);
    } catch (caught) {
      if (!controller.signal.aborted) {
        setError(caught instanceof Error ? caught.message : "경기 기록을 불러오지 못했습니다.");
      }
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
      controller.abort();
    }
  }, [path]);

  useEffect(() => {
    void load();
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [load]);

  const title = headToHead ? "나와의 전적" : "경기 기록";
  const perspectiveId = headToHead ? viewerId : player.id;
  const nextOffset = page ? getNextOffset(page) : 0;
  const outOfSync = stale || isPageOutOfSync(page, nextOffset);
  const canLoadMore = hasNextPage(page, nextOffset);

  return (
    <section className="player-match-section" aria-labelledby={headingId} aria-busy={loading}>
      <header className="player-match-section__heading">
        <h3 id={headingId}>{title}</h3>
        <p>{headToHead ? "내 기준" : `${player.username} 기준`} · 최신순</p>
      </header>
      {page && (
        <p className="player-match-section__summary">
          총 {page.total}경기 <span>·</span> <strong>{page.wins}승 {page.losses}패</strong>
        </p>
      )}
      {!page && loading && <p className="player-match-section__message" role="status">기록을 불러오는 중이에요.</p>}
      {page && page.items.length === 0 && (
        <p className="player-match-section__message">
          {headToHead ? "아직 이 선수와의 경기 기록이 없어요." : "아직 경기 기록이 없어요."}
        </p>
      )}
      {page && page.items.length > 0 && (
        <div className="match-history-table player-match-list">
          {page.items.map((match) => {
            const view = getMatchPerspective(match, perspectiveId);
            return (
              <article key={match.id}>
                <span className={`result-badge ${view.won ? "is-win" : "is-loss"}`}>
                  {view.won ? "승" : "패"}
                </span>
                <div>
                  <strong>{view.opponentName}</strong>
                  <span>{formatKoreanDateTime(match.played_on, match.played_at)}</span>
                </div>
                <strong className="match-history-score">{view.myScore} : {view.opponentScore}</strong>
              </article>
            );
          })}
        </div>
      )}
      {outOfSync ? (
        <Notice tone="info">경기 기록이 변경됐어요. 최신 기록을 다시 불러와 주세요.</Notice>
      ) : error && <Notice>{error}</Notice>}
      {(canLoadMore || error || outOfSync) && (
        <div className="player-match-section__footer">
          {page && <span>{page.items.length} / {page.total}경기</span>}
          <button
            type="button"
            className="secondary-button"
            disabled={loading}
            aria-label={`${title} ${outOfSync ? "새로고침" : error ? "다시 불러오기" : "더보기"}`}
            onClick={() => void load(outOfSync ? null : page)}
          >
            {loading ? "불러오는 중" : outOfSync ? "기록 새로고침" : error ? "다시 불러오기" : "더보기"}
          </button>
        </div>
      )}
    </section>
  );
}

export function PlayerMatchHistoryModal({
  player,
  viewerId,
  onClose,
}: {
  player: PlayerSummary;
  viewerId: number;
  onClose: () => void;
}) {
  return (
    <div className="player-record-dialog">
      <Modal title={`${player.username} 선수 기록`} onClose={onClose}>
        <div className="player-record-sections">
          <PlayerMatchHistorySection key={`${player.id}-all`} player={player} viewerId={viewerId} />
          {player.id === viewerId ? (
            <section className="player-match-section" aria-label="나와의 전적">
              <header className="player-match-section__heading"><h3>나와의 전적</h3></header>
              <p className="player-match-section__message">내 기록이에요. 다른 선수를 선택하면 나와의 전적을 볼 수 있어요.</p>
            </section>
          ) : (
            <PlayerMatchHistorySection key={`${player.id}-${viewerId}-head`} player={player} viewerId={viewerId} headToHead />
          )}
        </div>
      </Modal>
    </div>
  );
}
