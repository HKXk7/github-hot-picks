/**
 * 全局加载骨架。
 *
 * 首页/往期页自己带了 Suspense 占位（PPR 的静态外壳会先到），
 * 这一层主要兜住「整段还在等服务端」的情况，比如成本看板那种整页查库的路由。
 */
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="animate-pulse space-y-6">
        <div className="h-3 w-32 rounded-full bg-slate-200" />
        <div className="h-9 w-2/3 rounded-xl bg-slate-200" />
        <div className="h-4 w-full rounded-lg bg-slate-100" />
        <div className="h-4 w-5/6 rounded-lg bg-slate-100" />
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="panel-card h-32" />
          ))}
        </div>
      </div>
    </main>
  );
}
