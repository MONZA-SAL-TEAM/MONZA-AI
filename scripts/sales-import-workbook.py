"""
The sales bot's brain, read from Samer's workbook (2026-09-17: "this is the brain of the chat bot").

    python scripts/sales-import-workbook.py "C:/Users/you/Desktop/Monza-Bot-Reply-Worksheet-Master-Logic-Expanded.xlsx"

Reads (never writes) the workbook and regenerates lib/wasales/knowledge-data.ts from:

  A Car Facts   the approved value of every fact, per model; powertrain bucket; aliases
  B Showroom    address, hours, department numbers, the welcome and hand-off sentences
  Replies       the Google Maps link Samer wrote into the answers

Wording meant for Samer, never for a customer ("not confirmed in this worksheet", "on the
VOYAH Lebanon page") is rewritten here, and a value that only says it is missing is kept
as UNCONFIRMED so the bot says so instead of sending the sentence. Every rewrite and every
conflict is printed, so a changed workbook is reviewed before it is committed.

Needs openpyxl (pip install openpyxl). Re-run after every edit of the workbook, then
`npm run verify`.
"""

import json
import re
import sys
from pathlib import Path

try:
    import openpyxl
except ImportError:
    sys.exit("openpyxl is missing: pip install openpyxl")

OUT = Path(__file__).resolve().parent.parent / "lib" / "wasales" / "knowledge-data.ts"

# Official model name → (engine code, catalogue folder id).
MODELS = {
    "VOYAH Free 318": ("FREE_318", "voyah-free-comp"),
    "VOYAH Courage": ("COURAGE", "voyah-courage"),
    "VOYAH Dream": ("DREAM", "voyah-dream"),
    "VOYAH Passion": ("PASSION", "voyah-passion"),
    "VOYAH Passion L": ("PASSION_L", "voyah-passion-l"),
    "VOYAH Taishan": ("TAISHAN", "voyah-taishan"),
    "MHERO 1": ("MHERO_1", "mhero-1"),
    "MHERO 2": ("MHERO_2", "mhero-2"),
}

# Workbook aliases that would point the matcher at one car when customers mean several
# ("voyah sedan" is the Passion AND the Passion L) — the engine reads those as a choice.
AMBIGUOUS_ALIASES = {"voyah sedan"}

# A Car Facts column header → the engine's fact key.
FACT_COLUMNS = {
    "Power": "HORSEPOWER",
    "Range": "RANGE",
    "Battery": "BATTERY",
    "Powertrain": "POWERTRAIN",
    "Charging": "CHARGING",
    "Seats": "SEATS",
    "Dimensions / trunk": "DIMENSIONS",
    "Warranty": "WARRANTY",
}

BUCKETS = {"EV / BEV": "EV", "EV": "EV", "BEV": "EV", "EREV": "EREV", "PHEV": "PHEV"}

# Internal wording → what a customer may read. Order matters: longest first.
REWRITES = [
    (r";\s*exact Lebanon charging time not confirmed in this worksheet", " (the exact charging time is not confirmed yet)"),
    (r";\s*exact time not currently published on Lebanon model page", " (the exact charging time is not confirmed yet)"),
    (r"\s*·\s*trunk not currently stated", " (trunk capacity not confirmed yet)"),
    (r"\s*·\s*trunk not published", " (trunk capacity not confirmed yet)"),
]

# Facts the workbook gives that conflict with another source or repeat another
# model's figure (docs/SALES-FACTS-DISCREPANCIES.md, 2026-09-17). Samer: "do not
# silently choose between conflicting specifications". Until he confirms each,
# the bot says the figure is not confirmed yet. Remove an entry once confirmed.
PENDING_CONFIRMATION = {
    ("VOYAH Courage", "RANGE"),        # workbook 440 km WLTP, Monza's video says 470 km
    ("VOYAH Taishan", "HORSEPOWER"),   # workbook 657 hp, Monza's video says 670 hp; same as Passion L
    ("VOYAH Taishan", "RANGE"),        # 1,400 km combined, same as Passion L
    ("VOYAH Passion L", "HORSEPOWER"), # 657 hp, same as Taishan
    ("VOYAH Passion L", "RANGE"),      # 1,400 km combined, same as Taishan
    ("VOYAH Free 318", "BATTERY"),     # 43 kWh, same as Dream and Passion
    ("VOYAH Dream", "BATTERY"),        # 43 kWh, same as Free 318 and Passion
    ("VOYAH Passion", "BATTERY"),      # 43 kWh, same as Free 318 and Dream
}

# A value that is ONLY a statement that the figure is missing.
UNCONFIRMED = re.compile(r"not (currently )?(stated|published|confirmed|mapped)", re.I)
INTERNAL = re.compile(r"worksheet|lebanon (model )?page|specs page|not currently|not published", re.I)

warnings = []


def text(v):
    return "" if v is None else str(v).strip()


def clean_value(model, key, raw):
    if (model, key) in PENDING_CONFIRMATION:
        warnings.append(f"PENDING {model} {key}: {raw!r} awaits Samer's confirmation — the bot says not confirmed yet")
        return {"value": "", "confirmed": False, "pending": raw}
    value = raw
    for pattern, replacement in REWRITES:
        value = re.sub(pattern, replacement, value, flags=re.I)
    if value != raw:
        warnings.append(f"reworded {model} {key}: {raw!r} -> {value!r}")
    if key == "WARRANTY":
        m = re.match(r"^\s*(\d+)\s*yr vehicle\s*/\s*(\d+)\s*yr battery\s*$", value, re.I)
        if m:
            value = f"{m.group(1)} years on the vehicle and {m.group(2)} years on the battery"
    if UNCONFIRMED.search(value) and not re.search(r"\(.*not confirmed yet\)", value):
        warnings.append(f"UNCONFIRMED {model} {key}: {raw!r} — the bot says it is not confirmed yet")
        return {"value": "", "confirmed": False}
    if INTERNAL.search(value):
        warnings.append(f"CHECK {model} {key}: internal wording left in {value!r}")
    return {"value": value, "confirmed": True}


def header_row(ws, first):
    for r in range(1, 12):
        if text(ws.cell(r, 1).value) == first:
            return r
    sys.exit(f"{ws.title}: no header row starting with {first!r}")


def main(path):
    wb = openpyxl.load_workbook(path, data_only=True)

    # ── A Car Facts ──
    ws = wb["A Car Facts"]
    h = header_row(ws, "Model")
    cols = {text(ws.cell(h, c).value): c for c in range(1, ws.max_column + 1) if text(ws.cell(h, c).value)}
    models = {}
    for r in range(h + 1, h + 20):
        official = text(ws.cell(r, cols["Official model"]).value)
        if official not in MODELS:
            continue
        code, catalogue_id = MODELS[official]
        facts = {}
        for column, key in FACT_COLUMNS.items():
            raw = text(ws.cell(r, cols[column]).value)
            if raw:
                facts[key] = clean_value(official, key, raw)
            else:
                warnings.append(f"MISSING {official} {key}")
        seats = facts.get("SEATS", {})
        seat_count = int(re.match(r"\d+", seats["value"]).group(0)) if seats.get("confirmed") and re.match(r"\d+", seats["value"]) else None
        bucket_raw = text(ws.cell(r, cols["Powertrain bucket"]).value)
        bucket = BUCKETS.get(bucket_raw)
        if not bucket:
            sys.exit(f"{official}: unknown powertrain bucket {bucket_raw!r}")
        aliases = [
            a.strip().lower()
            for a in text(ws.cell(r, cols["Keywords / aliases"]).value).split(",")
            if a.strip() and a.strip().lower() not in AMBIGUOUS_ALIASES
        ]
        models[code] = {
            "officialName": official,
            "catalogueId": catalogue_id,
            "bucket": bucket,
            "seatCount": seat_count,
            "facts": facts,
            "aliases": aliases,
            "workbookColours": text(ws.cell(r, cols["Available colour media"]).value),
        }
    missing = sorted({code for code, _ in MODELS.values()} - set(models))
    if missing:
        sys.exit(f"A Car Facts: no row for {missing}")

    # ── B Showroom ──
    ws = wb["B Showroom"]
    h = header_row(ws, "Item")
    showroom = {}
    for r in range(h + 1, ws.max_row + 1):
        item = text(ws.cell(r, 1).value).lower()
        answer = text(ws.cell(r, 3).value)
        if not item:
            continue
        if item.startswith("showroom address"):
            showroom["location"] = answer
        elif item.startswith("opening hours: monday"):
            showroom["hoursWeek"] = answer
        elif item.startswith("opening hours: saturday"):
            showroom["hoursSaturday"] = answer
        elif item.startswith("opening hours: sunday"):
            showroom["hoursSunday"] = answer
        elif item.startswith("sales phone"):
            showroom["salesContact"] = answer
        elif item.startswith("service"):
            showroom["serviceContact"] = answer
        elif item.startswith("welcome"):
            showroom["welcome"] = answer
        elif item.startswith("sales hand-off"):
            showroom["handoff"] = answer
    for key in ["location", "hoursWeek", "hoursSaturday", "hoursSunday", "salesContact", "serviceContact", "welcome", "handoff"]:
        if not showroom.get(key):
            sys.exit(f"B Showroom: no answer for {key}")

    # The saved map link Samer wrote into a Replies answer (B only says "send the saved link").
    maps = ""
    for row in wb["Replies"].iter_rows(values_only=True):
        for cell in row:
            m = re.search(r"https://maps\.app\.goo\.gl/[A-Za-z0-9]+", text(cell))
            if m:
                maps = m.group(0)
                break
        if maps:
            break
    if not maps:
        warnings.append("No maps.app.goo.gl link found in Replies — location goes without a map link")
    showroom["mapsLink"] = maps

    # Administration numbers, from the department menu Samer wrote (Replies row 3).
    admin = ""
    for row in wb["Replies"].iter_rows(values_only=True):
        for cell in row:
            m = re.search(r"Administration\s+([0-9 /]+)", text(cell))
            if m:
                admin = re.sub(r"\s+", " ", m.group(1)).strip()
                break
        if admin:
            break
    showroom["administration"] = admin

    body = json.dumps({"models": models, "showroom": showroom}, ensure_ascii=False, indent=2)
    OUT.write_text(
        "/**\n"
        " * GENERATED by scripts/sales-import-workbook.py from Samer's workbook\n"
        " * \"Monza-Bot-Reply-Worksheet-Master-Logic-Expanded.xlsx\" (A Car Facts, B Showroom).\n"
        " * Do not edit by hand: change the workbook and run the script again.\n"
        " *\n"
        " * Every value here was approved by Samer in that workbook (2026-09-17). A fact with\n"
        " * confirmed: false is one the workbook says is not stated: the bot says so, never guesses.\n"
        " */\n\n"
        f"export const WORKBOOK = {body} as const;\n",
        encoding="utf-8",
    )
    print(f"wrote {OUT}")
    for w in warnings:
        print("  -", w)
    for code, m in models.items():
        print(f"  colours in the workbook for {code}: {m['workbookColours'] or '-'} (the bot offers what the library holds)")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
