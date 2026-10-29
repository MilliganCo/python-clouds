import { createHashRouter, Navigate } from "react-router-dom";
import { ShellLayout } from "../features/shell/ShellLayout";

export function createAppRouter(opts: {
  username: string;
  onLogout: () => void;
}) {
  return createHashRouter([
    {
      path: "/",
      element: (
        <ShellLayout username={opts.username} onLogout={opts.onLogout} />
      ),
      children: [
        {
          index: true,
          lazy: async () => {
            const { HomePage } = await import("../features/home/HomePage");
            return { Component: HomePage };
          },
        },
        {
          path: "topics",
          lazy: async () => {
            const { TopicsCatalogPage } = await import(
              "../features/topics/TopicsCatalogPage"
            );
            return { Component: TopicsCatalogPage };
          },
        },
        {
          path: "topic/:id/theory",
          lazy: async () => {
            const { TheoryArticlePage } = await import(
              "../features/theory/TheoryArticlePage"
            );
            return { Component: TheoryArticlePage };
          },
        },
        {
          path: "task/:id",
          lazy: async () => {
            const { TaskPage } = await import("../features/task/TaskPage");
            return { Component: TaskPage };
          },
        },
        {
          path: "profile",
          lazy: async () => {
            const { ProfilePage } = await import(
              "../features/profile/ProfilePage"
            );
            return { Component: ProfilePage };
          },
        },
        {
          path: "shop",
          lazy: async () => {
            const { ShopPage } = await import("../features/shop/ShopPage");
            return { Component: ShopPage };
          },
        },
        {
          path: "daily/:diff",
          lazy: async () => {
            const { DailyPage } = await import("../features/daily/DailyPage");
            return { Component: DailyPage };
          },
        },
        {
          path: "game",
          lazy: async () => {
            const { GamesHubPage } = await import(
              "../features/games/GamesHubPage"
            );
            return { Component: GamesHubPage };
          },
        },
        { path: "games", element: <Navigate to="/game" replace /> },
        {
          path: "game/:name",
          lazy: async () => {
            const { GamePlayPage } = await import(
              "../features/games/GamePlayPage"
            );
            return { Component: GamePlayPage };
          },
        },
        {
          path: "projects",
          lazy: async () => {
            const { ProjectsPage } = await import(
              "../features/projects/ProjectsPage"
            );
            return { Component: ProjectsPage };
          },
        },
        {
          path: "project/:course",
          lazy: async () => {
            const { ProjectCoursePage } = await import(
              "../features/projects/ProjectCoursePage"
            );
            return { Component: ProjectCoursePage };
          },
        },
        {
          path: "project/:course/:stage",
          lazy: async () => {
            const { ProjectStagePage } = await import(
              "../features/projects/ProjectStagePage"
            );
            return { Component: ProjectStagePage };
          },
        },
        {
          path: "showcase",
          lazy: async () => {
            const { ShowcasePage } = await import(
              "../features/showcase/ShowcasePage"
            );
            return { Component: ShowcasePage };
          },
        },
        {
          path: "showcase/new",
          lazy: async () => {
            const { ShowcaseCreatePage } = await import(
              "../features/showcase/ShowcaseCreatePage"
            );
            return { Component: ShowcaseCreatePage };
          },
        },
        {
          path: "showcase/:id",
          lazy: async () => {
            const { ShowcaseCardPage } = await import(
              "../features/showcase/ShowcaseCardPage"
            );
            return { Component: ShowcaseCardPage };
          },
        },
        { path: "*", element: <Navigate to="/" replace /> },
      ],
    },
  ]);
}
