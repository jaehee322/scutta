import {
  ArrowRight,
  DatabaseZap,
  ListRestart,
  Trophy,
  UserRoundCog,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";
import { AccountSettings } from "../components/AccountSettings";

export function AdminHomePage() {
  const { user } = useAuth();

  return (
    <div className="page">
      <header className="admin-page-heading">
        <div>
          <h1>관리자 홈</h1>
          <p>{user?.username}님, SCUTTA 운영 메뉴를 한곳에서 관리하세요.</p>
        </div>
      </header>

      <section className="admin-console-anchor" aria-labelledby="admin-console-title">
        <div className="admin-console-heading">
          <span className="section-icon section-icon--blue">
            <UserRoundCog size={23} />
          </span>
          <div>
            <h2 id="admin-console-title">관리 메뉴</h2>
          </div>
        </div>
        <div className="admin-quick-grid">
          <AdminFeatureCard
            icon={<UserRoundCog size={22} />}
            title="선수 관리"
            description="등록·수정·삭제·비밀번호 초기화"
            href="/admin/players"
          />
          <AdminFeatureCard
            icon={<ListRestart size={22} />}
            title="일반 경기 관리"
            description="일반 경기 오기입 수정과 삭제"
            href="/admin/matches"
          />
          <AdminFeatureCard
            icon={<Trophy size={22} />}
            title="리그전 관리"
            description="생성·수정·마감"
            href="/competitions"
          />
          <AdminFeatureCard
            icon={<DatabaseZap size={22} />}
            title="학기 초기화"
            description="모든 선수·대회·경기 제거"
            href="/admin/reset"
            danger
          />
        </div>
      </section>

      <AccountSettings />
    </div>
  );
}
function AdminFeatureCard({
  icon,
  title,
  description,
  href,
  danger = false,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  href: string;
  danger?: boolean;
}) {
  return (
    <Link className={`admin-feature-card ${danger ? "is-danger" : ""}`} to={href}>
      <span>{icon}</span>
      <div>
        <strong>{title}</strong>
        <small>{description}</small>
      </div>
      <ArrowRight size={18} />
    </Link>
  );
}
