# LevelUp — L × Light × JEE

90-day, 30-level habit curriculum for JEE 2027 prep, packaged as a real Android app.
Built with React + Vite + Capacitor. All data lives on your phone.

**Status:** Phase 1 — JEE Core (Levels 1–13, Days 1–39, 37 habits) is fully built with
daily tasks, pass criteria, unlock rules, common mistakes, and JEE-benefit notes.
Phases 2–4 (Levels 14–30) are scaffolded in the timeline and will be filled in with the
same level of detail in upcoming updates — the app already works end-to-end for all 90
days (streaks, habit scores, recovery mode, mock-test protocol, exam-month mode).

## Get the APK (no coding needed)

1. Push this project to your own GitHub repo (steps below).
2. GitHub Actions builds the APK automatically and publishes it to your repo's
   **Releases** page under the tag `latest`, every time you push to `main`.
3. Go to `github.com/<your-username>/<repo>/releases`, download the `.apk`, and
   install it on your phone (allow "install from unknown sources" once, since this
   isn't from the Play Store).

### Push to your own GitHub repo

```bash
cd jee-levelup
git init
git add .
git commit -m "LevelUp v1 - Phase 1 complete"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```

That's it - open the **Actions** tab on GitHub to watch the build (~3-4 min), then
check **Releases** for the APK. You can also trigger a build manually anytime from
Actions -> "Build and Release APK" -> "Run workflow".

## Local development (optional)

```bash
npm install
npm run dev          # runs in the browser at localhost, for quick UI iteration
npm run build         # production web build
npx cap sync android  # copy the web build into the native Android project
```

To build the APK on your own machine instead of CI, you need Android Studio /
the Android SDK + JDK 21 installed, then: `cd android && ./gradlew assembleDebug`.

## How the system works

- **Today tab** - your daily checklist, grouped Morning / Study Blocks / Night,
  cumulative across every unlocked level. A radial gauge shows Day X/90 and today's
  completion.
- **Levels tab** - the full 30-level timeline grouped by phase. Tap any level for its
  new habits, daily tasks, time required, completion criteria,
  unlock condition, common mistakes, and JEE benefit.
- **Progress tab** - 7-day habit scores and streaks per habit, plus overall day streak
  and levels cleared/needing recovery.
- **Review tab** - weekly review (unlocks every 7th day) and monthly assessment
  (Day 30/60/90), your JEE Main exam date (auto-switches Today into a lighter
  revision-only Exam Month Protocol in the final 30 days), and past review history.
- **Recovery Mode** - if a day's completion drops below 30%, the next day
  automatically shows only the current level's core tasks as required; everything
  else becomes optional "Bonus" so you rebuild momentum instead of feeling buried.
- **Sunday Mock Test Protocol** - every 7th day, a fixed weekly checklist appears
  (full mock, same-day error review, mistake log, section-time breakdown).

All progress is stored locally on-device (localStorage inside the app's webview).
Uninstalling the app clears it - there's no cloud sync in this version.
