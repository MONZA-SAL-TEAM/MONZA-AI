"use client";

/**
 * Vehicle updates — the communication view of the garage.
 *
 * "Ready for pickup" comes first because it is the only status that means
 * somebody is waiting to hear from us. Everything else is context: a car that
 * is in service or waiting on a part is a car whose owner might ask, and the
 * answer should be to hand.
 *
 * There is no job lifecycle here, no technician, no parts ordering and no way
 * to change a status. Those belong to the garage system, which stays
 * authoritative — this screen only reads.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  VEHICLE_STATUS_LABEL,
  type Customer,
  type Vehicle,
  type VehicleStatus,
} from "@/lib/domain/types";
import { eventsForVehicle } from "@/lib/automations/events";
import { renderTemplate } from "@/lib/automations/templates";
import { waLink } from "@/lib/format";
import { numberContains, searchIntent, textContains } from "@/lib/search";
import "../board.css";

interface Props {
  today: string;
  demo: boolean;
  sourceLabel: string;
  vehicles: Vehicle[];
  customers: Customer[];
}

/** Ready first — it is the only status with someone waiting on the other end. */
const STATUS_ORDER: VehicleStatus[] = [
  "ready_for_pickup",
  "waiting_parts",
  "in_service",
  "with_customer",
  "delivered",
];

type Lens = "needs_a_word" | "all";

export default function VehiclesClient({
  today,
  demo,
  sourceLabel,
  vehicles,
  customers,
}: Props) {
  /**
   * Opens on "All open cars", not "Needs a word".
   *
   * The demo canon has no car at "ready for pickup" — its nine open jobs are
   * reconciled with the assistant's own answers ("3 waiting to start, 4 being
   * worked on, 2 blocked on parts"), and inventing a tenth to make this screen
   * livelier would put the demo universe out of step with itself. So the
   * default lens is the one with something in it, and "Needs a word" honestly
   * shows nothing until a car actually is ready.
   */
  const [lens, setLens] = useState<Lens>("all");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const customerById = useMemo(
    () => new Map(customers.map((c) => [c.id, c])),
    [customers]
  );

  const counts = useMemo(() => {
    const by = (s: VehicleStatus) =>
      vehicles.filter((v) => v.status === s).length;
    return {
      ready: by("ready_for_pickup"),
      waitingParts: by("waiting_parts"),
      inService: by("in_service"),
    };
  }, [vehicles]);

  const inLens = useMemo(() => {
    const chosen =
      lens === "needs_a_word"
        ? vehicles.filter((v) => v.status === "ready_for_pickup")
        : vehicles.filter((v) => v.status !== "delivered");
    return [...chosen].sort((a, b) => {
      const byStatus =
        STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
      if (byStatus !== 0) return byStatus;
      return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
    });
  }, [vehicles, lens]);

  const visible = useMemo(() => {
    const intent = searchIntent(search);
    if (intent.kind === "empty") return inLens;
    if (intent.kind === "number_too_short") return [];
    return inLens.filter((v) => {
      const c = v.customerId ? customerById.get(v.customerId) : null;
      if (intent.kind === "number") {
        return numberContains(c?.phone ?? null, intent.digits);
      }
      return (
        textContains(v.label, intent.text) ||
        textContains(v.plate, intent.text) ||
        textContains(v.vin, intent.text) ||
        textContains(c?.name ?? null, intent.text) ||
        textContains(v.jobReference, intent.text)
      );
    });
  }, [inLens, search, customerById]);

  return (
    <main className="board">
      <header className="board-head">
        <div className="eyebrow">Follow-up</div>
        <h1 className="h1">Vehicle updates</h1>
        <p className="lede">
          Cars whose status means a customer should hear from you.
        </p>
      </header>

      <p className="board-note">
        The garage system stays in charge of the work — job cards, parts and
        technicians all live there. This screen only reads
        {" "}{sourceLabel.toLowerCase()} to see who is waiting on news, and nothing
        here changes a vehicle&apos;s status.
        {demo && " Nothing here is real yet."}
      </p>

      <div className="tiles">
        <div className="tile">
          <p className="tile-label">Ready for pickup</p>
          <p className="tile-value">{counts.ready}</p>
          <p className="tile-foot">Somebody is waiting to hear</p>
        </div>
        <div className="tile">
          <p className="tile-label">Waiting for parts</p>
          <p className="tile-value">{counts.waitingParts}</p>
          <p className="tile-foot">Expect questions about these</p>
        </div>
        <div className="tile">
          <p className="tile-label">In service</p>
          <p className="tile-value">{counts.inService}</p>
          <p className="tile-foot">Work under way</p>
        </div>
      </div>

      <div className="board-tools">
        <input
          className="board-search"
          type="search"
          placeholder="Search by name, plate, VIN or job number"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search vehicles"
        />
        <div className="chips">
          <button
            type="button"
            className="chip"
            aria-pressed={lens === "needs_a_word"}
            onClick={() => setLens("needs_a_word")}
          >
            Needs a word
          </button>
          <button
            type="button"
            className="chip"
            aria-pressed={lens === "all"}
            onClick={() => setLens("all")}
          >
            All open cars
          </button>
        </div>
      </div>

      <p className="cap">
        Showing {visible.length} of {inLens.length}
      </p>

      <ul className="rows">
        {visible.map((v) => {
          const customer = v.customerId ? customerById.get(v.customerId) : null;
          const event = eventsForVehicle(v, today)[0];
          const message =
            event && customer
              ? renderTemplate("vehicle.ready_for_pickup", {
                  customerName: customer.name,
                  event,
                })
              : null;
          const isOpen = openId === v.id;

          return (
            <li
              key={v.id}
              className={`rowcard${
                v.status === "ready_for_pickup"
                  ? " ready"
                  : v.status === "waiting_parts"
                    ? " urgent"
                    : ""
              }`}
            >
              <div className="rowcard-top">
                <div className="grow">
                  <p className="rowcard-name">{v.label}</p>
                  <p className="rowcard-sub">
                    {customer?.name ?? "No owner on record"}
                    {v.plate ? ` · ${v.plate}` : ""}
                    {v.jobReference ? ` · job ${v.jobReference}` : ""}
                  </p>
                </div>
                <div className="rowcard-tags">
                  <span
                    className={`tag${
                      v.status === "ready_for_pickup"
                        ? " live"
                        : v.status === "waiting_parts"
                          ? " urgent"
                          : ""
                    }`}
                  >
                    {VEHICLE_STATUS_LABEL[v.status]}
                  </span>
                  {v.awaitingPart && <span className="tag">{v.awaitingPart}</span>}
                </div>
              </div>

              {isOpen && message && (
                <>
                  <p className="preview">{message}</p>
                  <p className="cap">
                    Nothing is sent from here. Opening WhatsApp fills this in —
                    a person taps send.
                  </p>
                </>
              )}

              <div className="rowcard-actions">
                {message ? (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setOpenId(isOpen ? null : v.id)}
                  >
                    {isOpen ? "Hide message" : "Show message"}
                  </button>
                ) : (
                  <span className="cap">
                    {v.status === "ready_for_pickup"
                      ? "No owner or job reference on record — nothing can be sent safely."
                      : "No message for this status."}
                  </span>
                )}
                {isOpen && message && customer?.phone && (
                  <a
                    className="btn primary"
                    href={waLink(customer.phone, message)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open in WhatsApp
                  </a>
                )}
                {customer && (
                  <Link className="btn quiet" href={`/customers?open=${customer.id}`}>
                    Customer
                  </Link>
                )}
              </div>
            </li>
          );
        })}

        {visible.length === 0 && (
          <li className="board-empty">
            {search
              ? "Nothing matches that search."
              : "No car is waiting on a word right now."}
          </li>
        )}
      </ul>
    </main>
  );
}
