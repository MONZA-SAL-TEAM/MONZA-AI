# Sales bot: facts and colours awaiting Samer's confirmation

Date: 2026-09-17. Source workbook: `Monza-Bot-Reply-Worksheet-Master-Logic-Expanded.xlsx`, sheet *A Car Facts*.

Rule (Samer, 2026-09-17): the bot never chooses between conflicting specifications. Every row
below is **held back** — the bot answers "not confirmed yet" and gives the sales number — until
Samer confirms the value. Confirmed rows are removed from `PENDING_CONFIRMATION` in
`scripts/sales-import-workbook.py`, the script is re-run, and the workbook value goes live.

## Facts

| Car | Fact | Workbook says | Why it is held | Confirm |
|---|---|---|---|---|
| VOYAH Courage | Range | 440 km WLTP | Monza's own Courage video caption says 470 km | ☐ 440 · ☐ 470 · ☐ other: ____ |
| VOYAH Taishan | Horsepower | 657 hp | Monza's Taishan video says 670 combined hp; identical to the Passion L | ☐ 657 · ☐ 670 · ☐ other: ____ |
| VOYAH Taishan | Range | 370 km EV / 1,400 km combined (CLTC) | 1,400 km identical to the Passion L | ☐ confirm · ☐ other: ____ |
| VOYAH Passion L | Horsepower | 657 hp | identical to the Taishan | ☐ confirm · ☐ other: ____ |
| VOYAH Passion L | Range | 410 km EV / 1,400 km combined (CLTC) | 1,400 km identical to the Taishan | ☐ confirm · ☐ other: ____ |
| VOYAH Free 318 | Battery | 43 kWh ternary lithium | identical to the Dream and Passion | ☐ confirm · ☐ other: ____ |
| VOYAH Dream | Battery | 43 kWh ternary lithium | identical to the Free 318 and Passion | ☐ confirm · ☐ other: ____ |
| VOYAH Passion | Battery | 43 kWh ternary lithium | identical to the Free 318 and Dream | ☐ confirm · ☐ other: ____ |
| VOYAH Passion L | Battery | *(blank: "not currently stated")* | missing | value: ____ |
| MHERO 1 | Seats | *(blank: "not currently stated")* | missing | value: ____ |

Also blank in the workbook and therefore never sent: the exact charging time of the Free 318,
Courage, Passion L and Taishan, and the trunk capacity of the Passion L, Taishan, MHERO 1 and
MHERO 2 (the bot says "not confirmed yet" for those parts).

## Colours

The bot offers only colours that have a video in the shared library, so the library wins today.
The workbook should be brought in line, or videos added.

| Car | Workbook (A Car Facts) | Media library | Bot offers today |
|---|---|---|---|
| MHERO 1 | Black · Green · Grey | Black, Grey | Black, Grey |
| VOYAH Passion | *(none)* | Black | Black |
| VOYAH Dream | black | one video, no colour folders | the one video, no colour choice |

## Not in the workbook at all

These questions are answered "not in our approved information yet" and handed to the team:
top speed, 0–100 acceleration, sunroof, seat material, ground clearance, wheel size, suspension,
driver-assistance features, towing, performance in snow / off-road, sound system, screen size,
heated or ventilated seats, weight, torque, interior colours, model year per car.

If Monza wants the bot to answer any of them, add a column to *A Car Facts* and tell me the
column name.
