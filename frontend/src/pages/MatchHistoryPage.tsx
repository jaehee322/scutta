import { ArrowLeft, CalendarDays } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { PageLoader } from "../components/Loading";
import { Notice } from "../components/Notice";
import { formatKoreanDate, getMatchPerspective } from "../lib/match";
import {
  getNextOffset,
  hasNextPage,
  isPageOutOfSync,
  tryAppendPage,
} from "../lib/pagination";
import type { MatchListResponse } from "../types";

const MATCH_PAGE_SIZE = 50;

export function MatchHistoryPage() {
  const { user } = useAuth();
  const [matches, setMatches] = useState<MatchListResponse | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loadMoreError, setLoadMoreError] = useState("");
  const [nextOffset, setNextOffset] = useState(0);
  const [pageStale, setPageStale] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const requestVersion = useRef(0);
  const loadMoreInFlight = useRef(false);
  const refreshingInFlight = useRef(false);

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    loadMoreInFlight.current = false;
    refreshingInFlight.current = true;
    setRefreshing(true);
    setLoadingMore(false);
    setLoadError("");
    setLoadMoreError("");
    try {
      const nextMatches = await apiRequest<MatchListResponse>(
        `/matches?limit=${MATCH_PAGE_SIZE}&offset=0`,
      );
      if (version !== requestVersion.current) return;
      setMatches(nextMatches);
      setNextOffset(getNextOffset(nextMatches));
      setPageStale(false);
    } catch (caught) {
      if (version !== requestVersion.current) return;
      setLoadError(caught instanceof Error ? caught.message : "경기 기록을 불러오지 못했습니다.");
    } finally {
      if (version === requestVersion.current) {
        refreshingInFlight.current = false;
        setRefreshing(false);
      }
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (
      loadMoreInFlight.current ||
      refreshingInFlight.current ||
      !matches ||
      !hasNextPage(matches, nextOffset)
    ) {
      return;
    }

    const version = requestVersion.current;
    loadMoreInFlight.current = true;
    setLoadingMore(true);
    setLoadMoreError("");
    try {
      const anchorOffset = nextOffset - 1;
      const anchorRequest: Promise<MatchListResponse | null> =
        anchorOffset >= 0
          ? apiRequest<MatchListResponse>(`/matches?limit=1&offset=${anchorOffset}`)
          : Promise.resolve(null);
      const [anchorPage, nextPage] = await Promise.all([
        anchorRequest,
        apiRequest<MatchListResponse>(
          `/matches?limit=${MATCH_PAGE_SIZE}&offset=${nextOffset}`,
        ),
      ]);
      if (version !== requestVersion.current) return;
      const result = tryAppendPage(
        matches,
        nextPage,
        anchorPage
          ? {
              offset: anchorOffset,
              total: anchorPage.total,
              itemId: anchorPage.items[0]?.id ?? null,
            }
          : undefined,
      );
      if (result.status === "stale") {
        setPageStale(true);
        return;
      }
      setMatches(result.value);
      setNextOffset(getNextOffset(nextPage));
    } catch (caught) {
      if (version !== requestVersion.current) return;
      setLoadMoreError(
        caught instanceof Error ? caught.message : "경기를 더 불러오지 못했습니다.",
      );
    } finally {
      loadMoreInFlight.current = false;
      if (version === requestVersion.current) setLoadingMore(false);
    }
  }, [matches, nextOffset]);

  useEffect(() => {
    void load();
    return () => {
      requestVersion.current += 1;
    };
  }, [load]);

  if (!matches && !loadError) return <PageLoader />;

  const canLoadMore = hasNextPage(matches, nextOffset);
  const pageOutOfSync = pageStale || isPageOutOfSync(matches, nextOffset);

  return (
    <div className="page">
      <Link className="back-link" to="/">
        <ArrowLeft size={18} /> 홈
      </Link>

      <header className="page-heading">
        <h1>전체 경기 기록</h1>
      </header>

      {loadError && (
        <div className="page-load-error">
          <Notice>{loadError}</Notice>
          <button
            type="button"
            className="secondary-button"
            disabled={refreshing}
            onClick={() => void load()}
          >
            {refreshing ? "불러오는 중" : "다시 불러오기"}
          </button>
        </div>
      )}

      {matches && (
        <section className="match-history-card card" aria-label="전체 경기 기록 목록">
          <header className="card-title-row">
            <h2>내 경기 기록</h2>
            <span className="muted-count">
              {matches.items.length === matches.total
                ? `총 ${matches.total}경기`
                : `${matches.items.length} / 총 ${matches.total}경기`}
            </span>
          </header>
          {!matches.items.length ? (
            <div className="empty-state">
              <span className="empty-state__icon"><CalendarDays size={24} /></span>
              <strong>아직 경기 기록이 없어요</strong>
            </div>
          ) : (
            <div className="match-history-table">
              {matches.items.map((match) => {
                const view = getMatchPerspective(match, user!.id);
                return (
                  <article key={match.id}>
                    <span className={`result-badge ${view.won ? "is-win" : "is-loss"}`}>
                      {view.won ? "승" : "패"}
                    </span>
                    <div>
                      <strong>{view.opponentName}</strong>
                      <span>{formatKoreanDate(match.played_on)}</span>
                    </div>
                    <strong className="match-history-score">
                      {view.myScore} : {view.opponentScore}
                    </strong>
                  </article>
                );
              })}
            </div>
          )}
          {(canLoadMore || loadMoreError || pageOutOfSync) && (
            <div className="pagination-footer">
              {pageOutOfSync ? (
                <Notice tone="info">목록이 변경되었습니다. 최신 목록을 다시 불러와 주세요.</Notice>
              ) : (
                loadMoreError && <Notice>{loadMoreError}</Notice>
              )}
              <button
                type="button"
                className="secondary-button"
                disabled={loadingMore || refreshing || (!canLoadMore && !pageOutOfSync)}
                onClick={() => void (pageOutOfSync ? load() : loadMore())}
              >
                {loadingMore || refreshing
                  ? "불러오는 중"
                  : pageOutOfSync
                    ? "목록 새로고침"
                    : "더 보기"}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
