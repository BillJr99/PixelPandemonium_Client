# Pixel Pandemonium Client

Standalone static frontend for Pixel Pandemonium. It is extracted from the CS173 DrawingCanvas/Replay app and preserves the existing visual style, table-based instruction layout, canvas presentation, colors, and navigation treatment.

The deployable branch is `gh-pages` for GitHub Pages hosting.

## Requirements

- A running Pixel Pandemonium server
- Ruby/Jekyll for local static-site testing
- Optional: GitHub Pages for production hosting

Install Jekyll dependencies:

```bash
bundle install
```

If you do not use Bundler:

```bash
gem install jekyll webrick
```

## Configuration

Edit `config.yaml`.

- `server_url`: HTTP API base URL.
- `realtime_url`: realtime base URL. Usually the same as `server_url`.
- `base_url`: public client base URL used when generating links.
- `default_expiration_hours`: default shown on the teacher dashboard.
- `subcols` and `subrows`: per-tile pixel grid dimensions.
- `student_canvas_width` and `student_canvas_height`: student tile canvas size.
- `replay_cell_size`: rendered full-image pixel size.
- `pictures`: enabled picture ids, display names, and composite JS file paths.

## Local Run

Use two terminals for local end-to-end testing.

Terminal 1, start the server locally:

```bash
cd ../Pixel_Pandemonium_server
npm install
npm start
```

Terminal 2, run the client:

```bash
./scripts/run-local.sh
```

Open:

```text
http://127.0.0.1:4000
```

Common pages:

```text
http://127.0.0.1:4000/teacher-dashboard.html
http://127.0.0.1:4000/admin.html?instance=INSTANCE-CODE&admin=ADMIN-CODE
http://127.0.0.1:4000/instructions.html?instance=INSTANCE-CODE
http://127.0.0.1:4000/replay.html?instance=INSTANCE-CODE
```

## GitHub Pages

This repository is intended to deploy from the `gh-pages` branch.

1. Keep the deployable static site on `gh-pages`.
2. Configure GitHub Pages to serve from the `gh-pages` branch root.
3. Set `base_url`, `server_url`, and `realtime_url` in `config.yaml` to production URLs.
4. Commit and push.

The helper script checks that you are on `gh-pages` and builds the site:

```bash
./scripts/deploy-gh-pages.sh
```

Example production config values:

```yaml
server_url: https://your-worker-or-node-host.example.com
realtime_url: https://your-worker-or-node-host.example.com
base_url: https://your-github-user.github.io/PixelPandemonium_client
```

For GitHub Pages, the server must be deployed separately. The static client cannot store replay data by itself.

## Use Cases

- Teacher opens `teacher-dashboard.html`.
- Teacher selects a picture, enters name/date/time, and creates an instance.
- Dashboard displays student, replay, and admin URLs plus QR codes.
- The generated student URL is the URL students use to participate.
- The generated admin URL opens `admin.html` for the selected instance.
- Students open the student URL and get the correct picture from instance metadata.
- Students use the clickable tile selector instead of row/column dropdowns.
- Blank, in-progress, complete, and error tiles are visible at a glance.
- Wrong-color tiles are amber; wrong sub-pixels get red outlines.
- Students correct mistakes by clicking the correct color and overwriting the sub-pixel.
- Teacher opens the replay URL and sees the image rebuild from replay data.
- Teacher can auto-finish the replay from the expected image data.
- Teacher can reset an instance with the admin URL/code.
- Admin page shows incomplete pages and pages with mistakes.
- Admin page can edit or delete individual replay rows.
- Admin page can deactivate an instance. Deactivation preserves replay rows but makes the instance unavailable to students and normal replay/status pages.
- Admin page can generate a time-lapse from instance data in student completion order or random order.
- Admin page can generate a finished-product time-lapse even if the activity is incomplete, using existing student work first and then filling missing pixels sequentially or randomly.
- Multiple teachers can run the same picture at once because all data is instance-scoped.

## Tests

Keep the server running at the configured `server_url`, or let the harness prompt you to start it.

Static/config/API client smoke tests:

```bash
npm install
./test.sh
```

Browser orchestration tests:

```bash
npm install
./browser-test.sh
```

All client tests:

```bash
./all-tests.sh
```

The smoke harness reads `config.yaml`, starts the sibling server when available, verifies required files and feature hooks, creates a server instance, and runs a Jekyll build if Jekyll is installed. Browser tests use Playwright to exercise the teacher dashboard, student tile submission, amber error state, replay, auto-finish, admin reset/deactivation/data editing flows, and generated URLs.

Manual user-level test scenarios are in `docs/USER_LEVEL_TESTS.md`.

If Playwright reports a missing browser, run:

```bash
npx playwright install chromium
```

## Tetris Classroom Demo

The client includes a demonstration script that starts the sibling server, starts
the local client, opens the teacher dashboard, creates a Tetris instance, opens
three separate student browser windows, and has those students complete the
Tetris pages one by one. After all pages are complete, it opens the teacher/admin
page and animates the finished image.

Run it from this client repository:

```bash
npm install
npm run demo:tetris
```

The default pacing is intended for a live demonstration. It usually finishes in
roughly 5 minutes, depending on machine speed and whether the local servers are
already running.

Useful timing options:

```bash
DEMO_PIXEL_DELAY_MS=850 npm run demo:tetris
DEMO_ADMIN_ANIMATION_DELAY_MS=80 npm run demo:tetris
DEMO_FINAL_PAUSE_MS=20000 npm run demo:tetris
```

Useful run-mode options:

```bash
DEMO_HEADLESS=1 npm run demo:tetris
DEMO_KEEP_OPEN=1 npm run demo:tetris
DEMO_CLIENT_PORT=4000 DEMO_SERVER_PORT=8000 npm run demo:tetris
```

`DEMO_HEADLESS=1` is mainly for checking that the script still works. For a real
classroom demonstration, leave it unset so the teacher/admin and three student
Chromium windows are visible.

During the demo, browser-side failures are written to the browser console with a
`[PixelPandemonium]` prefix. Replay insert failures include the failed URL,
status, response body, instance code, and pixel payload. Match the response
`requestId` to the server's structured JSON logs when debugging HTTP failures.

## Styling Policy

New controls intentionally extend the original DrawingCanvas style:

- blue navigation bar
- gray top banner
- table-based instruction layout
- `mono` data display
- bordered canvases
- simple form panels

Avoid redesigning the UI unless a new feature requires a minimal matching extension.
