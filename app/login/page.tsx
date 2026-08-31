import type { Metadata } from "next";
import LoginClient from "./LoginClient";

export const metadata: Metadata = {
  title: "Team sign in — Monza Assistant",
};

export default function LoginPage() {
  return <LoginClient />;
}
