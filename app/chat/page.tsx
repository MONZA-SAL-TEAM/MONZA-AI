import { Suspense } from "react";
import { crmConfigured } from "@/lib/env";
import ChatClient from "./ChatClient";

/** Server-rendered so the demo banner needs no public status endpoint: whether
 *  this deployment has staff sign-in is decided here and handed down as a prop.
 *  (It used to be fetched from GET /api/status, which meant that route had to
 *  answer configuration questions to anonymous callers.) */
export const dynamic = "force-dynamic";

export default function ChatPage() {
  // ChatClient reads the ?ask= deep-link with useSearchParams, which Next
  // requires to sit inside a Suspense boundary — the build fails without it.
  return (
    <Suspense fallback={null}>
      <ChatClient demoMode={!crmConfigured()} />
    </Suspense>
  );
}
