import {
  ChartNoAxesColumnIncreasing,
  DatabaseZap,
  Home,
  ListRestart,
  ReceiptText,
  Trophy,
  UsersRound,
} from "lucide-react";
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";
import { Brand } from "./Brand";

const playerNavItems = [
  { to: "/", label: "홈", icon: Home, end: true },
  { to: "/rankings", label: "랭킹", icon: ChartNoAxesColumnIncreasing, end: false },
  { to: "/competitions", label: "리그전", icon: Trophy, end: false },
  { to: "/settlements", label: "정산", icon: ReceiptText, end: false },
] as const;

const adminNavItems = [
  { to: "/", label: "홈", icon: Home, end: true },
  { to: "/admin/players", label: "선수", icon: UsersRound, end: false },
  { to: "/admin/matches", label: "경기", icon: ListRestart, end: false },
  { to: "/competitions", label: "리그전", icon: Trophy, end: false },
  { to: "/admin/reset", label: "초기화", icon: DatabaseZap, end: false },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const navItems = user?.role === "admin" ? adminNavItems : playerNavItems;

  return (
    <div className="app-frame">
      <header className="topbar">
        <div className="topbar__inner">
          <Brand compact />
          <nav className="desktop-nav" aria-label="주요 메뉴">
            {navItems.map(({ to, label, end }) => (
              <NavLink key={to} to={to} end={end}>
                {label}
              </NavLink>
            ))}
          </nav>
          <NavLink className="user-chip" to="/" aria-label="홈으로 이동">
            <strong>{user?.username}</strong>
          </NavLink>
        </div>
      </header>

      <main id="main-content" className="app-content" tabIndex={-1}>{children}</main>

      <nav className="bottom-nav" aria-label="주요 메뉴">
        {navItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end}>
            <Icon size={22} strokeWidth={2} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
