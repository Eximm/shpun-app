import { Navigate, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { useMe } from "./useMe";
import { enablePush } from "../notifications/push";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { me, loading } = useMe();
  const loc = useLocation();

  useEffect(() => {
    if (me) {
      enablePush().catch(() => {});
    }
  }, [me]);

  if (loading) return <div style={{ padding: 24 }}>Loading...</div>;

  if (!me) {
    return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  }

  return <>{children}</>;
}