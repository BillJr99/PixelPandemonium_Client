const { test, expect } = require("@playwright/test");
const path = require("node:path");

async function createInstance(request, teacherName = "Browser Test", pictureId = "tetris", teacherAccessKey = "teacher") {
  const uniqueTeacherName = Math.random().toString(36).slice(2, 6) + " " + teacherName;
  const response = await request.post("http://127.0.0.1:8000/instance/create", {
    headers: {
      Origin: "http://localhost:4000"
    },
    data: {
      pictureId,
      teacherName: uniqueTeacherName,
      dateTime: "2026-06-23T14:00:00",
      expirationHours: 1,
      teacherAccessKey
    }
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function ensureTeacherKey(request, teacherKey) {
  const response = await request.post("http://127.0.0.1:8000/teacher-keys", {
    headers: { Origin: "http://localhost:4000" },
    data: {
      teacherKey,
      label: teacherKey,
      adminPassword: "admin"
    }
  });
  expect([201, 409]).toContain(response.status());
}

test("teacher dashboard creates an instance and renders URLs plus QR codes", async ({ page }) => {
  await page.goto("/create-instance.html?teacherAccessKey=teacher");
  await expect(page.getByRole("heading", { name: "Create Instance" })).toBeVisible();

  await page.locator("#pictureId").selectOption("tetris");
  await page.locator("#instanceName").fill("browser-" + Math.random().toString(36).slice(2, 8));
  await page.locator("#teacherName").fill("Browser Teacher");
  await page.locator("#dateTime").fill("2026-06-23T14:00");
  await page.locator("#expirationDays").fill("1");
  await page.getByRole("button", { name: "Create Instance" }).click();

  await expect(page.locator("#createResult")).toContainText("Instance created");
  await expect(page.locator("#createResult")).toContainText("Instance Label:");
  await expect(page.locator("#createResult input").nth(0)).toHaveValue(/instructions\.html\?instance=.*&key=/);
  await expect(page.locator("#createResult input").nth(1)).toHaveValue(/replay\.html\?instance=.*&key=/);
  await expect(page.locator("#createResult input").nth(2)).toHaveValue(/teacher-dashboard\.html\?instance=.*&teacherKey=.*&admin=/);
  await expect(page.locator("#createResult input").nth(3)).toHaveValue(/admin\.html\?instance=.*&teacherKey=.*&admin=/);
  await expect(page.locator("#createResult img[alt='Student QR']")).toBeVisible();
  await expect(page.locator("#createResult img[alt='Teacher QR']")).toBeVisible();
});

test("teacher dashboard rejects duplicate instance names", async ({ page }) => {
  const instanceName = "duplicate-" + Math.random().toString(36).slice(2, 8);
  await page.goto("/create-instance.html?teacherAccessKey=teacher");
  await page.locator("#pictureId").selectOption("tetris");
  await page.locator("#instanceName").fill(instanceName);
  await page.locator("#teacherName").fill("Duplicate First");
  await page.locator("#dateTime").fill("2026-06-23T14:00");
  await page.locator("#expirationDays").fill("1");
  await page.getByRole("button", { name: "Create Instance" }).click();
  await expect(page.locator("#createResult")).toContainText("Instance created");

  await page.goto("/create-instance.html?teacherAccessKey=teacher");
  await page.locator("#pictureId").selectOption("tetris");
  await page.locator("#instanceName").fill(instanceName);
  await page.locator("#teacherName").fill("Duplicate Second");
  await page.locator("#dateTime").fill("2026-06-23T15:00");
  await page.locator("#expirationDays").fill("1");
  await page.getByRole("button", { name: "Create Instance" }).click();
  await expect(page.locator("#createResult")).toContainText("Instance name already exists");
});

test("teacher dashboard rejects the reserved tetris instance name", async ({ page }) => {
  await page.goto("/create-instance.html?teacherAccessKey=teacher");
  await page.locator("#pictureId").selectOption("tetris");
  await page.locator("#instanceName").fill("tetris");
  await page.locator("#teacherName").fill("Reserved Name");
  await page.locator("#dateTime").fill("2026-06-23T16:00");
  await page.locator("#expirationDays").fill("1");
  await page.getByRole("button", { name: "Create Instance" }).click();
  await expect(page.locator("#createResult")).toContainText("Instance name is reserved");
});

test("teacher dashboard creates an instance from uploaded posterizer spec files", async ({ page }) => {
  await page.goto("/create-instance.html?teacherAccessKey=teacher");
  await page.locator("#creationMode").selectOption("spec");
  await page.locator("#customTitle").fill("Browser Spec Custom");
  await page.locator("#specFiles").setInputFiles(path.join(process.cwd(), "tests/fixtures/Post-It_tetris_composite.js"));
  await page.getByRole("button", { name: "Analyze Custom Picture" }).click();
  await expect(page.locator("#customPictureStatus")).toContainText("Custom picture ready");

  await page.locator("#teacherName").fill("Spec Teacher");
  await page.locator("#dateTime").fill("2026-06-23T14:00");
  await page.locator("#expirationDays").fill("1");
  await page.getByRole("button", { name: "Create Instance" }).click();
  await expect(page.locator("#customPictureStatus")).toContainText("Download spec files zip");
  await expect(page.locator("#createResult")).toContainText("Instance created");

  const studentUrl = await page.locator("#createResult input").nth(0).inputValue();
  await page.goto(studentUrl.replace("http://localhost:4000", ""));
  await expect(page.locator("#pictureTitle")).toContainText("Browser Spec Custom");
  await expect(page.locator("#tileSelectorCanvas")).toBeVisible();
});

test("teacher dashboard creates an image-first instance with dimension and palette remapping", async ({ page }) => {
  await page.goto("/create-instance.html?teacherAccessKey=teacher");
  await expect(await page.evaluate(() => window.PixelPandemonium.__test.fitAspectDimensions(576, 216, 100, 36))).toEqual({ width: 96, height: 36 });
  await expect(await page.evaluate(() => window.PixelPandemonium.__test.fitAspectGridDimensions(576, 216, 100, 36))).toEqual({ width: 95, height: 36 });
  await page.locator("#creationMode").selectOption("image");
  await page.locator("#customTitle").fill("Browser Image Custom");
  await page.locator("#imageFile").setInputFiles(path.join(process.cwd(), "tests/fixtures/tetris.gif"));
  await expect(page.locator("#customPictureStatus")).toContainText("Image loaded");
  await expect(page.locator("#dimensionPreset")).toContainText("15x15 (closest)");
  await page.locator("#dimensionPreset").selectOption("custom");
  await page.locator("#customWidth").fill("100");
  await page.locator("#customHeight").fill("36");
  await page.locator("#paletteEditor").fill("255,255,255\n0,0,0\n0,255,0\n255,0,0");
  await page.getByRole("button", { name: "Remap Palette" }).click();
  await expect(page.locator("#customPictureStatus")).toContainText("Custom picture ready");
  await expect(page.locator("#customPictureStatus")).toContainText("as 35x36");
  await expect(page.locator("#customPreviewCanvas")).toBeVisible();

  await page.locator("#teacherName").fill("Image Teacher");
  await page.locator("#dateTime").fill("2026-06-23T14:00");
  await page.locator("#expirationDays").fill("1");
  await page.getByRole("button", { name: "Create Instance" }).click();
  await expect(page.locator("#createResult")).toContainText("Instance created");

  const replayUrl = await page.locator("#createResult input").nth(1).inputValue();
  await page.goto(replayUrl.replace("http://localhost:4000", ""));
  await expect(page.locator("#pictureTitle")).toContainText("Browser Image Custom");
  await expect(page.getByRole("button", { name: "Auto Finish" })).toBeVisible();
});

test("teacher dashboard blocks incomplete spec uploads with missing-data guidance", async ({ page }) => {
  await page.goto("/create-instance.html?teacherAccessKey=teacher");
  await page.locator("#creationMode").selectOption("spec");
  await page.locator("#customTitle").fill("Incomplete Custom");
  await page.locator("#specFiles").setInputFiles(path.join(process.cwd(), "tests/fixtures/ColorMap_tetris.txt"));
  await page.getByRole("button", { name: "Analyze Custom Picture" }).click();
  await expect(page.locator("#customPictureStatus")).toContainText("Missing complete spec data");

  await page.locator("#teacherName").fill("Incomplete Teacher");
  await page.locator("#dateTime").fill("2026-06-23T14:00");
  await page.locator("#expirationDays").fill("1");
  await page.getByRole("button", { name: "Create Instance" }).click();
  await expect(page.locator("#createResult")).toContainText("Missing complete spec data");
});

test("student page validates an instance, auto-selects a tile, submits a wrong pixel, and marks tile amber", async ({ page, request }) => {
  const instance = await createInstance(request, "Student Flow");
  await page.goto(`/instructions.html?instance=${encodeURIComponent(instance.instanceCode)}&key=${encodeURIComponent(instance.accessKey)}`);

  await expect(page.locator("#pictureTitle")).toContainText("Tetris");
  await expect(page.locator("#tileSelectorCanvas")).toBeVisible();
  await expect.poll(async () => page.evaluate(() => {
    const canvas = document.getElementById("tileSelectorCanvas");
    const testApi = window.PixelPandemonium.__test;
    return canvas.width >= testApi.state.numCols * 68 && canvas.height >= testApi.state.numRows * 48;
  })).toBe(true);
  await expect(page.locator("#drawCanvas")).toBeVisible();
  await expect(page.locator("#tileStatusText")).toContainText("Selected:");
  await expect(page.locator("#remainingPages")).toContainText("A1-A5");
  await expect(await page.evaluate(() => window.PixelPandemonium.__test.formatPageRanges([{ col: 0, row: 0 }, { col: 0, row: 1 }, { col: 1, row: 0 }]))).toBe("A1-A2, B1");

  const statusBefore = await page.evaluate(() => window.PixelPandemonium.__test.getTileStatus(0, 0));
  expect(statusBefore).toBe("blank");

  await page.locator("#canvascolor0").click();
  await page.locator("#drawCanvas").click({ position: { x: 20, y: 20 } });

  await expect.poll(async () => {
    return page.evaluate(() => window.PixelPandemonium.__test.getTileStatus(0, 0));
  }).toBe("error");

  await expect.poll(async () => {
    const retrieve = await request.get(`http://127.0.0.1:8000/instance/${encodeURIComponent(instance.instanceCode)}/retrieve?key=${encodeURIComponent(instance.accessKey)}`, {
      headers: { Origin: "http://localhost:4000" }
    });
    expect(retrieve.ok()).toBeTruthy();
    const rows = await retrieve.json();
    return rows.length;
  }).toBeGreaterThan(0);
});

test("student page reprompts when the class key is incorrect", async ({ page, request }) => {
  const instance = await createInstance(request, "Student Prompt Flow", "eagles");
  const prompts = [];
  page.on("dialog", async (dialog) => {
    prompts.push(dialog.message());
    await dialog.accept(instance.accessKey);
  });
  await page.goto(`/instructions.html?instance=${encodeURIComponent(instance.instanceCode)}&key=WRONG`);
  await expect(page.locator("#pictureTitle")).toContainText("Eagles");
  await expect.poll(() => prompts.length).toBe(1);
  await expect(page).toHaveURL(new RegExp("key=" + instance.accessKey));
});

test("admin page reprompts when the teacher key is incorrect", async ({ page, request }) => {
  const instance = await createInstance(request, "Teacher Prompt Flow", "eagles");
  const prompts = [];
  page.on("dialog", async (dialog) => {
    prompts.push(dialog.message());
    await dialog.accept(instance.teacherKey);
  });
  await page.goto(`/admin.html?instance=${encodeURIComponent(instance.instanceCode)}&teacherKey=WRONG&admin=${encodeURIComponent(instance.adminCode)}&adminPassword=admin`);
  await expect(page.locator("#adminStatus")).toContainText("Admin access loaded");
  await expect.poll(() => prompts.length).toBe(1);
  await expect(page).toHaveURL(new RegExp("teacherKey=" + instance.teacherKey));
});

test("admin page without an instance prompts only for the admin password and lists instances", async ({ page, request }) => {
  const instance = await createInstance(request, "Admin Listing Flow", "eagles");
  const prompts = [];
  page.on("dialog", async (dialog) => {
    prompts.push(dialog.message());
    await dialog.accept("admin");
  });
  await page.goto("/admin.html");
  await expect(page.locator("#adminStatus")).toContainText("Choose an instance or create a new one");
  await expect(page.locator("#instancesList")).toContainText(instance.instanceCode);
  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toContain("admin password");
  await page.locator("#instancesList tr", { hasText: instance.instanceCode }).locator('button[data-action="load-instance"]').click();
  await expect(page.locator("#adminStatus")).toContainText("Admin access loaded");
  await expect(page.locator("#instanceCode")).toContainText(instance.instanceCode);

  await page.locator("#adminPictureId").selectOption("eagles");
  await page.locator("#adminInstanceName").fill("admin-created-" + Math.random().toString(36).slice(2, 8));
  await page.locator("#adminTeacherName").fill("Admin Created");
  await page.locator("#adminDateTime").fill("2026-06-23T17:00");
  await page.locator("#adminExpirationDays").fill("365");
  await page.getByRole("button", { name: "Create Instance" }).click();
  await expect(page.locator("#adminCreateResult")).toContainText("Instance created");
  await expect(page.locator("#adminStatus")).toContainText("Admin access loaded");

  await page.getByRole("button", { name: "Load Teacher Keys" }).click();
  await expect(page.locator("#teacherKeysList")).toContainText("teacher");
  await page.locator("#newTeacherKey").fill("teacher");
  await page.locator("#newTeacherKeyLabel").fill("Duplicate Default");
  await page.getByRole("button", { name: "Create Teacher Key" }).click();
  await expect(page.locator("#teacherKeyStatus")).toContainText("Teacher key already exists");
});

test("teacher dashboard lists only instances created with that teacher key", async ({ page, request }) => {
  const secondTeacherKey = "browser-teacher-" + Math.random().toString(36).slice(2, 8);
  await ensureTeacherKey(request, secondTeacherKey);
  const defaultOwned = await createInstance(request, "Default Owner", "tetris", "teacher");
  const secondOwned = await createInstance(request, "Second Owner", "eagles", secondTeacherKey);

  await page.goto("/teacher-dashboard.html?teacherAccessKey=teacher");
  await page.waitForFunction(() => document.body.dataset.ppReady === "teacher-dashboard");
  await page.getByRole("button", { name: "Load Instances" }).click();
  await expect(page.locator("#instancesList")).toContainText(defaultOwned.instanceCode);
  await expect(page.locator("#instancesList")).not.toContainText(secondOwned.instanceCode);

  await page.goto(`/teacher-dashboard.html?teacherAccessKey=${encodeURIComponent(secondTeacherKey)}`);
  await page.waitForFunction(() => document.body.dataset.ppReady === "teacher-dashboard");
  await page.getByRole("button", { name: "Load Instances" }).click();
  await expect(page.locator("#instancesList")).toContainText(secondOwned.instanceCode);
  await expect(page.locator("#instancesList")).not.toContainText(defaultOwned.instanceCode);
});

test("replay page loads instance data and auto-finish controls", async ({ page, request }) => {
  const instance = await createInstance(request, "Replay Flow");
  const insert = await request.post(`http://127.0.0.1:8000/instance/${encodeURIComponent(instance.instanceCode)}/insert`, {
    headers: { Origin: "http://localhost:4000" },
    data: { data: "0,0,10,10,#000000,0,0", accessKey: instance.accessKey }
  });
  expect(insert.ok()).toBeTruthy();

  await page.goto(`/replay.html?instance=${encodeURIComponent(instance.instanceCode)}&key=${encodeURIComponent(instance.accessKey)}`);
  await expect(page.locator("#pictureTitle")).toContainText("Tetris");
  await page.locator("#replayOrder").selectOption("random");
  await page.locator("#replayDelayMs").fill("0");
  await expect(page.getByRole("button", { name: "Replay From Empty" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Auto Finish" })).toBeVisible();
  await page.getByRole("button", { name: "Replay From Empty" }).click();
  await page.getByRole("button", { name: "Auto Finish" }).click();
  await expect(page.locator("#drawCanvas")).toBeVisible();
});

test("dashboard reset clears only the selected instance", async ({ page, request }) => {
  const first = await createInstance(request, "Reset First");
  const second = await createInstance(request, "Reset Second");

  await request.post(`http://127.0.0.1:8000/instance/${encodeURIComponent(first.instanceCode)}/insert`, {
    headers: { Origin: "http://localhost:4000" },
    data: { data: "0,0,10,10,#000000,0,0", accessKey: first.accessKey }
  });
  await request.post(`http://127.0.0.1:8000/instance/${encodeURIComponent(second.instanceCode)}/insert`, {
    headers: { Origin: "http://localhost:4000" },
    data: { data: "0,0,10,10,#000000,0,0", accessKey: second.accessKey }
  });

  await page.goto(`/teacher-dashboard.html?instance=${encodeURIComponent(first.instanceCode)}&teacherKey=${encodeURIComponent(first.teacherKey)}&admin=${encodeURIComponent(first.adminCode)}&teacherAccessKey=teacher`);
  await expect(page.locator("#resetInstanceCode")).toHaveValue(first.instanceCode);
  await expect(page.locator("#resetAdminCode")).toHaveValue(first.adminCode);
  await expect(page.locator("#resetTeacherKey")).toHaveValue(first.teacherKey);
  await page.getByRole("button", { name: "Load Instances" }).click();
  await expect(page.locator("#instancesList")).toContainText(first.instanceCode);
  await page.locator("#instancesList tr", { hasText: first.instanceCode }).locator('button[data-action="load-instance"]').click();
  await expect(page.locator("#dashboardAdminStatus")).toContainText("Loaded");
  await page.locator("#animationOrder").selectOption("random");
  await page.getByRole("button", { name: "Animate Finished Image" }).click();
  await page.getByRole("button", { name: "Reset Instance" }).click();
  await expect(page.locator("#resetResult")).toContainText("Instance reset");

  const firstRows = await (await request.get(`http://127.0.0.1:8000/instance/${encodeURIComponent(first.instanceCode)}/retrieve?key=${encodeURIComponent(first.accessKey)}`, {
    headers: { Origin: "http://localhost:4000" }
  })).json();
  const secondRows = await (await request.get(`http://127.0.0.1:8000/instance/${encodeURIComponent(second.instanceCode)}/retrieve?key=${encodeURIComponent(second.accessKey)}`, {
    headers: { Origin: "http://localhost:4000" }
  })).json();

  expect(firstRows).toHaveLength(0);
  expect(secondRows.length).toBeGreaterThan(0);
});

test("admin page edits rows, reports incomplete and mistake pages, and animates", async ({ page, request }) => {
  const instance = await createInstance(request, "Admin Flow");
  await request.post(`http://127.0.0.1:8000/instance/${encodeURIComponent(instance.instanceCode)}/insert`, {
    headers: { Origin: "http://localhost:4000" },
    data: { data: "0,0,10,10,#000000,0,0", accessKey: instance.accessKey }
  });

  await page.goto(`/admin.html?instance=${encodeURIComponent(instance.instanceCode)}&teacherKey=${encodeURIComponent(instance.teacherKey)}&admin=${encodeURIComponent(instance.adminCode)}&adminPassword=admin`);
  await expect(page.locator("#adminStatus")).toContainText("Admin access loaded");
  await page.getByRole("button", { name: "Load Instances" }).click();
  await expect(page.locator("#instancesList")).toContainText(instance.instanceCode);
  await expect(page.locator("#adminTileSummary")).toContainText("Incomplete pages:");
  await expect(page.locator("#adminTileSummary")).toContainText("A1-A5");
  await expect(page.locator("#adminTileSummary")).toContainText("Pages with mistakes:");
  await expect(page.locator("#adminTileSummary")).toContainText("A1");
  await expect(page.locator("#adminRows .admin-table tbody tr")).toHaveCount(1);

  await page.locator('#adminRows .admin-table textarea[data-role="data"]').fill("0,0,10,10,#00ff00,0,0");
  await page.locator('#adminRows .admin-table button[data-action="update"]').click();
  await expect(page.locator("#adminStatus")).toContainText("Row updated");

  await request.post(`http://127.0.0.1:8000/instance/${encodeURIComponent(instance.instanceCode)}/insert`, {
    headers: { Origin: "http://localhost:4000" },
    data: { data: "0,0,10,10,#111111,2,0", accessKey: instance.accessKey }
  });
  await page.getByRole("button", { name: "Refresh Rows" }).click();
  await expect(page.locator("#adminRows .admin-table tbody tr")).toHaveCount(2);
  const rowToDelete = page.locator("#adminRows .admin-table tbody tr", { hasText: "#111111" });
  await rowToDelete.locator('button[data-action="delete"]').click();
  await expect(page.locator("#adminStatus")).toContainText("Row deleted");
  await expect(page.locator("#adminRows .admin-table tbody tr")).toHaveCount(1);

  await page.locator("#animationSource").selectOption("finished");
  await page.locator("#animationOrder").selectOption("existing-then-sequential");
  await page.getByRole("button", { name: "Animate Instance Data" }).click();
  await page.locator("#animationOrder").selectOption("random");
  await page.getByRole("button", { name: "Animate Finished Image" }).click();

  const status = await request.get(`http://127.0.0.1:8000/instance/${encodeURIComponent(instance.instanceCode)}/status?key=${encodeURIComponent(instance.accessKey)}`, {
    headers: { Origin: "http://localhost:4000" }
  });
  expect(status.ok()).toBeTruthy();

  const legacyRows = await (await request.get(`http://127.0.0.1:8000/retrieve?name=${encodeURIComponent(instance.instanceCode)}`, {
    headers: { Origin: "http://localhost:4000" }
  })).json();
  expect(legacyRows.length).toBeGreaterThan(0);
});

test("public tetris demo is open to students and teacher reset", async ({ page, request }) => {
  await page.goto("/instructions.html?instance=tetris");
  await expect(page.locator("#pictureTitle")).toContainText("Tetris");

  await request.post("http://127.0.0.1:8000/instance/tetris/insert", {
    headers: { Origin: "http://localhost:4000" },
    data: { data: "0,0,10,10,#000000,0,0" }
  });
  await page.goto("/teacher-dashboard.html?instance=tetris");
  await expect(page.locator("#resetInstanceCode")).toHaveValue("tetris");
  await page.getByRole("button", { name: "Reset Instance" }).click();
  await expect(page.locator("#resetResult")).toContainText("Instance reset");

  await page.goto("/admin.html?instance=tetris");
  await expect(page.locator("#adminStatus")).toContainText("Admin access loaded");
  await expect(page.getByRole("button", { name: "Deactivate Instance" })).toHaveCount(0);
});

test("admin page rotates class and teacher keys for secured instances", async ({ page, request }) => {
  const instance = await createInstance(request, "Rotate Flow", "eagles");
  await page.goto(`/admin.html?instance=${encodeURIComponent(instance.instanceCode)}&teacherKey=${encodeURIComponent(instance.teacherKey)}&admin=${encodeURIComponent(instance.adminCode)}&adminPassword=admin`);
  await expect(page.locator("#adminStatus")).toContainText("Admin access loaded");

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Reset this class key");
    await dialog.accept();
  });
  await page.getByRole("button", { name: "Reset Class Key" }).click();
  await expect(page.locator("#adminStatus")).toContainText("Reset class key");
  const oldStatus = await request.get(`http://127.0.0.1:8000/instance/${encodeURIComponent(instance.instanceCode)}/status?key=${encodeURIComponent(instance.accessKey)}`, {
    headers: { Origin: "http://localhost:4000" }
  });
  expect(oldStatus.status()).toBe(403);

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Reset this teacher key");
    await dialog.accept();
  });
  await page.getByRole("button", { name: "Reset Teacher Key" }).click();
  await expect(page.locator("#adminStatus")).toContainText("Reset teacher key");
  await expect(page).toHaveURL(/teacherKey=/);
});

test("public tetris demo toasts and rolls back a wrong-color pixel", async ({ page, request }) => {
  // Start from a clean demo so the auto-selected tile is blank and deterministic.
  const reset = await request.post("http://127.0.0.1:8000/instance/tetris/reset", {
    headers: { Origin: "http://localhost:4000" },
    data: {}
  });
  expect(reset.ok()).toBeTruthy();

  await page.goto("/instructions.html?instance=tetris");
  await expect(page.locator("#pictureTitle")).toContainText("Tetris");
  await expect(page.locator("#tileStatusText")).toContainText("Selected:");

  // Work out the square a top-left canvas click maps to, the color the demo
  // expects there, and a different (wrong) palette swatch to submit.
  const target = await page.evaluate(() => {
    const t = window.PixelPandemonium.__test;
    const s = t.state;
    const tile = s.selectedTile;
    const xSquare = tile.col * s.subcols; // sub-cell (0,0) of the selected tile
    const ySquare = tile.row * s.subrows;
    const colLetter = String.fromCharCode(65 + tile.col);
    const pageData = s.pages.find((p) => String(p.row) === String(tile.row + 1) && p.col === colLetter);
    const expectedHex = t.rgbToHex(
      s.palette[pageData.uncompressed[0]][0],
      s.palette[pageData.uncompressed[0]][1],
      s.palette[pageData.uncompressed[0]][2]
    ).toLowerCase();
    let wrongIndex = -1;
    for (let i = 0; i < s.palette.length; i++) {
      const hex = t.rgbToHex(s.palette[i][0], s.palette[i][1], s.palette[i][2]).toLowerCase();
      if (hex !== expectedHex) { wrongIndex = i; break; }
    }
    return { tile, xSquare, ySquare, expectedHex, wrongIndex, filledBefore: s.filled[ySquare][xSquare] || null };
  });
  expect(target.wrongIndex).toBeGreaterThanOrEqual(0);
  expect(target.filledBefore).toBeNull();
  expect(await page.evaluate((tile) => window.PixelPandemonium.__test.getTileStatus(tile.row, tile.col), target.tile)).toBe("blank");

  // Submit the wrong color on the public demo. The server returns 400, and the
  // client should toast the reason and undo the optimistic pixel.
  const toast = page.locator("#toastHolder");
  await page.locator(`#canvascolor${target.wrongIndex}`).click();
  await page.locator("#drawCanvas").click({ position: { x: 20, y: 20 } });

  // The toast carries the server's actual reason (not a generic "Save failed").
  await expect(toast).toContainText("does not match the expected color");
  await expect(page.locator("#tileStatusText")).toContainText("does not match the expected color");

  // Rollback: the optimistic pixel is gone and the tile is blank again. (The
  // status line is set after the rollback runs, so by now the undo has happened.)
  const afterFilled = await page.evaluate((t) => window.PixelPandemonium.__test.state.filled[t.ySquare][t.xSquare] || null, target);
  expect(afterFilled).toBeNull();
  expect(await page.evaluate((tile) => window.PixelPandemonium.__test.getTileStatus(tile.row, tile.col), target.tile)).toBe("blank");

  // The server stored nothing for the rejected submission.
  const rows = await (await request.get("http://127.0.0.1:8000/instance/tetris/retrieve", {
    headers: { Origin: "http://localhost:4000" }
  })).json();
  expect(rows.length).toBe(0);
});
