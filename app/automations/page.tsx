import type { Metadata } from "next";
import { requireStaffForPage } from "@/lib/auth-server";
import { getSource, isDemoSource, readContext } from "@/lib/domain";
import { DEMO_TODAY } from "@/lib/domain/demo-source";
import { DEFAULT_AUTOMATIONS } from "@/lib/automations/catalog";
import { collectEvents } from "@/lib/automations/events";
import { evaluate } from "@/lib/automations/engine";
import { renderTemplate, templateIds } from "@/lib/automations/templates";
import AutomationsClient, { type AutomationView } from "./AutomationsClient";

export const metadata: Metadata = {
  title: "Automations — Monza AI",
};

/**
 * /automations — what would happen, computed with the real engine.
 *
 * This page does NOT describe automations in prose and hope they behave that
 * way. It runs lib/automations/engine over today's actual events and shows the
 * result, so what is on screen is what the system would do. The engine is pure,
 * so running it to render a page is exactly as safe as reading a list.
 *
 * Every automation ships switched OFF. The preview below therefore evaluates a
 * copy with each one turned on — "here is what this would do if you enabled it"
 * — while the real catalog stays off. Nothing is sent from this page, and until
 * an outbound channel is connected nothing can be.
 */
export const dynamic = "force-dynamic";

export default async function AutomationsPage() {
  const user = await requireStaffForPage("/automations");
  const source = getSource();
  const ctx = readContext(user);

  const [installments, vehicles, customers] = await Promise.all([
    source.listInstallments(ctx),
    source.listVehicles(ctx),
    source.listCustomers(ctx),
  ]);

  const nameById = new Map(customers.map((c) => [c.id, c.name]));
  const events = collectEvents({ installments, vehicles }, DEMO_TODAY);
  const known = templateIds();

  const views: AutomationView[] = DEFAULT_AUTOMATIONS.map((automation) => {
    // Evaluate this one automation as if it were on, against today's events.
    const asIfOn = { ...automation, enabled: true };
    const { planned } = evaluate(events, [asIfOn], { knownTemplates: known });

    return {
      id: automation.id,
      name: automation.name,
      description: automation.description,
      enabled: automation.enabled,
      triggerKind: automation.trigger.kind,
      actionKinds: automation.actions.map((a) => a.kind),
      wouldActNow: planned.length,
      examples: planned.slice(0, 3).map((p) => {
        const customerName = nameById.get(p.customerId) ?? "A customer";
        const text =
          p.action.kind === "send_message" && p.action.templateId
            ? renderTemplate(p.action.templateId, {
                customerName,
                event: p.event,
              })
            : (p.action.note ?? null);
        return {
          customerName,
          actionKind: p.action.kind,
          text: text ?? "",
        };
      }),
    };
  });

  return (
    <AutomationsClient
      demo={isDemoSource(source)}
      sourceLabel={source.label}
      today={DEMO_TODAY}
      eventCount={events.length}
      automations={views}
    />
  );
}
