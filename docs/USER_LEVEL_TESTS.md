# Pixel Pandemonium User-Level Test Plan

Run these with the server at `http://localhost:8000` and the client at `http://127.0.0.1:4000`.

## Teacher Creates A Class Instance

1. Open `teacher-dashboard.html`.
2. Select `Demo (Tetris)`.
3. Enter a teacher name, date/time, and expiration.
4. Click `Create Instance`.
5. Confirm the page shows:
   - instance code
   - expiration timestamp
   - student URL
   - replay URL
   - admin URL
   - student QR code
   - teacher/admin QR code

## Teacher Creates A Spec-First Custom Instance

1. Open `teacher-dashboard.html?adminPassword=admin`.
2. Set `Picture Source` to `Upload posterizer specs`.
3. Enter a custom picture title.
4. Upload a `Post-It_*_composite.js` file.
5. Click `Analyze Custom Picture`.
6. Confirm the page reports that the custom picture is ready and shows a preview.
7. Enter teacher name, date/time, and expiration.
8. Click `Create Instance`.
9. Confirm the dashboard shows a spec zip download link and generated student/replay/admin URLs.
10. Open the student URL and confirm the custom title and tile selector appear.

## Teacher Creates An Image-First Custom Instance

1. Open `teacher-dashboard.html?adminPassword=admin`.
2. Set `Picture Source` to `Upload GIF/image`.
3. Upload a GIF or other image.
4. Confirm the dimension menu labels the closest prior dimension with `(closest)`.
5. Choose a dimension preset or enter custom width/height.
6. Leave the palette empty to auto-extract colors, or enter one RGB color per line.
7. Click `Remap Palette`.
8. Confirm the custom picture is ready and the preview appears.
9. Create the instance.
10. Open the replay URL and click `Auto Finish`; confirm the generated image fills in.

## Incomplete Custom Spec Handling

1. Open `teacher-dashboard.html?adminPassword=admin`.
2. Set `Picture Source` to `Upload posterizer specs`.
3. Upload only a ColorMap file.
4. Click `Analyze Custom Picture`.
5. Confirm the dashboard explains that complete spec data is missing.
6. Click `Create Instance`.
7. Confirm instance creation is blocked until a complete composite JS or CSV plus ColorMap is provided.

## Student Joins And Gets A Tile

1. Open the generated student URL.
2. Confirm the page displays the picture title and instance code.
3. Confirm the tile selector appears.
4. Confirm one tile is auto-selected.
5. Confirm the student instruction table and color palette appear.

## Student Submits A Pixel

1. Click a color in the palette.
2. Click a sub-pixel in the tile canvas.
3. Confirm the sub-pixel fills in locally.
4. Open the replay URL.
5. Confirm the submitted pixel appears in the replay.

## Error Detection And Resubmission

1. On the student page, intentionally choose a wrong color for a sub-pixel.
2. Confirm the tile becomes amber in the tile selector.
3. Reopen or reselect the tile.
4. Confirm the wrong sub-pixel has a red outline.
5. Choose the correct color and click the same sub-pixel.
6. Confirm the amber/error state clears when the tile is complete and correct.

## Multiple Instance Isolation

1. Create two instances for the same picture.
2. Submit pixels in instance A.
3. Open the replay page for instance B.
4. Confirm instance B does not show instance A’s pixels.
5. Submit pixels in instance B.
6. Confirm each replay page only shows its own pixels.

## Reset

1. Create an instance and submit at least one pixel.
2. Open the admin URL or use the reset form with the instance/admin code.
3. Click `Reset Instance`.
4. Reload the student and replay pages.
5. Confirm the submitted pixels are gone and the same instance URL still works.

## Auto Finish

1. Open a replay URL.
2. Click `Auto Finish`.
3. Confirm the image fills from empty to complete using the expected picture data.

## Expired Or Invalid Instance

1. Change one digit in a valid student URL instance code.
2. Confirm the browser reports an invalid instance code.
3. Use an expired instance, if available.
4. Confirm the page reports that the instance is no longer active.
