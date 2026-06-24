const { test, expect } = require("@playwright/test");

async function createInstance(request, teacherName = "Browser Test") {
  const response = await request.post("http://127.0.0.1:8000/instance/create", {
    headers: {
      Origin: "http://localhost:4000"
    },
    data: {
      pictureId: "tetris",
      teacherName,
      dateTime: "2026-06-23T14:00:00",
      expirationHours: 1
    }
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

test("teacher dashboard creates an instance and renders URLs plus QR codes", async ({ page }) => {
  await page.goto("/teacher-dashboard.html");
  await expect(page.getByRole("heading", { name: "Teacher Dashboard" })).toBeVisible();

  await page.locator("#pictureId").selectOption("tetris");
  await page.locator("#teacherName").fill("Browser Teacher");
  await page.locator("#dateTime").fill("2026-06-23T14:00");
  await page.locator("#expirationHours").fill("1");
  await page.getByRole("button", { name: "Create Instance" }).click();

  await expect(page.locator("#createResult")).toContainText("Instance created");
  await expect(page.locator("#createResult input").nth(0)).toHaveValue(/instructions\.html\?instance=/);
  await expect(page.locator("#createResult input").nth(1)).toHaveValue(/replay\.html\?instance=/);
  await expect(page.locator("#createResult input").nth(2)).toHaveValue(/admin\.html\?instance=/);
  await expect(page.locator("#createResult img[alt='Student QR']")).toBeVisible();
  await expect(page.locator("#createResult img[alt='Teacher QR']")).toBeVisible();
});

test("student page validates an instance, auto-selects a tile, submits a wrong pixel, and marks tile amber", async ({ page, request }) => {
  const instance = await createInstance(request, "Student Flow");
  await page.goto(`/instructions.html?instance=${encodeURIComponent(instance.instanceCode)}`);

  await expect(page.locator("#pictureTitle")).toContainText("Tetris");
  await expect(page.locator("#tileSelectorCanvas")).toBeVisible();
  await expect(page.locator("#drawCanvas")).toBeVisible();
  await expect(page.locator("#tileStatusText")).toContainText("Selected:");

  const statusBefore = await page.evaluate(() => window.PixelPandemonium.__test.getTileStatus(0, 0));
  expect(statusBefore).toBe("blank");

  await page.locator("#canvascolor0").click();
  await page.locator("#drawCanvas").click({ position: { x: 20, y: 20 } });

  await expect.poll(async () => {
    return page.evaluate(() => window.PixelPandemonium.__test.getTileStatus(0, 0));
  }).toBe("error");

  await expect.poll(async () => {
    const retrieve = await request.get(`http://127.0.0.1:8000/instance/${encodeURIComponent(instance.instanceCode)}/retrieve`, {
      headers: { Origin: "http://localhost:4000" }
    });
    expect(retrieve.ok()).toBeTruthy();
    const rows = await retrieve.json();
    return rows.length;
  }).toBeGreaterThan(0);
});

test("replay page loads instance data and auto-finish controls", async ({ page, request }) => {
  const instance = await createInstance(request, "Replay Flow");
  const insert = await request.post(`http://127.0.0.1:8000/instance/${encodeURIComponent(instance.instanceCode)}/insert`, {
    headers: { Origin: "http://localhost:4000" },
    data: { data: "0,0,10,10,#000000,0,0" }
  });
  expect(insert.ok()).toBeTruthy();

  await page.goto(`/replay.html?instance=${encodeURIComponent(instance.instanceCode)}`);
  await expect(page.locator("#pictureTitle")).toContainText("Tetris");
  await expect(page.getByRole("button", { name: "Replay From Empty" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Auto Finish" })).toBeVisible();
  await page.getByRole("button", { name: "Auto Finish" }).click();
  await expect(page.locator("#drawCanvas")).toBeVisible();
});

test("dashboard reset clears only the selected instance", async ({ page, request }) => {
  const first = await createInstance(request, "Reset First");
  const second = await createInstance(request, "Reset Second");

  await request.post(`http://127.0.0.1:8000/instance/${encodeURIComponent(first.instanceCode)}/insert`, {
    headers: { Origin: "http://localhost:4000" },
    data: { data: "0,0,10,10,#000000,0,0" }
  });
  await request.post(`http://127.0.0.1:8000/instance/${encodeURIComponent(second.instanceCode)}/insert`, {
    headers: { Origin: "http://localhost:4000" },
    data: { data: "0,0,10,10,#000000,0,0" }
  });

  await page.goto(`/teacher-dashboard.html?instance=${encodeURIComponent(first.instanceCode)}&admin=${encodeURIComponent(first.adminCode)}&adminPassword=admin`);
  await expect(page.locator("#resetInstanceCode")).toHaveValue(first.instanceCode);
  await expect(page.locator("#resetAdminCode")).toHaveValue(first.adminCode);
  await page.getByRole("button", { name: "Reset Instance" }).click();
  await expect(page.locator("#resetResult")).toContainText("Instance reset");

  const firstRows = await (await request.get(`http://127.0.0.1:8000/instance/${encodeURIComponent(first.instanceCode)}/retrieve`, {
    headers: { Origin: "http://localhost:4000" }
  })).json();
  const secondRows = await (await request.get(`http://127.0.0.1:8000/instance/${encodeURIComponent(second.instanceCode)}/retrieve`, {
    headers: { Origin: "http://localhost:4000" }
  })).json();

  expect(firstRows).toHaveLength(0);
  expect(secondRows.length).toBeGreaterThan(0);
});

test("admin page edits rows, reports incomplete and mistake pages, animates, and deactivates without deleting data", async ({ page, request }) => {
  const instance = await createInstance(request, "Admin Flow");
  await request.post(`http://127.0.0.1:8000/instance/${encodeURIComponent(instance.instanceCode)}/insert`, {
    headers: { Origin: "http://localhost:4000" },
    data: { data: "0,0,10,10,#000000,0,0" }
  });

  await page.goto(`/admin.html?instance=${encodeURIComponent(instance.instanceCode)}&admin=${encodeURIComponent(instance.adminCode)}&adminPassword=admin`);
  await expect(page.locator("#adminStatus")).toContainText("Admin access loaded");
  await expect(page.locator("#adminTileSummary")).toContainText("Incomplete pages:");
  await expect(page.locator("#adminTileSummary")).toContainText("A1");
  await expect(page.locator("#adminTileSummary")).toContainText("Pages with mistakes:");
  await expect(page.locator("#adminTileSummary")).toContainText("A1");
  await expect(page.locator(".admin-table tbody tr")).toHaveCount(1);

  await page.locator('.admin-table textarea[data-role="data"]').fill("0,0,10,10,#00ff00,0,0");
  await page.locator('.admin-table button[data-action="update"]').click();
  await expect(page.locator("#adminStatus")).toContainText("Row updated");

  await request.post(`http://127.0.0.1:8000/instance/${encodeURIComponent(instance.instanceCode)}/insert`, {
    headers: { Origin: "http://localhost:4000" },
    data: { data: "0,0,10,10,#111111,2,0" }
  });
  await page.getByRole("button", { name: "Refresh Rows" }).click();
  await expect(page.locator(".admin-table tbody tr")).toHaveCount(2);
  const rowToDelete = page.locator(".admin-table tbody tr", { hasText: "#111111" });
  await rowToDelete.locator('button[data-action="delete"]').click();
  await expect(page.locator("#adminStatus")).toContainText("Row deleted");
  await expect(page.locator(".admin-table tbody tr")).toHaveCount(1);

  await page.locator("#animationSource").selectOption("finished");
  await page.locator("#animationOrder").selectOption("existing-then-sequential");
  await page.getByRole("button", { name: "Animate Instance Data" }).click();
  await page.locator("#animationOrder").selectOption("random");
  await page.getByRole("button", { name: "Animate Finished Image" }).click();

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Deactivate this instance");
    await dialog.accept();
  });
  await page.getByRole("button", { name: "Deactivate Instance" }).click();
  await expect(page.locator("#adminStatus")).toContainText("Instance deactivated");

  const status = await request.get(`http://127.0.0.1:8000/instance/${encodeURIComponent(instance.instanceCode)}/status`, {
    headers: { Origin: "http://localhost:4000" }
  });
  expect(status.status()).toBe(404);

  const legacyRows = await (await request.get(`http://127.0.0.1:8000/retrieve?name=${encodeURIComponent(instance.instanceCode)}`, {
    headers: { Origin: "http://localhost:4000" }
  })).json();
  expect(legacyRows.length).toBeGreaterThan(0);
});
