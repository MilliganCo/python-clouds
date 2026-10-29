export type MeResponse = { username: string };

export type ProgressResponse = { solved: string[] };

export type WalletResponse = {
  drops: number;
  freezes: number;
  owned: string[];
};

export type AchievementsResponse = {
  earned: Record<string, string>;
};

export type HealthResponse = {
  ok: boolean;
  service: string;
  port: number;
  ui: "legacy" | "react";
  frontend_build: string;
};
