import { redirect } from "next/navigation";

/**
 * The front door does exactly one thing: send people to the chat.
 *
 * That is always the right first stop — the middleware then takes over: with
 * a CRM configured and no sign-in cookie it forwards to /login, and in demo
 * mode it lets the visitor straight through. Nobody ever sees this page.
 */
export default function Home() {
  redirect("/chat");
}
