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
          <h2 id="admin-console-title">관리 메뉴</h2>
        </div>
        <div className="admin-quick-grid">
          <AdminFeatureCard
            title="선수 관리"
            description="등록·수정·삭제·비밀번호 초기화"
            href="/admin/players"
          />
          <AdminFeatureCard
            title="일반 경기 관리"
            description="일반 경기 오기입 수정과 삭제"
            href="/admin/matches"
          />
          <AdminFeatureCard
            title="리그전 관리"
            description="생성·수정·마감"
            href="/competitions"
          />
          <AdminFeatureCard
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
  title,
  description,
  href,
  danger = false,
}: {
  title: string;
  description: string;
  href: string;
  danger?: boolean;
}) {
  return (
    <Link className={`admin-feature-card ${danger ? "is-danger" : ""}`} to={href}>
      <div>
        <strong>{title}</strong>
        <small>{description}</small>
      </div>
      <span className="admin-feature-card__action">열기</span>
    </Link>
  );
}
