# Prompt: take triplan to the level of the biggest travel apps

You are upgrading triplan, a Hebrew (RTL) trip planner. The goal is a product that a 75-year-old who is not comfortable with computers can use to plan a trip alone, without asking anyone for help, and that a heavy planner with 14 days, 6 friends and 80 ideas can work in faster than in Wanderlog. It is one app for both of them, not two versions.

The bar is the best consumer apps you know: every screen feels obvious, fast and finished. This document tells you exactly what to change and what to add. Everything listed here is the minimum, not the target. You are expected to go well beyond it with your own ideas; section 7 says how.

Element ids and function names below come from `index.html` as it is today. Confirm them against the code before you edit, because line numbers move.

All user-facing text in the app stays in simple, everyday Hebrew. This prompt is in English only for your benefit.

## 1. What exists today

- One file, `index.html` (about 6,500 lines, plain JS, no framework), using Firebase (Firestore, Google and email sign-in), Leaflet, html2pdf, geolib, Gemini, and `sw.js`.
- Tabs in `#mainTabs`: Days (`#panelDays`), Ideas (`#ideasSection`), Budget and documents (`#budgetSection`), Packing and flight prep (`#packingSection`), and a hidden "Abroad tools" tab (`#toolsSection`) with sign translation from a photo, a trip journal and the meridian tool.
- The data model is defined in `newActivity`, `newDay`, `newAttractionIdea`, `newDayGroup`, `newDocument` and the `normalize*` functions. Each trip is one document in `trips`; the packing list is stored separately per user.
- Already built: sharing with per-role codes (`fbJoinByCode`, `applyRoleRestrictions`), suggestions between members and an activity feed, a map, weather, multiple currencies, AI day planning and schedule checking, grouping ideas into days by distance (`autoGroupIdeas`), a touring plan by hours (`computeIdeasTouringPlan`), filling a document from pasted text (`#aiImportDocBtn`), an AI chat that also sends images, and PDF and JSON export.
- `mcp/` is an MCP server that reads and writes the same data. The data model and `firestore.rules` are a contract shared with it.

Run the app and walk through it yourself on mobile and desktop before deciding anything. Recent screenshots are in `.playwright-mcp/`.

## 2. The core problem

The app is rich in features but shows all of them at once. A new user sees a form, not a trip. This is exactly what people complain about in travel apps ("it almost seems to have made planning more complicated", "family isn't tech savvy"). Simplicity is the feature the market is missing.

## 3. What to change in what exists

**3.1 Top bar (`#accountBar` and the row below it)**
- Today one row holds sign-in, the display name, the trip selector, `#newTripBtn`, `#archiveTripBtn`, `#deleteTripBtn`, `#sharingPanelToggle`, a code field and `#joinCodeBtn`.
- Keep three things visible: the trip name (tapping it opens the trip list), a "Share" button, and the account avatar.
- Archive, delete, "show archive" and join-by-code move into the trip's "More" menu. "Connect Claude" and sign-out move into the account menu.
- "New trip" sits at the top of the trip list.

**3.2 Activity card (`buildActivityRow`)**
- Today an empty activity shows every field. Make it collapsed by default: one row with time, name and category icon, and under it a summary of what is filled in (cost, duration, "needs booking").
- Tapping opens editing. Editing shows only name, time and category. The other fields (per `ACTIVITY_CATEGORY_FIELDS`) sit behind "More details", and any field that has a value is always shown.
- A "Fill it in for me" button next to the name: Gemini suggests duration, opening hours, address and estimated cost, and shows them for approval before saving. Never write an AI value without approval.
- A new day does not open with an empty activity (`newDay` creates `[ newActivity() ]` today). It opens with an empty state and two large buttons: "Add activity" and "Plan this day for me".
- The "priority 1-10" field becomes three choices: must, want, if there's time. Store 9, 6 and 3 so existing trips and the MCP keep working.
- The transport list (`TRANSPORT_OPTIONS`) changes from a dropdown to a row of buttons, each with an icon and a word.

**3.3 Trip header card (name, date, currencies, budget)**
- Show only the name, dates and number of days. Main currency, second currency and budget move to "Trip settings".
- Replace empty counters ("destinations 0") with a countdown ("23 days to go") and what is missing ("2 days have no place to stay yet").

**3.4 Lodging card**
- Today it is open on every day. Collapse it to one row ("Staying at: hotel name" or "Add a place to stay") that opens on tap.
- "Apply from yesterday" stays, with clear wording: "Same hotel as yesterday".

**3.5 Bottom action row**
- Today `#clearAll` ("clear everything") sits next to print, `#exportPdfBtn`, `#exportJsonBtn`, import and `#shareLinkBtn`. Move all of them into the trip's "More" menu, and move "clear everything" to the end of settings behind a confirmation that requires typing the trip name.
- `#shareLinkBtn` creates a copy of the trip (`checkSharedLink` reads `#d=`). Rename it "Send a copy", and add a real join link (section 4.6).

**3.6 Dialogs and wording**
- Replace every `confirm()` and `alert()` with an in-app dialog with large buttons in plain language ("Delete this day?" / "Yes, delete" / "No").
- AI buttons are marked today with 🤖 and purple. Unify them under one consistent marker with words that say what will happen ("Plan this day for me", "Check this day makes sense").
- Emoji used as button icons are replaced with line icons from `ICONS`, always with a word next to them.
- Words to remove from the main screens: JSON, sync, cache, "stored on this device". Use "Saved" and "Back up to a file" instead.

**3.7 Exchange rates**
- `EXCHANGE_RATES` is hardcoded. Fetch current rates once a day from a free source that needs no key, store them locally with their date, and fall back to the fixed table when offline. Show "rate from <date>".

**3.8 Tabs**
- Turn "Abroad tools" into an "On the trip" tab that appears automatically from the departure date (section 4.2). On mobile, a bottom bar with at most five tabs, each with an icon and a word.

**3.9 Working without internet**
- Data is already persisted (`persistentLocalCache`) and `sw.js` caches `index.html`, but the CDN libraries, fonts and map tiles are not cached. Extend `sw.js`: precache Leaflet, html2pdf, geolib and the font files, and cache map tiles that have been viewed.
- Add a "Download this trip for use without internet" button in "On the trip" that saves the map tiles around all trip destinations and shows progress.
- A quiet strip, "No internet. Your changes will be saved when you're back", instead of an error message.

**3.10 Visual craft and speed**
- One design system: a single type scale, spacing scale, radius, and color roles used everywhere. Remove one-off styles.
- Every empty state has a short sentence and one clear next action. Every loading state has a skeleton, not a spinner on a blank page.
- Motion is short and purposeful (a card opening, an item moving to another day) and is disabled under `prefers-reduced-motion`.
- The first screen is usable in under 2 seconds on a mid-range phone on 4G. Load html2pdf and Leaflet only when the user needs them. Typing in a field never lags, even on a 14-day trip; `render` should update only what changed.
- Make it installable: a web app manifest, icons, and a gentle "add to home screen" hint after the second visit.

## 4. What to add

**4.1 Guided start**
- With no trips: a screen with one question, "Where are you going?", then "When?" and "Who is travelling?" (couple, family with kids, with older adults, friends). One step per screen, a large "Next" button, skippable.
- At the end: "Want me to build a suggested trip?" creates days with suggested activities that can be approved or removed one by one, or "I'll start on my own" opens an empty trip.
- A microphone button on free-text fields (Web Speech API in Hebrew), hidden in browsers that do not support it.
- New trip fields: `pace` (`relaxed`, `normal`, `fast`) and `travelers` (`kids`, `seniors`). AI day planning and schedule checking receive them.

**4.2 "On the trip" mode**
- During the trip dates the app opens on today.
- A large "Now" card and a "Next" card with the time, estimated travel time, a "Navigate" button that opens the device's maps app, and a "Show confirmation" button when a document is linked.
- Mark an activity "Done" (field `done`), or "We skipped it", which offers to move it to another day.
- A "We're running late" button: shifts the rest of the day and marks what no longer fits within opening hours.
- The existing tools (sign translation, meridian, journal) stay here.

**4.3 Importing booking confirmations**
- Extend `#aiImportDocBtn` to accept a screenshot, photo or PDF, not only pasted text (sending `inlineData` to Gemini already exists in the chat).
- After extraction show "Here's what I found" with editable fields, and offer to also create the matching activity or lodging on the right day, linked to the document.
- Document attachments support only text today (`attachmentText`). Images and PDFs need file storage. Show me the options (Firebase Storage, or local-only storage) and what each costs before you choose.

**4.4 The map as a workspace**
- Desktop: a split view of the day's list and the map, with matching numbers. Mobile: a button that switches between list and map.
- A route line between activities in order, and walking or driving time between each pair shown inside the list. Start with an estimate from straight-line distance (`haversineKm` exists) and label it as an estimate.
- An "Order by shortest route" button for a day that leaves activities with a fixed time or advance booking in place, and shows before and after for approval.
- A warning when an activity falls outside its opening hours.

**4.5 Deciding as a group**
- Voting on ideas: a `votes` field on the idea (`{uid: 1 | -1}`), large "Want it" and "Not so much" buttons, and sorting by what the group wants.
- A "Quick vote" mode: one idea on screen at a time with two buttons. Swiping is an extra, never the only way.
- "Build a plan from the votes": feeds the top ideas into the existing `autoGroupIdeas` and `computeIdeasTouringPlan`.
- A simple poll for open questions ("Where do we eat on Tuesday?"), with the result written to the activity feed.

**4.6 Joining by link**
- A `?join=<code>` link that runs `fbJoinByCode` after sign-in, with no code to type. One share button that opens the device's share sheet, plus a QR code.
- Someone who arrives from a link and is not signed in sees one screen: "You've been invited to trip X" and a "Join with Google" button.

**4.7 Expenses and splitting**
- A new collection on the trip: `expenses`, each `{id, title, amount, currency, paidBy, splitWith[], dayId, activityId, createdAt}`.
- Quick add: amount, who paid, who shares it (default: everyone, equally).
- A "Who owes whom" screen that settles up in the fewest transfers, in the home currency.
- The existing budget (`updateStats`) shows planned against actual.

**4.8 Calendar export**
- Export an ICS file for the whole trip or one day, with the destination's time zone, location and a link back to the trip.

**4.9 Undo**
- An undo stack for every change (at least 20 steps) on top of `saveState`. After a delete, a "Deleted" message with an "Undo" button stays for at least 8 seconds. Ctrl+Z on desktop.

**4.10 After the trip**
- Extend the existing journal (`#generateJournalBtn`): a summary page with the route on a map, numbers (days, places, kilometres, actual cost) and a read-only share link.
- "Duplicate as a template" creates a new trip with the same structure, without dates or expenses.

**4.11 Finding places while typing**
- Typing an activity or idea name shows matching real places (start with the free geocoder behind `geocodeQuery`). Picking one fills the name, address and coordinates.
- Pasting a Google Maps link anywhere creates the place (`coordsFromGoogleMapsLink` exists).
- Register the installed app as a Web Share Target, so "Share" from Google Maps, Instagram, TikTok or a browser sends the link straight into the trip's ideas.

**4.12 Paste a whole itinerary**
- "I already have a plan": paste any text (a blog post, a WhatsApp message, a ChatGPT answer, an agency itinerary) or upload a PDF, and Gemini turns it into days and activities shown for approval before saving.

**4.13 Reminders**
- A "To book" list built from activities with `booking: true` and no confirmation, sorted by how soon they are needed.
- Reminders for: bookings still open, online check-in 24 hours before a flight, packing items with `dueDaysBefore`, and an evening "Tomorrow" brief with the first activity, when to leave and the weather.
- Start with in-app and local notifications (`ensureNotificationPermission` exists). Push while the app is closed needs Firebase Cloud Messaging; show me what it takes before adding it.

**4.14 Weather-aware plan**
- Extend `loadWeatherForDay`: when rain or extreme heat is forecast for a day with outdoor activities, offer to swap it with another day, or suggest indoor alternatives nearby. Always a suggestion with before and after.

**4.15 Walking-load meter**
- Each day shows total hours on your feet and estimated kilometres, colored against the trip's `pace` and `travelers`. With `seniors` or `kids`, offer to add rest breaks and flag days with no meal planned.

**4.16 Time zones**
- Flight and booking times are shown in the local time of each place, with "home time" beside them during the trip. A day with a time change says so at the top.

**4.17 "Show the driver" card**
- A full-screen card for any activity or hotel: the name and address in very large type in the local language and script, with a "Call" button if there is a phone number. Works offline.

**4.18 Essentials and emergency card**
- One offline screen per trip: local emergency numbers, the nearest Israeli embassy or consulate, travel insurance policy and phone, hotel address for today, blood type, medications and allergies (optional, stored in the user's private data like the packing list, never in the shared trip).
- A passport validity check against the trip dates, and a visa and entry-requirements note for the destination. AI-generated notes are labelled "check with the official source" and link to it.

**4.19 Phrasebook**
- Next to the existing sign translation: 30 useful phrases in the destination language with large text and audio (`speechSynthesis`), plus a two-way "say it for me" translator. Saved for offline use.

**4.20 Planning for someone else**
- A "helper" can build the trip for a parent or grandparent. The traveller gets the same trip in a simplified view: today, next, navigate, show confirmation, call the helper.
- A "Ask my family" button on any screen sends a question with a screenshot of the current screen to the trip members, using the existing suggestions channel.

**4.21 Comments and reactions**
- A short comment thread and quick reactions on every activity and idea, with mentions of members, written to the existing activity feed.

**4.22 Finding each other on the trip**
- Opt-in live location among trip members for a chosen period (it turns itself off), and a "Meet here" pin that everyone can navigate to. Build on the location check-in code in the meridian tool. Never on by default.

**4.23 Photos and memories**
- Add photos to a day or activity; they feed the journal and the after-trip summary (4.10). This depends on the storage decision in 4.3.

**4.24 Money on the trip**
- A quick converter in "On the trip" between the local and home currency with large digits, a tip calculator with the local custom, and a daily "how much cash to carry" estimate from the day's planned costs.

**4.25 Departure and return checklists**
- A "Leaving home" checklist on departure day (passport, chargers, gas, windows, water the plants) and a "Leaving the hotel" one on each checkout day (safe, chargers, fridge). Editable, saved per user as templates.
- Packing lists get per-person templates that can be reused across trips, and AI packing suggestions follow the actual activities and forecast.

**4.26 Version history**
- A daily snapshot of the trip and one before every AI bulk change or import, with "Restore" in settings. In a shared trip this is the safety net against one member breaking the plan.

**4.27 Printable booklet**
- A large-print PDF for people who prefer paper: one page per day with times, addresses in the local script, a QR code per activity that opens navigation, and the essentials card on the first page.

**4.28 More languages**
- Move all interface text into one dictionary and add English, then Arabic and Russian, with RTL and LTR handled by the same layout. Each member chooses their own language in a shared trip.

**4.29 Trip gallery**
- Publish a finished trip as a read-only template (personal details, costs and documents stripped), and start a new trip from a template, your own or one shared by link.

**4.30 Ready-to-go score**
- One screen before departure: what is missing (nights with no lodging, unbooked items, passport validity, insurance, unassigned tickets, offline download) with a button that fixes each.

**4.31 Destination card**
- Per destination: tipping, plugs and voltage, tap water, SIM and eSIM options, common scams, dress codes, and public holidays or closures that fall on your dates. AI-written, labelled, with sources and a date.

**4.32 "Is everything still open?" check**
- A week before the trip, re-check opening hours and closure days for every planned place against the actual dates, and list conflicts with a suggested fix.

**4.33 Kosher, Shabbat and dietary needs**
- Dietary needs per traveller (kosher, vegetarian, allergies) that the AI planner and restaurant ideas respect.
- Shabbat and holiday times computed for each destination and date, shown on the day, and an option to keep those days free of bookings, driving and paid activities.

**4.34 Book-ahead warnings**
- Flag sights that usually sell out or need timed entry, with how far ahead to book, as soon as they enter the ideas list.

**4.35 Light and timing**
- Sunrise, sunset and daylight hours on each day, used by the schedule checker for outdoor activities.

**4.36 Jet lag and arrival day**
- A light first-day template after long flights, and a sleep suggestion for the days around a large time change.

**4.37 Travelling with children**
- Nap windows as protected time blocks, stroller-friendly and playground notes on places, and a limit on consecutive "adult" activities.

**4.38 Passes and price comparisons**
- Given the plan, estimate whether a city pass, museum pass or rail pass pays for itself, and compare taxi against public transport for the group size. Show the arithmetic.

**4.39 Ask the trip**
- Extend the AI chat to answer from the trip's own data ("when is check-out in Florence?", "what have we not booked?") with links to the items, and to act only after showing the change.

**4.40 Hands-free**
- "What's next?" read aloud (`speechSynthesis`), and voice commands for the common actions in "On the trip".

**4.41 Who is here now**
- Show who else is viewing or editing, and which item, building on `isEditingSomething`. When two people edit the same item, keep both versions and ask.

**4.42 View without an account**
- A read-only link anyone can open without signing in, with the owner able to switch it off.

**4.43 Duplicates and tidy-up**
- Detect duplicate ideas and offer to merge them. A "Tidy my ideas" action that fixes names, fills missing coordinates and groups by area, shown for approval.

**4.44 Shopping and gifts**
- A shopping and gifts list per trip with who each gift is for, and a VAT refund reminder at the right airport.

**4.45 Across trips**
- A personal map and statistics of all trips, a yearly recap, and an expense report export per trip.

**4.46 Automatic backup**
- An optional scheduled backup of all trips to a file the user keeps, with a clear "Restore from backup".

## 5. Accessibility and comfort for older adults

This is based on Nielsen Norman Group's usability research with people aged 65 and over, and on a systematic review of 27 guidelines for mobile apps. The two guidelines that matter most are to simplify, and to increase the size of controls and the distance between them. Older users also do not learn by trial and error; they need explicit steps, and when something fails they blame themselves.

- Body text at least 18px, labels at least 16px, no text below 14px. All sizes in `rem` so the browser's font-size setting works.
- A "Text size" setting with three levels (normal, large, very large), saved per user.
- Contrast of at least 4.5:1 for text and 3:1 for the borders of fields and buttons. Light grey placeholder text does not count as a label: every field has a permanent label above it.
- Touch targets at least 48×48px with 8px between them. The small icon buttons (`.icon-btn`, the delete bins) grow to match.
- The delete bin never sits next to a common action, and always comes with undo.
- Every drag, swipe or long press has a visible button that does the same thing ("Move up", "Move to another day").
- Date and time pickers: check they are comfortable on mobile, and add shortcuts ("morning", "noon", "evening").
- Long dropdowns (currencies) become a searchable list with the trip's currencies at the top.
- Every icon button gets an `aria-label`, dialogs get `role="dialog"` and a focus trap, messages (`showToast`) get `aria-live`. There is almost no `aria` in the file today.
- Visible focus on every control, and a Tab order that makes sense in RTL.
- Error messages say what to do now and do not blame ("We couldn't save. Try again in a moment"), with no error codes.
- Respect `prefers-reduced-motion` and dark mode.
- A permanent "Help" button that explains the current screen in three steps and points to the existing AI chat (`#aiChatFab`), worded "Ask me anything".

## 6. Tools for expert users

These never sit in a beginner's path, but they are always one click or one shortcut away.

- A command palette on Ctrl+K: search the whole trip (activities, ideas, documents) and run any action.
- Shortcuts: `N` new activity, `D` new day, `J`/`K` move between days, `1`-`5` tabs, `/` search, `?` the shortcut list.
- Multi-select for activities or ideas, then move, delete or change category for all of them.
- Duplicate a day and duplicate an activity. Drag an activity between days.
- A weekly timeline view alongside the list view.
- One-line quick add: "10:30 Louvre 2 hours 17€" is parsed into fields.
- Filter and sort ideas by any field, including votes and distance from the hotel.
- Display density (comfortable, normal, compact) in settings.
- The MCP connection is presented in settings as a feature, with a short explanation of what you can ask Claude to do.

## 6A. Veteran travellers who plan without apps

A third audience: people who have planned many trips with a spreadsheet, Google My Maps, a notes file and printouts, and see no reason to change. They will only switch if the app does everything their own system does, faster, and never gets in the way.

What they actually do today, from their own descriptions (a travel blogger's Sheets and My Maps system, App Store reviews of Wanderlog, and a Rick Steves forum thread of experienced travellers):

- A spreadsheet with a general tab (flights, lodging, addresses, transport), a running list of food and sights everyone adds to, a tab per day with times, why they want to go, opening hours and transport notes between stops, and an expenses tab. What they like: "all the information at once", any column they want, and moving rows between days easily.
- A Google My Map of every idea, used to group nearby places into days and avoid backtracking.
- Bookings still to make written in red with a due date, and paid or booked items in bold. Costs in both the foreign currency and their own.
- Transit written out by hand: kilometres and driving time from A to B, or the starting station, number of stops and exit station.
- Printouts, binders and 30 to 40 page booklets, because they do not trust battery, signal or a phone. QR codes of tickets screenshotted into a photo album.
- Calendar entries with addresses, links and PDF attachments.
- Six to eight trips planned one to two years ahead, plus loose notes for dozens more.
- Why apps failed them: email import that did not accept their emails, printing that looks worse than a sheet, route ordering done by hand, export locked behind payment, and apps that "want to budget my trip, know about my car, invite everyone" until planning feels more complicated. Several still kept a spreadsheet next to the app.

Build for them:

**6A.1 Table view**
- The whole trip in one grid, every day visible, one row per activity, with inline editing, keyboard navigation like a spreadsheet, and multi-row copy, paste and drag between days.
- Show, hide and reorder columns. Custom columns the user names (a new `custom` map on activities and ideas).
- Paste rows straight from Google Sheets or Excel, and copy rows back out.

**6A.2 Bring your system in, take it out any time**
- Import: CSV and XLSX with a column-matching step, Google My Maps KML/KMZ, Google Maps saved lists, ICS, and plain text (4.12).
- Export: CSV, XLSX, KML and GPX (so the places open in Google Maps, Organic Maps or Maps.me), ICS, Markdown and PDF. Export is complete, always available, and never limited.
- "Open this day in Google Maps" builds a directions link with all the day's stops in order.

**6A.3 Booking status**
- Each activity, lodging and document gets a status: idea, to book, booked, paid. New fields: `bookingStatus`, `bookBy`, `cancelBy` (free-cancellation deadline), `paidAmount`, `balanceDue`, `balanceDueDate`. Keep the existing `booking` boolean working.
- A "Bookings" screen: what must be booked and by when, what can still be cancelled for free and until when, and what is still owed. The colors follow their own habit: to book in red with the date, booked in bold.

**6A.4 Getting between stops, written their way**
- A transit note between any two activities: mode, line, from station, number of stops, exit station or exit number, and a free-text line. Distance and time are filled in as an estimate and can be overwritten by hand.

**6A.5 Complex itineraries**
- Multi-city and open-jaw trips, road trips with distance and driving time per leg and a daily driving total, overnight trains and flights that cross days, and a day that covers more than one destination.
- A "Plan B" alternative attached to any activity, and free time blocks that the schedule checker respects instead of flagging as empty.

**6A.6 Paper and tickets**
- A compact print layout that looks like a good spreadsheet: choose the columns, fit a whole day or the whole trip on a page, alongside the large-print booklet (4.27).
- A ticket wallet: the QR code or barcode image for each booking, shown full screen at full brightness, available offline. This depends on the storage decision in 4.3.

**6A.7 Notes and a trip pipeline**
- A free notes area per trip and per day (plain text with links), for the snippets that fit no field.
- A "Someday" list of future trips that are only a name, rough dates and notes, and an ideas inbox that is not tied to any trip.
- A personal places library: rate a place after visiting, add a "lessons learned" note to a finished trip, and reuse both when planning the next one.

**6A.8 Stay out of the way**
- Nothing is mandatory. No required fields, onboarding is skippable in one tap, and the app never nags to invite people, set a budget or turn on notifications.
- A "No AI" setting that removes every AI button and suggestion.
- Whatever AI or a geocoder fills in shows where it came from and when, links to the official site, and is never changed silently afterwards.
- A setting "Start in table view" for people who want the grid from the first screen.

## 6B. Older travellers who are experts at travel

A fourth audience, and the easiest one to get wrong: people in their 60s, 70s and 80s who have travelled independently for decades. They are experts at travel and novices only at this app. Section 5 makes the app readable and forgiving for them; this section is about what they need as travellers. Never label anything "senior mode", never use a childish tone, and never force a tutorial. One of them put it this way: "People treat you differently, and it can feel weird."

What they say themselves (Rick Steves forum threads "Changes in travel approach as you age", 77 replies, and "Printed Documents"; an early-retirement.org thread on travel in your 70s; AARP's 2026 Travel Trends survey of 1,189 adults aged 50 and over):

- **Paper is a tool, not a habit to cure.** "I print EVERYTHING... I use the paper copies more than pulling out the phone." "I worry my phone will be out of juice, and I am in my 70s and still a fan of paper calendars." Printed copies also made an insurance claim easier.
- **Digital tickets fail in specific ways.** A screenshot of a boarding pass would not scan at the gate. A QR code shown as a PDF was refused twice where the full-page printout was accepted. A wrinkled printout stopped scanning. A group of four with all tickets on one phone could not pull them up in time.
- **They back up by hand:** an email folder per trip, a photo album of screenshots, a cloud folder per city, "the next three days" loaded on the phone, and a spare phone in the bag with everything on it.
- **Pace changes.** "Comfort and pacing become more important than fitting as much as possible." They stay longer in each place, plan "a long midday break in the room", add rest days, and sit more in parks and museums. "Rest stops become sacred, not optional." "Planning too much can steal the joy."
- **Stairs decide the hotel.** "I will not book a hotel that does not have an elevator." "No more spiral staircases to bathrooms."
- **Luggage decides the transport.** They avoid buses with luggage, take a taxi "when the walk is more than a kilometer with luggage", and take a cab to and from airports and stations, "no discussion".
- **Arrival and departure days get padding:** an extra night after an early arrival from a long flight, a day room before an evening departure, more time between connections. On road trips, "no more than 5-6 hours a day, with a stop every 2 or 3 hours".
- **Health travels with them:** extra medication for long trips, medical items that push a bag over the carry-on limit, canes for long lines, artificial joints at security, and "we do buy insurance now", including medical evacuation.
- **From the survey:** worry about flight cancellations rose from 24% to 36% in a year. 89% shop for bargains and more than half used loyalty rewards. About 15% need accommodations for a disability or health condition. One in four trips includes three generations. Interest in cruises and road trips rises with age. They plan early. They are not afraid of technology: AI use for planning doubled to 16%, and one 70-something wrote "I don't know how anyone can travel without a smart phone."

Build for them:

**6B.1 Paper as a first-class output**
- A "Print pack" that produces, in one go: the day-by-day itinerary, every ticket as a full page with its code at original size, wallet-size cards per traveller, a copy page for passports and cards, the insurance page and the emergency card (4.18).
- "Print the next three days" for long trips.
- After any edit, "What changed since you printed" lists the changes and reprints only the affected pages.

**6B.2 Tickets that scan**
- Keep the original ticket file and show it full screen, at full brightness, zoomable. Never show a screenshot or a recompressed copy where the original exists.
- Assign each ticket to a traveller, and "Send each person their own tickets" so a group is not stuck behind one phone.
- For each ticket, a note field "paper required" that the print pack respects and the reminder list (4.13) mentions the day before.
- "Second device": a read-only copy of the trip for a spare phone or tablet, opened with a link and a PIN, fully offline once loaded.

**6B.3 Comfort settings**
- Per traveller, under the plain name "Comfort": most walking in a day, stairs (fine, a few, none), longest drive in a day and how often to stop, a midday break, earliest start, and whether they carry their own luggage.
- The schedule checker and AI planner respect these as hard limits and say which limit a plan breaks. They never lecture and are easy to dismiss per day.
- Rest days: suggest one after a long-haul arrival and after a set number of full days, shown as a real day type and not as an empty day to fill.
- A "moving too often" note when the average stay drops below two nights, with nights per stop shown in the trip header.

**6B.4 Lodging that fits**
- New lodging fields: `elevator`, `floor`, `stepFreeAccess`, `walkToTransitMinutes`, and a free "access notes" line. Missing answers appear in a "Worth checking before you book" list, not as errors.
- Padding suggestions: an extra night before an early-morning arrival, a day room before an evening departure.

**6B.5 Door-to-door transfers**
- Every arrival and departure gets a transfer plan: how to get between the station or airport and the lodging, the walking distance with luggage, stairs on the way if known, a taxi estimate and the pre-booked driver's details.
- When a walk with luggage is longer than the traveller's limit (default 1 km), suggest a taxi.
- Connection checks: warn when the time between two bookings is tighter than the traveller's chosen buffer.

**6B.6 Health and insurance**
- A private medication list: name, dose, times, and the quantity needed for the trip length plus spare days. A schedule that adjusts across time zones. Copies of prescriptions and a doctor's letter. Stored only in the user's private data.
- Insurance details including medical evacuation, with the claim phone number on the emergency card.
- A "Claims folder": collect receipts and unused bookings during the trip and export one PDF for the insurer.
- An airport assistance reminder (request at least 48 hours ahead) when a traveller has mobility needs.

**6B.7 When a flight goes wrong**
- For each flight: the airline's phone number, the booking reference, later flights the same day noted in advance, and what the rest of the day's plan depends on. One "My flight is cancelled" button shows all of it and what downstream bookings can still be cancelled for free.

**6B.8 Loyalty and discounts**
- Store loyalty numbers and discount cards per traveller, show the right one next to each booking, and note where an age-based or rail-card discount applies.

**6B.9 Three generations, cruises and road trips**
- Split a day by person: grandparents rest while the kids go out, with a shared meeting time and place.
- Cruise days as a day type, with port hours and an "all aboard" time that the schedule checker treats as fixed.
- Road-trip days show driving hours against the traveller's limit and suggest stops.

**6B.10 Their own material**
- Photograph handwritten notes or a guidebook page and turn it into ideas or activities, shown for approval.
- A "source" field on any item for a guidebook page reference or a friend's recommendation.
- Dictate a note or a whole day instead of typing.
- Accessibility notes on any place (step-free, seating, toilets, how long the line usually is), filled by the user or suggested with a source.

**6B.11 People at home**
- A read-only link for a family member at home, with today's location in the itinerary and the lodging phone number.
- An optional one-tap "Arrived safely" that notifies them.

## 7. Be creative

Everything in sections 3 to 6B is the minimum. I wrote it from a few hours of research; you will know the app far better after working in it. The goal is the trip planner people recommend to their parents and to their most organized friend, and reaching it needs ideas that are not in this document.

- At the start of every stage, add your own ideas for that area: at least five that are not listed here, each with a short reason and where the need comes from. Show them with the stage plan and build the ones I approve.
- At the end of every stage, tell me what you noticed while building that would make the app better and that nobody asked for.
- Look past travel apps for inspiration: how the best note-taking, maps, banking, messaging and calendar apps solve onboarding, search, sharing, undo and offline. Borrow the idea, not the look.
- For each of the four audiences (first-time users who are not comfortable with computers, heavy planners, veterans who plan without apps, older expert travellers), find at least one thing that would make that person say "nothing else does this".
- Propose at least five ideas that no competitor does, each with a short reason, before building any of them. Directions to consider: a sanity check for a day ("you planned 9 hours of walking with grandpa"), planning that respects Shabbat, holidays and local opening hours, a morning brief for the whole group, a rain plan for each day, or packing suggestions that follow the actual activities and forecast.
- For any item in sections 3 to 6B, if you see a simpler or better design that serves the same goal, propose it instead of implementing mine.
- Before each new feature, look for a real need: one- and two-star reviews of Wanderlog, TripIt and Tripsy, and threads on r/travel about what is missing. Note briefly where you found it.

What we learned from competitors so far: TripIt and Tineo build the trip from booking confirmations. Wanderlog works from the map and puts route optimization behind a paywall. SwipeSights, Stippl and WePlanify turn votes into a plan. Splitwise and WePlanify settle up in the fewest transfers. Tripsy and TripMapper work offline. Polarsteps leaves a story after the trip. In all of them the best features cost money, and most were built for a single decision-maker.

## 8. Order of work

Each stage stands alone, is tested, and can be reverted alone.

1. Section 5 (accessibility and sizes), 3.6 (dialogs and wording) and 3.10 (design system). No data changes.
2. Sections 3.1 to 3.5 (simplify the existing screens) and 4.9 (undo).
3. Section 4.1 (guided start) and 4.6 (join by link).
4. Sections 3.9 and 4.2 (offline and "On the trip" mode).
5. Sections 4.3 and 4.4 (confirmation import and the map).
6. Sections 4.5 and 4.7 (voting and expenses). The data model changes here.
7. Section 6 (expert tools), then 4.8, 4.10 and 3.7.
8. Sections 4.11 to 4.19 (places, itinerary paste, reminders, weather, walking load, time zones, driver card, essentials, phrasebook). These need little or no change to shared data.
9. Sections 4.20 to 4.29 (helper view, comments, live location, photos, money tools, checklists, version history, booklet, languages, gallery). Several change the data model or need storage, so plan each with me first.

10. Section 6A (veteran travellers). Start with 6A.1, 6A.2 and 6A.8, which decide whether a spreadsheet user stays, then 6A.3 to 6A.7.

11. Section 6B (older expert travellers). Start with 6B.1, 6B.2 and 6B.3, then the rest.
12. Sections 4.30 to 4.46.

After stage 12, keep going with your own ideas from section 7.

The app must not get more cluttered as it grows. More features means more care about where each one lives: nothing new appears on a main screen unless it earns the place, and everything else is reached through "More", settings, the command palette, or only when it is relevant (a flight-cancelled button only on a flight day). If you think an item should be merged with another or designed differently, propose that; do not drop it without asking me.

Sections 4.11 to 4.46 are part of the minimum too. Their order within a stage is yours to choose by benefit against effort.

## 9. Working rules

1. **Plan first.** Show me the plan for the current stage, and what you suggest not doing, and wait for approval before writing code.
2. **A previous rewrite was reverted.** A full UI rewrite (`7ca9fe8`) was reverted in `eef74f5`. Look at it in git, and ask me what did not work before you touch the same areas.
3. **Do not break data.** Existing trips open as before. Every new field (`done`, `votes`, `pace`, `travelers`, `expenses`) gets a default in `normalize*`, an update in `firestore.rules`, and a matching update to the tools in `mcp/`. Check that the trip document stays well under Firestore's 1MB limit, and propose a subcollection if it does not.
4. **Test in a real browser.** After each stage, use Playwright at widths 390 and 1280 to go through: creating a trip, adding a day and an activity, turning an idea into an activity, sharing and joining, and offline mode. Attach before and after screenshots.
5. **The grandmother test.** For every screen: does someone seeing it for the first time know the next action without reading instructions? If not, the screen is not finished.
6. **Splitting the file.** `index.html` is too large to work in safely. Propose splitting it into modules as a separate stage with no behavior change, and only do it if I approve.
7. **AI cost.** Every Gemini call is triggered by a user tap or debounced, and fails quietly with a clear message when the quota runs out (`isQuotaError` exists).
8. Do not create a new git branch without my approval.

## 10. When it is done

- A new user gets from a blank page to a three-day trip with activities in under two minutes, typing into no more than two fields.
- Every action can be done with the keyboard alone, and with one thumb on a phone.
- Lighthouse accessibility score of 95 or higher, performance 90 or higher on mobile, and no console errors.
- A downloaded trip opens and can be edited in the browser's offline mode, including the map and fonts, and syncs when the connection returns.
- A friend joins a trip from a link in WhatsApp in two taps.
- All existing MCP tools work against the new data, and the tests in `mcp/` pass.
- A trip kept in a spreadsheet is imported, edited in the table view and exported again without losing a column.
- The print pack for a real trip is complete enough to travel with the phone switched off, and every printed ticket code scans.
- A report at the end of each stage: what was built, what was tested and how, and what is still open.
