import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { useAuth } from "./auth/AuthContext";
import { AppShell } from "./components/AppShell";
import { LoadingScreen } from "./components/Loading";
import { AdminMatchesPage } from "./pages/AdminMatchesPage";
import { AdminPlayersPage } from "./pages/AdminPlayersPage";
import { AdminResetPage } from "./pages/AdminResetPage";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { ProfilePage } from "./pages/ProfilePage";
import { RankingsPage } from "./pages/RankingsPage";
import { SettlementsPage } from "./pages/SettlementsPage";

function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname]);

  return null;
}

export default function App() {
  const { user, booting } = useAuth();

  if (booting) return <LoadingScreen />;
  if (!user) return <LoginPage />;

  return (
    <AppShell>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={user.role === "player" ? <HomePage /> : <Navigate to="/profile" replace />} />
        <Route path="/rankings" element={user.role === "player" ? <RankingsPage /> : <Navigate to="/profile" replace />} />
        <Route path="/settlements" element={user.role === "player" ? <SettlementsPage /> : <Navigate to="/profile" replace />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/admin/players" element={user.role === "admin" ? <AdminPlayersPage /> : <Navigate to="/" replace />} />
        <Route path="/admin/matches" element={user.role === "admin" ? <AdminMatchesPage /> : <Navigate to="/" replace />} />
        <Route path="/admin/reset" element={user.role === "admin" ? <AdminResetPage /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to={user.role === "admin" ? "/profile" : "/"} replace />} />
      </Routes>
    </AppShell>
  );
}
