/**
 * The sales conversation flow — what to say, and when.
 *
 * The old brain answered one question: "does this first message deserve an
 * automatic reply?" That is no longer enough, because the answer is now a
 * CONVERSATION:
 *
 *     customer:  can I get more information about the MHERO?
 *     Monza:     of course — we have it in Black, White or Grey.
 *                Which would you like to see?
 *     customer:  black
 *     Monza:     [black walkaround video] + [MHERO brochure]
 *
 * Which means the flow is stateful. It stays PURE anyway: the state goes in as
 * an argument and comes back in the result, so the caller (a webhook handler,
 * or the simulator on screen) owns persistence and this module stays
 * deterministic and testable.
 *
 * THE GUARD THAT HAD TO CHANGE. The old rules said "only ever reply to the
 * FIRST message from a NEW number". That is still right for starting a
 * conversation — but the customer's colour answer is by definition their
 * second message, and refusing it would leave the robot having asked a
 * question it then ignores. So the first-message guards now apply only when
 * starting; once we have asked something, we are allowed to hear the answer.
 *
 * WHAT IT WILL NEVER DO:
 *   - ask the colour question twice in a row without progress (it gives up and
 *     hands over to a person)
 *   - claim a colour we cannot actually send
 *   - keep talking after the material has gone out; the next message is a
 *     person's job
 */

import {
  isBareGreeting,
  matchModel,
  type IncomingInput,
  type WaCar,
} from "@/lib/wasales/matcher";
import {
  defaultColour,
  listColourNames,
  readColourAnswer,
  sendableColours,
  type WaColour,
} from "@/lib/wasales/colours";

/* ── State ───────────────────────────────────────────────────────────────── */

export type SalesState =
  /** Nothing said yet. The first-message guards apply here and only here. */
  | { stage: "new" }
  /** We asked which colour, and are waiting for the answer. */
  | { stage: "awaiting_colour"; carId: string; timesAsked: number }
  /** Material has gone out. The robot is finished; a person takes it from here. */
  | { stage: "sent"; carId: string; colourId: string | null }
  /** Handed to a person. The robot stays quiet for the rest of the thread. */
  | { stage: "human" };

export const INITIAL_STATE: SalesState = { stage: "new" };

/** How many times we may ask the colour question before handing over. */
export const MAX_COLOUR_ASKS = 2;

/* ── What we know about a car's material ─────────────────────────────────── */

/**
 * What has actually been uploaded for one car. Supplied by the caller from the
 * media store, so this module never guesses at what exists — a flow that
 * promises a video nobody uploaded is worse than one that says nothing.
 */
export interface CarMedia {
  hasBrochure: boolean;
  /** colour id -> how many videos that colour has. */
  videosByColour: Readonly<Record<string, number>>;
}

export type MediaLookup = (carId: string) => CarMedia;

/* ── Actions ─────────────────────────────────────────────────────────────── */

export type SalesAction =
  /** Ask which colour, listing the ones we can actually send. */
  | {
      kind: "ask_colour";
      car: WaCar;
      colours: WaColour[];
      /** The exact words that would go out. */
      message: string;
    }
  /** Send this colour's videos plus the car's one brochure. */
  | {
      kind: "send";
      car: WaCar;
      colour: WaColour;
      /** True when the customer said "any" and we chose. */
      chosenForThem: boolean;
      message: string;
    }
  /** Say something and keep waiting — used when they asked for a colour we
   *  do not have, which deserves an honest answer rather than silence. */
  | {
      kind: "reask_colour";
      car: WaCar;
      colours: WaColour[];
      message: string;
    }
  /** Nothing goes out; a person handles it. Every hold carries a reason. */
  | { kind: "hold"; reason: string };

export interface FlowResult {
  action: SalesAction;
  next: SalesState;
}

/* ── Message wording ─────────────────────────────────────────────────────── */
/* Placeholder voice — warm, short, never pushy. Monza's to rewrite. */

export function askColourMessage(car: WaCar, colours: WaColour[]): string {
  return (
    `Thanks for your interest in the ${car.name}! We have it in ` +
    `${listColourNames(colours)}. Which would you like to see?`
  );
}

/**
 * The message that goes out with the material.
 *
 * `hadAChoice` is false when the car has exactly one sendable colour — either
 * because its videos were never organised by colour (Voyah Dream) or because
 * the others have no video yet (Mhero 1, whose Black folder is empty). In that
 * case the message must NOT name a colour or offer to show another one: doing
 * so advertises a choice that does not exist, and the customer asks for a
 * colour we then have to refuse.
 */
export function sendMessage(
  car: WaCar,
  colour: WaColour,
  chosenForThem: boolean,
  hadAChoice: boolean
): string {
  if (!hadAChoice) {
    return (
      `Here is the ${car.name}. The brochure has the full details. ` +
      `Tell us if you would like to arrange a test drive.`
    );
  }
  const opening = chosenForThem
    ? `Here is the ${car.name} in ${colour.name} — a favourite of ours.`
    : `Here is the ${car.name} in ${colour.name}.`;
  return (
    `${opening} The brochure has the full details. ` +
    `Tell us if you would like to see another colour, or arrange a test drive.`
  );
}

export function reaskColourMessage(car: WaCar, colours: WaColour[]): string {
  return (
    `Sorry — we do not have the ${car.name} in that colour. ` +
    `We have ${listColourNames(colours)}. Which would you like to see?`
  );
}

/* ── The flow ────────────────────────────────────────────────────────────── */

function hold(reason: string, next: SalesState = { stage: "human" }): FlowResult {
  return { action: { kind: "hold", reason }, next };
}

/**
 * Advance the conversation by one incoming message.
 *
 * `media` reports what has really been uploaded. A car with no brochure, or no
 * colour with a video, can never auto-send — the flow holds and says which
 * piece is missing, so the gap is visible on the dashboard instead of silent.
 */
export function advance(
  input: IncomingInput,
  state: SalesState,
  catalog: readonly WaCar[],
  media: MediaLookup
): FlowResult {
  // (1) The owner's kill switch beats everything, at every stage.
  if (!input.autoSendEnabled) {
    return hold(
      "Auto-send is switched off — nothing goes out automatically until you turn it back on.",
      state
    );
  }

  if (state.stage === "human") {
    return hold("Your team is handling this conversation.", state);
  }

  if (state.stage === "sent") {
    return hold(
      "The material has already gone out — your team replies from here.",
      { stage: "human" }
    );
  }

  if (state.stage === "awaiting_colour") {
    return answerColour(input, state, catalog, media);
  }

  return start(input, catalog, media);
}

/** Starting a conversation: the original first-message guards, unchanged. */
function start(
  input: IncomingInput,
  catalog: readonly WaCar[],
  media: MediaLookup
): FlowResult {
  if (!input.isNewNumber) {
    return hold(
      "This person already has a conversation with Monza — your team replies, the auto-sender stays quiet."
    );
  }
  if (!input.isFirstMessage) {
    return hold(
      "Not their first message — once a conversation has started, your team replies."
    );
  }

  const match = matchModel(input.text, catalog);
  if (match.decision === "hold") {
    if (!match.contenders && isBareGreeting(input.text)) {
      return hold(
        "Just a greeting, no car mentioned — a person should say hello back."
      );
    }
    return hold(match.reason);
  }

  const car = match.model as WaCar;
  if (!car.enabled) {
    return hold(
      `Matched ${car.name}, but its auto-send is switched off — handed to your team.`
    );
  }

  const have = media(car.id);
  const sendable = sendableColours(car.colours, have.videosByColour);

  const missing: string[] = [];
  if (sendable.length === 0) missing.push("videos");
  if (!have.hasBrochure) missing.push("brochure");
  if (missing.length > 0) {
    return hold(
      `Matched ${car.name}, but it is missing its ${missing.join(" and ")} — ` +
        `nothing goes out half-empty; handed to your team.`
    );
  }

  // They may have named the colour already — "info about the black MHERO".
  // Asking a question they have already answered is the kind of thing that
  // makes a robot obvious.
  const answer = readColourAnswer(input.text, sendable);
  if (answer.kind === "one") {
    return {
      action: {
        kind: "send",
        car,
        colour: answer.colour,
        chosenForThem: false,
        message: sendMessage(car, answer.colour, false, sendable.length > 1),
      },
      next: { stage: "sent", carId: car.id, colourId: answer.colour.id },
    };
  }

  // Only one colour exists, so there is nothing to choose between.
  if (sendable.length === 1) {
    return {
      action: {
        kind: "send",
        car,
        colour: sendable[0],
        chosenForThem: true,
        message: sendMessage(car, sendable[0], true, false),
      },
      next: { stage: "sent", carId: car.id, colourId: sendable[0].id },
    };
  }

  return {
    action: {
      kind: "ask_colour",
      car,
      colours: sendable,
      message: askColourMessage(car, sendable),
    },
    next: { stage: "awaiting_colour", carId: car.id, timesAsked: 1 },
  };
}

/** Reading the reply to the colour question. */
function answerColour(
  input: IncomingInput,
  state: Extract<SalesState, { stage: "awaiting_colour" }>,
  catalog: readonly WaCar[],
  media: MediaLookup
): FlowResult {
  const car = catalog.find((c) => c.id === state.carId);
  if (!car) {
    return hold("That car is no longer in the catalogue — handed to your team.");
  }
  if (!car.enabled) {
    return hold(
      `${car.name} was switched off mid-conversation — handed to your team.`
    );
  }

  const have = media(car.id);
  const sendable = sendableColours(car.colours, have.videosByColour);
  if (sendable.length === 0 || !have.hasBrochure) {
    return hold(
      `${car.name} no longer has the material to send — handed to your team.`
    );
  }

  const answer = readColourAnswer(input.text, sendable);

  if (answer.kind === "one") {
    return {
      action: {
        kind: "send",
        car,
        colour: answer.colour,
        chosenForThem: false,
        message: sendMessage(car, answer.colour, false, sendable.length > 1),
      },
      next: { stage: "sent", carId: car.id, colourId: answer.colour.id },
    };
  }

  // "Any", "whatever you have", "you choose" — a real answer. Send our pick.
  if (answer.kind === "no_preference") {
    const pick = defaultColour(car.colours, have.videosByColour);
    if (!pick) {
      return hold(`${car.name} has no colour with a video — handed to your team.`);
    }
    return {
      action: {
        kind: "send",
        car,
        colour: pick,
        chosenForThem: true,
        message: sendMessage(car, pick, true, sendable.length > 1),
      },
      next: { stage: "sent", carId: car.id, colourId: pick.id },
    };
  }

  // Two colours named at once is a comparison, and comparisons are a person's
  // job — the same rule as two cars in one message.
  if (answer.kind === "several") {
    return hold(
      `Asked about ${answer.colours.map((c) => c.name).join(" and ")} — ` +
        `handed to your team.`
    );
  }

  // A colour we do not stock deserves an honest answer, once.
  if (answer.kind === "unavailable") {
    if (state.timesAsked >= MAX_COLOUR_ASKS) {
      return hold(
        `Asked for a colour we do not have in the ${car.name} — handed to your team.`
      );
    }
    return {
      action: {
        kind: "reask_colour",
        car,
        colours: sendable,
        message: reaskColourMessage(car, sendable),
      },
      next: {
        stage: "awaiting_colour",
        carId: car.id,
        timesAsked: state.timesAsked + 1,
      },
    };
  }

  // Nothing colour-shaped: they changed the subject, or asked something else.
  // A person answers that; the robot does not guess twice.
  return hold(
    `They replied about something other than colour — handed to your team.`
  );
}
