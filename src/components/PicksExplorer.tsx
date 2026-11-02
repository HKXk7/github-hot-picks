"use client";

/**
 * 推荐项目的「搜索 + 筛选 + 列表」。
 * ==================================
 * 首页和往期详情页原来都是纯服务端渲染：数据一多就只能靠眼睛扫。
 * 这里把列表做成客户端组件，加上关键词搜索和语言/分类筛选。
 *
 * 为什么不放在服务端用 URL 参数做：每敲一个字都要走一次网络往返 + 查库，
 * 而数据是整期一次性给到前端的（也就 10 条），本地过滤是瞬时的事。
 *
 * 焦点卡（#1）只在「没有筛选」时出现：一旦用户开始找东西，
 * 名次就不重要了，统一用网格展示更利于扫读。
 */

import { useMemo, useState } from "react";
import type { SitePick } from "@/lib/site-data";
import { formatStars, langStyle } from "@/lib/format";
import ProjectTutorialModal from "@/components/ProjectTutorialModal";

/** 多关键词之间是「与」的关系：输入 "rust 游戏" 命中同时满足两个词的项目 */
function matches(pick: SitePick, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [
    pick.fullName,
    pick.name,
    pick.description ?? "",
    pick.language ?? "",
    pick.category ?? "",
    pick.reason ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return words.every((w) => haystack.includes(w));
}

function uniqueSorted(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b));
}

export default function PicksExplorer({ picks }: { picks: SitePick[] }) {
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);

  const languages = useMemo(() => uniqueSorted(picks.map((p) => p.language)), [picks]);
  const categories = useMemo(() => uniqueSorted(picks.map((p) => p.category)), [picks]);

  const filtered = useMemo(
    () =>
      picks.filter(
        (p) =>
          matches(p, query) &&
          (!language || p.language === language) &&
          (!category || p.category === category),
      ),
    [picks, query, language, category],
  );

  const filtering = query.trim() !== "" || language !== null || category !== null;

  function clearAll() {
    setQuery("");
    setLanguage(null);
    setCategory(null);
  }

  // 语言/分类都只有 1 种时不展示筛选条：一行按钮却筛不掉任何东西，纯占地方
  const showLanguages = languages.length > 1;
  const showCategories = categories.length > 1;

  return (
    <div className="space-y-5">
      {showLanguages || showCategories ? (
        <div className="panel-card space-y-3 p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="relative flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜项目名、描述、语言…（多个词用空格隔开）"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm text-slate-800 outline-none transition focus:border-cyan-400 focus:bg-white focus:ring-2 focus:ring-cyan-100"
              />
            </label>
            {filtering ? (
              <button
                type="button"
                onClick={clearAll}
                className="shrink-0 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-500 transition hover:border-fuchsia-300 hover:text-fuchsia-600"
              >
                清空筛选
              </button>
            ) : null}
          </div>

          {showLanguages ? (
            <FilterRow
              label="语言"
              options={languages}
              selected={language}
              onSelect={(v) => setLanguage((cur) => (cur === v ? null : v))}
              activeClass="border-cyan-400 bg-cyan-50 text-cyan-700"
            />
          ) : null}

          {showCategories ? (
            <FilterRow
              label="分类"
              options={categories}
              selected={category}
              onSelect={(v) => setCategory((cur) => (cur === v ? null : v))}
              activeClass="border-fuchsia-400 bg-fuchsia-50 text-fuchsia-700"
            />
          ) : null}

          {filtering ? (
            <p className="text-xs font-medium text-slate-500">
              命中 <span className="font-bold text-lime-600">{filtered.length}</span> / {picks.length} 个项目
            </p>
          ) : null}
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <div className="panel-card p-8 text-center">
          <p className="text-base font-bold text-slate-800">没有匹配的项目</p>
          <p className="mt-2 text-sm text-slate-500">换个关键词，或者清空筛选看看全部。</p>
          <button
            type="button"
            onClick={clearAll}
            className="btn-outline mt-4 px-4 py-2 text-sm font-medium"
          >
            清空筛选
          </button>
        </div>
      ) : null}

      {/* 没筛选时保留焦点卡；一旦开始搜索，名次让位于「好不好找」 */}
      {!filtering && picks.length > 0 ? <FeaturedCard pick={picks[0]} /> : null}

      {filtered.length > 0 ? (
        <ol className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered
            .filter((p) => filtering || p.rank !== 1)
            .map((pick, index) => (
              <li key={pick.fullName} className="card-enter" style={{ animationDelay: `${index * 50}ms` }}>
                <ProjectCard pick={pick} />
              </li>
            ))}
        </ol>
      ) : null}
    </div>
  );
}

function FilterRow({ label, options, selected, onSelect, activeClass }: {
  label: string;
  options: string[];
  selected: string | null;
  onSelect: (value: string) => void;
  activeClass: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 shrink-0 text-xs font-bold uppercase tracking-wider text-slate-400">{label}</span>
      {options.map((option) => {
        const active = selected === option;
        return (
          <button
            key={option}
            type="button"
            onClick={() => onSelect(option)}
            aria-pressed={active}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
              active
                ? activeClass
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900"
            }`}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

function ProjectCard({ pick }: { pick: SitePick }) {
  const lang = langStyle(pick.language);
  return (
    <div className="project-card flex h-full flex-col p-5">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-sm font-bold text-cyan-500">#{String(pick.rank).padStart(2, "0")}</span>
        {pick.language ? (
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
            style={{ color: lang.text, background: lang.bg }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: lang.dot }} />
            {pick.language}
          </span>
        ) : null}
      </div>
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3 className="text-base font-bold leading-snug text-slate-900 transition-colors hover:text-cyan-600">
          <a href={pick.url} target="_blank" rel="noopener noreferrer">
            {pick.fullName}
          </a>
        </h3>
        <span className="flex shrink-0 items-center gap-1 text-xs font-bold text-amber-500">
          <StarIcon />
          {formatStars(pick.stars)}
        </span>
      </div>
      {pick.description ? (
        <p className="mb-3 flex-1 text-sm leading-6 text-slate-500 line-clamp-3">{pick.description}</p>
      ) : null}
      <div className="mt-auto space-y-1.5 border-t border-slate-100 pt-2 text-xs">
        {pick.category ? (
          <span className="inline-block rounded-full border border-fuchsia-100 bg-fuchsia-50 px-2 py-0.5 font-semibold text-fuchsia-600">
            {pick.category}
          </span>
        ) : null}
        {pick.reason ? (
          <p className="text-slate-500">
            <span className="font-semibold text-cyan-600">推荐：</span>
            {pick.reason.length > 48 ? pick.reason.slice(0, 48) + "…" : pick.reason}
          </p>
        ) : null}
      </div>
      <div className="mt-3">
        <ProjectTutorialModal pick={pick} />
      </div>
    </div>
  );
}

function FeaturedCard({ pick }: { pick: SitePick }) {
  const lang = langStyle(pick.language);
  return (
    <div className="featured-card p-6 sm:p-8">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-3 py-1 text-xs font-bold text-white shadow-lg shadow-cyan-400/30">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
          今日焦点 · #{String(pick.rank).padStart(2, "0")}
        </span>
      </div>
      <h3 className="mt-4 text-2xl font-extrabold text-slate-900 sm:text-3xl">
        <a
          href={pick.url}
          target="_blank"
          rel="noopener noreferrer"
          className="transition-all hover:bg-gradient-to-r hover:from-cyan-500 hover:to-fuchsia-500 hover:bg-clip-text hover:text-transparent"
        >
          {pick.fullName}
        </a>
      </h3>
      <p className="mt-3 text-base leading-7 text-slate-600 sm:text-lg">
        {pick.description ?? "这个项目今天冲到了推荐榜首，值得优先看看。"}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        {pick.language ? (
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold"
            style={{ color: lang.text, background: lang.bg }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: lang.dot }} />
            {pick.language}
          </span>
        ) : null}
        {pick.category ? (
          <span className="rounded-full border border-fuchsia-100 bg-fuchsia-50 px-2.5 py-1 font-semibold text-fuchsia-600">
            {pick.category}
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1 font-bold text-amber-500">
          <StarIcon />
          {formatStars(pick.stars)}
        </span>
        <span className="text-slate-400">⑂ {formatStars(pick.forks)}</span>
      </div>
      <div className="mt-4 rounded-2xl border border-cyan-200 bg-cyan-50 p-5 text-sm font-medium leading-7 text-cyan-900">
        <span className="font-bold">推荐理由：</span>
        {pick.reason ?? "它在今天的候选项目里综合表现最突出。"}
      </div>
      <div className="mt-5">
        <ProjectTutorialModal pick={pick} />
      </div>
    </div>
  );
}

function StarIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M10 1.5l2.6 5.3 5.9.85-4.25 4.15 1 5.85L10 14.9l-5.25 2.75 1-5.85L1.5 7.65l5.9-.85L10 1.5z" />
    </svg>
  );
}
