# MDI PGDM 2025-27 · Term-IV Personal Timetable

An interactive, static website where a student searches their **name or roll number**
and instantly sees their personalised weekly timetable — plus a **friends compare** view
and a **login-backed attendance tracker**. Built automatically from the official Term-IV
time table and the course-wise student lists.

🔗 **Live site:** _add your GitHub Pages URL here once published_

## Features

- **📅 Timetable** — search any student → colour-coded weekly grid + day-by-day agenda,
  with a legend of course names, sections and faculty.
- **👥 Friends** — add up to 5 classmates and see an overlap grid: who has class when and
  where, with green “all free” slots highlighting good times to meet. Friends are remembered
  on your device.
- **✅ Attendance** — create an account with your **@mdi.ac.in email + password** and your
  **roll number** (only institute emails allowed). You then see only *your own* courses, and
  mark each dated class Present / Absent / Cancelled across the term. Live attendance % per
  course (green ≥75 %, amber ≥60 %, red below), synced to the cloud across devices.
- **🌙 Light / dark theme** toggle (top-right), remembered between visits.

> Until Firebase is configured, the attendance tracker still works — it just saves locally on
> the device with no login. Add your keys (below) to switch on login + cross-device sync.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Layout, styles, tabs. |
| `app.js` | All app logic (timetable, friends, attendance, theme). |
| `firebase-config.js` | **Edit this** to enable login + cloud sync. |
| `data.js` | Generated data: courses, weekly meetings, student enrollments. |
| `build.py` | Regenerates `data.js` from the source `.doc` / `.xlsx`. |

## Deploy to GitHub Pages

```bash
git init
git add index.html app.js firebase-config.js data.js README.md
git commit -m "MDI Term-IV personal timetable"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

Then on GitHub: **Settings → Pages → Source: Deploy from a branch**, pick `main` / `root`,
save. Live at `https://<you>.github.io/<repo>/` within a minute.

## Enabling login + attendance sync (Firebase — free)

The attendance tracker uses **Firebase Authentication + Cloud Firestore**, both free on the
Spark plan, which is plenty for a class. One-time setup (~10 min):

1. **Create a project** at <https://console.firebase.google.com> → *Add project*.
2. **Register a web app**: click the `</>` icon. Firebase shows a `firebaseConfig = {…}`
   object — copy its values into `firebase-config.js`.
3. **Enable sign-in**: Build → Authentication → *Get started* → enable **Email/Password**.
   (Google is intentionally not used. Sign-up is restricted client-side to `@mdi.ac.in`
   addresses, and each account is bound to the roll number entered at sign-up.)
4. **Create the database**: Build → Firestore Database → *Create database* (Production mode).
   Open the **Rules** tab and paste this (it restricts each user to their own document **and**
   enforces the `@mdi.ac.in` domain on the server too):

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid} {
         allow read, write: if request.auth != null
           && request.auth.uid == uid
           && request.auth.token.email.lower().matches('.*@mdi[.]ac[.]in');
       }
     }
   }
   ```
   Click **Publish**.
5. **Authorize your domain**: Authentication → Settings → *Authorized domains* → add your
   Pages domain, e.g. `yourname.github.io`. (`localhost` is already allowed for testing.)

That's it — reload the site and the Attendance tab will show a sign-in screen. Each user's
roll + attendance is stored privately at `users/{their-uid}`.

> **Note:** the Firebase web config (apiKey etc.) is *meant* to be public — it only
> identifies the project. Access is controlled by the Firestore rules above, which restrict
> every user to their own document.

## Regenerating the data

If the time table or student lists change, update the paths at the top of `build.py` and run:

```bash
# convert the .doc to .docx first (uses LibreOffice):
soffice --headless --convert-to docx --outdir /tmp "Time Table-T4, PGDM, 2025-27.doc"
python3 build.py
```

Requires `python3` with `openpyxl` and `python-docx`.

---
*Rooms, sections and faculty are shown exactly as scheduled. The attendance tracker assumes a
weekly class on each scheduled slot from 15 Jun to 6 Sep 2026 — mark holidays/off days as
“Cancel”. Always verify against official notices.*
