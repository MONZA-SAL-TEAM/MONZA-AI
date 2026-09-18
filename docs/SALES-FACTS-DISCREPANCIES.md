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

## Settled by Samer in chat, 2026-09-18

- **Courage range** — "its 550 km and if uphill 440 km". The bot says: *"The VOYAH Courage offers
  550 km of WLTP range on a full charge, and 440 km if uphill."* Nothing is held any more.
  **Your workbook still says "440 km WLTP" in A Car Facts (cell C6)** — please change that cell to
  the same sentence, so the workbook and the bot agree; until then `CONFIRMED_BY_SAMER` in
  `scripts/sales-import-workbook.py` carries your word and the importer prints the difference.
  Monza's own Courage video still says 470 km.
- **Passion S** — "leave passion s only to be answered by sales team instead of chat bot". Any
  message naming the Passion S gets only *"Our Sales Team will assist you further right here with
  all the details you need."* and a "Question for the team" alert — no brochure, no video, and it
  is never answered as the Passion. The "Do you mean Voyah passion S?" sentence is NOT sent by the
  bot: a customer who asks for a colour we do not have is told so and offered the real colours.

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
  keeps the link you gave on 2026-09-18: https://maps.app.goo.gl/CVPJQqXfnnbBmubZ8
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
