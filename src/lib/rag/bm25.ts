/**
 * BM25 —— 经典词频检索算法，纯 TS 实现，零依赖。
 *
 * 为什么不用现成库：语料只有几百条，引入 lunr / flexsearch 反而要处理它们的
 * 中文分词短板；而且 BM25 的核心是二十行数学，自己写既能控分词，面试时也能讲清。
 *
 * 为什么不只用向量：向量擅长「语义相近」，但项目名、包名、命令这种
 * **字面精确匹配**（比如查 "ripgrep"）向量反而容易糊掉。BM25 正好补这块，
 * 所以后面做混合检索而不是二选一。
 */

const K1 = 1.5;
const B = 0.75;

/**
 * 中英混合分词。
 * 中文没有空格，这里用「相邻二字组（bigram）」：
 * "安装教程" → 安装、装教、教程。
 * 这比单字切分噪声小，比接一整个分词词典轻得多，短查询下召回足够。
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];

  // 英文 / 数字 / 常见符号按词切，保留点号和下划线（包名、命令里有）
  const latin = text.toLowerCase().match(/[a-z0-9][a-z0-9._-]*/g);
  if (latin) tokens.push(...latin);

  // 中文：先剥掉所有非汉字，再滑窗取 bigram
  const cjk = text.replace(/[^\u4e00-\u9fa5]/g, "");
  if (cjk.length === 1) {
    tokens.push(cjk);
  } else {
    for (let i = 0; i + 1 < cjk.length; i++) tokens.push(cjk.slice(i, i + 2));
  }

  return tokens;
}

interface Posting {
  /** 词频 */
  tf: number;
}

export interface BM25Doc {
  id: string;
  content: string;
}

export class BM25Index {
  private docs: BM25Doc[] = [];
  private postings = new Map<string, Map<number, Posting>>();
  private docLen: number[] = [];
  private avgDocLen = 0;
  private docFreq = new Map<string, number>();

  constructor(docs: BM25Doc[] = []) {
    if (docs.length) this.fit(docs);
  }

  fit(docs: BM25Doc[]): void {
    this.docs = docs;
    this.postings = new Map();
    this.docFreq = new Map();
    this.docLen = [];

    docs.forEach((doc, idx) => {
      const tokens = tokenize(doc.content);
      this.docLen[idx] = tokens.length;
      const seen = new Set<string>();
      for (const t of tokens) {
        let p = this.postings.get(t);
        if (!p) {
          p = new Map();
          this.postings.set(t, p);
        }
        const cur = p.get(idx);
        if (cur) cur.tf += 1;
        else p.set(idx, { tf: 1 });
        seen.add(t);
      }
      for (const t of seen) this.docFreq.set(t, (this.docFreq.get(t) ?? 0) + 1);
    });

    const total = this.docLen.reduce((a, b) => a + b, 0);
    this.avgDocLen = docs.length ? total / docs.length : 0;
  }

  /** IDF：语料里越常见的词区分度越低。加 1 做平滑，防止出现在所有文档里时变负数 */
  private idf(term: string): number {
    const df = this.docFreq.get(term) ?? 0;
    return Math.log(1 + (this.docs.length - df + 0.5) / (df + 0.5));
  }

  search(query: string, topK = 5): { id: string; score: number }[] {
    const terms = tokenize(query);
    if (!terms.length || !this.docs.length) return [];

    const scores = new Map<number, number>();
    for (const term of terms) {
      const posting = this.postings.get(term);
      if (!posting) continue;
      const idf = this.idf(term);
      for (const [idx, { tf }] of posting) {
        const len = this.docLen[idx] || 0;
        const denom = tf + K1 * (1 - B + (B * len) / (this.avgDocLen || 1));
        const add = (idf * (tf * (K1 + 1))) / denom;
        scores.set(idx, (scores.get(idx) ?? 0) + add);
      }
    }

    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([idx, score]) => ({ id: this.docs[idx].id, score }));
  }
}

// ================= 向量侧工具 =================

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

export function parseEmbedding(raw: string | null): number[] | null {
  if (!raw) return null;
  try {
    const arr: unknown = JSON.parse(raw);
    return Array.isArray(arr) && arr.every((n) => typeof n === "number") ? (arr as number[]) : null;
  } catch {
    return null;
  }
}

/**
 * RRF（Reciprocal Rank Fusion）：把多路排序融合成一路。
 * 用它而不是加权求和的原因：BM25 的分数和余弦相似度**量纲完全不同**，
 * 直接加权等于拿两把不同刻度的尺子硬加；只看名次就绕开了归一化问题。
 */
export function rrfFuse(
  rankedLists: { id: string; score: number }[][],
  topK = 5,
  k = 60,
): { id: string; score: number }[] {
  const fused = new Map<string, number>();
  for (const list of rankedLists) {
    list.forEach((item, rank) => {
      fused.set(item.id, (fused.get(item.id) ?? 0) + 1 / (k + rank + 1));
    });
  }
  return [...fused.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([id, score]) => ({ id, score }));
}
