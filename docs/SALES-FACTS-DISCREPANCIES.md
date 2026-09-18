# Sales bot: what still needs Samer's word

Date: 2026-09-18. Source workbook: `Monza-Bot-Reply-Worksheet-Updated-Logic.xlsx`.

Rule (Samer, 2026-09-17): the bot never chooses between conflicting specifications. A held fact
reads "not confirmed yet — our Sales Team can confirm it with you right here" and raises a
"Question for the team" alert, until Samer settles it. To release one: fix the workbook, remove
the row from `PENDING_CONFIRMATION` in `scripts/sales-import-workbook.py`, re-run the script.

## Settled by the 2026-09-18 workbook (holds lifted)

Samer re-stated every fact that was held on 2026-09-17, and named *A Car Facts* the single source
of truth: Taishan 700 hp and 410 km EV / 1,400 km combined; Passion L 657 hp, 410 km EV / 1,400 km
combined, 65 kWh CATL; the 43 kWh CATL packs of the Free 318, Dream and Passion; MHERO 1 = 5 seats.
The bot now states all of them exactly as written.

## Still held: 1 fact

| Car | Fact | A Car Facts | Conflicts with | Confirm |
|---|---|---|---|---|
| VOYAH Courage | Range | 440 km WLTP | the same workbook's *F Model Answer Coverage*: "550 km of WLTP range on a full charge if up hill 440 km"; Monza's own Courage video says 470 km | ☐ 440 km WLTP · ☐ the 550 / 440 sentence · ☐ other: ____ |

## A sentence I did not switch on: "Do you mean Voyah passion S?"

Replies rows 113, 118, 120, 122, 126, 131, 134 and 139 (a customer asks for a colour we do not
have, e.g. red) now say: *"Sorry we don't have a Voyah Free 318 in red. Do you mean Voyah passion
S?"* — the same text on every car's row, including the Courage and the MHERO rows.

There is no "Passion S" in *A Car Facts*, so the bot has no brochure, video or fact for it and
would be naming a car it cannot show. Today the bot answers: *"Sorry — we don't have a video of the
VOYAH Courage in red."* and offers that car's real colours. Tell me which you want:

- ☐ Passion S is a real car we sell: add its row to *A Car Facts* (and its brochure/video), and I switch the sentence on.
- ☐ It should say "VOYAH Passion" (or "Passion L"): tell me which, and for which colour(s).
- ☐ Keep today's answer.

## Colours: the workbook names more than the library can show

The bot offers only colours that have a video in the shared library, under the workbook's official
names ("black" still finds "Pearl Black").

| Car | A Car Facts | Has a video | Not offered until a video is uploaded |
|---|---|---|---|
| VOYAH Free 318 | Midnight Black · British Racing Green · Titanium Grey · Sage Green · Pearl White | all five | — |
| VOYAH Courage | Pearl Black · Crayon Grey · Pearl White | all three | — |
| VOYAH Dream | Midnight Black | one video, not filed under a colour | (sent as "a video of the VOYAH Dream") |
| VOYAH Passion | Midnight Black | none | Midnight Black |
| VOYAH Passion L | Obsidian Black · Titanium Grey | both | — |
| VOYAH Taishan | Obsidian Black · Sapphire Blue · Storm Grey | all three | — |
| MHERO 1 | Obsidian Black · Storm Grey · Recon Green | Storm Grey | Obsidian Black, Recon Green |
| MHERO 2 | Piano Black · Olive Green · Clouds White · Polar Silver | the first three | Polar Silver |

Because the Passion has no video, a price or test-drive question about it gets the brochure and
the Sales hand-off, without the "model video" the workbook asks for.

## Smaller notes

- **Service sentence.** *B Showroom* still says "For Service, Maintenance, or Spare Parts, please
  contact 76 877 278."; *D Staff Replies* and *E* now say "…please contact us on WhatsApp at
  76 877 278." The bot uses D's sentence (it is the newer, and the only one saying it is WhatsApp).
- **"Our current bot portfolio covers VOYAH and MHERO in Lebanon"** (E, unknown brand): kept as
  "We currently specialize in VOYAH and MHERO vehicles in Lebanon." — "bot portfolio" is wording
  for us, not for a customer. Say if you want it word for word.
- **Map link.** The workbook now holds only the `<iframe>` embed, which is never sent. The bot
  keeps the link you wrote on 2026-09-17: https://maps.app.goo.gl/orJMduowHtVqQgR58
- **Stock.** E says "if an explicit approved stock answer exists, answer it". The workbook holds no
  stock table, so availability always goes to Sales ("will confirm the current availability … right
  here"). Replies rows 84–85 ("yes and send brochure…") are marked *Person*, so they are not automated.
- **Trunk capacity** of the Passion L, Taishan, MHERO 1 and MHERO 2 is "not currently stated": the
  bot gives the dimensions and says the trunk capacity is not confirmed yet.

## Not in the workbook at all

Answered "not in our approved information yet" and passed to Sales: top speed, 0–100 acceleration,
sunroof, seat material, ground clearance, wheel size, suspension, driver-assistance features, towing,
performance in snow / off-road, sound system, screen size, heated or ventilated seats, weight,
torque, interior colours, the model year of a specific car. To have the bot answer one, add a
column to *A Car Facts* and tell me its name.
