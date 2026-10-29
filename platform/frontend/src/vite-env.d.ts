/// <reference types="vite/client" />

declare module "@legacy-styles";
declare module "@content-bundle" {
  const data: unknown;
  export default data;
}
declare module "@legacy-minigame" {
  export const Blitz: unknown;
  export const OrderGame: unknown;
  export const MatchGame: unknown;
  export const TraceGame: unknown;
  export const FillGame: unknown;
}
declare module "@legacy-insights" {
  const insights: Record<number, string>;
  export default insights;
}
declare module "*?raw" {
  const source: string;
  export default source;
}
