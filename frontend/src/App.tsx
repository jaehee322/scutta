import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { useAuth } from "./auth/AuthContext";
import { AppShell } from "./components/AppShell";
import { ConnectionErrorScreen, LoadingScreen, PageLoader } from "./components/Loading";

const loadAdminCompetitionFormPage = () => import("./pages/AdminCompetitionFormPage");
const loadAdminHomePage = () => import("./pages/AdminHomePage");
const loadAdminMatchesPage = () => import("./pages/AdminMatchesPage");
const loadAdminPlayersPage = () => import("./pages/AdminPlayersPage");
const loadAdminResetPage = () => import("./pages/AdminResetPage");
const loadAdminSettlementsPage = () => import("./pages/AdminSettlementsPage");
const loadCompetitionDetailPage = () => import("./pages/CompetitionDetailPage");
const loadCompetitionsPage = () => import("./pages/CompetitionsPage");
const loadHomePage = () => import("./pages/HomePage");
const loadLoginPage = () => import("./pages/LoginPage");
const loadMatchHistoryPage = () => import("./pages/MatchHistoryPage");
const loadMinigamePage = () => import("./pages/MinigamePage");
const loadRankingsPage = () => import("./pages/RankingsPage");
const loadSettlementsPage = () => import("./pages/SettlementsPage");

const AdminCompetitionFormPage = lazy(() =>
  loadAdminCompetitionFormPage().then((module) => ({
    default: module.AdminCompetitionFormPage,
  })),
);
const AdminHomePage = lazy(() =>
  loadAdminHomePage().then((module) => ({ default: module.AdminHomePage })),
);
const AdminMatchesPage = lazy(() =>
  loadAdminMatchesPage().then((module) => ({ default: module.AdminMatchesPage })),
);
const AdminPlayersPage = lazy(() =>
  loadAdminPlayersPage().then((module) => ({ default: module.AdminPlayersPage })),
);
const AdminResetPage = lazy(() =>
  loadAdminResetPage().then((module) => ({ default: module.AdminResetPage })),
);
const AdminSettlementsPage = lazy(() =>
  loadAdminSettlementsPage().then((module) => ({ default: module.AdminSettlementsPage })),
);
const CompetitionDetailPage = lazy(() =>
  loadCompetitionDetailPage().then((module) => ({
    default: module.CompetitionDetailPage,
  })),
);
const CompetitionsPage = lazy(() =>
  loadCompetitionsPage().then((module) => ({ default: module.CompetitionsPage })),
);
const HomePage = lazy(() =>
  loadHomePage().then((module) => ({ default: module.HomePage })),
);
const LoginPage = lazy(() =>
  loadLoginPage().then((module) => ({ default: module.LoginPage })),
);
const MatchHistoryPage = lazy(() =>
  loadMatchHistoryPage().then((module) => ({ default: module.MatchHistoryPage })),
);
const MinigamePage = lazy(() =>
  loadMinigamePage().then((module) => ({ default: module.MinigamePage })),
);
const RankingsPage = lazy(() =>
  loadRankingsPage().then((module) => ({ default: module.RankingsPage })),
);
const SettlementsPage = lazy(() =>
  loadSettlementsPage().then((module) => ({ default: module.SettlementsPage })),
);

function ScrollToTop() {
  const { pathname } = useLocation();
  const { user } = useAuth();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    const pageName = pathname.startsWith("/admin/players")
      ? "선수 관리"
      : pathname.startsWith("/admin/matches")
        ? "일반 경기 관리"
        : pathname.startsWith("/admin/settlements")
          ? "정산 설정"
        : pathname.startsWith("/admin/reset")
          ? "학기 초기화"
            : pathname.startsWith("/admin/competitions")
              ? "리그전 관리"
              : pathname.startsWith("/competitions")
                ? "리그전"
                : pathname === "/rankings"
                  ? "랭킹"
                  : pathname === "/minigame"
                    ? "미니게임"
                  : pathname === "/history"
                    ? "경기 기록"
                    : pathname === "/settlements"
                      ? "정산"
                      : user?.role === "admin"
                        ? "관리 홈"
                        : "홈";
    document.title = `${pageName} | SCUTTA`;
    window.requestAnimationFrame(() => document.getElementById("main-content")?.focus());
  }, [pathname, user?.role]);

  return null;
}

export default function App() {
  const { user, booting, connectionError, refreshUser } = useAuth();

  useEffect(() => {
    if (!user) return;
    const timer = window.setTimeout(() => {
      if (!navigator.onLine) return;
      const sharedPageLoaders: Array<() => Promise<unknown>> = [
        loadCompetitionsPage,
        loadCompetitionDetailPage,
      ];
      const rolePageLoaders: Array<() => Promise<unknown>> = user.role === "admin"
        ? [
            loadAdminHomePage,
            loadAdminPlayersPage,
            loadAdminMatchesPage,
            loadAdminCompetitionFormPage,
            loadAdminResetPage,
            loadAdminSettlementsPage,
          ]
        : [
            loadHomePage,
            loadMatchHistoryPage,
            loadMinigamePage,
            loadRankingsPage,
            loadSettlementsPage,
          ];
      void Promise.allSettled(
        [...sharedPageLoaders, ...rolePageLoaders].map((loadPage) => loadPage()),
      );
    }, 1_000);
    return () => window.clearTimeout(timer);
  }, [user]);

  if (booting) return <LoadingScreen />;
  if (connectionError) {
    return (
      <ConnectionErrorScreen
        message={connectionError}
        onRetry={() => void refreshUser()}
      />
    );
  }
  if (!user) {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <LoginPage />
      </Suspense>
    );
  }

  return (
    <AppShell>
      <ScrollToTop />
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={user.role === "player" ? <HomePage /> : <AdminHomePage />} />
          <Route path="/rankings" element={user.role === "player" ? <RankingsPage /> : <Navigate to="/" replace />} />
          <Route path="/competitions" element={<CompetitionsPage />} />
          <Route path="/competitions/:competitionId" element={<CompetitionDetailPage />} />
          <Route path="/settlements" element={user.role === "player" ? <SettlementsPage /> : <Navigate to="/" replace />} />
          <Route path="/minigame" element={user.role === "player" ? <MinigamePage /> : <Navigate to="/" replace />} />
          <Route path="/history" element={user.role === "player" ? <MatchHistoryPage /> : <Navigate to="/" replace />} />
          <Route path="/profile" element={<Navigate to="/" replace />} />
          <Route path="/admin/players" element={user.role === "admin" ? <AdminPlayersPage /> : <Navigate to="/" replace />} />
          <Route path="/admin/matches" element={user.role === "admin" ? <AdminMatchesPage /> : <Navigate to="/" replace />} />
          <Route path="/admin/settlements" element={user.role === "admin" ? <AdminSettlementsPage /> : <Navigate to="/" replace />} />
          <Route path="/admin/competitions/new" element={user.role === "admin" ? <AdminCompetitionFormPage /> : <Navigate to="/" replace />} />
          <Route path="/admin/competitions/:competitionId/edit" element={user.role === "admin" ? <AdminCompetitionFormPage /> : <Navigate to="/" replace />} />
          <Route path="/admin/reset" element={user.role === "admin" ? <AdminResetPage /> : <Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}
