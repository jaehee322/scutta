export function Brand({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <div className="brand brand--compact">
        <img
          className="brand__logo"
          src="/scutta-logo.png"
          alt="SCUTTA"
          width={255}
          height={237}
        />
      </div>
    );
  }

  return (
    <div className="brand">
      <img
        className="brand__logo"
        src="/scutta-university-logo.png"
        alt="서울대학교 탁구동아리 SCUTTA"
        width={509}
        height={360}
      />
    </div>
  );
}
