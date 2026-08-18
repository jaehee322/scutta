import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { useAuth } from "./auth/AuthContext";
import { AppShell } from "./components/AppShell";
import { ConnectionErrorScreen, LoadingScreen, PageLoader } from "./components/Loading";

const AdminCompetitionFormPage = lazy(() =>
  import("./pages/AdminCompetitionFormPage").then((module) => ({
    default: module.AdminCompetitionFormPage,
  })),
);
const AdminMatchesPage = lazy(() =>
  import("./pages/AdminMatchesPage").then((module) => ({ default: module.AdminMatchesPage })),
);
const AdminPlayersPage = lazy(() =>
  import("./pages/AdminPlayersPage").then((module) => ({ default: module.AdminPlayersPage })),
);
const AdminResetPage = lazy(() =>
  import("./pages/AdminResetPage").then((module) => ({ default: module.AdminResetPage })),
);
const CompetitionDetailPage = lazy(() =>
  import("./pages/CompetitionDetailPage").then((module) => ({
    default: module.CompetitionDetailPage,
  })),
);
const CompetitionsPage = lazy(() =>
  import("./pages/CompetitionsPage").then((module) => ({ default: module.CompetitionsPage })),
);
const HomePage = lazy(() =>
  import("./pages/HomePage").then((module) => ({ default: module.HomePage })),
);
const LoginPage = lazy(() =>
  import("./pages/LoginPage").then((module) => ({ default: module.LoginPage })),
);
const ProfilePage = lazy(() =>
  import("./pages/ProfilePage").then((module) => ({ default: module.ProfilePage })),
);
const RankingsPage = lazy(() =>
  import("./pages/RankingsPage").then((module) => ({ default: module.RankingsPage })),
);
const SettlementsPage = lazy(() =>
  import("./pages/SettlementsPage").then((module) => ({ default: module.SettlementsPage })),
);

function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname]);

  return null;
}

export default function App() {
  const { user, booting, connectionError, refreshUser } = useAuth();

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
          <Route path="/" element={user.role === "player" ? <HomePage /> : <Navigate to="/profile" replace />} />
          <Route path="/rankings" element={user.role === "player" ? <RankingsPage /> : <Navigate to="/profile" replace />} />
          <Route path="/competitions" element={<CompetitionsPage />} />
          <Route path="/competitions/:competitionId" element={<CompetitionDetailPage />} />
          <Route path="/settlements" element={user.role === "player" ? <SettlementsPage /> : <Navigate to="/profile" replace />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/admin/players" element={user.role === "admin" ? <AdminPlayersPage /> : <Navigate to="/" replace />} />
          <Route path="/admin/matches" element={user.role === "admin" ? <AdminMatchesPage /> : <Navigate to="/" replace />} />
          <Route path="/admin/competitions/new" element={user.role === "admin" ? <AdminCompetitionFormPage /> : <Navigate to="/" replace />} />
          <Route path="/admin/competitions/:competitionId/edit" element={user.role === "admin" ? <AdminCompetitionFormPage /> : <Navigate to="/" replace />} />
          <Route path="/admin/reset" element={user.role === "admin" ? <AdminResetPage /> : <Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to={user.role === "admin" ? "/profile" : "/"} replace />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}
