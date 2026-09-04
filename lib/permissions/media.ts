/**
 * Who may change the shared media library, and what a refusal says.
 *
 * Split out of the route so the policy is a pure value that can be tested
 * without Next's request machinery — an authorization rule that can only be
 * exercised by deploying it is an authorization rule nobody checks.
 *
 * The rule itself: changing the shared library requires a REAL staff identity
 * (never the demo identity, which any anonymous caller receives in demo mode)
 * holding a sales-side capability. Owners always pass.
 */

import type { StaffAccess } from "@/lib/auth";

/** Managing sales material is a sales job. Owners always pass. */
export const MEDIA_CAPABILITIES = ["sales", "manage_team"] as const;

/** Machine codes the browser store keys on. Stable wire contract. */
export type MediaErrorCode =
  | "signInRequired"
  | "forbidden"
  | "demoMode"
  | "keyMissing"
  | "badRequest"
  | "storageFailed";

export interface MediaRefusal {
  code: MediaErrorCode;
  message: string;
  status: number;
}

/**
 * Turn a refused access result into the response the caller should receive.
 *
 * Each message tells the person what to DO — sign in, ask an owner, wait for an
 * administrator — and none of them says anything about how the server is
 * configured beyond "not available to you".
 */
export function mediaWriteRefusal(
  access: Extract<StaffAccess, { ok: false }>
): MediaRefusal {
  switch (access.reason) {
    case "demo_mode":
      return {
        code: "demoMode",
        status: 403,
        message:
          "This deployment is running in demo mode, which has no real sign-in — " +
          "so it cannot change the shared media library. An administrator needs " +
          "to connect staff sign-in first.",
      };
    case "unauthenticated":
      return {
        code: "signInRequired",
        status: 401,
        message: "Please sign in first.",
      };
    case "forbidden":
      return {
        code: "forbidden",
        status: 403,
        message: "Your account does not include managing sales material.",
      };
  }
}
