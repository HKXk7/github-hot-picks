"use client";

import { useEffect, useRef, useState } from "react";

const MODELS = [
  { id: "deepseek-ai/DeepSeek-V4-Pro", label: "DeepSeek V4 Pro", tag: "综合最强", desc: "推理和知识面最强，适合深度问答、技术选型" },
  { id: "deepseek-ai/DeepSeek-V4.1-Flash", label: "DeepSeek V4.1 Flash", tag: "极速响应", desc: "回答最快，适合快问快答、快速扫一眼结论" },
  { id: "zai-org/GLM-5.3", label: "智谱 GLM 5.3", tag: "中文出色", desc: "中文表达最自然，适合要长解释、讲概念的问题" },
  { id: "Pro/moonshotai/Kimi-K2.6", label: "Kimi K2.6", tag: "贴心陪跑", desc: "语气温和又细致，适合新手一步步带你入门" },
];

const STORAGE_KEY = "github-hot-picks.ai-buddy";
const DEFAULT_PROMPTS = [
  "先帮我总结今天最值得看的 3 个项目",
  "从新手角度推荐一个最适合入门的项目，并说明原因",
  "这几个项目里，哪些适合做 AI Agent 或自动化工具？",
  "帮我规划一个 7 天的 GitHub 热门项目学习路线",
];

interface Msg { role: "user" | "assistant"; content: string; }

export default function ChatAssistant() {
  const [open, setOpen] = useState(false);
  const [model, setModel] = useState(MODELS[0].id);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [messages]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { model?: string; messages?: Msg[] };
      if (saved.model && MODELS.some((i) => i.id === saved.model)) setModel(saved.model);
      if (Array.isArray(saved.messages)) setMessages(saved.messages.slice(-20));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ model, messages: messages.slice(-20) })); } catch { /* ignore */ }
  }, [messages, model]);

  useEffect(() => {
    const openPanel = () => setOpen(true);
    window.addEventListener("open-ai-buddy", openPanel);
    return () => window.removeEventListener("open-ai-buddy", openPanel);
  }, []);

  useEffect(() => { if (open) textareaRef.current?.focus(); }, [open]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    const history = [...messages, { role: "user" as const, content: text }];
    setMessages(history); setInput(""); setError(null); setLoading(true);
    const ac = new AbortController(); abortRef.current = ac;
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: history, model }), signal: ac.signal });
      if (!res.ok || !res.body) {
        let msg = `请求失败（${res.status}）`;
        try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* ignore */ }
        setMessages((prev) => [...prev, { role: "assistant", content: `⚠️ ${msg}` }]); setError(msg); return;
      }
      const reader = res.body.getReader(); const decoder = new TextDecoder();
      let buffer = ""; let acc = "";
      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
        for (const line of lines) {
          const t = line.trim(); if (!t.startsWith("data:")) continue;
          const payload = t.slice(5).trim(); if (payload === "[DONE]") break;
          try { const obj = JSON.parse(payload); const delta = obj.choices?.[0]?.delta?.content ?? ""; if (delta) { acc += delta; setMessages((prev) => { const next = [...prev]; next[next.length - 1] = { role: "assistant", content: acc }; return next; }); } } catch { /* ignore */ }
        }
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      const msg = e instanceof Error ? e.message : String(e); setError(msg);
      setMessages((prev) => [...prev, { role: "assistant", content: `⚠️ ${msg}` }]);
    } finally { setLoading(false); abortRef.current = null; }
  }

  function stop() { abortRef.current?.abort(); setLoading(false); }
  function resetConversation() { abortRef.current?.abort(); setMessages([]); setInput(""); setError(null); setLoading(false); }
  function usePrompt(prompt: string) { setInput(prompt); setOpen(true); requestAnimationFrame(() => textareaRef.current?.focus()); }
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }

  return (
    <>
      {/* 浮动按钮 */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="ai-buddy-btn fixed bottom-5 right-5 z-50 flex items-center gap-3 px-4 py-3 backdrop-blur"
        title="打开 AIBuddy"
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 via-sky-500 to-fuchsia-500 text-sm font-bold text-white shadow-lg shadow-cyan-400/25">
          AI
        </span>
        <div className="hidden text-left sm:block">
          <div className="text-sm font-bold text-slate-900">AIBuddy</div>
          <div className="text-xs text-slate-400">项目解读 · 模型切换 · 连续对话</div>
        </div>
      </button>

      {/* 面板 */}
      {open && (
        <div className="ai-buddy-panel fixed inset-y-4 right-4 z-50 flex w-[440px] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-2xl">
          {/* Header */}
          <div className="border-b border-slate-100 bg-gradient-to-r from-cyan-50 via-white to-fuchsia-50 px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 via-sky-500 to-fuchsia-500 text-sm font-bold text-white shadow-lg shadow-cyan-400/25">
                  AI
                </span>
                <div>
                  <div className="text-base font-bold text-slate-900">AIBuddy</div>
                  <div className="mt-1 text-xs text-slate-500">结合今天的推荐数据，帮你理解项目、做技术选型</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={resetConversation} className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-700" type="button">清空</button>
                <button onClick={() => setOpen(false)} className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-700" type="button">关闭</button>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-[1fr_auto] gap-3">
              <label className="block">
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.2em] text-cyan-500">模型</span>
                <select value={model} onChange={(e) => setModel(e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none transition focus:border-cyan-400" title="选择模型">
                  {MODELS.map((item) => (<option key={item.id} value={item.id}>{item.label} · {item.tag}</option>))}
                </select>
              </label>
              <div className="min-w-[150px] max-w-[190px] rounded-2xl border border-cyan-200 bg-cyan-50 px-3 py-2">
                <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-cyan-600">当前风格</div>
                <div className="mt-1 text-sm font-bold text-slate-900">{MODELS.find((i) => i.id === model)?.tag}</div>
                <div className="mt-0.5 text-[11px] leading-4 text-slate-500">{MODELS.find((i) => i.id === model)?.desc}</div>
              </div>
            </div>
          </div>

          {/* Messages */}
          <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto bg-slate-50 px-5 py-5">
            {messages.length === 0 && (
              <div className="space-y-4">
                <div className="rounded-3xl border border-slate-100 bg-white p-4 text-sm text-slate-600">
                  <p className="text-base font-bold text-slate-900">你好，我是 AIBuddy 👋</p>
                  <p className="mt-2 leading-7">我可以帮你快速看懂今天推荐的项目、对比技术方向、给新手学习路线，也能根据你的目标推荐更合适的仓库。</p>
                </div>
                <div className="space-y-2">
                  <div className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-500">可以点这些问题试试</div>
                  {DEFAULT_PROMPTS.map((prompt) => (
                    <button key={prompt} type="button" onClick={() => usePrompt(prompt)}
                      className="w-full rounded-2xl border border-slate-100 bg-white px-4 py-3 text-left text-sm font-medium text-slate-600 transition hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700">
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[88%] whitespace-pre-wrap rounded-3xl px-4 py-3 text-sm leading-7 shadow-sm ${
                  m.role === "user"
                    ? "rounded-br-md bg-gradient-to-br from-cyan-500 to-fuchsia-500 text-white font-medium"
                    : "rounded-bl-md border border-slate-100 bg-white text-slate-800"
                }`}>
                  {m.content || (loading && i === messages.length - 1 ? "正在整理回答…" : "")}
                </div>
              </div>
            ))}
            {error && (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">出错了：{error}</div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-slate-100 bg-white px-4 py-4">
            <div className="mb-3 flex flex-wrap gap-2">
              {DEFAULT_PROMPTS.slice(0, 2).map((prompt) => (
                <button key={prompt} type="button" onClick={() => usePrompt(prompt)}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 transition hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-600">
                  {prompt}
                </button>
              ))}
            </div>
            <div className="flex items-end gap-2">
              <textarea ref={textareaRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKeyDown} rows={3}
                placeholder="例如：帮我从今天的推荐里挑一个最适合新手做练手项目"
                className="min-h-[88px] max-h-40 flex-1 resize-none rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-cyan-400 focus:bg-white" />
              {loading ? (
                <button onClick={stop} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-red-500 text-white transition hover:bg-red-600" title="停止">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
                </button>
              ) : (
                <button onClick={send} disabled={!input.trim()} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-fuchsia-500 text-white transition hover:brightness-110 disabled:opacity-40 shadow-lg shadow-cyan-400/25" title="发送">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4z" /><path d="M22 2 11 13" /></svg>
                </button>
              )}
            </div>
            <p className="mt-2 text-center text-[11px] text-slate-400">Enter 发送，Shift + Enter 换行。回答由 AI 生成，请结合项目实际情况判断。</p>
          </div>
        </div>
      )}
    </>
  );
}