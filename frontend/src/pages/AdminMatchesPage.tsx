import { ArrowLeft, CalendarDays, Pencil, Trash2 } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { apiRequest, jsonBody } from "../api/client";
import { PageLoader } from "../components/Loading";
import { Modal } from "../components/Modal";
import { Notice } from "../components/Notice";
import { formatKoreanDate } from "../lib/match";
import { getNextOffset, hasNextPage, isPageOutOfSync, tryAppendPage } from "../lib/pagination";
import type { MatchListResponse, MatchRead, UserRead } from "../types";

type AllowedScore = "3:0" | "2:1" | "1:2" | "0:3";
const MATCH_PAGE_SIZE = 200;

export function AdminMatchesPage() {
  const [data, setData] = useState<MatchListResponse | null>(null);
  const [players, setPlayers] = useState<UserRead[]>([]);
  const [loadError, setLoadError] = useState("");
  const [loadMoreError, setLoadMoreError] = useState("");
  const [nextOffset, setNextOffset] = useState(0);
  const [pageStale, setPageStale] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<MatchRead | null>(null);
  const [deleting, setDeleting] = useState<MatchRead | null>(null);
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
      const [nextMatches, nextPlayers] = await Promise.all([
        apiRequest<MatchListResponse>(`/admin/matches?limit=${MATCH_PAGE_SIZE}&offset=0`),
        apiRequest<UserRead[]>("/admin/players"),
      ]);
      if (version !== requestVersion.current) return;
      setData(nextMatches);
      setPlayers(nextPlayers);
      setNextOffset(getNextOffset(nextMatches));
      setPageStale(false);
    } catch (caught) {
      if (version !== requestVersion.current) return;
      setLoadError(caught instanceof Error ? caught.message : "경기 목록을 불러오지 못했습니다.");
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
      !data ||
      !hasNextPage(data, nextOffset)
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
          ? apiRequest<MatchListResponse>(`/admin/matches?limit=1&offset=${anchorOffset}`)
          : Promise.resolve(null);
      const [anchorPage, nextPage] = await Promise.all([
        anchorRequest,
        apiRequest<MatchListResponse>(
          `/admin/matches?limit=${MATCH_PAGE_SIZE}&offset=${nextOffset}`,
        ),
      ]);
      if (version !== requestVersion.current) return;
      const result = tryAppendPage(
        data,
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
      setData(result.value);
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
  }, [data, nextOffset]);

  useEffect(() => {
    void load();
    return () => {
      requestVersion.current += 1;
    };
  }, [load]);

  if (!data && !loadError) return <PageLoader />;

  const canLoadMore = hasNextPage(data, nextOffset);
  const pageOutOfSync = pageStale || isPageOutOfSync(data, nextOffset);

  return (
    <div className="page admin-page">
      <Link className="back-link" to="/profile">
        <ArrowLeft size={18} /> 내 정보
      </Link>
      <header className="admin-page-heading">
        <div>
          <h1>경기 관리</h1>
        </div>
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

      {data && (
        <section className="admin-list-card">
          <div className="admin-list-card__summary">
            <strong>경기 {data.total}개</strong>
            <span>{data.items.length}개 표시</span>
          </div>
          {!data.items.length ? (
            <div className="empty-state">
              <span className="empty-state__icon"><CalendarDays size={24} /></span>
              <strong>아직 경기 기록이 없어요</strong>
            </div>
          ) : (
            <div className="admin-match-list">
              {data.items.map((match) => {
                const matchName = `${match.player1.username} 대 ${match.player2.username}`;
                return (
                  <article key={match.id}>
                    <span>{formatKoreanDate(match.played_on)}</span>
                    <div>
                      <strong>{match.player1.username}</strong>
                      <small>vs</small>
                      <strong>{match.player2.username}</strong>
                    </div>
                    <b>{match.score1} : {match.score2}</b>
                    <div className="admin-row-actions">
                      <button
                        type="button"
                        aria-label={`${matchName} 경기 수정`}
                        onClick={() => setEditing(match)}
                      >
                        <Pencil size={18} />
                      </button>
                      <button
                        type="button"
                        className="is-danger"
                        aria-label={`${matchName} 경기 삭제`}
                        onClick={() => setDeleting(match)}
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
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

      {editing && (
        <MatchEditModal
          match={editing}
          players={players}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
      {deleting && (
        <DeleteMatchModal
          match={deleting}
          onClose={() => setDeleting(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}

function MatchEditModal({
  match,
  players,
  onClose,
  onSaved,
}: {
  match: MatchRead;
  players: UserRead[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [player1Id, setPlayer1Id] = useState(match.player1.id);
  const [player2Id, setPlayer2Id] = useState(match.player2.id);
  const [score, setScore] = useState<AllowedScore>(`${match.score1}:${match.score2}` as AllowedScore);
  const [playedOn, setPlayedOn] = useState(match.played_on);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (player1Id === player2Id) {
      setError("서로 다른 두 선수를 선택해 주세요.");
      return;
    }

    setSaving(true);
    setError("");
    const [score1, score2] = score.split(":").map(Number);
    try {
      await apiRequest(`/admin/matches/${match.id}`, {
        method: "PATCH",
        body: jsonBody({
          player1_id: player1Id,
          player2_id: player2Id,
          score1,
          score2,
          played_on: playedOn,
        }),
      });
      await onSaved();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "수정하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="경기 기록 수정" description="선수, 점수와 날짜를 모두 바로잡을 수 있어요." onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <div className="form-row">
          <label className="field">
            <span>첫 번째 선수</span>
            <select value={player1Id} onChange={(event) => setPlayer1Id(Number(event.target.value))}>
              {players.map((player) => (
                <option key={player.id} value={player.id} disabled={player.id === player2Id}>
                  {player.username}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>두 번째 선수</span>
            <select value={player2Id} onChange={(event) => setPlayer2Id(Number(event.target.value))}>
              {players.map((player) => (
                <option key={player.id} value={player.id} disabled={player.id === player1Id}>
                  {player.username}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="form-row">
          <label className="field">
            <span>경기 날짜</span>
            <input
              type="date"
              value={playedOn}
              onChange={(event) => setPlayedOn(event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>점수</span>
            <select value={score} onChange={(event) => setScore(event.target.value as AllowedScore)}>
              <option value="3:0">3 : 0</option>
              <option value="2:1">2 : 1</option>
              <option value="1:2">1 : 2</option>
              <option value="0:3">0 : 3</option>
            </select>
          </label>
        </div>
        <p className="form-hint">점수는 위에 표시된 첫 번째 선수 기준이에요.</p>
        {error && <Notice>{error}</Notice>}
        <button className="primary-button primary-button--large" disabled={saving}>
          {saving ? "수정하는 중" : "수정하기"}
        </button>
      </form>
    </Modal>
  );
}

function DeleteMatchModal({
  match,
  onClose,
  onSaved,
}: {
  match: MatchRead;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);

  const remove = async () => {
    setDeleting(true);
    setError("");
    try {
      await apiRequest(`/admin/matches/${match.id}`, { method: "DELETE" });
      await onSaved();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "삭제하지 못했습니다.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal title="경기 기록을 삭제할까요?" description="삭제 즉시 랭킹과 정산에도 반영돼요." onClose={onClose}>
      <div className="confirm-match">
        <strong>{match.player1.username} {match.score1} : {match.score2} {match.player2.username}</strong>
        <span>{formatKoreanDate(match.played_on)}</span>
      </div>
      {error && <Notice>{error}</Notice>}
      <div className="modal-actions">
        <button type="button" className="secondary-button" onClick={onClose}>취소</button>
        <button type="button" className="danger-button" disabled={deleting} onClick={() => void remove()}>
          {deleting ? "삭제하는 중" : "삭제하기"}
        </button>
      </div>
    </Modal>
  );
}
