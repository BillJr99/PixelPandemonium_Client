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
    const res = await fetch(serverUrl("/instance/" + encodeURIComponent(code) + "/admin?admin=" + encodeURIComponent(admin)));
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
    state.picture = findPicture(pictureId);
    if (!state.picture) showFatal("No pictures are configured.");
    delete window.palette;
    delete window.pages;
    delete window.numRows;
    delete window.numCols;
    await loadScript(state.picture.script);
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

  async function initDashboard() {
    await loadConfig();
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

    document.getElementById("createForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const body = {
        pictureId: pictureSelect.value,
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
    });

    document.getElementById("resetForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const code = document.getElementById("resetInstanceCode").value;
      const adminCode = document.getElementById("resetAdminCode").value;
      const res = await fetch(serverUrl("/instance/" + encodeURIComponent(code) + "/reset"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminCode })
      });
      const data = await res.json();
      setHtml("resetResult", res.ok ? '<p class="ok">Instance reset.</p>' : '<p class="error">' + (data.error || "Reset failed") + "</p>");
    });
  }

  async function adminFetchRows() {
    const res = await fetch(serverUrl("/instance/" + encodeURIComponent(state.instance.instanceCode) + "/admin?admin=" + encodeURIComponent(state.instance.adminCode)));
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
        body: JSON.stringify({ adminCode: state.instance.adminCode })
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
      const body = { adminCode: state.instance.adminCode };
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
