import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SafeMarkdown } from "../components/SafeMarkdown/SafeMarkdown";
import { TrustedCourseContent } from "../components/TrustedCourseContent/TrustedCourseContent";
import { sanitizeCourseHtml } from "./legacyContent";

describe("SafeMarkdown", () => {
  it("does not render script tags as HTML", () => {
    render(<SafeMarkdown source={"Hello <script>alert(1)</script>"} />);
    expect(document.querySelector("script")).toBeNull();
    expect(screen.getByText(/Hello/)).toBeTruthy();
  });
});

describe("TrustedCourseContent", () => {
  it("keeps allowlisted <p> from course HTML", () => {
    const html = sanitizeCourseHtml("<p>Теория</p>");
    render(<TrustedCourseContent html={html} />);
    expect(screen.getByText("Теория")).toBeTruthy();
  });

  it("strips script tags from course HTML", () => {
    const html = sanitizeCourseHtml('<p>ok</p><script>alert(1)</script>');
    render(<TrustedCourseContent html={html} />);
    expect(document.querySelector("script")).toBeNull();
    expect(screen.getByText("ok")).toBeTruthy();
  });

  it("drops javascript: links", () => {
    const html = sanitizeCourseHtml('<a href="javascript:alert(1)">x</a>');
    expect(html.includes("javascript:")).toBe(false);
  });

  it("keeps allowlisted <b> from course HTML", () => {
    const html = sanitizeCourseHtml("<p><b>bold</b></p>");
    expect(html).toContain("<b>");
  });
});
