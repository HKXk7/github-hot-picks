import Link from "next/link";

export const metadata = {
  title: "页面不存在 · GitHub 热门项目推荐",
};

/**
 * 404 页。
 *
 * 顺带兜住「往期日期写错」这个最常见的误入场景：
 * 与其只显示一句「没有找到」，不如直接给出回去的路。
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-3xl flex-col items-center justify-center px-4 py-16 text-center">
      <p className="text-sm font-bold uppercase tracking-[0.28em] text-cyan-500">404</p>
      <h1 className="mt-3 text-3xl font-extrabold text-slate-900">这个页面不存在</h1>
      <p className="mt-3 max-w-md text-sm leading-7 text-slate-600">
        链接可能过期了，或者这一期还没有生成。往期列表里能找到所有已经发布的推荐。
      </p>
      <div className="mt-4 h-1 w-16 rounded-full bg-gradient-to-r from-cyan-400 via-lime-400 to-fuchsia-400" />
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link href="/" className="btn-primary px-5 py-2.5 text-sm font-medium">
          回到今日推荐
        </Link>
        <Link href="/history" className="btn-outline px-5 py-2.5 text-sm font-medium">
          看看往期
        </Link>
      </div>
    </main>
  );
}
