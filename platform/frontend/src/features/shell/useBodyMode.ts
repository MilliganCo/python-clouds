import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { invalidateSkyScroll } from "../../services/skyScroll";

/** Mirror legacy app.js body class toggles for sky / layout CSS. */
export function useBodyMode(): void {
  const location = useLocation();

  useEffect(() => {
    const path = location.pathname;
    const onHome = path === "/";
    const onTopics = path === "/topics" || path.startsWith("/topics/");
    const onTheory = /^\/topic\/[^/]+\/theory\/?$/.test(path);
    const onTask = /^\/task\//.test(path);
    const onDaily = /^\/daily\//.test(path);
    const onProfile = path === "/profile";
    const onShop = path === "/shop";
    const onGame =
      path === "/game" || path === "/games" || path.startsWith("/game/");
    const onProjects =
      path === "/projects" || path.startsWith("/project/");
    const onShowcase = path === "/showcase" || path.startsWith("/showcase/");
    const onAppSurface =
      onTheory ||
      onTask ||
      onDaily ||
      onProfile ||
      onShop ||
      onGame ||
      onProjects ||
      onShowcase;

    document.body.classList.remove("list-mode", "home-mode", "task-mode");
    if (onHome) document.body.classList.add("home-mode");
    else if (onTopics) document.body.classList.add("list-mode");
    else if (onAppSurface) document.body.classList.add("task-mode");
    else document.body.classList.add("task-mode");

    // Same as legacy route(): reset scroll on navigation
    window.scrollTo(0, 0);
    invalidateSkyScroll();

    return () => {
      document.body.classList.remove("list-mode", "home-mode", "task-mode");
    };
  }, [location.pathname]);
}
