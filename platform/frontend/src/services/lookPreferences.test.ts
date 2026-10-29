import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getLook,
  setLook,
  setLookUser,
  syncLooksFromOwnership,
} from "./lookPreferences";

describe("syncLooksFromOwnership", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.className = "";
    setLookUser("tester");
  });

  afterEach(() => {
    localStorage.clear();
    document.body.className = "";
    setLookUser("");
  });

  it("clears applied sky when not in owned list", () => {
    setLook("sky", "sky_night");
    syncLooksFromOwnership(["sky_dawn"]);
    expect(getLook("sky")).toBeNull();
    expect(document.body.classList.contains("skin-sky_night")).toBe(false);
  });

  it("keeps owned look and applies body class", () => {
    setLook("sky", "sky_night");
    syncLooksFromOwnership(["sky_night", "term_ice"]);
    expect(getLook("sky")).toBe("sky_night");
    expect(document.body.classList.contains("skin-sky_night")).toBe(true);
  });
});
