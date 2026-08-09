# Firebase Integration — Design Spec

**Date:** 2026-07-11
**Status:** Approved for planning

## Purpose

Add three capabilities to the single-file trip planner (`index.html`) using Firebase:

1. **Accounts** — so a user's trips sync across devices.
2. **Trip sharing via invite codes** — so multiple people can collaborate on the same trip, with different permission levels.
3. **Google Analytics** — basic page-view tracking.

The app today is a single static `index.html` with no build step, all state in `localStorage`, supporting multiple trips per browser, JSON export/import, and a base64-encoded share-link. It's hosted externally (GitHub Pages or similar) — this project does not set up Firebase Hosting.

## Non-goals

- No real-time collaborative editing (no live cursors / `onSnapshot` listeners driving the UI). Sync happens on load/save/manual refresh.
- No build tooling introduced. Firebase is loaded via CDN `<script type="module">` directly in `index.html`, matching the existing single-file convention.
- No Cloud Functions. All logic runs client-side, governed by Firestore Security Rules, so the project stays on the free Spark plan (no billing account required).
- No custom Analytics events — only the automatic `page_view`.

## Architecture

### SDK loading

Firebase modular JS SDK (v10+), loaded via `<script type="module">` pointing at `https://www.gstatic.com/firebasejs/10.x.x/firebase-*.js`, added inline in `index.html`. No npm, no bundler. The existing classic `<script>` block stays as-is; the new Firebase logic lives in its own `type="module"` script block that talks to the existing app via a small set of functions (module scripts execute after the DOM is parsed, same as `defer`).

### Services used

- **Firebase Authentication** — Anonymous, Google, and Email/Password providers.
- **Cloud Firestore** — trip storage.
- **Firebase Analytics** (gtag under the hood) — automatic `page_view` only.

## Auth model

- On first load, the app signs the user in anonymously (`signInAnonymously`) if there's no existing session. This gives every visitor a stable `uid` immediately, with zero friction — matching today's "just start using it" experience.
- The UI exposes "Sign in with Google" / "Sign in with email" as an **upgrade**, using Firebase's account-linking (`linkWithCredential` / `linkWithPopup`) so the anonymous account's data and trip memberships carry over rather than starting fresh.
- If the user never upgrades, the app keeps working fully (including creating/joining trips) under the anonymous `uid`, but that identity is tied to the current browser/device — clearing site data loses access. The UI should surface a light nudge about this (e.g., a dismissible note), not a blocker.
- Email/password sign-up needs the standard create/sign-in/forgot-password UI; anonymous → email linking must handle the "email already in use" case by falling back to sign-in and prompting the user to decide which account's data to keep (last write wins is acceptable for v1 — this is a low-stakes hobby app).

## Data model (Firestore)

```
trips/{tripId}
  name: string
  startDate: string
  currency: string
  days: array            // same shape as today's local state
  packing: array
  attractionIdeas: array
  members: { [uid]: "owner" | "editor" | "viewer" }   // multiple uids can be "owner"
  createdAt: timestamp
  updatedAt: timestamp

tripCodes/{code}
  tripId: string
  role: "owner" | "editor" | "viewer"
```

- `code` is a random unguessable string (e.g. 8-10 alphanumeric chars), generated client-side when a trip is created and whenever a code is regenerated/revoked.
- Each trip has exactly three live codes at a time (one per role), stored as documents in the top-level `tripCodes` collection, plus mirrored under `trips/{tripId}.codes.{role}` for the owner UI to display/copy them.
- `tripCodes` documents are fetched by exact document ID only (`getDoc`), never listed/queried — this is what keeps the codes effectively secret even though the collection itself is broadly readable-by-ID.

### Join-by-code flow (client + Security Rules only)

1. User enters a code in the UI.
2. Client does `getDoc(tripCodes/{code})`. If missing, show "invalid code."
3. Client writes to `trips/{tripId}`, setting `members.{uid} = { role, viaCode: code }` (storing the code used alongside the role, *within the member entry itself*, so the security rule can verify it).
4. **Security rule** for updating `trips/{tripId}.members`: allow the write only if the only changed key is the caller's own `uid`, and a `get()` on `tripCodes/{that member entry's viaCode}` confirms `tripId` and `role` match. This means a client cannot self-assign a role without presenting a code that actually grants it — Firestore rules re-validate server-side regardless of what the client claims.
5. Any member who can read the trip doc can see all three invite codes (accepted trade-off, see below) and the `viaCode` values of other members. This is fine for a friends/family trip-planning tool; it is **not** a system that isolates roles from each other adversarially within a trip.

### Role permissions

- **owner**: full read/write on trip content, can add/remove other members (of any role) and regenerate codes. Multiple owners are allowed — the trip creator is simply the first owner.
- **editor**: full read/write on trip content (days, activities, hotel, packing, attraction ideas). Cannot remove members or regenerate codes.
- **viewer**: read-only.

### Security Rules sketch

```
match /trips/{tripId} {
  allow read: if request.auth.uid in resource.data.members;

  allow create: if request.auth != null; // creator writes members = { uid: "owner" } themselves

  allow update: if request.auth != null && (
    // normal content edit by an existing owner/editor, membership map untouched
    (resource.data.members[request.auth.uid] in ['owner','editor']
      && request.resource.data.members == resource.data.members)
    ||
    // joining via code: only the caller's own membership entry may change
    (onlySelfMembershipChanged() && joinCodeIsValid())
    ||
    // owner managing members/codes
    (resource.data.members[request.auth.uid] == 'owner')
  );
}

match /tripCodes/{code} {
  allow get: if request.auth != null;   // exact-ID lookup only
  allow list: if false;                  // never enumerable
  allow write: if request.auth != null && request.auth.uid in get(/databases/$(database)/documents/trips/$(request.resource.data.tripId)).data.members
    && get(/databases/$(database)/documents/trips/$(request.resource.data.tripId)).data.members[request.auth.uid] == 'owner';
}
```

(Exact rule syntax to be finalized during implementation — this sketch establishes the intended access boundaries for the plan.)

## Sync behavior

- Autosave-on-change, same as today's `saveState()`, but writing to Firestore (`setDoc`/`updateDoc`) instead of (or in addition to) `localStorage`.
- No live listeners. When a user opens/switches to a trip, the app fetches the latest doc. A manual "רענן" (refresh) affordance re-fetches. This mirrors the current mental model (autosave note already says "changes save automatically to your device").

## Migration from localStorage

- On first authenticated session (including anonymous), if `localStorage` has trips from the existing `triplan-trips-index-v1` scheme, the app uploads each one to Firestore as a new `trips/{tripId}` document with `members = { [uid]: "owner" }`.
- After a successful upload, `localStorage` keeps functioning as a local cache/fallback (e.g., offline reads), but Firestore becomes the source of truth going forward. The existing legacy-migration function (`migrateLegacyStorage`) is a useful precedent for how this project already handles one-time data migrations.

## Analytics

- Add the standard Firebase Analytics/gtag snippet. Automatic `page_view` on load. No custom event instrumentation in this iteration.

## What stays the same

UI, styling, RTL layout, JSON export/import, print/PDF export — unchanged. Firebase is an additive data/identity layer underneath the existing app shell.

## Firebase project setup (manual steps, done by the user)

1. Create a Firebase project in the console.
2. Register a Web App, get the config snippet (apiKey, projectId, etc.).
3. Enable Authentication providers: Anonymous, Google, Email/Password.
4. Create a Firestore database (production mode, then apply the security rules above).
5. Enable Google Analytics for the project (can be done at project creation or after).
6. Add the app's actual hosting domain (GitHub Pages domain, custom domain, etc.) to the Auth "Authorized domains" list.

These steps require the user's own Google/Firebase account access and will be walked through interactively (not something this session can do on the user's behalf).

## Testing approach

No test framework exists in this project (plain static HTML/JS). Verification will be manual, in a browser, covering:

- Anonymous sign-in happens transparently; trips work with no explicit login.
- Google and email/password sign-in link to the anonymous account without losing data.
- Creating a trip produces owner/editor/viewer codes; joining with each code grants the right permissions (verified by attempting a disallowed action, e.g. a viewer trying to edit).
- Multiple owners: a second account joining via the owner code can also manage members.
- localStorage → Firestore migration runs once on first login and doesn't duplicate trips on subsequent logins.
- Analytics page_view fires (checked via the Firebase Analytics DebugView or browser network tab).
