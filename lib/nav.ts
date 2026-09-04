/**
 * The product's shape, in one list.
 *
 * MONZA AI is a communication and automation layer, and the navigation says so:
 * the Inbox is first because conversations are the centre of the product, and
 * everything above the divider is something you DO with a customer. The System
 * group is the plumbing.
 *
 * This replaces the old "Departments" framing, which mirrored Monza's
 * org chart (Customers & Sales, Installments & Payments, Garage & Vehicles,
 * Money & Reports) and quietly pushed the product toward being a second ERP —
 * a department page per business system is a business system.
 *
 * One list, so the sidebar, the redirects and any future command palette can
 * never disagree about what exists.
 */

export interface NavItem {
  href: string;
  label: string;
  /** Key into the sidebar's icon set. */
  icon: string;
  /** Match the path exactly rather than by prefix. */
  exact?: boolean;
  /** One line for a menu or a landing page. */
  blurb: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: "Communication",
    items: [
      {
        href: "/inbox",
        label: "Inbox",
        icon: "inbox",
        blurb:
          "Every conversation, from WhatsApp, Instagram and Facebook, in one place.",
      },
      {
        href: "/customers",
        label: "Customers",
        icon: "customers",
        blurb:
          "Who you are talking to, and the context you need while you talk to them.",
      },
      {
        href: "/automations",
        label: "Automations",
        icon: "automations",
        blurb:
          "When something happens, say the right thing — reminders, confirmations, pickups.",
      },
    ],
  },
  {
    label: "Follow-up",
    items: [
      {
        href: "/installments",
        label: "Installments",
        icon: "installments",
        blurb:
          "Who to remind, who to thank, and what was already sent. Not a ledger.",
      },
      {
        href: "/vehicles",
        label: "Vehicle updates",
        icon: "vehicles",
        blurb:
          "Cars whose status means a customer should hear from you.",
      },
      {
        href: "/sales",
        label: "Sales",
        icon: "sales",
        blurb:
          "Brochures, photos and videos, ready to send — and the auto-responder.",
      },
    ],
  },
  {
    label: "Assistant",
    items: [
      {
        href: "/chat",
        label: "AI assistant",
        icon: "chat",
        exact: true,
        blurb: "Ask the Monza systems anything, in plain language.",
      },
    ],
  },
  {
    label: "System",
    items: [
      {
        href: "/dashboard",
        label: "Dashboard",
        icon: "dashboard",
        blurb: "What the assistant did today.",
      },
      {
        href: "/integrations",
        label: "Integrations",
        icon: "integrations",
        blurb: "Which systems and channels are connected.",
      },
      {
        href: "/settings",
        label: "Settings",
        icon: "settings",
        blurb: "How this deployment is set up.",
      },
    ],
  },
];

/** Every route in the product, flattened. */
export const NAV_ITEMS: NavItem[] = NAV.flatMap((g) => g.items);

/** Paths the sign-in gate protects — derived, so a new page cannot be missed.
 *  (A page added to NAV without a matcher entry would be reachable without
 *  signing in; deriving the list is how that stops being possible.) */
export const PROTECTED_PATHS: string[] = NAV_ITEMS.map((i) => i.href);
