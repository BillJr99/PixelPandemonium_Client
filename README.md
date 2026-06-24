# Pixel Pandemonium Client

Standalone static frontend for Pixel Pandemonium. It is extracted from the CS173 DrawingCanvas/Replay app and preserves the existing visual style, table-based instruction layout, canvas presentation, colors, and navigation treatment.

The deployable branch is `gh-pages` for GitHub Pages hosting.

## Requirements

- A running Pixel Pandemonium server
- Ruby/Jekyll for local static-site testing
- Optional: GitHub Pages for production hosting

Restore Node dependencies after cloning or after removing `node_modules`:

```bash
npm install
```

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

The teacher dashboard also has a custom picture workflow. Custom picture specs
are stored by the server, so they do not need entries in `config.yaml`.

## Local Run

Use two terminals for local end-to-end testing.

Terminal 1, start the server locally:

```bash
cd ../PixelPandemonium_Server
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

## Tutorial: Create And Run A Pixel Pandemonium Instance

### 1. Configure The Server

Start with the server-side configuration in `PixelPandemonium_Server`. The
client does not have a `.env` file.

Create or review the server `.env`:

```bash
ADMIN_PASSWORD=admin
DOWNLOAD_TOKEN=change-me-before-deploying
```

- `ADMIN_PASSWORD` is required for teacher/admin operations such as reset,
  deactivate, replay-row editing, custom picture upload, and admin inspection.
- `DOWNLOAD_TOKEN` is used only for the protected `/download` replay-data export.

When the server starts, it checks for `.env` and required keys. If the file or a
required key is missing in an interactive terminal, the server prompts for values
with defaults prepopulated for revision and writes the server-side `.env`. In
non-interactive startup, the server exits with an error instead. Until the server
has a valid `.env`, the client cannot log in or perform teacher/admin operations
because the server is not available for those requests. The browser never views
or modifies `.env`; admin access requires the configured `ADMIN_PASSWORD`.

Also confirm these server/client settings:

- Server `config.yaml`: `allowed_origins` must include the client origin.
- Server `config.yaml`: `client_base_url` should match the public client URL.
- Client `config.yaml`: `server_url` and `realtime_url` should point to the
  server.
- Client `config.yaml`: `base_url` should match the public client URL used in
  generated links and QR codes.

### 2. Create An Instance From An Existing Picture

1. Open `teacher-dashboard.html`.
2. Leave `Picture Source` set to `Configured picture`.
3. Pick a picture, enter teacher name, date/time, and expiration hours.
4. Click `Create Instance`.
5. Save or share the generated student URL, replay URL, and admin URL.

The student and replay URLs are scoped to the generated instance code. Multiple
teachers can use the same picture at the same time without sharing replay data.

### 3. Create An Instance From Existing Posterizer Specs

1. Open `teacher-dashboard.html?adminPassword=YOUR_ADMIN_PASSWORD`.
2. Set `Picture Source` to `Upload posterizer specs`.
3. Enter a custom title.
4. Upload a complete `Post-It_*_composite.js`, or upload composite CSV plus a
   ColorMap file.
5. Click `Analyze Custom Picture`.
6. Confirm the preview and readiness message.
7. Enter teacher name, date/time, and expiration hours.
8. Click `Create Instance`.
9. Download the generated spec zip if you want to reuse the files later.

Incomplete spec uploads are blocked. The dashboard reports missing data and will
not create an instance until it can build a valid palette, dimensions, and page
list.

### 4. Create An Instance From A GIF Or Image

1. Open `teacher-dashboard.html?adminPassword=YOUR_ADMIN_PASSWORD`.
2. Set `Picture Source` to `Upload GIF/image`.
3. Upload a GIF, PNG, JPEG, or WebP.
4. Choose an output dimension. The menu is derived from dimensions already used
   by configured pictures and marks the closest match to the uploaded image.
5. Choose `Custom` or edit width/height for a different output size.
6. Leave the palette blank to auto-extract common colors, or enter one RGB color
   per line.
7. Click `Remap Palette` to map the current image to the nearest palette colors.
8. Review the preview, then create the instance.
9. Download the generated posterizer-style zip for later use.

The browser downsamples the image to the selected dimensions, maps pixels to the
nearest palette color, pads to complete `5x3` pages, and uploads the normalized
spec to the server.

### 5. Student Access

Students open the generated student URL. The page validates the instance, loads
the configured or custom picture spec, auto-selects an available tile, and shows
the palette plus the 15-pixel tile grid.

Students click a palette color, then click a sub-pixel in the tile canvas. Their
submissions are saved to the instance and sent over realtime updates. Wrong-color
tiles turn amber, and incorrect sub-pixels get a red outline when the tile is
reselected.

### 6. Teacher Replay And Animation

Open the replay URL to see the image rebuild from submitted student data. Use:

- `Replay From Empty` to animate existing submissions in order.
- `Auto Finish` to fill the final expected image from the picture spec.

The admin page has additional animation controls:

- `Instance data only` animates actual submitted rows.
- `Finished product, filling missing pixels` uses existing student work and
  fills unsubmitted pixels from the expected image.
- Ordering can be chronological, existing-then-sequential, or random.

### 7. Admin Page

Open the generated admin URL and provide the server `ADMIN_PASSWORD` when
prompted, or include `adminPassword=...` in the URL for local demos.

Admin tools include:

- Student and replay links.
- Incomplete page and mistake summaries.
- Replay row refresh, edit, and delete.
- Instance reset.
- Instance deactivation.
- Animation from submitted data or from the finished product.

The admin page cannot view, create, or modify the server `.env`. Missing or
incomplete `.env` setup is handled at server startup.

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
base_url: https://your-github-user.github.io/PixelPandemonium_Client
```

For GitHub Pages, the server must be deployed separately. The static client cannot store replay data by itself.

## Use Cases

- Teacher opens `teacher-dashboard.html`.
- Teacher selects a picture, enters name/date/time, and creates an instance.
- Teacher can instead choose `Upload posterizer specs`, provide outside
  posterizer files, review the generated spec, and create an instance from the
  uploaded data.
- Teacher can choose `Upload GIF/image`, select output dimensions, edit or
  replace the color palette, remap pixels to nearest palette colors, download
  generated posterizer-style files, and create an instance from the generated
  spec.
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

## Custom Picture Workflow

The dashboard supports two custom creation paths:

- Spec-first: upload a `Post-It_*_composite.js` file, or upload a composite CSV
  together with a ColorMap file. If the files are incomplete, the dashboard shows
  what is missing and blocks instance creation.
- Image-first: upload a GIF, PNG, JPEG, or WebP image. The browser downsamples
  the image to the selected output dimensions, maps every pixel to the nearest
  palette color, pads the result to complete `5x3` pages, and builds the same
  runtime spec used by the original composite JS files.

Dimension controls:

- The dimensions menu lists prior dimensions used by the bundled images:
  the dashboard reads the configured composite scripts, derives
  `numCols * subcols` by `numRows * subrows`, and de-duplicates the results.
- After an image is selected, the closest prior dimension is labeled
  `(closest)`.
- Choose `Custom` or edit width/height to specify a different output size.

Palette controls:

- Leave the palette box empty to auto-extract the most common image colors.
- Enter one RGB color per line, such as `255,255,255`.
- Edit, remove, or replace the palette and click `Remap Palette` to align the
  current image pixels to the nearest listed colors.

Generated files:

- `Post-It_<name>_composite.js`
- `Post-It_<name>_composite.csv`
- `Post-It_<name>_uncompressed.txt`
- `Post-It_<name>_compressed.txt`
- `ColorMap_<name>.txt`
- `ColorMap_<name>.html`

After the custom picture is uploaded to the server, the dashboard shows a zip
download link for those generated files. Student, replay, and admin pages load
server-served custom specs automatically from instance metadata.

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

The smoke harness reads `config.yaml`, starts the sibling server when available,
verifies required files and feature hooks, creates static and custom server
instances, and runs a Jekyll build if Jekyll is installed. Browser tests use
Playwright to exercise the teacher dashboard, spec-first and image-first custom
creation, incomplete spec validation, student tile submission, amber error
state, replay, auto-finish, admin reset/deactivation/data editing flows, and
generated URLs.

Manual user-level test scenarios are in `docs/USER_LEVEL_TESTS.md`.

If Playwright reports a missing browser, run:

```bash
npx playwright install chromium
```

Playwright and the local web-server processes may print this Node warning:

```text
The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
```

This is only terminal color configuration. `FORCE_COLOR` takes precedence over
`NO_COLOR`; unset `FORCE_COLOR` if you want `NO_COLOR` to suppress colored
output in test logs.

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

This is the normal visible demo command. It leaves `DEMO_HEADLESS` unset, so it
opens visible Chromium windows for the teacher/admin view and three students.
The default pacing is intended for a live demonstration. It usually finishes in
roughly 5 minutes, depending on machine speed and whether the local servers are
already running.

Demo mode notes:

- Start from a clean terminal in `PixelPandemonium_Client`.
- Use a projector or screen share that can show the teacher/admin browser window.
- The script opens three student windows and switches between them as each page
  is completed.
- The local default admin password is `admin`; the demo runner supplies it with
  `DEMO_ADMIN_PASSWORD`, defaulting to `admin`.
- Leave the terminal visible if you want to show technical progress. It prints
  each tile as it is assigned and verifies that all 225 Tetris pixels reached the
  server before the final animation.

Useful timing options:

```bash
DEMO_PIXEL_DELAY_MS=850 npm run demo:tetris
DEMO_ADMIN_ANIMATION_DELAY_MS=80 npm run demo:tetris
DEMO_FINAL_PAUSE_MS=20000 npm run demo:tetris
DEMO_ADMIN_PASSWORD=admin npm run demo:tetris
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
