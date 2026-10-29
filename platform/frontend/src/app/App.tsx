import { useMemo } from "react";
import { RouterProvider } from "react-router-dom";
import { SessionBoundary } from "../application/session/SessionBoundary";
import { createAppRouter } from "./router";
import { SkyAtmosphere } from "../features/shell/SkyAtmosphere";

function AuthenticatedApp({
  username,
  logout,
}: {
  username: string;
  logout: () => Promise<void>;
}) {
  const router = useMemo(
    () =>
      createAppRouter({
        username,
        onLogout: () => {
          void logout();
        },
      }),
    [username, logout],
  );
  return (
    <>
      <SkyAtmosphere username={username} />
      <RouterProvider router={router} />
    </>
  );
}

export function App() {
  return (
    <SessionBoundary>
      {({ username, logout }) => (
        <AuthenticatedApp username={username} logout={logout} />
      )}
    </SessionBoundary>
  );
}
