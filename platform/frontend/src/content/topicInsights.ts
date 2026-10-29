import TOPIC_INSIGHT from "@legacy-insights";

/** Legacy `window.TOPIC_INSIGHT` — «Где это живёт» for topics catalog. */
export function topicInsight(topicId: number): string | null {
  const text = TOPIC_INSIGHT[topicId];
  return typeof text === "string" && text ? text : null;
}
