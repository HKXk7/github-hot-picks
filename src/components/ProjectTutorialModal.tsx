"use client";

import { useState } from "react";

interface TutorialPick {
  fullName: string;
  name: string;
  description: string | null;
  language: string | null;
  stars: number;
  tutorial: string | null;
}

// 轻量 Markdown 渲染：支持 ## 标题、### 标题、``` 代码块、- 列表、普通段落
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
          <li key={i} className="flex gap-2.5 text-[15px] leading-7 text-zinc-300">
            <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />
            <span>{item}</span>
          </li>
        ))}
      </ul>,
    );
    listLines = [];
  };

  const flushCode = () => {
    if (codeLines.length === 0) return;
    blocks.push(
      <pre
        key={key++}
        className="overflow-x-auto rounded-xl border border-white/10 bg-zinc-950/90 p-4 text-sm leading-6 text-zinc-200"
      >
        <code>{codeLines.join("\n")}</code>
      </pre>,
    );
    codeLines = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trimStart().startsWith("```")) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        flushList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }
    if (line.trim().startsWith("## ")) {
      flushList();
      blocks.push(
        <h3 key={key++} className="pt-2 text-lg font-semibold text-zinc-100">
          {line.trim().slice(3)}
        </h3>,
      );
      continue;
    }
    if (line.trim().startsWith("### ")) {
      flushList();
      blocks.push(
        <h4 key={key++} className="pt-1 text-base font-semibold text-zinc-100">
          {line.trim().slice(4)}
        </h4>,
      );
      continue;
    }
    if (/^[-*]\s+/.test(line.trim())) {
      listLines.push(line.trim().replace(/^[-*]\s+/, ""));
      continue;
    }
    if (line.trim() === "") {
      flushList();
      continue;
    }
    // 普通段落
    flushList();
    blocks.push(
      <p key={key++} className="text-[15px] leading-7 text-zinc-300">
        {line.trim()}
      </p>,
    );
  }
  flushList();
  flushCode();
  return blocks;
}

function formatStars(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return (k >= 100 ? Math.round(k) : Math.round(k * 10) / 10) + "k";
  }
  return String(n);
}

const LINK_LABEL = "小白上手此项目保姆级教程";

type Phase = "idle" | "generating" | "error";

export default function ProjectTutorialModal({ pick }: { pick: TutorialPick }) {
  const [open, setOpen] = useState(false);
  const [tutorial, setTutorial] = useState<string | null>(pick.tutorial);
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  // 现场生成：调用后端接口生成教程，成功后自动弹出教程弹窗
  async function generateAndOpen() {
    if (phase === "generating") return;
    setPhase("generating");
    setErrorMsg("");
    try {
      const res = await fetch("/api/tutorial", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fullName: pick.fullName }),
      });
      const data = (await res.json()) as { tutorial?: string; error?: string };
      if (!res.ok || !data.tutorial) {
        throw new Error(data.error ?? `请求失败（${res.status}）`);
      }
      setTutorial(data.tutorial);
      setPhase("idle");
      setOpen(true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }

  return (
    <>
      {tutorial ? (
        <button
          onClick={() => setOpen(true)}
          className="rounded-full border border-cyan-400/40 bg-cyan-400/10 px-4 py-2 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-400/20 hover:shadow-[0_0_18px_-4px_rgba(34,211,238,0.55)]"
        >
          📖 {LINK_LABEL}
        </button>
      ) : (
        <div className="space-y-1.5">
          <button
            onClick={generateAndOpen}
            disabled={phase === "generating"}
            className="group inline-flex items-center gap-1.5 rounded-full border border-lime-400/40 bg-lime-400/10 px-4 py-2 text-xs font-semibold text-lime-200 transition hover:bg-lime-400/20 hover:shadow-[0_0_18px_-4px_rgba(163,230,53,0.55)] disabled:cursor-wait disabled:opacity-70"
            title="点击即时生成这份教程"
          >
            {phase === "generating" ? (
              <>
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-lime-400" />
                正在生成教程，约需十几秒…
              </>
            ) : (
              <>✨ {LINK_LABEL} →</>
            )}
          </button>
          {phase === "error" ? (
            <p className="text-[11px] leading-5 text-red-400">
              生成失败：{errorMsg}
              <button onClick={generateAndOpen} className="ml-1 underline hover:text-red-300">
                重试
              </button>
            </p>
          ) : null}
        </div>
      )}

      {open && tutorial ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="relative max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-[28px] border border-cyan-400/20 bg-[#0a0f18] p-7 shadow-2xl shadow-black/60"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setOpen(false)}
              className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-zinc-400 transition hover:bg-white/10 hover:text-zinc-100"
              aria-label="关闭"
            >
              ✕
            </button>

            <div className="pr-10">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-400">Beginner Tutorial</p>
              <h2 className="mt-2 text-2xl font-bold text-white">{pick.fullName}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-zinc-400">
                {pick.language ? (
                  <span className="rounded-full bg-white/10 px-2.5 py-1">{pick.language}</span>
                ) : null}
                <span className="inline-flex items-center gap-1 font-semibold text-yellow-300">⭐ {formatStars(pick.stars)}</span>
              </div>
              {pick.description ? (
                <p className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-7 text-zinc-400">
                  {pick.description}
                </p>
              ) : null}
            </div>

            <div className="mt-6 space-y-3 border-t border-white/10 pt-6">{renderMarkdown(tutorial)}</div>

            <p className="mt-6 border-t border-white/10 pt-4 text-xs leading-6 text-zinc-600">
              本教程由 AI 自动生成，仅供快速入门参考；具体用法请以项目官方 README 为准。
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}
