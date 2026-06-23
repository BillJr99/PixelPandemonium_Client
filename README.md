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

Start the server first:

```bash
cd ../Pixel_Pandemonium_server
npm install
npm start
```

Then run the client:

```bash
./scripts/run-local.sh
```

Open:

```text
http://127.0.0.1:4000
```

## GitHub Pages

This repository is intended to deploy from the `gh-pages` branch.

1. Keep the deployable static site on `gh-pages`.
2. Configure GitHub Pages to serve from the `gh-pages` branch root.
3. Set `base_url` and `server_url` in `config.yaml` to production URLs.
4. Commit and push.

The helper script checks that you are on `gh-pages` and builds the site:

```bash
./scripts/deploy-gh-pages.sh
```

## Use Cases

- Teacher opens `teacher-dashboard.html`.
- Teacher selects a picture, enters name/date/time, and creates an instance.
- Dashboard displays student, replay, and admin URLs plus QR codes.
- Students open the student URL and get the correct picture from instance metadata.
- Students use the clickable tile selector instead of row/column dropdowns.
- Blank, in-progress, complete, and error tiles are visible at a glance.
- Wrong-color tiles are amber; wrong sub-pixels get red outlines.
- Students correct mistakes by clicking the correct color and overwriting the sub-pixel.
- Teacher opens the replay URL and sees the image rebuild from replay data.
- Teacher can auto-finish the replay from the expected image data.
- Teacher can reset an instance with the admin URL/code.
- Multiple teachers can run the same picture at once because all data is instance-scoped.

## Tests

Run:

```bash
./test.sh
```

The harness reads `config.yaml`, checks or waits for the server at `server_url`, verifies required files and feature hooks, creates a server instance, and runs a Jekyll build if Jekyll is installed.

## Styling Policy

New controls intentionally extend the original DrawingCanvas style:

- blue navigation bar
- gray top banner
- table-based instruction layout
- `mono` data display
- bordered canvases
- simple form panels

Avoid redesigning the UI unless a new feature requires a minimal matching extension.
