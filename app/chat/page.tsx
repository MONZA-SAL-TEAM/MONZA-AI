import { Suspense } from "react";
import ChatClient from "./ChatClient";

export default function ChatPage() {
  // ChatClient reads the ?ask= deep-link with useSearchParams, which Next
  // requires to sit inside a Suspense boundary — the build fails without it.
  return (
    <Suspense fallback={null}>
      <ChatClient />
    </Suspense>
  );
}
