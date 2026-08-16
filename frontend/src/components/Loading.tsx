export function LoadingScreen() {
  return (
    <main className="splash" aria-label="앱을 불러오는 중">
      <img className="splash__logo" src="/scutta-logo.png" alt="" />
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
