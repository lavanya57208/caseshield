import { Outlet } from "react-router-dom";

// Auth screens own their full-viewport presentation (see LoginPage).
export function AuthLayout() {
  return <Outlet />;
}
