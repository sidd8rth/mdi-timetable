#!/usr/bin/env python3
"""Generate data.js for the MDI PGDM Term-IV personal timetable site.

Reads:
  - The weekly grid + elective list from the Word timetable (converted to .docx)
  - Per-course student lists (one .xlsx per course, one sheet per section)

Writes data.js with a global `TT_DATA` object consumed by index.html.
"""
import openpyxl, docx, glob, os, re, json

DOWNLOADS = "/Users/siporwal/Downloads"
XLSX_DIR = os.path.join(DOWNLOADS, "All Course wise student list attendance term 4 2025-26")
DOCX = "/tmp/Time Table-T4, PGDM, 2025-27 (1).docx"
OUT = os.path.join(os.path.dirname(__file__), "data.js")

# Course was renamed "Strategic Management-II" (SM-II) -> "Corporate Strategy and
# Implementation" (CSI). The grid mostly uses CSI but the elective table + one
# leftover cell still say SM-II, and the student file is SM-II.xlsx. Normalise all
# of these to a single canonical key.
CANON = {"SM-II": "CSI"}
def canon(a): return CANON.get(a, a)

# ---- 1. Course metadata from the elective list table -----------------------
COURSE_NAME = {}      # abbr -> full course name
COURSE_FACULTY = {}   # abbr -> set of faculty full names

d = docx.Document(DOCX)
grid_table, elective_table = d.tables[0], d.tables[1]

# locate columns by header (layout changed between timetable versions)
hdr = [x.text.strip().lower() for x in elective_table.rows[0].cells]
def colidx(*needles):
    for i, h in enumerate(hdr):
        if any(n in h for n in needles): return i
    return -1
CI_NAME = colidx("elective")
CI_ABBR = colidx("abb")
CI_FAC  = colidx("faculty (", "dr.")

for row in elective_table.rows[1:]:
    c = [x.text.strip() for x in row.cells]
    abbr = canon(c[CI_ABBR]) if 0 <= CI_ABBR < len(c) else ""
    name = c[CI_NAME] if 0 <= CI_NAME < len(c) else ""
    fac  = c[CI_FAC]  if 0 <= CI_FAC  < len(c) else ""
    if not abbr:
        continue
    name = re.sub(r"\s*\(Section[^)]*\)", "", name).strip()
    COURSE_NAME.setdefault(abbr, name)
    COURSE_FACULTY.setdefault(abbr, set())
    if fac:
        COURSE_FACULTY[abbr].add(fac)

# ---- 2. Parse the weekly grid ----------------------------------------------
SLOTS = [
    "8:30-10:00 AM", "10:15-11:45 AM", "12:00-1:30 PM",
    "2:15-3:45 PM", "4:00-5:30 PM", "5:45-7:15 PM",
]
DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]

# Known course abbreviations, longest first so e.g. FMIB wins over FM.
ABBRS = sorted(
    ["SM-II", "FMIB", "DIAA", "ETTA", "AGTB", "CRBV", "ENVC", "MBFI",
     "NMS", "PrM", "RTM", "MOQ", "SCM", "M&A", "CB", "FM", "IM", "DV",
     "PD", "IB", "LM", "CSI"],
    key=len, reverse=True,
)

def find_abbr(text, i):
    """If a known abbr starts at text[i] on a word boundary, return it."""
    if i > 0 and (text[i-1].isalnum()):
        return None
    for a in ABBRS:
        if text.startswith(a, i):
            # ensure the next char isn't an alnum that would extend the token
            j = i + len(a)
            if j < len(text) and text[j].isalnum():
                continue
            return a
    return None

def parse_cell(text):
    """Return list of {course, section, details} from a grid cell."""
    # locate every course-abbr occurrence; entries run until the next one
    marks = []
    i = 0
    while i < len(text):
        a = find_abbr(text, i)
        if a:
            marks.append((i, a))
            i += len(a)
        else:
            i += 1
    entries = []
    for k, (pos, abbr) in enumerate(marks):
        end = marks[k+1][0] if k+1 < len(marks) else len(text)
        seg = text[pos:end]
        rest = seg[len(abbr):]
        # section = a lone A-F in parentheses (faculty abbrs are 2+ chars)
        sec = None
        m = re.search(r"\(([A-F])\)", rest)
        if m:
            sec = m.group(1)
            rest = (rest[:m.start()] + " " + rest[m.start()+3:])
        details = re.sub(r"\s+", " ", rest).strip(" \n,-")
        # repair unbalanced "(" left by a missing line break in the source
        if details.count("(") > details.count(")"):
            details += ")"
        entries.append({"course": canon(abbr), "section": sec, "details": details})
    return entries

# meetings[course][section or ""] = list of {day, slot, details}
meetings = {}
for ri, row in enumerate(grid_table.rows[1:]):  # skip header
    day = DAYS[ri] if ri < len(DAYS) else row.cells[0].text.strip()
    for ci in range(1, 7):
        cell = row.cells[ci].text
        for e in parse_cell(cell):
            meetings.setdefault(e["course"], {}).setdefault(
                e["section"] or "", []
            ).append({"day": day, "slot": ci-1, "details": e["details"]})

# ---- 3. Parse student lists -------------------------------------------------
# Filename (without ext) -> grid abbreviation. Mostly identical.
FILE_TO_ABBR = {"PRM": "PrM", "SM-II": "CSI"}  # everything else maps to itself

students = {}  # roll -> {name, courses: [{course, section}]}

def norm_section(sheet):
    m = re.search(r"Section\s+([A-F])", sheet, re.I)
    return m.group(1).upper() if m else None

for f in sorted(glob.glob(os.path.join(XLSX_DIR, "*.xlsx"))):
    base = os.path.splitext(os.path.basename(f))[0]
    abbr = FILE_TO_ABBR.get(base, base)
    if abbr not in meetings:
        print(f"WARN: course {abbr} ({base}) not found in grid; sections seen: {list(meetings.keys())}")
    wb = openpyxl.load_workbook(f, data_only=True)
    for ws in wb.worksheets:
        sec = norm_section(ws.title)
        for r in ws.iter_rows(min_row=2, values_only=True):
            if r is None or len(r) < 3:
                continue
            roll, name = r[1], r[2]
            if not roll or not name:
                continue
            roll = str(roll).strip()
            name = str(name).strip()
            if not re.match(r"^\d*P?\d", roll) and not roll.upper().startswith("25P"):
                # skip stray non-roll rows
                if not re.match(r"^25P\d+$", roll):
                    continue
            st = students.setdefault(roll, {"name": name, "courses": []})
            # keep a non-empty name if one row had it blank
            if name and not st["name"]:
                st["name"] = name
            st["courses"].append({"course": abbr, "section": sec})

# ---- 4. Emit data.js --------------------------------------------------------
course_meta = {
    a: {"name": COURSE_NAME.get(a, a), "faculty": sorted(COURSE_FACULTY.get(a, []))}
    for a in meetings
}

data = {
    "slots": SLOTS,
    "days": DAYS,
    "courses": course_meta,
    "meetings": meetings,
    "students": students,
}

with open(OUT, "w") as fh:
    fh.write("window.TT_DATA = ")
    json.dump(data, fh, ensure_ascii=False, indent=1)
    fh.write(";\n")

print(f"Wrote {OUT}")
print(f"  courses: {len(course_meta)}  students: {len(students)}")
print(f"  total enrollments: {sum(len(s['courses']) for s in students.values())}")
