/**
 * AI Buddy 的会话存储。
 *
 * 之前会话只活在浏览器的 localStorage 里：换台设备、清一下缓存就全没了，
 * 服务端也完全不知道用户问过什么。挪到库里之后，多轮上下文才真正成立。
 *
 * 长会话的麻烦在于上下文会无限增长——聊 50 轮之后，光历史就能吃掉几万 token，
 * 钱和延迟都扛不住。这里的做法和大多数产品一样：
 *   最近的若干轮原样保留，更早的折叠成一段滚动摘要，然后把原文删掉。
 * 摘要本身也会随下一次折叠继续压缩，所以长度是有上限的。
 */

import { prisma } from "./prisma";
import { chat, hasApiKey } from "./ai/llm";
import { withTrace } from "./ai/usage-sink";

/** 会话保留多久。超过就当新会话，不接着往上续 */
export const SESSION_TTL_DAYS = 7;

/** 原样送进模型的最近轮数（一轮 = 一条用户 + 一条助手） */
export const KEEP_RECENT_MESSAGES = 12;

/** 攒到这么多条就折叠一次，避免历史无限增长 */
export const SUMMARIZE_THRESHOLD = 40;

/** 摘要用的轻量模型：这是纯压缩任务，用不上强模型，用强模型就是浪费钱 */
const SUMMARY_MODEL = "deepseek-ai/DeepSeek-V4.1-Flash";

export interface StoredMessage {
  role: string;
  content: string;
}

export interface SessionHistory {
  sessionId: string;
  messages: StoredMessage[];
  summary: string | null;
}

function isExpired(updatedAt: Date): boolean {
  return Date.now() - updatedAt.getTime() > SESSION_TTL_DAYS * 86_400_000;
}

/** 会话 id 是客户端生成的，不能信：既不是我们的格式，也可能指向一个过期的会话 */
export async function resolveSession(sessionId: string | null | undefined): Promise<string | null> {
  if (!sessionId || !/^[a-zA-Z0-9_-]{8,64}$/.test(sessionId)) return null;
  const existing = await prisma.chatSession.findUnique({ where: { id: sessionId } });
  if (!existing) return null;
  // 过期会话当新会话处理：不主动删（可能还有人要看），只是不再续写
  return isExpired(existing.updatedAt) ? null : existing.id;
}

export async function createSession(): Promise<string> {
  const session = await prisma.chatSession.create({ data: {} });
  return session.id;
}

/** 取出要送进模型的历史：滚动摘要 + 最近若干轮 */
export async function loadHistory(sessionId: string): Promise<SessionHistory> {
  const rows = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true },
  });
  const session = await prisma.chatSession.findUnique({
    where: { id: sessionId },
    select: { summary: true },
  });
  return {
    sessionId,
    // 只取最近这些：更老的已经在摘要里了，再带上就是重复付费
    messages: rows.slice(-KEEP_RECENT_MESSAGES),
    summary: session?.summary ?? null,
  };
}

/** 一轮问答结束后落库。存不下也不能让这次回答失败 */
export async function saveTurn(
  sessionId: string,
  user: string,
  assistant: string,
): Promise<void> {
  if (!assistant.trim()) return;
  try {
    await prisma.chatMessage.createMany({
      data: [
        { sessionId, role: "user", content: user },
        { sessionId, role: "assistant", content: assistant },
      ],
    });
    // touch 一下 updatedAt，过期判定依赖它
    await prisma.chatSession.update({ where: { id: sessionId }, data: { updatedAt: new Date() } });
  } catch (err) {
    console.warn("[chat-session] 会话未能保存：", err instanceof Error ? err.message : err);
  }
}

/**
 * 需要时把早期对话折叠成摘要。
 * 只在超过阈值时触发，且失败不影响本次回答——最坏情况是多花一点 token。
 */
export async function maybeSummarize(sessionId: string): Promise<void> {
  try {
    const total = await prisma.chatMessage.count({ where: { sessionId } });
    if (total <= SUMMARIZE_THRESHOLD) return;

    const rows = await prisma.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: "asc" },
      select: { id: true, role: true, content: true },
    });
    // 最近的这些还要原样用，只折叠它们之前的
    const older = rows.slice(0, Math.max(0, rows.length - KEEP_RECENT_MESSAGES));
    if (older.length === 0) return;

    const session = await prisma.chatSession.findUnique({
      where: { id: sessionId },
      select: { summary: true },
    });
    const transcript = older
      .map((m) => `${m.role === "user" ? "用户" : "助手"}：${m.content.slice(0, 400)}`)
      .join("\n");

    const prompt = [
      "下面是 AI 助手与用户的一段较早对话。",
      session?.summary ? `此前已有的摘要：\n${session.summary}\n` : "",
      "请把「已有摘要」和这段对话合并压缩成不超过 300 字的中文摘要，",
      "保留：用户关心什么、已经得到过什么结论、提过哪些偏好。",
      "丢掉：寒暄、重复内容、具体代码。只输出摘要正文，不要任何前缀。",
      "\n对话：\n" + transcript,
    ]
      .filter(Boolean)
      .join("\n");

    if (!hasApiKey()) return;
    const outcome = await withTrace({ id: `summary-${sessionId}`, kind: "chat", label: "会话摘要" }, () =>
      chat({
        model: SUMMARY_MODEL,
        messages: [{ role: "user", content: prompt }],
        maxTokens: 500,
        temperature: 0.2,
      }),
    );

    if (!outcome.ok || !outcome.message.content?.trim()) return;
    await prisma.chatSession.update({
      where: { id: sessionId },
      data: { summary: outcome.message.content.trim().slice(0, 2000), summarizedAt: new Date() },
    });
    // 折叠完就把原文删掉，否则下次又会把它们再算一遍
    await prisma.chatMessage.deleteMany({ where: { id: { in: older.map((m) => m.id) } } });
  } catch (err) {
    console.warn("[chat-session] 摘要失败（不影响本次回答）：", err instanceof Error ? err.message : err);
  }
}

/** 历史里能带进上下文的总字数上限，超了就丢最早的几轮 */
export const MAX_HISTORY_CHARS = 12_000;

/**
 * 把库里的历史裁成能送进模型的样子。
 * 超长时丢的是**最早的**几轮：对话场景下最近的上下文更有价值，
 * 而更早的内容已经进过摘要了。
 */
export function trimHistory(messages: StoredMessage[]): StoredMessage[] {
  const usable: StoredMessage[] = [];
  let chars = 0;
  for (const m of [...messages].reverse()) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    chars += m.content.length;
    if (chars > MAX_HISTORY_CHARS) break;
    usable.unshift({ role: m.role, content: m.content });
  }
  return usable;
}

/** 删除过期会话及其消息，供清理脚本调用 */
export async function purgeExpiredSessions(): Promise<number> {
  const cutoff = new Date(Date.now() - SESSION_TTL_DAYS * 86_400_000);
  const stale = await prisma.chatSession.findMany({
    where: { updatedAt: { lt: cutoff } },
    select: { id: true },
  });
  if (stale.length === 0) return 0;
  const ids = stale.map((s) => s.id);
  await prisma.chatMessage.deleteMany({ where: { sessionId: { in: ids } } });
  const { count } = await prisma.chatSession.deleteMany({ where: { id: { in: ids } } });
  return count;
}
