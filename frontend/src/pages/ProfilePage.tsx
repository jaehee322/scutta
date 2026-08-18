import {
  ArrowRight,
  CalendarDays,
  DatabaseZap,
  KeyRound,
  LogOut,
  Medal,
  ShieldCheck,
  Trophy,
  UserRoundCog,
} from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { apiRequest, jsonBody } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Modal } from "../components/Modal";
import { Notice } from "../components/Notice";
import { PageLoader } from "../components/Loading";
import { formatKoreanDate, getMatchPerspective } from "../lib/match";
import { getNextOffset, hasNextPage, isPageOutOfSync, tryAppendPage } from "../lib/pagination";
import type { MatchListResponse, PlayerWithStats } from "../types";

const MATCH_PAGE_SIZE = 50;

export function ProfilePage() {
  const { user, logout } = useAuth();
  const [profile, setProfile] = useState<PlayerWithStats | null>(null);
  const [matches, setMatches] = useState<MatchListResponse | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loadMoreError, setLoadMoreError] = useState("");
  const [actionError, setActionError] = useState("");
  const [nextOffset, setNextOffset] = useState(0);
  const [pageStale, setPageStale] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const requestVersion = useRef(0);
  const loadMoreInFlight = useRef(false);
  const refreshingInFlight = useRef(false);

  const load = useCallback(async () => {
    if (user?.role !== "player") return;
    const version = ++requestVersion.current;
    loadMoreInFlight.current = false;
    refreshingInFlight.current = true;
    setRefreshing(true);
    setLoadingMore(false);
    setLoadError("");
    setLoadMoreError("");
    try {
      const [nextProfile, nextMatches] = await Promise.all([
        apiRequest<PlayerWithStats>("/players/me"),
        apiRequest<MatchListResponse>(`/matches?limit=${MATCH_PAGE_SIZE}&offset=0`),
      ]);
      if (version !== requestVersion.current) return;
      setProfile(nextProfile);
      setMatches(nextMatches);
      setNextOffset(getNextOffset(nextMatches));
      setPageStale(false);
    } catch (caught) {
      if (version !== requestVersion.current) return;
      setLoadError(caught instanceof Error ? caught.message : "내 정보를 불러오지 못했습니다.");
    } finally {
      if (version === requestVersion.current) {
        refreshingInFlight.current = false;
        setRefreshing(false);
      }
    }
  }, [user?.role]);

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

  const handlePassword = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    try {
      const response = await apiRequest<{ message: string }>("/auth/password", {
        method: "PATCH",
        body: jsonBody({ current_password: currentPassword, new_password: newPassword }),
      });
      setMessage(response.message);
      setCurrentPassword("");
      setNewPassword("");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "비밀번호를 변경하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    setActionError("");
    try {
      await logout();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "로그아웃하지 못했습니다.");
    }
  };

  if (user?.role === "player" && !profile && !loadError) return <PageLoader />;

  const canLoadMore = hasNextPage(matches, nextOffset);
  const pageOutOfSync = pageStale || isPageOutOfSync(matches, nextOffset);

  return (
    <div className="page profile-page">
      <section className="profile-hero">
        <div className="profile-avatar">{user?.username.slice(0, 1)}</div>
        <div>
          <h1>{user?.username}</h1>
          <p>
            {user?.role === "admin"
              ? "SCUTTA 관리자"
              : profile
                ? `${profile.club_rank}부 · ${profile.is_freshman ? "신입 부원" : "SCUTTA 부원"}`
                : "SCUTTA 선수"}
          </p>
        </div>
        <span className={`role-badge ${user?.role === "admin" ? "is-admin" : ""}`}>
          {user?.role === "admin" ? <ShieldCheck size={16} /> : <Medal size={16} />}
          {user?.role === "admin" ? "관리자" : "선수"}
        </span>
      </section>

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
      {actionError && <Notice>{actionError}</Notice>}

      {profile && (
        <section className="profile-stats">
          <div><span>경기</span><strong>{profile.stats.matches}</strong></div>
          <div><span>승리</span><strong>{profile.stats.wins}</strong></div>
          <div><span>패배</span><strong>{profile.stats.losses}</strong></div>
          <div><span>상대</span><strong>{profile.stats.opponents}</strong></div>
        </section>
      )}

      {matches && (
        <section className="profile-history card">
          <header className="card-title-row">
            <div>
              <h2>내 경기 기록</h2>
            </div>
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
            <div className="history-table">
              {matches.items.map((match) => {
                const view = getMatchPerspective(match, user!.id);
                return (
                  <article key={match.id}>
                    <span className={`result-badge ${view.won ? "is-win" : "is-loss"}`}>
                      {view.won ? "승" : "패"}
                    </span>
                    <div><strong>{view.opponentName}</strong><span>{formatKoreanDate(match.played_on)}</span></div>
                    <strong className="history-score">{view.myScore} : {view.opponentScore}</strong>
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

      <section className="settings-list">
        <button type="button" onClick={() => setPasswordOpen(true)}>
          <span className="settings-list__icon"><KeyRound size={20} /></span>
          <div><strong>비밀번호 변경</strong></div>
          <ArrowRight size={18} />
        </button>
        <button type="button" className="is-danger" onClick={() => void handleLogout()}>
          <span className="settings-list__icon"><LogOut size={20} /></span>
          <div><strong>로그아웃</strong></div>
          <ArrowRight size={18} />
        </button>
      </section>

      {passwordOpen && (
        <Modal title="비밀번호 변경" description="새 비밀번호는 8자 이상 입력해 주세요." onClose={() => setPasswordOpen(false)}>
          <form className="modal-form" onSubmit={handlePassword}>
            <label className="field"><span>현재 비밀번호</span><input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} minLength={4} required /></label>
            <label className="field"><span>새 비밀번호</span><input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={8} required /></label>
            {message && <Notice tone={message.includes("변경했습니다") ? "success" : "error"}>{message}</Notice>}
            <button className="primary-button primary-button--large" disabled={submitting}>{submitting ? "변경하는 중" : "변경하기"}</button>
          </form>
        </Modal>
      )}

      {user?.role === "admin" && <AdminConsole />}
    </div>
  );
}

function AdminConsole() {
  return (
    <section className="admin-console-anchor" id="admin-console">
      <div className="admin-console-heading">
        <span className="section-icon section-icon--blue"><UserRoundCog size={23} /></span>
        <div><h2>관리자</h2></div>
      </div>
      <div className="admin-quick-grid">
        <AdminPlayers />
        <AdminMatches />
        <AdminCompetitions />
        <AdminReset />
      </div>
    </section>
  );
}

function AdminPlayers() {
  return <AdminFeatureCard icon={<UserRoundCog size={22} />} title="선수 관리" description="등록·수정·비밀번호 초기화" href="/admin/players" />;
}

function AdminMatches() {
  return <AdminFeatureCard icon={<DatabaseZap size={22} />} title="경기 관리" description="오기입 수정과 삭제" href="/admin/matches" />;
}

function AdminCompetitions() {
  return <AdminFeatureCard icon={<Trophy size={22} />} title="리그전 관리" description="생성·수정·마감" href="/competitions" />;
}

function AdminReset() {
  return <AdminFeatureCard icon={<DatabaseZap size={22} />} title="학기 초기화" description="모든 선수와 경기 제거" href="/admin/reset" danger />;
}

function AdminFeatureCard({ icon, title, description, href, danger = false }: { icon: ReactNode; title: string; description: string; href: string; danger?: boolean }) {
  return (
    <a className={`admin-feature-card ${danger ? "is-danger" : ""}`} href={href}>
      <span>{icon}</span><div><strong>{title}</strong><small>{description}</small></div><ArrowRight size={18} />
    </a>
  );
}
