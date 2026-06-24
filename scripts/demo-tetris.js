#!/usr/bin/env node
"use strict";

const { spawn } = require("child_process");
const { chromium } = require("@playwright/test");

const CLIENT_PORT = Number(process.env.DEMO_CLIENT_PORT || 4000);
const SERVER_PORT = Number(process.env.DEMO_SERVER_PORT || 8000);
const CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}`;
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`;
const HEADLESS = process.env.DEMO_HEADLESS === "1";
const PIXEL_DELAY_MS = Number(process.env.DEMO_PIXEL_DELAY_MS || 850);
const TILE_DELAY_MS = Number(process.env.DEMO_TILE_DELAY_MS || 2000);
const STUDENT_SWITCH_DELAY_MS = Number(process.env.DEMO_STUDENT_SWITCH_DELAY_MS || 700);
const ADMIN_ANIMATION_DELAY_MS = Number(process.env.DEMO_ADMIN_ANIMATION_DELAY_MS || 80);
const ADMIN_PASSWORD = process.env.DEMO_ADMIN_PASSWORD || "admin";
const FINAL_PAUSE_MS = Number(process.env.DEMO_FINAL_PAUSE_MS || 20000);
const SLOW_MO_MS = Number(process.env.DEMO_SLOW_MO_MS || 120);

const root = new URL("..", `file://${__dirname}/`).pathname;
const serverRoot = new URL("../../Pixel_Pandemonium_server/", `file://${__dirname}/`).pathname;
const startedProcesses = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isUp(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitFor(url, label, timeoutMs = 45000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isUp(url)) return;
    await sleep(500);
  }
  throw new Error(`${label} did not become ready at ${url}`);
}

function startProcess(command, args, cwd, label) {
  const child = spawn(command, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(SERVER_PORT) }
  });
  startedProcesses.push(child);
  child.stdout.on("data", (data) => process.stdout.write(`[${label}] ${data}`));
  child.stderr.on("data", (data) => process.stderr.write(`[${label}] ${data}`));
  child.on("exit", (code, signal) => {
    if (code && code !== 0) console.error(`[${label}] exited with code ${code}${signal ? ` (${signal})` : ""}`);
  });
  return child;
}

async function fetchJsonWithRetry(url, options = {}, attempts = 10) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response.json();
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }
  throw lastError;
}

async function retrieveRows(instance) {
  return fetchJsonWithRetry(`${SERVER_URL}/instance/${encodeURIComponent(instance.instanceCode)}/retrieve`);
}

async function ensureServers() {
  if (!(await isUp(`${SERVER_URL}/health`))) {
    console.log(`Starting Pixel Pandemonium server on ${SERVER_URL}`);
    startProcess("npm", ["start"], serverRoot, "server");
  } else {
    console.log(`Using existing server at ${SERVER_URL}`);
  }

  if (!(await isUp(CLIENT_URL))) {
    console.log(`Starting Pixel Pandemonium client on ${CLIENT_URL}`);
    startProcess("./scripts/run-local.sh", [String(CLIENT_PORT)], root, "client");
  } else {
    console.log(`Using existing client at ${CLIENT_URL}`);
  }

  await waitFor(`${SERVER_URL}/health`, "Server");
  await waitFor(CLIENT_URL, "Client");
}

async function launchBrowser(label, viewport) {
  const browser = await chromium.launch({
    headless: HEADLESS,
    slowMo: HEADLESS ? 0 : SLOW_MO_MS,
    args: [`--window-size=${viewport.width},${viewport.height}`]
  });
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") console.error(`[${label}] ${message.text()}`);
  });
  return { label, browser, page };
}

async function closeBrowser(browser) {
  await Promise.race([
    browser.close(),
    sleep(3000)
  ]).catch(() => {});
}

async function createTetrisInstance(page) {
  console.log("Creating Tetris instance from the teacher dashboard");
  await page.goto(`${CLIENT_URL}/teacher-dashboard.html`);
  await page.locator("#pictureId").selectOption("tetris");
  await page.locator("#teacherName").fill("Demo Teacher");
  await page.locator("#dateTime").fill("2026-06-24T10:00");
  await page.locator("#expirationHours").fill("2");
  await page.getByRole("button", { name: "Create Instance" }).click();
  await page.locator("#createResult").waitFor({ state: "visible" });

  const urls = await page.locator("#createResult input.url-box").evaluateAll((inputs) => inputs.map((input) => input.value));
  const instanceCode = await page.locator("#resetInstanceCode").inputValue();
  const adminCode = await page.locator("#resetAdminCode").inputValue();
  return {
    instanceCode,
    adminCode,
    studentUrl: urls.find((url) => url.includes("instructions.html")),
    replayUrl: urls.find((url) => url.includes("replay.html")),
    adminUrl: urls.find((url) => url.includes("admin.html"))
  };
}

async function openStudent(student, studentUrl) {
  console.log(`Opening ${student.label}`);
  await student.page.goto(studentUrl);
  await student.page.locator("#drawCanvas").waitFor({ state: "visible" });
  await student.page.locator("#tileStatusText").waitFor({ state: "visible" });
}

async function getTiles(page) {
  return page.evaluate(() => {
    const state = window.PixelPandemonium.__test.state;
    const labels = [];
    for (let col = 0; col < state.numCols; col++) {
      for (let row = 0; row < state.numRows; row++) {
        const label = String.fromCharCode("A".charCodeAt(0) + col) + String(row + 1);
        const pageData = state.pages.find((candidate) => candidate.col === String.fromCharCode("A".charCodeAt(0) + col) && String(candidate.row) === String(row + 1));
        labels.push({ row, col, label, colors: pageData.uncompressed });
      }
    }
    return {
      subrows: state.subrows,
      subcols: state.subcols,
      numRows: state.numRows,
      numCols: state.numCols,
      tiles: labels
    };
  });
}

async function selectTile(page, metadata, tile) {
  const selector = page.locator("#tileSelectorCanvas");
  const box = await selector.boundingBox();
  await selector.click({
    position: {
      x: ((tile.col + 0.5) * box.width) / metadata.numCols,
      y: ((tile.row + 0.5) * box.height) / metadata.numRows
    }
  });
  await page.locator("#tileStatusText").waitFor({ state: "visible" });
}

async function clickPixel(page, metadata, subRow, subCol, colorIndex) {
  await page.locator(`#canvascolor${colorIndex}`).click();
  const canvas = page.locator("#drawCanvas");
  const box = await canvas.boundingBox();
  await canvas.click({
    position: {
      x: ((subCol + 0.5) * box.width) / metadata.subcols,
      y: ((subRow + 0.5) * box.height) / metadata.subrows
    }
  });
}

async function waitForSubmittedPixel(instance, expectedRows) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 2500) {
    const rows = await retrieveRows(instance);
    if (rows.length >= expectedRows) return rows.length;
    await sleep(100);
  }
  const rows = await retrieveRows(instance);
  return rows.length;
}

async function fillTile(student, metadata, tile, instance, progress) {
  const { page, label } = student;
  await page.bringToFront();
  console.log(`${label} completing page ${tile.label}`);
  await selectTile(page, metadata, tile);
  await sleep(STUDENT_SWITCH_DELAY_MS);

  for (let subRow = 0; subRow < metadata.subrows; subRow++) {
    for (let subCol = 0; subCol < metadata.subcols; subCol++) {
      const colorIndex = tile.colors[subRow * metadata.subcols + subCol];
      progress.count += 1;
      let submittedRows = 0;
      for (let attempt = 1; attempt <= 3; attempt++) {
        await clickPixel(page, metadata, subRow, subCol, colorIndex);
        submittedRows = await waitForSubmittedPixel(instance, progress.count);
        if (submittedRows >= progress.count) break;
        console.log(`${label} retrying page ${tile.label} pixel ${subRow + 1},${subCol + 1}`);
      }
      if (submittedRows < progress.count) {
        throw new Error(`Timed out waiting for pixel ${progress.count}; server has ${submittedRows} rows.`);
      }
      await sleep(PIXEL_DELAY_MS);
    }
  }

  await sleep(TILE_DELAY_MS);
}

async function showFinalAnimation(admin, instance) {
  console.log("Opening the teacher/admin page and animating the finished image");
  const url = `${instance.adminUrl}&adminPassword=${encodeURIComponent(ADMIN_PASSWORD)}&animationDelayMs=${encodeURIComponent(ADMIN_ANIMATION_DELAY_MS)}`;
  await admin.page.goto(url);
  await admin.page.locator("#drawCanvas").waitFor({ state: "visible" });
  await admin.page.locator("#adminTileSummary").waitFor({ state: "visible" });
  await admin.page.locator("#animationSource").selectOption("finished");
  await admin.page.locator("#animationOrder").selectOption("existing-then-sequential");
  await admin.page.getByRole("button", { name: "Animate Finished Image" }).click();
  await sleep(ADMIN_ANIMATION_DELAY_MS * 230 + FINAL_PAUSE_MS);
}

async function verifyComplete(instance, expectedRows) {
  const rows = await retrieveRows(instance);
  if (rows.length < expectedRows) {
    throw new Error(`Expected at least ${expectedRows} submitted pixels, but the server has ${rows.length}.`);
  }
  console.log(`Verified ${rows.length} submitted pixels on the server.`);
}

async function run() {
  await ensureServers();

  const teacher = await launchBrowser("Teacher", { width: 1200, height: 900 });
  const admin = await launchBrowser("Teacher animation", { width: 1200, height: 900 });
  const students = [
    await launchBrowser("Student 1", { width: 1040, height: 820 }),
    await launchBrowser("Student 2", { width: 1040, height: 820 }),
    await launchBrowser("Student 3", { width: 1040, height: 820 })
  ];
  const allBrowsers = [teacher, admin, ...students];

  try {
    const instance = await createTetrisInstance(teacher.page);
    console.log(`Created instance ${instance.instanceCode}`);
    for (const student of students) await openStudent(student, instance.studentUrl);

    const metadata = await getTiles(students[0].page);
    const progress = { count: 0 };
    for (let i = 0; i < metadata.tiles.length; i++) {
      await fillTile(students[i % students.length], metadata, metadata.tiles[i], instance, progress);
    }

    await verifyComplete(instance, metadata.tiles.length * metadata.subrows * metadata.subcols);
    await showFinalAnimation(admin, instance);
    console.log("Demo complete.");
  } finally {
    if (process.env.DEMO_KEEP_OPEN === "1" && !HEADLESS) {
      console.log("DEMO_KEEP_OPEN=1 set. Press Ctrl+C when finished.");
      await new Promise(() => {});
    }
    await cleanup();
    await Promise.allSettled(allBrowsers.map(({ browser }) => closeBrowser(browser)));
    await cleanup();
  }
}

async function cleanup() {
  const children = startedProcesses.splice(0).reverse();
  await Promise.all(children.map((child) => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }, 2000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  })));
}

process.on("SIGINT", async () => {
  await cleanup();
  process.exit(130);
});
process.on("SIGTERM", async () => {
  await cleanup();
  process.exit(143);
});

run().catch((error) => {
  console.error(error);
  cleanup().finally(() => process.exit(1));
}).then(() => process.exit(0));
