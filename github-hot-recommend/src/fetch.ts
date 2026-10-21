import type { GithubRepo } from "./types";

const SEARCH_URL = "https://api.github.com/search/repositories";

// 距今 N 天的日期字符串（YYYY-MM-DD）
function daysAgo(n: number): string {
  const d = new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

interface RawItem {
  id: number;
  full_name: string;
  name: string;
  description: string | null;
  html_url: string;
  homepage: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  topics: string[];
  archived: boolean;
  fork: boolean;
  created_at: string;
  updated_at: string;
  pushed_at: string;
}

interface SearchResponse {
  items: RawItem[];
}

function toRepo(raw: RawItem): GithubRepo {
  const owner = raw.full_name.split("/")[0] ?? "";
  return {
    id: raw.id,
    full_name: raw.full_name,
    name: raw.name,
    owner,
    description: raw.description,
    html_url: raw.html_url,
    homepage: raw.homepage,
    language: raw.language,
    stargazers_count: raw.stargazers_count,
    forks_count: raw.forks_count,
    open_issues_count: raw.open_issues_count,
    topics: raw.topics ?? [],
    archived: raw.archived,
    fork: raw.fork,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    pushed_at: raw.pushed_at,
  };
}

async function search(q: string, perPage = 30): Promise<GithubRepo[]> {
  const url = `${SEARCH_URL}?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${perPage}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "github-hot-recommend",
  };
  // 配了 GITHUB_TOKEN 可提高限流额度（不配也能用）
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API 请求失败（${res.status}）：${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as SearchResponse;
  return data.items.map(toRepo);
}

// 抓候选项目：最近 30 天新建、且已有一定 star 的「新锐」项目
export async function fetchCandidateRepos(): Promise<GithubRepo[]> {
  const q = `created:>${daysAgo(30)} stars:>50`;
  const repos = await search(q, 100);
  return repos.filter((r) => !r.fork && !r.archived);
}

// 直接运行本文件（npm run fetch）时，打印抓取结果便于调试
if (process.argv[1] && process.argv[1].endsWith("fetch.ts")) {
  fetchCandidateRepos()
    .then((repos) => {
      console.log(`抓到 ${repos.length} 个候选项目：`);
      repos.slice(0, 10).forEach((r) => console.log(`  ${r.full_name}  (${r.stargazers_count} stars)`));
    })
    .catch((err) => {
      console.error("抓取失败：", err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
