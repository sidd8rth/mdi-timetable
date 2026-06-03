// ───────────────────────────────────────────────────────────────────────────
//  FIREBASE CONFIG  —  edit this file to turn on login + cloud attendance sync.
// ───────────────────────────────────────────────────────────────────────────
//
//  Until you fill this in, the site still works: attendance is saved locally on
//  the device (no login). Once you paste a real config below, the Attendance
//  tab switches to Google / email login and syncs across devices.
//
//  How to get these values (one-time, ~10 min, free):
//   1. Go to https://console.firebase.google.com  →  "Add project".
//   2. In the project, click the </> (Web) icon to "register an app".
//      Firebase shows you a `firebaseConfig = { ... }` object — copy its values
//      into the object below.
//   3. Left menu → Build → Authentication → Get started →
//      enable "Email/Password" sign-in. (Sign-up is restricted to @mdi.ac.in
//      addresses; users enter their roll number when creating an account.)
//   4. Left menu → Build → Firestore Database → Create database (Production mode).
//      Then Rules tab, paste the rules from README.md, Publish.
//   5. Authentication → Settings → Authorized domains → add your GitHub Pages
//      domain, e.g.  yourname.github.io   (localhost is already allowed).
//
//  Leave apiKey as "" to keep running in local-only mode.

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBDwd-8FhU65iVd9cV1hbxHwGrGPB0rRKs",
  authDomain: "mdig-att-tt-tracker.firebaseapp.com",
  projectId: "mdig-att-tt-tracker",
  storageBucket: "mdig-att-tt-tracker.firebasestorage.app",
  messagingSenderId: "118704068986",
  appId: "1:118704068986:web:46a0f0ab0d2b496f535ec3",
  measurementId: "G-7LV4F9KR8K"
};
