import { useEffect } from "react";
import { startSkyScrollDarken } from "../../services/skyScroll";
import { startLeavesFx } from "../../services/leavesFx";
import {
  applyStoredLooks,
  setLookUser,
} from "../../services/lookPreferences";

/**
 * Boots legacy sky atmosphere once:
 * - scroll-darken rAF pump (--scroll-ease → .sky-void)
 * - leaves FX hooks (active when body.fx-leaves)
 * - optional: apply stored sky/term/fx for username
 */
export function SkyAtmosphere({ username }: { username?: string }) {
  useEffect(() => {
    const scroll = startSkyScrollDarken();
    const leaves = startLeavesFx();
    return () => {
      scroll.stop();
      leaves.stop();
    };
  }, []);

  useEffect(() => {
    if (!username) return;
    setLookUser(username);
    applyStoredLooks();
  }, [username]);

  return null;
}
