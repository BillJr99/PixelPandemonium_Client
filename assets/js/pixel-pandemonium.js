(function () {
  "use strict";

  const state = {
    config: null,
    instance: null,
    picture: null,
    palette: [],
    pages: [],
    numRows: 0,
    numCols: 0,
    subrows: 3,
    subcols: 5,
    filled: [],
    selectedTile: null,
    fayeClient: null,
    ws: null,
    replayTimer: null
  };

  let priorDimensions = [];
  let customDraft = null;
  let currentImageDimensions = null;

  function parseScalar(value) {
    const trimmed = value.trim();
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
    return trimmed.replace(/^["']|["']$/g, "");
  }

  function parseYaml(text) {
    const config = {};
    const lines = text.split(/\r?\n/);
    let currentList = null;
    let currentItem = null;

    for (const raw of lines) {
      if (!raw.trim() || raw.trim().startsWith("#")) continue;
      const indent = raw.match(/^\s*/)[0].length;
      const line = raw.trim();

      if (line.startsWith("- ")) {
        if (!currentList) continue;
        const rest = line.slice(2);
        currentItem = {};
        config[currentList].push(currentItem);
        if (rest.includes(":")) {
          const idx = rest.indexOf(":");
          currentItem[rest.slice(0, idx).trim()] = parseScalar(rest.slice(idx + 1));
        }
        continue;
      }

      const idx = line.indexOf(":");
      if (idx < 0) continue;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();

      if (indent === 0) {
        if (value === "") {
          config[key] = [];
          currentList = key;
          currentItem = null;
        } else {
          config[key] = parseScalar(value);
          currentList = null;
          currentItem = null;
        }
      } else if (currentItem) {
        currentItem[key] = parseScalar(value);
      }
    }

    return config;
  }

  async function loadConfig() {
    const res = await fetch("config.yaml?t=" + Date.now());
    state.config = parseYaml(await res.text());
    state.subcols = Number(state.config.subcols || 5);
    state.subrows = Number(state.config.subrows || 3);
    return state.config;
  }

  function absoluteUrl(path) {
    const base = String(state.config.base_url || window.location.origin).replace(/\/$/, "");
    return base + "/" + path.replace(/^\//, "");
  }

  function serverUrl(path) {
    return String(state.config.server_url || "").replace(/\/$/, "") + path;
  }

  function scriptUrl(path) {
    if (/^https?:\/\//i.test(String(path))) return path;
    if (String(path).startsWith("/")) return serverUrl(path);
    return path;
  }

  function realtimeUrl(path) {
    return String(state.config.realtime_url || state.config.server_url || "").replace(/\/$/, "") + path;
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function setHtml(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  function showFatal(message) {
    document.body.innerHTML = '<div class="page-wrap"><h2 class="error">' + message + "</h2></div>";
    throw new Error(message);
  }

  function logClient(level, message, details) {
    const entry = {
      timestamp: new Date().toISOString(),
      component: "pixel-pandemonium-client",
      level,
      message,
      details: details || {}
    };
    const logger = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    logger.call(console, "[PixelPandemonium]", entry);
  }

  function digitsOnly(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function luhnCheckDigit(payloadDigits) {
    const digits = digitsOnly(payloadDigits);
    let sum = 0;
    let alternate = true;
    for (let i = digits.length - 1; i >= 0; i--) {
      let n = parseInt(digits[i], 10);
      if (alternate) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      sum += n;
      alternate = !alternate;
    }
    return String((10 - (sum % 10)) % 10);
  }

  function clientValidateCheckDigit(code) {
    const digits = digitsOnly(code);
    return digits.length >= 2 && luhnCheckDigit(digits.slice(0, -1)) === digits.slice(-1);
  }

  function adminPassword() {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("adminPassword");
    if (fromUrl) {
      window.sessionStorage.setItem("pixelPandemoniumAdminPassword", fromUrl);
      return fromUrl;
    }
    const cached = window.sessionStorage.getItem("pixelPandemoniumAdminPassword");
    if (cached) return cached;
    const entered = window.prompt("Enter the Pixel Pandemonium admin password:");
    if (entered) window.sessionStorage.setItem("pixelPandemoniumAdminPassword", entered);
    return entered || "";
  }

  function adminQuery() {
    return "&adminPassword=" + encodeURIComponent(adminPassword());
  }

  async function validateInstance() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("instance");
    if (!code) showFatal("No instance code in URL. Please use the URL your teacher gave you.");
    if (!clientValidateCheckDigit(code)) showFatal("Invalid instance code. Please double-check the URL.");
    const res = await fetch(serverUrl("/instance/" + encodeURIComponent(code) + "/status"));
    const data = await res.json();
    if (!res.ok || !data.valid) showFatal(data.error || "This instance is no longer active.");
    state.instance = data;
    return data;
  }

  async function validateAdminInstance() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("instance");
    const admin = params.get("admin");
    if (!code || !admin) showFatal("Missing instance or admin code.");
    if (!clientValidateCheckDigit(code)) showFatal("Invalid instance code. Please double-check the URL.");
    const res = await fetch(serverUrl("/instance/" + encodeURIComponent(code) + "/admin?admin=" + encodeURIComponent(admin) + adminQuery()));
    const data = await res.json();
    if (!res.ok) showFatal(data.error || "This admin URL is not valid.");
    state.instance = {
      ...data,
      instanceCode: code,
      adminCode: admin,
      studentUrl: absoluteUrl("instructions.html?instance=" + encodeURIComponent(code)),
      replayUrl: absoluteUrl("replay.html?instance=" + encodeURIComponent(code))
    };
    return state.instance;
  }

  function findPicture(id) {
    return (state.config.pictures || []).find((pic) => pic.id === id) || state.config.pictures[0];
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src + "?t=" + Date.now();
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async function loadPicture(pictureId) {
    if (state.instance && state.instance.pictureCustom) {
      state.picture = {
        id: pictureId,
        title: state.instance.pictureTitle || "Custom Picture",
        script: state.instance.pictureSpecUrl || state.instance.pictureScript
      };
    } else {
      state.picture = findPicture(pictureId);
    }
    if (!state.picture) showFatal("No pictures are configured.");
    delete window.palette;
    delete window.pages;
    delete window.numRows;
    delete window.numCols;
    await loadScript(scriptUrl(state.picture.script));
    state.palette = window.palette || [];
    state.pages = window.pages || [];
    state.numRows = Number(window.numRows || 0);
    state.numCols = Number(window.numCols || 0);
    resetFilled();
    return state.picture;
  }

  function resetFilled() {
    state.filled = [];
    for (let r = 0; r < state.numRows * state.subrows; r++) {
      state.filled[r] = [];
      for (let c = 0; c < state.numCols * state.subcols; c++) {
        state.filled[r][c] = "";
      }
    }
  }

  function rgbToHex(r, g, b) {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  function lookupPage(row, col) {
    for (let i = 0; i < state.pages.length; i++) {
      if (String(state.pages[i].row) === String(row) && state.pages[i].col === col) return i;
    }
    return -1;
  }

  function pageLabel(row, col) {
    return String.fromCharCode("A".charCodeAt(0) + col) + String(row + 1);
  }

  function messageParts(message) {
    const parts = String(message || "").split(",");
    return {
      leftx: Number(parts[0]),
      topy: Number(parts[1]),
      rectwidth: Number(parts[2]),
      rectheight: Number(parts[3]),
      rectcolor: parts[4],
      xsquare: Number(parts[5]),
      ysquare: Number(parts[6])
    };
  }

  function applyMessage(message) {
    const msg = messageParts(message);
    if (
      msg.ysquare >= 0 && msg.ysquare < state.numRows * state.subrows &&
      msg.xsquare >= 0 && msg.xsquare < state.numCols * state.subcols &&
      msg.rectcolor && msg.rectcolor !== "undefined"
    ) {
      state.filled[msg.ysquare][msg.xsquare] = String(message);
    }
  }

  function expectedColor(majorRow, majorCol, subRow, subCol) {
    const colLetter = String.fromCharCode("A".charCodeAt(0) + majorCol);
    const idx = lookupPage(majorRow + 1, colLetter);
    if (idx < 0) return null;
    const colorIndex = state.pages[idx].uncompressed[subRow * state.subcols + subCol];
    const rgb = state.palette[colorIndex];
    return rgb ? rgbToHex(rgb[0], rgb[1], rgb[2]) : null;
  }

  function getTileStatus(majorRow, majorCol) {
    let filled = 0;
    let errors = 0;
    const total = state.subrows * state.subcols;
    for (let r = 0; r < state.subrows; r++) {
      for (let c = 0; c < state.subcols; c++) {
        const data = state.filled[majorRow * state.subrows + r][majorCol * state.subcols + c];
        if (data && data.trim()) {
          filled++;
          const actual = messageParts(data).rectcolor;
          const expected = expectedColor(majorRow, majorCol, r, c);
          if (expected && actual && actual.toLowerCase() !== expected.toLowerCase()) errors++;
        }
      }
    }
    if (filled === 0) return "blank";
    if (errors > 0) return "error";
    if (filled < total) return "in-progress";
    return "complete";
  }

  function incompleteLabels() {
    const labels = [];
    for (let col = 0; col < state.numCols; col++) {
      for (let row = 0; row < state.numRows; row++) {
        if (getTileStatus(row, col) !== "complete") labels.push(pageLabel(row, col));
      }
    }
    return labels;
  }

  function setPagesThatRemain() {
    const labels = incompleteLabels();
    setText("remainingPages", labels.length ? "Here are some pages that remain to be filled in: " + labels.join(", ") : "");
  }

  async function retrieveReplay() {
    const res = await fetch(serverUrl("/instance/" + encodeURIComponent(state.instance.instanceCode) + "/retrieve"));
    if (!res.ok) throw new Error("Retrieve failed");
    const rows = await res.json();
    resetFilled();
    rows.forEach((row) => applyMessage(row.DATA));
    setPagesThatRemain();
    return rows;
  }

  async function sendReplay(message) {
    const url = serverUrl("/instance/" + encodeURIComponent(state.instance.instanceCode) + "/insert");
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: message })
    });
    if (!res.ok) {
      const responseText = await res.text().catch(() => "");
      logClient("error", "Replay insert failed", {
        url,
        status: res.status,
        statusText: res.statusText,
        responseText,
        instanceCode: state.instance && state.instance.instanceCode,
        message
      });
      throw new Error("Replay insert failed with HTTP " + res.status);
    }
    return res;
  }

  function fayeChannel() {
    return "/faye/messages/" + state.instance.instanceCode;
  }

  function publishRealtime(message) {
    if (state.fayeClient) {
      state.fayeClient.publish(fayeChannel(), { text: message });
    } else if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({ channel: fayeChannel(), data: { text: message } }));
    }
  }

  async function setupRealtime(onMessage) {
    if (window.Faye) {
      state.fayeClient = new window.Faye.Client(realtimeUrl("/faye"));
      state.fayeClient.addExtension({
        outgoing: function (message, callback) {
          if (message.channel === "/meta/handshake") {
            message.ext = message.ext || {};
            message.ext.origin = window.location.origin;
          }
          callback(message);
        }
      });
      state.fayeClient.subscribe(fayeChannel(), function (message) {
        onMessage(message.text);
      });
      return;
    }

    const wsBase = realtimeUrl("/faye").replace(/^http/, "ws");
    state.ws = new WebSocket(wsBase + "?channel=" + encodeURIComponent(fayeChannel()));
    state.ws.onmessage = function (event) {
      const parsed = JSON.parse(event.data);
      const text = parsed.data && parsed.data.text ? parsed.data.text : parsed.text;
      if (text) onMessage(text);
    };
  }

  function loadFayeScript() {
    return new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = realtimeUrl("/faye/client.js");
      script.onload = resolve;
      script.onerror = resolve;
      document.head.appendChild(script);
    });
  }

  function drawGrid(ctx, canvas, majorCols, majorRows, subcols, subrows) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const gridwidth = canvas.width / majorCols;
    const gridheight = canvas.height / majorRows;
    ctx.strokeStyle = "black";
    for (let x = 0, count = 0; x <= canvas.width + 1; x += gridwidth / subcols, count++) {
      ctx.lineWidth = count % subcols === 0 ? 3 : 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0, count = 0; y <= canvas.height + 1; y += gridheight / subrows, count++) {
      ctx.lineWidth = count % subrows === 0 ? 3 : 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }
  }

  function drawTileGrid() {
    const canvas = document.getElementById("drawCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    drawGrid(ctx, canvas, 1, 1, state.subcols, state.subrows);
  }

  function drawGridSquare(canvas, rectcolor, xsquare, ysquare, localOnly) {
    const ctx = canvas.getContext("2d");
    const majorCols = localOnly ? 1 : state.numCols;
    const majorRows = localOnly ? 1 : state.numRows;
    const width = canvas.width / (majorCols * state.subcols);
    const height = canvas.height / (majorRows * state.subrows);
    ctx.fillStyle = rectcolor;
    ctx.fillRect(xsquare * width + 1, ysquare * height + 1, width - 1, height - 1);
  }

  function renderPalettes() {
    const holder = document.getElementById("colorpicker");
    if (!holder) return;
    holder.innerHTML = "";
    state.palette.forEach((rgb, i) => {
      const canvas = document.createElement("canvas");
      canvas.id = "canvascolor" + i;
      canvas.width = 64;
      canvas.height = 64;
      canvas.style.border = "1px solid #000000";
      canvas.dataset.color = rgbToHex(rgb[0], rgb[1], rgb[2]);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = canvas.dataset.color;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.font = "18px Arial";
      ctx.fillStyle = canvas.dataset.color === "#000000" ? "white" : "black";
      ctx.fillText(String(i), 28, 36);
      canvas.addEventListener("mousedown", () => {
        document.getElementById("chosenColor").value = canvas.dataset.color;
      });
      holder.appendChild(canvas);
    });
  }

  function showPixelMap(page) {
    let html = '<table width="50%" border="1" cellspacing="0" cellpadding="10">';
    let count = -1;
    for (let r = 0; r < state.subrows; r++) {
      html += "<tr>";
      for (let c = 0; c < state.subcols; c++) {
        count++;
        html += '<td class="mono" align="center">' + (page ? page.uncompressed[count] : "&nbsp;") + "</td>";
      }
      html += "</tr>";
    }
    html += "</table>";
    setHtml("pixelChart", html);
  }

  function renderTileSelector() {
    const canvas = document.getElementById("tileSelectorCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const tileW = canvas.width / state.numCols;
    const tileH = canvas.height / state.numRows;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let col = 0; col < state.numCols; col++) {
      for (let row = 0; row < state.numRows; row++) {
        const status = getTileStatus(row, col);
        ctx.fillStyle = status === "blank" ? "#FFF" : status === "complete" ? "#CCC" : status === "error" ? "#FFE0B2" : "#CCE5FF";
        ctx.fillRect(col * tileW + 1, row * tileH + 1, tileW - 2, tileH - 2);
        ctx.strokeStyle = state.selectedTile && state.selectedTile.row === row && state.selectedTile.col === col ? "#FF0000" : "#333";
        ctx.lineWidth = state.selectedTile && state.selectedTile.row === row && state.selectedTile.col === col ? 3 : 1;
        ctx.strokeRect(col * tileW, row * tileH, tileW, tileH);
        ctx.fillStyle = status === "complete" ? "#777" : "#333";
        ctx.font = "14px Arial";
        ctx.fillText(pageLabel(row, col), col * tileW + tileW / 2 - 12, row * tileH + tileH / 2 + 5);
      }
    }
  }

  function selectTile(row, col) {
    state.selectedTile = { row, col };
    const colLetter = String.fromCharCode("A".charCodeAt(0) + col);
    const pageIndex = lookupPage(row + 1, colLetter);
    if (pageIndex < 0) return;
    const page = state.pages[pageIndex];
    setText("thePage", colLetter + "-" + (row + 1));
    setText("data", page.uncompressed.join(" "));
    setText("compressed", page.compressed.join(" "));
    setText("tileStatusText", "Selected: " + pageLabel(row, col));
    showPixelMap(page);
    drawTileGrid();
    for (let r = 0; r < state.subrows; r++) {
      for (let c = 0; c < state.subcols; c++) {
        const data = state.filled[row * state.subrows + r][col * state.subcols + c];
        if (data && data.trim()) drawGridSquare(document.getElementById("drawCanvas"), messageParts(data).rectcolor, c, r, true);
      }
    }
    if (getTileStatus(row, col) === "error") highlightErrors(row, col);
    renderTileSelector();
  }

  function highlightErrors(row, col) {
    const canvas = document.getElementById("drawCanvas");
    const ctx = canvas.getContext("2d");
    const width = canvas.width / state.subcols;
    const height = canvas.height / state.subrows;
    for (let r = 0; r < state.subrows; r++) {
      for (let c = 0; c < state.subcols; c++) {
        const data = state.filled[row * state.subrows + r][col * state.subcols + c];
        if (!data || !data.trim()) continue;
        const actual = messageParts(data).rectcolor;
        const expected = expectedColor(row, col, r, c);
        if (expected && actual.toLowerCase() !== expected.toLowerCase()) {
          ctx.strokeStyle = "#FF0000";
          ctx.lineWidth = 3;
          ctx.strokeRect(c * width + 2, r * height + 2, width - 4, height - 4);
        }
      }
    }
  }

  function autoSelectTile() {
    const priorities = ["blank", "error", "in-progress"];
    for (const status of priorities) {
      for (let col = 0; col < state.numCols; col++) {
        for (let row = 0; row < state.numRows; row++) {
          if (getTileStatus(row, col) === status) {
            selectTile(row, col);
            return;
          }
        }
      }
    }
    setText("tileStatusText", "All tiles complete.");
  }

  function initTileSelector() {
    const canvas = document.getElementById("tileSelectorCanvas");
    canvas.addEventListener("click", (event) => {
      const rect = canvas.getBoundingClientRect();
      const col = Math.floor((event.clientX - rect.left) / (canvas.width / state.numCols));
      const row = Math.floor((event.clientY - rect.top) / (canvas.height / state.numRows));
      if (getTileStatus(row, col) === "complete") {
        setText("tileStatusText", "Already complete.");
        return;
      }
      selectTile(row, col);
    });
  }

  function initStudentCanvas() {
    const canvas = document.getElementById("drawCanvas");
    canvas.width = Number(state.config.student_canvas_width || 500);
    canvas.height = Number(state.config.student_canvas_height || 300);
    document.getElementById("chosenColor").value = rgbToHex(state.palette[0][0], state.palette[0][1], state.palette[0][2]);
    canvas.addEventListener("mousedown", async (event) => {
      if (event.button !== 0 || !state.selectedTile) return;
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const pageX = Math.floor(x / (canvas.width / state.subcols));
      const pageY = Math.floor(y / (canvas.height / state.subrows));
      const xSquare = state.selectedTile.col * state.subcols + pageX;
      const ySquare = state.selectedTile.row * state.subrows + pageY;
      const color = document.getElementById("chosenColor").value;
      const fullCellW = canvas.width / state.subcols;
      const fullCellH = canvas.height / state.subrows;
      const message = [xSquare * fullCellW, ySquare * fullCellH, fullCellW, fullCellH, color, xSquare, ySquare].join(",");
      drawGridSquare(canvas, color, pageX, pageY, true);
      applyMessage(message);
      try {
        await sendReplay(message);
        publishRealtime(message);
        setPagesThatRemain();
        renderTileSelector();
        if (getTileStatus(state.selectedTile.row, state.selectedTile.col) === "error") highlightErrors(state.selectedTile.row, state.selectedTile.col);
      } catch (err) {
        logClient("error", "Student canvas click failed", {
          error: err.message,
          stack: err.stack,
          selectedTile: state.selectedTile,
          message
        });
        setText("tileStatusText", "Save failed. Please click that pixel again.");
      }
    });
  }

  function drawReplayMessage(message) {
    const canvas = document.getElementById("drawCanvas");
    const msg = messageParts(message);
    drawGridSquare(canvas, msg.rectcolor, msg.xsquare, msg.ysquare, false);
  }

  function makeReplayGrid() {
    const canvas = document.getElementById("drawCanvas");
    const cell = Number(state.config.replay_cell_size || 24);
    canvas.width = state.numCols * state.subcols * cell;
    canvas.height = state.numRows * state.subrows * cell;
    drawGrid(canvas.getContext("2d"), canvas, state.numCols, state.numRows, state.subcols, state.subrows);
  }

  function replayRows(rows, delay) {
    const canvas = document.getElementById("drawCanvas");
    makeReplayGrid();
    let i = 0;
    clearInterval(state.replayTimer);
    state.replayTimer = setInterval(() => {
      if (i >= rows.length) {
        clearInterval(state.replayTimer);
        return;
      }
      drawReplayMessage(rows[i].DATA);
      i++;
    }, delay);
    if (rows.length === 0) clearInterval(state.replayTimer);
  }

  function adminAnimationDelay(defaultDelay) {
    const params = new URLSearchParams(window.location.search);
    const delay = Number(params.get("animationDelayMs"));
    return Number.isFinite(delay) && delay >= 0 ? delay : defaultDelay;
  }

  function orderedRows(rows) {
    const copy = rows.slice();
    const order = document.getElementById("animationOrder");
    if (order && order.value === "random") {
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = copy[i];
        copy[i] = copy[j];
        copy[j] = tmp;
      }
    }
    return copy;
  }

  function completedImageRows(existingRows, mode) {
    const existingByCell = new Map();
    existingRows.forEach((row) => {
      const msg = messageParts(row.DATA);
      if (Number.isFinite(msg.xsquare) && Number.isFinite(msg.ysquare)) {
        existingByCell.set(msg.xsquare + "," + msg.ysquare, row);
      }
    });

    const expectedRows = expectedCompletionRows();
    const missing = [];
    expectedRows.forEach((row) => {
      const msg = messageParts(row.DATA);
      const key = msg.xsquare + "," + msg.ysquare;
      if (!existingByCell.has(key)) missing.push(row);
    });

    if (mode === "random") {
      for (let i = missing.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = missing[i];
        missing[i] = missing[j];
        missing[j] = tmp;
      }
    }

    return existingRows.concat(missing);
  }

  function rowsFromFilled() {
    const rows = [];
    for (let r = 0; r < state.filled.length; r++) {
      for (let c = 0; c < state.filled[r].length; c++) {
        if (state.filled[r][c]) rows.push({ DATA: state.filled[r][c] });
      }
    }
    return rows;
  }

  function expectedCompletionRows() {
    const rows = [];
    const canvas = document.getElementById("drawCanvas");
    const cellW = canvas.width / (state.numCols * state.subcols);
    const cellH = canvas.height / (state.numRows * state.subrows);
    for (let majorCol = 0; majorCol < state.numCols; majorCol++) {
      for (let majorRow = 0; majorRow < state.numRows; majorRow++) {
        const pageIndex = lookupPage(majorRow + 1, String.fromCharCode("A".charCodeAt(0) + majorCol));
        if (pageIndex < 0) continue;
        const page = state.pages[pageIndex];
        for (let r = 0; r < state.subrows; r++) {
          for (let c = 0; c < state.subcols; c++) {
            const xSquare = majorCol * state.subcols + c;
            const ySquare = majorRow * state.subrows + r;
            const colorIndex = page.uncompressed[r * state.subcols + c];
            const rgb = state.palette[colorIndex];
            rows.push({ DATA: [xSquare * cellW, ySquare * cellH, cellW, cellH, rgbToHex(rgb[0], rgb[1], rgb[2]), xSquare, ySquare].join(",") });
          }
        }
      }
    }
    return rows;
  }

  function dimensionScore(width, height, option) {
    const aspect = width / height;
    const optionAspect = option[0] / option[1];
    return Math.abs(Math.log(aspect / optionAspect)) + Math.abs(Math.log((width * height) / (option[0] * option[1]))) * 0.25;
  }

  async function loadPriorDimensions() {
    const found = new Map();
    await Promise.all((state.config.pictures || []).map(async (picture) => {
      try {
        const res = await fetch(picture.script + "?t=" + Date.now());
        if (!res.ok) return;
        const text = await res.text();
        const rows = Number((text.match(/var\s+numRows\s*=\s*(\d+)/) || [])[1]);
        const cols = Number((text.match(/var\s+numCols\s*=\s*(\d+)/) || [])[1]);
        if (rows > 0 && cols > 0) found.set(`${cols * state.subcols}x${rows * state.subrows}`, [cols * state.subcols, rows * state.subrows]);
      } catch (err) {
        logClient("warn", "Could not read prior picture dimensions", { pictureId: picture.id, error: err.message });
      }
    }));
    priorDimensions = Array.from(found.values()).sort((a, b) => (a[0] * a[1]) - (b[0] * b[1]) || a[0] - b[0]);
    if (!priorDimensions.length) priorDimensions = [[state.subcols, state.subrows]];
  }

  function populateDimensionPresets(imageWidth, imageHeight) {
    const select = document.getElementById("dimensionPreset");
    if (!select) return;
    if (!priorDimensions.length) priorDimensions = [[state.subcols, state.subrows]];
    select.innerHTML = "";
    let bestIndex = 0;
    priorDimensions.forEach((dim, index) => {
      if (imageWidth && imageHeight && dimensionScore(imageWidth, imageHeight, dim) < dimensionScore(imageWidth, imageHeight, priorDimensions[bestIndex])) bestIndex = index;
    });
    priorDimensions.forEach((dim, index) => {
      const option = document.createElement("option");
      option.value = dim.join("x");
      option.textContent = dim.join("x") + (index === bestIndex && imageWidth ? " (closest)" : "");
      select.appendChild(option);
    });
    const custom = document.createElement("option");
    custom.value = "custom";
    custom.textContent = "Custom";
    select.appendChild(custom);
    select.selectedIndex = bestIndex;
    document.getElementById("customWidth").value = priorDimensions[bestIndex][0];
    document.getElementById("customHeight").value = priorDimensions[bestIndex][1];
  }

  function selectedDimensions() {
    const preset = document.getElementById("dimensionPreset").value;
    if (preset && preset !== "custom") {
      const parts = preset.split("x").map(Number);
      return { width: parts[0], height: parts[1] };
    }
    return {
      width: Number(document.getElementById("customWidth").value),
      height: Number(document.getElementById("customHeight").value)
    };
  }

  function parsePaletteText(text) {
    return String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const parts = line.replace(/[#[\]]/g, "").split(/[,\s]+/).filter(Boolean).map(Number);
      if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) throw new Error("Palette lines must be RGB values like 255,255,255");
      return parts;
    });
  }

  function paletteToText(palette) {
    return palette.map((rgb) => rgb.join(",")).join("\n");
  }

  function nearestPaletteIndex(rgb, palette) {
    let best = 0;
    let bestDistance = Infinity;
    palette.forEach((color, index) => {
      const d = Math.pow(rgb[0] - color[0], 2) + Math.pow(rgb[1] - color[1], 2) + Math.pow(rgb[2] - color[2], 2);
      if (d < bestDistance) {
        best = index;
        bestDistance = d;
      }
    });
    return best;
  }

  function autoPaletteFromPixels(pixels, maxColors) {
    const counts = new Map();
    for (let i = 0; i < pixels.length; i += 4) {
      const key = [pixels[i], pixels[i + 1], pixels[i + 2]].join(",");
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxColors)
      .map(([key]) => key.split(",").map(Number));
  }

  function compressPixels(pixels) {
    const compressed = [];
    let prev = pixels[0];
    let count = 1;
    for (let i = 1; i < pixels.length; i++) {
      if (pixels[i] === prev) count++;
      else {
        compressed.push(count, prev);
        prev = pixels[i];
        count = 1;
      }
    }
    compressed.push(count, prev);
    return compressed;
  }

  function specFromIndexedPixels(indexes, width, height, palette) {
    const paddedWidth = Math.ceil(width / state.subcols) * state.subcols;
    const paddedHeight = Math.ceil(height / state.subrows) * state.subrows;
    let whiteIndex = palette.findIndex((rgb) => rgb[0] === 255 && rgb[1] === 255 && rgb[2] === 255);
    if (whiteIndex < 0) {
      palette = palette.concat([[255, 255, 255]]);
      whiteIndex = palette.length - 1;
    }
    const padded = [];
    for (let y = 0; y < paddedHeight; y++) {
      for (let x = 0; x < paddedWidth; x++) {
        padded[y * paddedWidth + x] = x < width && y < height ? indexes[y * width + x] : whiteIndex;
      }
    }
    const numRows = paddedHeight / state.subrows;
    const numCols = paddedWidth / state.subcols;
    const pages = [];
    for (let col = 0; col < numCols; col++) {
      for (let row = 0; row < numRows; row++) {
        const uncompressed = [];
        for (let y = row * state.subrows; y < (row + 1) * state.subrows; y++) {
          for (let x = col * state.subcols; x < (col + 1) * state.subcols; x++) {
            uncompressed.push(padded[y * paddedWidth + x]);
          }
        }
        pages.push({
          col: String.fromCharCode("A".charCodeAt(0) + col),
          row: String(row + 1),
          uncompressed,
          compressed: compressPixels(uncompressed)
        });
      }
    }
    return { palette, numRows, numCols, pages };
  }

  function drawSpecPreview(spec) {
    const canvas = document.getElementById("customPreviewCanvas");
    if (!canvas || !spec) return;
    const width = spec.numCols * state.subcols;
    const height = spec.numRows * state.subrows;
    const scale = Math.max(1, Math.floor(Math.min(300 / width, 180 / height)));
    canvas.width = width * scale;
    canvas.height = height * scale;
    canvas.style.display = "block";
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    spec.pages.forEach((page) => {
      const col = page.col.charCodeAt(0) - "A".charCodeAt(0);
      const row = Number(page.row) - 1;
      page.uncompressed.forEach((pixel, index) => {
        const localX = index % state.subcols;
        const localY = Math.floor(index / state.subcols);
        const rgb = spec.palette[pixel] || [255, 255, 255];
        ctx.fillStyle = rgbToHex(rgb[0], rgb[1], rgb[2]);
        ctx.fillRect((col * state.subcols + localX) * scale, (row * state.subrows + localY) * scale, scale, scale);
      });
    });
  }

  function parseJsArrayAssignment(text, name, nextName) {
    const startMarker = "var " + name + " =";
    const start = text.indexOf(startMarker);
    if (start < 0) throw new Error("Missing var " + name);
    const valueStart = start + startMarker.length;
    const next = nextName ? text.indexOf("var " + nextName, valueStart) : -1;
    const raw = (next >= 0 ? text.slice(valueStart, next) : text.slice(valueStart)).trim().replace(/;\s*$/, "");
    return JSON.parse(raw);
  }

  function parseCompositeJs(text) {
    const palette = parseJsArrayAssignment(text, "palette", "numRows");
    const numRows = Number((text.match(/var\s+numRows\s*=\s*(\d+)/) || [])[1]);
    const numCols = Number((text.match(/var\s+numCols\s*=\s*(\d+)/) || [])[1]);
    const pages = parseJsArrayAssignment(text, "pages", null);
    return { palette, numRows, numCols, pages };
  }

  function parseCompositeCsv(text, palette) {
    if (!palette || !palette.length) throw new Error("Composite CSV requires a color map or palette");
    const lines = String(text).trim().split(/\r?\n/).slice(1).filter(Boolean);
    const pages = lines.map((line) => {
      const cells = line.split(",");
      const uncompressed = cells.slice(2, 17).map(Number);
      const compressed = cells.slice(17).filter((item) => item !== "").map(Number);
      return { col: cells[0].trim(), row: cells[1].trim(), uncompressed, compressed };
    });
    const cols = new Set(pages.map((page) => page.col)).size;
    const rows = Math.max(...pages.map((page) => Number(page.row)));
    return { palette, numRows: rows, numCols: cols, pages };
  }

  function parseColorMap(text) {
    const colors = [];
    String(text).split(/\r?\n/).forEach((line) => {
      const match = line.match(/^\s*\d+\s*:\s*(\d+)\s+(\d+)\s+(\d+)/);
      if (match) colors.push([Number(match[1]), Number(match[2]), Number(match[3])]);
    });
    return colors;
  }

  function validateClientSpec(spec) {
    if (!spec || !Array.isArray(spec.palette) || !spec.palette.length) throw new Error("A palette is required");
    if (!Number.isInteger(Number(spec.numRows)) || !Number.isInteger(Number(spec.numCols))) throw new Error("Dimensions are required");
    if (!Array.isArray(spec.pages) || spec.pages.length !== Number(spec.numRows) * Number(spec.numCols)) throw new Error("Page data is incomplete");
    spec.pages.forEach((page) => {
      if (!Array.isArray(page.uncompressed) || page.uncompressed.length !== state.subrows * state.subcols) throw new Error("Each page needs 15 pixels");
      if (!Array.isArray(page.compressed) || !page.compressed.length) page.compressed = compressPixels(page.uncompressed);
    });
    return spec;
  }

  function specToJs(spec) {
    return "var palette = " + JSON.stringify(spec.palette, null, 2) + ";\n" +
      "var numRows = " + spec.numRows + " ;\n" +
      "var numCols = " + spec.numCols + " ;\n" +
      "var pages = " + JSON.stringify(spec.pages, null, 2) + ";\n";
  }

  function generateClientArtifacts(title, spec) {
    const base = String(title || "custom").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "custom";
    const header = ["PageRow", "PageColumn"];
    for (let i = 1; i <= 15; i++) header.push("pixel" + i);
    for (let i = 1; i <= 15; i++) header.push("count" + i, "color" + i);
    const csv = [header.join(",")].concat(spec.pages.map((page) => {
      const compressed = page.compressed.slice();
      while (compressed.length < 30) compressed.push("");
      return [page.col, page.row].concat(page.uncompressed, compressed).join(",");
    })).join("\n") + "\n";
    const colorMap = spec.palette.map((rgb, i) => i + ": " + rgb.join(" ")).join("\n") + "\n";
    const files = {};
    files["Post-It_" + base + "_composite.js"] = specToJs(spec);
    files["Post-It_" + base + "_composite.csv"] = csv;
    files["Post-It_" + base + "_uncompressed.txt"] = spec.pages.map((page) => page.col + "\t" + page.row + "\t" + page.uncompressed.join("\t")).join("\n") + "\n";
    files["Post-It_" + base + "_compressed.txt"] = spec.pages.map((page) => page.col + "\t" + page.row + "\t" + page.compressed.join("\t")).join("\n") + "\n";
    files["ColorMap_" + base + ".txt"] = colorMap;
    files["ColorMap_" + base + ".html"] = "<!doctype html><html><body><h1>" + title + "</h1><pre>" + colorMap + "</pre></body></html>\n";
    return files;
  }

  function readFileText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }

  function readImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function analyzeSpecFiles() {
    const files = Array.from(document.getElementById("specFiles").files || []);
    if (!files.length) throw new Error("Choose at least one posterizer file");
    let palette = null;
    let csv = null;
    for (const file of files) {
      const text = await readFileText(file);
      if (/composite\.js$/i.test(file.name)) return validateClientSpec(parseCompositeJs(text));
      if (/composite\.csv$/i.test(file.name)) csv = text;
      if (/colormap_.*\.(txt|html)$/i.test(file.name)) palette = parseColorMap(text);
    }
    if (csv) return validateClientSpec(parseCompositeCsv(csv, palette));
    throw new Error("Missing complete spec data. Add a composite JS file, or composite CSV plus ColorMap.");
  }

  async function analyzeImageFile() {
    const file = document.getElementById("imageFile").files[0];
    if (!file) throw new Error("Choose a GIF or image");
    const img = await readImage(file);
    populateDimensionPresets(img.naturalWidth, img.naturalHeight);
    const dims = selectedDimensions();
    if (!dims.width || !dims.height) throw new Error("Choose output dimensions");
    const canvas = document.createElement("canvas");
    canvas.width = dims.width;
    canvas.height = dims.height;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, 0, 0, dims.width, dims.height);
    const imageData = ctx.getImageData(0, 0, dims.width, dims.height);
    let palette = parsePaletteText(document.getElementById("paletteEditor").value);
    if (!palette.length) {
      palette = autoPaletteFromPixels(imageData.data, 12);
      document.getElementById("paletteEditor").value = paletteToText(palette);
    }
    const indexes = [];
    for (let i = 0; i < imageData.data.length; i += 4) {
      indexes.push(nearestPaletteIndex([imageData.data[i], imageData.data[i + 1], imageData.data[i + 2]], palette));
    }
    return validateClientSpec(specFromIndexedPixels(indexes, dims.width, dims.height, palette));
  }

  async function analyzeCustomPicture() {
    const mode = document.getElementById("creationMode").value;
    if (mode === "static") return null;
    const title = document.getElementById("customTitle").value || "Custom Picture";
    const spec = mode === "spec" ? await analyzeSpecFiles() : await analyzeImageFile();
    const artifacts = generateClientArtifacts(title, spec);
    customDraft = { title, spec, artifacts };
    drawSpecPreview(spec);
    setHtml("customPictureStatus", '<p class="ok">Custom picture ready: ' + spec.numCols + " columns by " + spec.numRows + " rows.</p>");
    return customDraft;
  }

  async function ensureCustomPicture() {
    const mode = document.getElementById("creationMode").value;
    if (mode === "static") return document.getElementById("pictureId").value;
    if (!customDraft) await analyzeCustomPicture();
    const res = await fetch(serverUrl("/pictures/custom"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...customDraft, adminPassword: adminPassword() })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Custom picture upload failed");
    setHtml("customPictureStatus", '<p class="ok">Custom picture uploaded. <a href="' + serverUrl(data.zipUrl) + '">Download spec files zip</a></p>');
    return data.id;
  }

  async function initDashboard() {
    await loadConfig();
    priorDimensions = [[state.subcols, state.subrows]];
    populateDimensionPresets();
    loadPriorDimensions().then(() => {
      populateDimensionPresets(
        currentImageDimensions && currentImageDimensions.width,
        currentImageDimensions && currentImageDimensions.height
      );
    }).catch((err) => {
      logClient("warn", "Could not load prior dimensions", { error: err.message });
    });
    const pictureSelect = document.getElementById("pictureId");
    state.config.pictures.forEach((pic) => {
      const option = document.createElement("option");
      option.value = pic.id;
      option.textContent = pic.title;
      pictureSelect.appendChild(option);
    });
    document.getElementById("expirationHours").value = state.config.default_expiration_hours || 72;
    document.getElementById("dateTime").value = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

    const params = new URLSearchParams(window.location.search);
    if (params.get("instance")) {
      document.getElementById("resetInstanceCode").value = params.get("instance");
      document.getElementById("resetAdminCode").value = params.get("admin") || "";
    }

    function syncMode() {
      const mode = document.getElementById("creationMode").value;
      const isStatic = mode === "static";
      document.getElementById("pictureId").disabled = !isStatic;
      document.getElementById("customTitle").disabled = isStatic;
      document.getElementById("specFiles").disabled = mode !== "spec";
      document.getElementById("imageFile").disabled = mode !== "image";
      document.getElementById("dimensionPreset").disabled = mode !== "image";
      document.getElementById("customWidth").disabled = mode !== "image";
      document.getElementById("customHeight").disabled = mode !== "image";
      document.getElementById("paletteEditor").disabled = isStatic;
      document.getElementById("analyzeCustomButton").disabled = isStatic;
      document.getElementById("remapPaletteButton").disabled = mode !== "image";
      if (isStatic) {
        customDraft = null;
        setHtml("customPictureStatus", "");
        const preview = document.getElementById("customPreviewCanvas");
        if (preview) preview.style.display = "none";
      }
    }

    document.getElementById("creationMode").addEventListener("change", syncMode);
    document.getElementById("dimensionPreset").addEventListener("change", () => {
      const dims = selectedDimensions();
      if (dims.width && dims.height) {
        document.getElementById("customWidth").value = dims.width;
        document.getElementById("customHeight").value = dims.height;
      }
      customDraft = null;
    });
    document.getElementById("customWidth").addEventListener("input", () => {
      document.getElementById("dimensionPreset").value = "custom";
      customDraft = null;
    });
    document.getElementById("customHeight").addEventListener("input", () => {
      document.getElementById("dimensionPreset").value = "custom";
      customDraft = null;
    });
    async function handleImageFileChange() {
      customDraft = null;
      const file = document.getElementById("imageFile").files[0];
      if (!file) return;
      try {
        const img = await readImage(file);
        currentImageDimensions = { width: img.naturalWidth, height: img.naturalHeight };
        if (priorDimensions.length <= 1) await loadPriorDimensions();
        populateDimensionPresets(img.naturalWidth, img.naturalHeight);
        setHtml("customPictureStatus", '<p>Image loaded. Review dimensions and palette, then analyze.</p>');
      } catch (err) {
        setHtml("customPictureStatus", '<p class="error">' + err.message + "</p>");
      }
    }
    document.getElementById("imageFile").addEventListener("change", handleImageFileChange);
    document.getElementById("specFiles").addEventListener("change", () => { customDraft = null; });
    document.getElementById("paletteEditor").addEventListener("input", () => { customDraft = null; });
    document.getElementById("analyzeCustomButton").addEventListener("click", async () => {
      try {
        await analyzeCustomPicture();
      } catch (err) {
        setHtml("customPictureStatus", '<p class="error">' + err.message + "</p>");
      }
    });
    document.getElementById("remapPaletteButton").addEventListener("click", async () => {
      try {
        customDraft = null;
        await analyzeCustomPicture();
      } catch (err) {
        setHtml("customPictureStatus", '<p class="error">' + err.message + "</p>");
      }
    });
    syncMode();
    if (document.getElementById("imageFile").files.length) handleImageFileChange();

    document.getElementById("createForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const pictureId = await ensureCustomPicture();
        const body = {
          pictureId,
          teacherName: document.getElementById("teacherName").value,
          dateTime: document.getElementById("dateTime").value,
          expirationHours: Number(document.getElementById("expirationHours").value)
        };
        const res = await fetch(serverUrl("/instance/create"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok) {
          setHtml("createResult", '<p class="error">' + (data.error || "Create failed") + "</p>");
          return;
        }
        renderCreatedInstance(data);
      } catch (err) {
        setHtml("createResult", '<p class="error">' + err.message + "</p>");
      }
    });

    document.getElementById("resetForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const code = document.getElementById("resetInstanceCode").value;
      const adminCode = document.getElementById("resetAdminCode").value;
      const res = await fetch(serverUrl("/instance/" + encodeURIComponent(code) + "/reset"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminCode, adminPassword: adminPassword() })
      });
      const data = await res.json();
      setHtml("resetResult", res.ok ? '<p class="ok">Instance reset.</p>' : '<p class="error">' + (data.error || "Reset failed") + "</p>");
    });
  }

  async function adminFetchRows() {
    const res = await fetch(serverUrl("/instance/" + encodeURIComponent(state.instance.instanceCode) + "/admin?admin=" + encodeURIComponent(state.instance.adminCode) + adminQuery()));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Admin fetch failed");
    resetFilled();
    data.rows.forEach((row) => applyMessage(row.DATA));
    state.instance.rows = data.rows;
    return data.rows;
  }

  function renderAdminRows(rows) {
    if (!rows.length) {
      setHtml("adminRows", "<p>No replay rows for this instance.</p>");
      return;
    }
    const html = [
      '<table class="admin-table">',
      "<thead><tr><th>ID</th><th>Timestamp</th><th>Data</th><th>Actions</th></tr></thead><tbody>"
    ];
    rows.forEach((row) => {
      html.push(
        '<tr data-row-id="' + row.ID + '">',
        "<td>" + row.ID + "</td>",
        "<td>" + row.TIMESTAMP + "</td>",
        '<td><textarea data-role="data">' + String(row.DATA || "").replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</textarea></td>",
        '<td><button type="button" data-action="update">Update</button> <button type="button" data-action="delete">Delete</button></td>',
        "</tr>"
      );
    });
    html.push("</tbody></table>");
    setHtml("adminRows", html.join(""));
  }

  function renderAdminTileSummary() {
    const incomplete = [];
    const mistakes = [];
    for (let col = 0; col < state.numCols; col++) {
      for (let row = 0; row < state.numRows; row++) {
        const status = getTileStatus(row, col);
        if (status !== "complete") incomplete.push(pageLabel(row, col));
        if (status === "error") mistakes.push(pageLabel(row, col));
      }
    }
    setHtml("adminTileSummary", [
      "<p><strong>Incomplete pages:</strong> " + (incomplete.length ? incomplete.join(", ") : "None") + "</p>",
      "<p><strong>Pages with mistakes:</strong> " + (mistakes.length ? mistakes.join(", ") : "None") + "</p>"
    ].join(""));
  }

  async function refreshAdmin() {
    const rows = await adminFetchRows();
    renderAdminRows(rows);
    renderAdminTileSummary();
    makeReplayGrid();
    rowsFromFilled().forEach((row) => drawReplayMessage(row.DATA));
  }

  async function initAdmin() {
    await loadConfig();
    await validateAdminInstance();
    await loadPicture(state.instance.pictureId);
    setText("pictureTitle", state.picture.title);
    setText("instanceCode", state.instance.instanceCode);
    document.getElementById("studentLink").href = state.instance.studentUrl;
    document.getElementById("studentLink").textContent = state.instance.studentUrl;
    document.getElementById("replayLink").href = state.instance.replayUrl;
    document.getElementById("replayLink").textContent = state.instance.replayUrl;
    setHtml("adminStatus", '<p class="ok">Admin access loaded for ' + state.instance.teacherName + ".</p>");
    await refreshAdmin();

    document.getElementById("refreshRowsButton").addEventListener("click", refreshAdmin);
    document.getElementById("adminReplayButton").addEventListener("click", async () => {
      const rows = await adminFetchRows();
      const source = document.getElementById("animationSource").value;
      const order = document.getElementById("animationOrder").value;
      if (source === "finished") {
        replayRows(completedImageRows(order === "random" ? orderedRows(rows) : rows, order), adminAnimationDelay(5));
      } else {
        replayRows(orderedRows(rows), adminAnimationDelay(5));
      }
    });
    document.getElementById("adminFinishButton").addEventListener("click", () => {
      makeReplayGrid();
      const order = document.getElementById("animationOrder").value;
      const rows = order === "existing-then-sequential"
        ? completedImageRows(state.instance.rows || [], order)
        : order === "random"
          ? completedImageRows(orderedRows(state.instance.rows || []), order)
          : completedImageRows(state.instance.rows || [], "existing-then-sequential");
      replayRows(rows, adminAnimationDelay(1));
    });
    document.getElementById("deleteInstanceButton").addEventListener("click", async () => {
      if (!window.confirm("Deactivate this instance? Replay data will be preserved, but students will no longer be able to access it.")) return;
      const res = await fetch(serverUrl("/instance/" + encodeURIComponent(state.instance.instanceCode) + "/deactivate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminCode: state.instance.adminCode, adminPassword: adminPassword() })
      });
      const data = await res.json();
      setHtml("adminStatus", res.ok ? '<p class="ok">Instance deactivated. Replay data was preserved.</p>' : '<p class="error">' + (data.error || "Deactivate failed") + "</p>");
    });
    document.getElementById("adminRows").addEventListener("click", async (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      const rowEl = button.closest("tr[data-row-id]");
      const id = rowEl.dataset.rowId;
      const action = button.dataset.action;
      const endpoint = "/instance/" + encodeURIComponent(state.instance.instanceCode) + "/event/" + encodeURIComponent(id) + "/" + action;
      const body = { adminCode: state.instance.adminCode, adminPassword: adminPassword() };
      if (action === "update") body.data = rowEl.querySelector('textarea[data-role="data"]').value;
      const res = await fetch(serverUrl(endpoint), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      setHtml("adminStatus", res.ok ? '<p class="ok">Row ' + action + "d.</p>" : '<p class="error">' + (data.error || "Action failed") + "</p>");
      if (res.ok) await refreshAdmin();
    });
  }

  function qrUrl(value) {
    return "https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=" + encodeURIComponent(value);
  }

  function renderCreatedInstance(data) {
    setHtml("createResult", [
      '<div class="panel">',
      '<p class="ok">Instance created.</p>',
      '<p><strong>Instance Code:</strong> <span class="mono">' + data.instanceCode + "</span></p>",
      '<p><strong>Expires:</strong> ' + data.expiresAt + "</p>",
      '<label>Student URL<br><input class="url-box" readonly value="' + data.studentUrl + '"></label>',
      '<br><label>Replay URL<br><input class="url-box" readonly value="' + data.replayUrl + '"></label>',
      '<br><label>Admin URL<br><input class="url-box" readonly value="' + data.adminUrl + '"></label>',
      '<div class="qr-row">',
      '<div><h3>Student QR</h3><img alt="Student QR" src="' + qrUrl(data.studentUrl) + '"></div>',
      '<div><h3>Teacher/Admin QR</h3><img alt="Teacher QR" src="' + qrUrl(data.adminUrl) + '"></div>',
      "</div>",
      "</div>"
    ].join(""));
    document.getElementById("resetInstanceCode").value = data.instanceCode;
    document.getElementById("resetAdminCode").value = data.adminCode;
  }

  async function initStudent() {
    await loadConfig();
    await validateInstance();
    await loadPicture(state.instance.pictureId);
    setText("pictureTitle", state.picture.title);
    setText("instanceCode", state.instance.instanceCode);
    renderPalettes();
    showPixelMap(null);
    initTileSelector();
    initStudentCanvas();
    await retrieveReplay();
    renderTileSelector();
    autoSelectTile();
    await loadFayeScript();
    await setupRealtime((message) => {
      applyMessage(message);
      setPagesThatRemain();
      renderTileSelector();
    });
  }

  async function initReplay() {
    await loadConfig();
    await validateInstance();
    await loadPicture(state.instance.pictureId);
    setText("pictureTitle", state.picture.title);
    setText("instanceCode", state.instance.instanceCode);
    makeReplayGrid();
    const rows = await retrieveReplay();
    replayRows(rows, 5);
    document.getElementById("replayButton").addEventListener("click", () => replayRows(rows, 5));
    document.getElementById("finishButton").addEventListener("click", () => replayRows(expectedCompletionRows(), 1));
    await loadFayeScript();
    await setupRealtime((message) => {
      applyMessage(message);
      drawReplayMessage(message);
    });
  }

  async function initIndex() {
    await loadConfig();
    const selector = document.getElementById("pageSelector");
    state.config.pictures.forEach((pic) => {
      const option = document.createElement("option");
      option.value = pic.id;
      option.textContent = pic.title;
      selector.appendChild(option);
    });
  }

  window.PixelPandemonium = {
    initDashboard,
    initAdmin,
    initStudent,
    initReplay,
    initIndex,
    absoluteUrl,
    __test: {
      parseYaml,
      clientValidateCheckDigit,
      luhnCheckDigit,
      rgbToHex,
      getTileStatus: function (row, col) { return getTileStatus(row, col); },
      state
    }
  };
})();
