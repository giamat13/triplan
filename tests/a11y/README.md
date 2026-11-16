# Accessibility and smoke test

Opens `index.html` in a real browser and checks it, without touching any real Firebase project.

```
cd tests/a11y
npm install
node run.mjs            # screenshots and results.json go to tests/a11y/out
node run.mjs C:\some\folder   # or to another folder
```

What it does:

- Serves the repo folder on a local port.
- Swaps every Firebase SDK file for `firebase-mock.js`, an in-memory stand-in, and swaps `config.js` for a fake config. No sign-in, no writes and no AI calls leave the machine.
- Loads one sample trip ("רומא באביב", two days, three ideas, one packing item).
- Runs axe-core (WCAG 2.1 A and AA) on every main tab, at 390px and 1280px wide, in the light, dark and high-contrast themes.
- Clicks through the basic flows: add an activity, delete one and undo, the delete-day dialog (focus starts on "No", Tab stays inside, Esc closes and focus returns), display settings, help with `?`, arrow keys on the tabs, and the empty documents list.
- Saves a screenshot of each screen it checked.

It exits with code 1 when axe finds a serious or critical problem, when a flow fails, or when the page throws an error. Requests to weather, geocoding and map-tile services are blocked on purpose, so those parts of the page stay empty in the screenshots.

The `tests/` folder is excluded from Firebase Hosting in `firebase.json`.
