// 首页与往期页共用的展示工具：语言配色、数字/时间格式化、Markdown 稿解析

export const LANG_COLORS: Record<string, { dot: string; text: string; bg: string }> = {
  TypeScript: { dot: "#3178c6", text: "#7fb3e6", bg: "rgba(49,120,198,0.15)" },
  JavaScript: { dot: "#f1e05a", text: "#f1e05a", bg: "rgba(241,224,90,0.12)" },
  Python: { dot: "#3572A5", text: "#6db3e0", bg: "rgba(53,114,165,0.15)" },
  Go: { dot: "#00ADD8", text: "#4fd1f0", bg: "rgba(0,173,216,0.14)" },
  Rust: { dot: "#dea584", text: "#e8b48a", bg: "rgba(222,165,132,0.14)" },
  C: { dot: "#555555", text: "#9ca3af", bg: "rgba(156,163,175,0.14)" },
  "C++": { dot: "#f34b7d", text: "#f4779d", bg: "rgba(243,75,125,0.14)" },
  Java: { dot: "#b07219", text: "#d9a05b", bg: "rgba(176,114,25,0.15)" },
  Ruby: { dot: "#701516", text: "#e06c75", bg: "rgba(112,21,22,0.2)" },
  Shell: { dot: "#89e051", text: "#a8e07a", bg: "rgba(137,224,81,0.12)" },
  Swift: { dot: "#F05138", text: "#f27c6a", bg: "rgba(240,81,56,0.14)" },
  Kotlin: { dot: "#A97BFF", text: "#bfa1ff", bg: "rgba(169,123,255,0.15)" },
  PHP: { dot: "#4F5D95", text: "#8b97c9", bg: "rgba(79,93,149,0.18)" },
  Dart: { dot: "#00B4AB", text: "#4fd6cf", bg: "rgba(0,180,171,0.14)" },
};

export function langStyle(lang: string | null) {
  if (!lang) return { dot: "#6b7280", text: "#9ca3af", bg: "rgba(156,163,175,0.14)" };
  return LANG_COLORS[lang] ?? { dot: "#6b7280", text: "#cbd5e1", bg: "rgba(203,213,225,0.12)" };
}

export function formatStars(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return (k >= 100 ? Math.round(k) : Math.round(k * 10) / 10) + "k";
  }
  return String(n);
}

export function formatTime(input: string) {
  return new Date(input).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function parseContent(content: string) {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (line.startsWith("# ")) return { type: "h1" as const, text: line.slice(2) };
      if (line.startsWith("## ")) return { type: "h2" as const, text: line.slice(3) };
      if (line.startsWith("### ")) return { type: "h3" as const, text: line.slice(4) };
      if (line.startsWith("- ")) return { type: "li" as const, text: line.slice(2) };
      if (line.startsWith("> ")) return { type: "quote" as const, text: line.slice(2) };
      return { type: "p" as const, text: line };
    });
}
