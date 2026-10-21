// 从 GitHub Search API 拿到的仓库数据（已精简成我们需要的字段）
export interface GithubRepo {
  id: number;
  full_name: string;
  name: string;
  owner: string;
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

// 打分之后的仓库
export interface ScoredRepo extends GithubRepo {
  score: number;
  reasons: string[];
}
