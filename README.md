# YDS Vocabulary Studio

Personal vocabulary study prototype for YDS-style English practice.

## What It Does

- Imports vocabulary from CSV.
- Supports the expected columns: `No`, `Sözcük`, `Türkçe Karşılığı`.
- Includes a downloadable `template.xlsx` file for preparing vocabulary data.
- Adds a simple login gate with username `saldanli`.
- Supports light and dark color modes.
- Downloads a JSON backup whenever you log out.
- Can import a downloaded JSON backup from another browser/device.
- Keeps a local internal snapshot so normal GitHub Pages code updates do not remove study progress.
- Requires the login password before `Sıfırla` can delete vocabulary and progress.
- Includes mobile shortcut metadata and an app icon through `manifest.webmanifest`.
- Provides flashcards, quiz mode, matching mode, word list, and progress dashboard.
- Keeps existing vocabulary and progress when new CSV/Sheets data is imported.
- Supports tap-to-reveal and swipe gestures in flashcards.
- Moves quiz questions forward automatically after an answer.
- Supports drag-and-drop matching with automatic next sets.
- Adds daily, weekly, and monthly analysis.
- Shows separate accuracy for Kartlar, Quiz, and Eşleştir.
- Saves vocabulary and study progress in the browser.
- Requests persistent browser storage when supported.
- Repeats difficult or due words with a simple spaced repetition schedule.
- Includes a mobile-first layout with bottom navigation for phone use.

## How to Use

Open `index.html` in a browser.

Then choose one of these import methods:

- Use `Load Sample` to test the app quickly.
- Upload a CSV file exported from Excel or Google Sheets.
- Paste a published Google Sheets CSV URL.

## Google Sheets CSV Format

Keep the first row as headers:

```csv
No,Sözcük,Türkçe Karşılığı
1,immature,olgunlaşmamış
```

For Google Sheets:

1. Open the sheet.
2. Use `File > Share > Publish to web`.
3. Choose CSV output.
4. Paste the CSV link into the app.

## Current Storage

The app stores data locally in the browser with `localStorage`.

This means:

- No account is needed.
- No backend is needed.
- Progress stays on the same browser/device.
- Clearing browser storage deletes progress.
- Updating the GitHub Pages files at the same site URL should not delete progress.
- Changing device/browser does not automatically sync because this is a static GitHub Pages app.
- To continue on mobile, upload the JSON backup downloaded from PC logout/export.
- Automatic PC-to-mobile sync requires a backend database such as Supabase or Firebase.

The login screen is a convenience gate for personal use. A static GitHub Pages app cannot securely authenticate users or automatically sync progress across different devices without a backend service.

## Suggested Next Versions

- Add Excel `.xlsx` import.
- Convert to React + Vite.
- Add IndexedDB through Dexie for larger datasets.
- Add GitHub Pages deployment.
- Add PWA install support.
