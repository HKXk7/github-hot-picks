import { describe, expect, it } from "vitest";
import { BM25Index, cosine, parseEmbedding, rrfFuse, tokenize } from "./bm25";

describe("tokenize", () => {
  it("英文按词切并保留包名里的点号和下划线", () => {
    expect(tokenize("npm install @vueuse/core")).toContain("core");
    expect(tokenize("some_pkg-1.2")).toContain("some_pkg-1.2");
  });

  it("中文按 bigram 滑窗切，因为中文没有空格分词", () => {
    const tokens = tokenize("终端文件管理器");
    expect(tokens).toEqual(["终端", "端文", "文件", "件管", "管理", "理器"]);
  });

  it("单个汉字也能成为一个 token", () => {
    expect(tokenize("快")).toEqual(["快"]);
  });

  it("中英混排时两路都保留，且不跨过英文把字粘在一起", () => {
    const tokens = tokenize("用 Rust 写");
    expect(tokens).toContain("rust");
    expect(tokens).toContain("用");
    expect(tokens).toContain("写");
    // 曾经的实现会把「用」「写」拼成「用写」，两个不相干的字变成一个词
    expect(tokens).not.toContain("用写");
  });
});

describe("BM25Index", () => {
  const docs = [
    { id: "a", content: "vue vue vue 响应式 框架" },
    { id: "b", content: "react 框架" },
    { id: "c", content: "django 后端 框架" },
  ];

  it("词频高的文档排在前面", () => {
    const hits = new BM25Index(docs).search("vue");
    expect(hits[0].id).toBe("a");
  });

  it("命中稀有词的文档压过只命中常见词的", () => {
    // 「框架」在三个文档里都有，区分度低；「django」只有一个文档有
    const hits = new BM25Index(docs).search("django 框架");
    expect(hits[0].id).toBe("c");
  });

  it("语料里没有的词返回空", () => {
    expect(new BM25Index(docs).search("kubernetes")).toEqual([]);
  });

  it("空索引不炸", () => {
    expect(new BM25Index().search("vue")).toEqual([]);
  });
});

describe("cosine", () => {
  it("相同向量相似度为 1", () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });

  it("正交向量为 0", () => {
    expect(cosine([1, 0], [0, 1])).toBe(0);
  });

  it("维度不一致时返回 0 而不是抛异常", () => {
    expect(cosine([1, 2], [1])).toBe(0);
    expect(cosine([], [])).toBe(0);
  });

  it("零向量不会除零", () => {
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});

describe("parseEmbedding", () => {
  it("解析数字数组", () => {
    expect(parseEmbedding("[0.1, 0.2]")).toEqual([0.1, 0.2]);
  });

  it("坏数据返回 null，交给调用方走 BM25 兜底", () => {
    expect(parseEmbedding("not json")).toBeNull();
    expect(parseEmbedding('["a"]')).toBeNull();
    expect(parseEmbedding(null)).toBeNull();
  });
});

describe("rrfFuse", () => {
  const bm25 = [
    { id: "a", score: 12.5 },
    { id: "b", score: 3.1 },
  ];
  const vector = [
    { id: "b", score: 0.87 },
    { id: "a", score: 0.12 },
  ];

  it("只看名次融合，两路的绝对分数大小不影响结果", () => {
    // BM25 的 12.5 和余弦的 0.87 量纲不同，加权求和等于拿两把尺子硬加
    const fused = rrfFuse([bm25, vector]);
    expect(fused.map((f) => f.id).sort()).toEqual(["a", "b"]);
  });

  it("两路都命中的文档排在只命中一路的前面", () => {
    const fused = rrfFuse([
      [
        { id: "shared", score: 9 },
        { id: "only-bm25", score: 8 },
      ],
      [
        { id: "shared", score: 0.9 },
        { id: "only-vector", score: 0.8 },
      ],
    ]);
    expect(fused[0].id).toBe("shared");
  });

  it("单路输入时保持原顺序", () => {
    const fused = rrfFuse([bm25]);
    expect(fused.map((f) => f.id)).toEqual(["a", "b"]);
  });

  it("没有输入时返回空", () => {
    expect(rrfFuse([])).toEqual([]);
  });
});
