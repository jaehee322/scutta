export function LoadingScreen() {
  return (
    <main className="splash" aria-label="앱을 불러오는 중">
      <div className="splash__mark" aria-hidden="true" />
      <strong>SCUTTA</strong>
      <span className="loading-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </main>
  );
}

export function PageLoader() {
  return (
    <div className="page-loader" role="status">
      <span className="spinner" />
      <span>불러오는 중</span>
    </div>
  );
}
