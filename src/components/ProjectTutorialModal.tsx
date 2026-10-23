"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface TutorialPick {
  fullName: string;
  name: string;
  description: string | null;
  language: string | null;
  stars: number;
  tutorial: string | null;
}

function renderMarkdown(md: string) {
  const lines = md.split("\n");
  const blocks: React.ReactNode[] = [];
  let codeLines: string[] = [];
  let inCode = false;
  let listLines: string[] = [];
  let key = 0;

  const flushList = () => {
    if (listLines.length === 0) return;
    blocks.push(
      <ul key={key++} className="space-y-2">
        {listLines.map((item, i) => (
          <li key={i} className="flex gap-2.5 text-[15px] leading-7 text-slate-700">
            <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    );
    listLines = [];
  };

  const flushCode = () => {
    if (codeLines.length === 0) return;
    blocks.push(
      <pre key={key++} className="overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-800 font-mono">
        <code>{codeLines.join("\n")}</code>
      </pre>
    );
    codeLines = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trimStart().startsWith("```")) {
      if (inCode) { flushCode(); inCode = false; } else { flushList(); inCode = true; }
      continue;
    }
    if (inCode) { codeLines.push(line); continue; }
    if (line.trim().startsWith("## ")) { flushList(); blocks.push(<h3 key={key++} className="pt-2 text-lg font-bold text-slate-900">{line.trim().slice(3)}</h3>); continue; }
    if (line.trim().startsWith("### ")) { flushList(); blocks.push(<h4 key={key++} className="pt-1 text-base font-semibold text-slate-800">{line.trim().slice(4)}</h4>); continue; }
    if (/^[-*]\s+/.test(line.trim())) { listLines.push(line.trim().replace(/^[-*]\s+/, "")); continue; }
    if (line.trim() === "") { flushList(); continue; }
    flushList();
    blocks.push(<p key={key++} className="text-[15px] leading-7 text-slate-700">{line.trim()}</p>);
  }
  flushList(); flushCode();
  return blocks;
}

function formatStars(n: number): string {
  if (n >= 1000) { const k = n / 1000; return (k >= 100 ? Math.round(k) : Math.round(k * 10) / 10) + "k"; }
  return String(n);
}

const LINK_LABEL = "小白上手此项目保姆级教程";
type Phase = "idle" | "generating" | "error";

export default function ProjectTutorialModal({ pick }: { pick: TutorialPick }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [tutorial, setTutorial] = useState<string | null>(pick.tutorial);
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => { setMounted(true); }, []);

  // 弹窗打开时：锁定页面滚动 + 支持 Esc 关闭
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function generateAndOpen() {
    if (phase === "generating") return;
    setPhase("generating"); setErrorMsg("");
    try {
      const res = await fetch("/api/tutorial", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fullName: pick.fullName }) });
      const data = (await res.json()) as { tutorial?: string; error?: string };
      if (!res.ok || !data.tutorial) throw new Error(data.error ?? `请求失败（${res.status}）`);
      setTutorial(data.tutorial); setPhase("idle"); setOpen(true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err)); setPhase("error");
    }
  }

  return (
    <>
      {tutorial ? (
        <button onClick={() => setOpen(true)} className="tutorial-btn-ready px-4 py-2 text-xs">
          📖 {LINK_LABEL}
        </button>
      ) : (
        <div className="space-y-1.5">
          <button onClick={generateAndOpen} disabled={phase === "generating"}
            className="tutorial-btn-gen group inline-flex items-center gap-1.5 px-4 py-2 text-xs disabled:cursor-wait disabled:opacity-70"
            title="点击即时生成这份教程">
            {phase === "generating" ? (
              <><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-lime-500" />正在生成教程，约需十几秒…</>
            ) : (
              <>✨ {LINK_LABEL} →</>
            )}
          </button>
          {phase === "error" ? (
            <p className="text-[11px] leading-5 text-red-600">
              生成失败：{errorMsg}
              <button onClick={generateAndOpen} className="ml-1 underline hover:text-red-500 font-medium">重试</button>
            </p>
          ) : null}
        </div>
      )}

      {/* 关键：用 Portal 挂到 body 上，脱离卡片的层叠上下文，
          否则 featured-card 的 animation/transform 会把 fixed 弹窗困住，
          后面的卡片就会盖在弹窗上面（图一的问题）。 */}
      {open && tutorial && mounted
        ? createPortal(
            <div
              className="fixed inset-0 flex items-center justify-center p-4 sm:p-6"
              style={{ zIndex: 2147483000 }}
              onClick={() => setOpen(false)}
            >
              {/* 遮罩：柔和深色 + 高斯模糊，淡入 */}
              <div className="tutorial-overlay absolute inset-0 bg-slate-900/30 backdrop-blur-lg" />

              {/* 浮层卡片：居中、可滚动、pop 入场 */}
              <div
                className="tutorial-card relative flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-[24px] border border-white/60 bg-white shadow-[0_24px_80px_-24px_rgba(15,23,42,0.35)]"
                onClick={(e) => e.stopPropagation()}
              >
                {/* 固定顶部栏：标题 + 关闭按钮（不随内容滚动） */}
                <div className="relative z-10 flex items-start justify-between gap-4 border-b border-slate-100 bg-white/95 px-7 py-5">
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-[0.28em] text-cyan-500">Beginner Tutorial</p>
                    <h2 className="mt-1 truncate text-xl font-extrabold text-slate-900">{pick.fullName}</h2>
                    <div className="mt-1.5 flex flex-wrap items-center gap-3 text-sm">
                      {pick.language ? <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600">{pick.language}</span> : null}
                      <span className="inline-flex items-center gap-1 font-bold text-amber-500">⭐ {formatStars(pick.stars)}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => setOpen(false)}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 shadow-sm transition hover:border-slate-300 hover:bg-slate-100 hover:text-slate-700"
                    aria-label="关闭"
                  >
                    ✕
                  </button>
                </div>

                {/* 可滚动正文 */}
                <div className="overflow-y-auto px-7 py-6">
                  {pick.description ? (
                    <p className="mb-6 rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm leading-7 text-slate-600">{pick.description}</p>
                  ) : null}

                  <div className="space-y-3">{renderMarkdown(tutorial)}</div>

                  <p className="mt-8 border-t border-slate-100 pt-4 text-xs leading-6 text-slate-400">
                    本教程由 AI 自动生成，仅供快速入门参考；具体用法请以项目官方 README 为准。
                  </p>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}