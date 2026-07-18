// 스켈레톤 로딩(§4.4-12) — 콘텐츠 자리 예약으로 점프 방지.
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded-lg bg-ink/8 ${className}`}
    />
  );
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-4" role="status" aria-label="목록 불러오는 중">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="rounded-xl border border-line bg-white p-4">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="mt-2 h-5 w-2/3" />
          <Skeleton className="mt-2 h-4 w-1/2" />
        </div>
      ))}
      <span className="sr-only">목록을 불러오는 중</span>
    </div>
  );
}
