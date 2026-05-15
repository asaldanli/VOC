# YDS Vocabulary Studio

Personal YDS vocabulary practice app with flashcards, quiz, matching, analytics, mobile support, and optional Firebase sync.

## What It Does

- Imports vocabulary from Excel/CSV style data.
- Expected columns: `No`, `Sozcuk`, `Turkce Karsiligi`.
- Includes `template.xlsx` for preparing vocabulary data.
- Adds a simple login gate with username `saldanli` and password `21542154`.
- Supports light and dark modes.
- Supports Firebase Realtime Database sync when `config.js` is configured.
- Keeps local data as a backup so normal GitHub Pages code updates do not remove study progress.
- Keeps existing vocabulary when new data is imported and skips duplicate words.
- Requires the login password before `Sifirla` can delete vocabulary and progress.
- Provides flashcards, quiz mode, matching mode, word list, and detailed progress dashboard.
- Shows separate accuracy for Kartlar, Quiz, and Eslestir.
- Includes mobile shortcut metadata and an app icon through `manifest.webmanifest`.

## How To Use

Open `index.html` in a browser, or publish the folder with GitHub Pages.

Import options:

- Use the included `template.xlsx`.
- Upload an Excel file prepared with the same columns.
- Paste a published Google Sheets CSV URL.

## Firebase Cloud Sync Setup

This app is static, so cross-device sync needs an online database. The working older project you shared used Firebase Realtime Database; this version now uses the same pattern.

1. Create or open a Firebase project.
2. Open `Build > Realtime Database`.
3. Create a database.
4. Open the database `Rules` tab.
5. Paste the contents of `firebase-rules.json` and publish.
6. Open `Project settings > General > Your apps`.
7. Create a Web App if needed.
8. Copy the Firebase config values.
9. Copy `config.example.js` as `config.js`.
10. Fill `config.js` like this:

```js
window.KELIME_STUDIO_CLOUD = {
  firebaseConfig: {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID",
  },
  databasePath: "yds-vocabulary/saldanli",
};
```

11. Upload `config.js` to GitHub once.

For future app updates, keep your filled `config.js`. Do not replace it with `config.example.js`.

## Important

The login screen is a personal-use gate, not bank-level security. Firebase rules in this starter setup allow read/write only under `yds-vocabulary/saldanli`, which is suitable for a private personal GitHub Pages app but should not be used for public multi-user products.

## Files To Upload

Upload these files to GitHub Pages:

- `index.html`
- `styles.css`
- `app.js`
- `template.xlsx`
- `logo.svg`
- `manifest.webmanifest`
- `config.js` after filling Firebase values

Keep `config.example.js`, `firebase-rules.json`, and this `README.md` in the repository for reference.
