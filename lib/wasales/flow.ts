/**
 * The sales conversation — ONE inbound message in, everything that follows
 * from it out.
 *
 * This file used to BE the brain: a hand-written state machine (which model →
 * "would you like the brochure?" → which colour → the video) that spoke only
 * to a brand-new number on its first message and handed everything else to a
 * person. It is now a thin runner over the Customer Search & Media Engine:
 *
 *   decide()            engine.ts     what was understood, what should happen
 *   renderPlan()        templates.ts  the exact messages, shaped per channel
 *   applySendPolicy()   actions.ts    whether any of it may go out — today, no
 *   traceForLog()       engine.ts     one structured, text-free log line
 *
 * What changed, and why (Samer's specification, 2026-09-14):
 *   - The brochure is SENT first whenever a model becomes active, instead of
 *     being offered with a yes/no question.
 *   - Returning customers and later messages are answered. The old rule
 *     answered only the first message of a never-seen number; in the
 *     first-message study 55% of customers wrote more than once.
 *   - Questions are answered from approved knowledge — facts, location, hours,
 *     the number — and everything a person must answer gets the number.
 *   - Instagram, Messenger and WhatsApp share one engine. The channel changes
 *     only how choices are drawn and which files fit.
 *
 * STILL PREVIEW ONLY. Nothing calls runTurn() from the webhook: CLAUDE.md rule
 * 24 forbids an inbound message triggering an outbound one without a person,
 * and no channel adapter can send a file yet. The simulator on /sales runs
 * exactly this function, so what it shows is what production would do.
 */

import {
  decide,
  traceForLog,
  type EngineDecision,
  type EngineDeps,
  type EngineInput,
} from "@/lib/wasales/engine";
import { applySendPolicy, type PolicyResult, type SendContext } from "@/lib/wasales/actions";
import { renderPlan, type OutboundPart } from "@/lib/wasales/templates";
import { freshState, type SearchEngineState } from "@/lib/wasales/context";
import { salesBrandOf, type SalesChannel } from "@/lib/wasales/knowledge";

export interface TurnResult {
  /** What the engine understood and decided. */
  decision: EngineDecision;
  /** The messages the decision would produce, in order, for this channel. */
  plan: OutboundPart[];
  /** Whether they may go out, and every reason they may not. */
  policy: PolicyResult;
  /** The decision as one log line — no message text, nothing secret. */
  trace: Record<string, unknown>;
}

/** Run one inbound message through the engine, the templates and the policy. */
export function runTurn(
  input: EngineInput,
  state: SearchEngineState,
  deps: EngineDeps,
  send: SendContext
): TurnResult {
  const decision = decide(input, state, deps);
  const brand = salesBrandOf(input.brand);
  const plan = brand
    ? renderPlan(decision.actions, {
        channel: send.channel,
        brand,
        knowledge: deps.knowledge,
        linkOversize: send.linkOversize,
      })
    : [];
  const policy = applySendPolicy(decision.actions, send, deps.knowledge);
  return {
    decision,
    plan,
    policy,
    trace: {
      ...traceForLog(decision),
      channel: send.channel,
      wouldSend: policy.wouldSend,
      blocked: policy.blocked,
    },
  };
}

/**
 * The send context as it stands today: the engine may think, nothing may
 * leave. Live sending stays off until Samer lifts rule 24, and no adapter
 * sends files. The switches that ARE the owner's (auto-send, the window, the
 * human lock) start permissive so the simulator shows the other blocks.
 */
export function previewSendContext(channel: SalesChannel): SendContext {
  return {
    channel,
    autoSendEnabled: true,
    replyWindowOpen: true,
    humanLock: false,
    liveSending: false,
    attachmentsSupported: false,
  };
}

/** A whole conversation, message by message, threading the state through. */
export function runConversation(
  inputs: readonly EngineInput[],
  deps: EngineDeps,
  send: SendContext,
  start: SearchEngineState = freshState()
): { turns: TurnResult[]; state: SearchEngineState } {
  const turns: TurnResult[] = [];
  let state = start;
  for (const input of inputs) {
    const turn = runTurn(input, state, deps, send);
    turns.push(turn);
    state = turn.decision.nextState;
  }
  return { turns, state };
}
