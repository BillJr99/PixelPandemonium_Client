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
  let instanceListMode = "dashboard";

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

  // The picture catalog now lives entirely on the server (predefined + custom).
  // Fetch it for the create/admin/index menus. Call after loadConfig so server_url
  // is known. Tolerant of failure so a page still loads with an empty menu.
  async function loadPictures() {
    try {
      const res = await fetch(serverUrl("/pictures"));
      if (!res.ok) throw new Error("HTTP " + res.status);
      state.pictures = await res.json();
    } catch (err) {
      logClient("warn", "Could not load picture catalog from server", { error: err.message });
      state.pictures = state.pictures || [];
    }
    return state.pictures;
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

  // Lightweight, self-contained toast. Builds its own fixed-position container
  // and styling so it works on any page that loads this script without needing
  // extra HTML/CSS. Pass { type: "success" } for a green toast; default is an
  // error (red) toast. Auto-dismisses after durationMs (default 4s).
  // Shows a toast. opts.type: "error" (default, red), "success" (green), "info"
  // (blue). opts.persist keeps it on screen until the returned dismiss() is called;
  // otherwise it auto-hides after opts.durationMs (default 4000). Returns dismiss().
  function showToast(message, opts) {
    if (typeof document === "undefined" || !document.body) return function () {};
    let holder = document.getElementById("toastHolder");
    if (!holder) {
      holder = document.createElement("div");
      holder.id = "toastHolder";
      holder.style.cssText =
        "position:fixed;top:1rem;right:1rem;z-index:9999;display:flex;" +
        "flex-direction:column;gap:0.5rem;max-width:min(90vw,360px);";
      document.body.appendChild(holder);
    }
    const type = (opts && opts.type) || "error";
    const background = type === "success" ? "#2e7d32" : type === "info" ? "#1565c0" : "#b00020";
    const toast = document.createElement("div");
    toast.setAttribute("role", type === "error" ? "alert" : "status");
    toast.style.cssText =
      "padding:0.6rem 0.9rem;border-radius:6px;color:#fff;font-size:0.95rem;" +
      "line-height:1.3;box-shadow:0 2px 8px rgba(0,0,0,0.25);opacity:0;" +
      "transition:opacity 0.15s ease;background:" + background + ";";
    toast.textContent = message;
    holder.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = "1"; });
    let dismissed = false;
    function dismiss() {
      if (dismissed) return;
      dismissed = true;
      toast.style.opacity = "0";
      setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 200);
    }
    if (!opts || !opts.persist) {
      setTimeout(dismiss, (opts && opts.durationMs) || 4000);
    }
    return dismiss;
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
    if (String(code || "").toLowerCase() === "tetris") return true;
    const digits = digitsOnly(code);
    if (digits.length < 11) return false;
    const suffix = digits.slice(-11);
    return luhnCheckDigit(suffix.slice(0, -1)) === suffix.slice(-1);
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

  function teacherAccessKey() {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("teacherAccessKey");
    if (fromUrl) {
      window.sessionStorage.setItem("pixelPandemoniumTeacherAccessKey", fromUrl);
      return fromUrl;
    }
    const cached = window.sessionStorage.getItem("pixelPandemoniumTeacherAccessKey");
    if (cached) return cached;
    const entered = window.prompt("Enter the Pixel Pandemonium teacher key:");
    if (entered) window.sessionStorage.setItem("pixelPandemoniumTeacherAccessKey", entered);
    return entered || "";
  }

  async function ensureTeacherAccess() {
    const key = teacherAccessKey();
    const res = await fetch(serverUrl("/teacher/validate?teacherAccessKey=" + encodeURIComponent(key)));
    const data = await res.json();
    if (!res.ok || !data.valid) {
      window.sessionStorage.removeItem("pixelPandemoniumTeacherAccessKey");
      throw new Error(data.error || "Invalid teacher key");
    }
    return key;
  }

  function isTetrisDemoCode(code) {
    return String(code || "").toLowerCase() === "tetris";
  }

  function promptForUrlValue(paramName, promptText, missingMessage) {
    const params = new URLSearchParams(window.location.search);
    const existing = params.get(paramName);
    if (existing) return existing;
    const entered = window.prompt(promptText);
    if (!entered) showFatal(missingMessage || "Missing required URL value.");
    params.set(paramName, entered.trim());
    window.history.replaceState(null, "", window.location.pathname + "?" + params.toString() + window.location.hash);
    return entered.trim();
  }

  function promptForUrlKey(paramName, promptText) {
    return promptForUrlValue(paramName, promptText, "Missing required access key.");
  }

  function repromptUrlValue(paramName, promptText, missingMessage) {
    const params = new URLSearchParams(window.location.search);
    params.delete(paramName);
    window.history.replaceState(null, "", window.location.pathname + "?" + params.toString() + window.location.hash);
    return promptForUrlValue(paramName, promptText, missingMessage);
  }

  function repromptUrlKey(paramName, promptText) {
    return repromptUrlValue(paramName, promptText, "Missing required access key.");
  }

  async function validateInstance(retried) {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("instance") || promptForUrlValue("instance", "Enter the class instance code:", "Missing class instance code.");
    const key = params.get("key") || "";
    if (!clientValidateCheckDigit(code)) showFatal("Invalid instance code. Please double-check the URL.");
    const keyQuery = key ? "?key=" + encodeURIComponent(key) : "";
    const res = await fetch(serverUrl("/instance/" + encodeURIComponent(code) + "/status" + keyQuery));
    const data = await res.json();
    // Only re-prompt for a key when the server actually rejected the access key.
    // The public tetris demo never needs a key, and other 403s (e.g. an origin/CORS
    // rejection, "Forbidden: Invalid origin") must not masquerade as a key prompt.
    const isAccessKeyError = res.status === 403 && /access key/i.test((data && data.error) || "");
    if (isAccessKeyError && !isTetrisDemoCode(code) && !retried) {
      repromptUrlKey("key", "That class access key was not accepted. Enter the class access key:");
      return validateInstance(true);
    }
    if (!res.ok || !data.valid) showFatal(data.error || "This instance is no longer active.");
    state.instance = { ...data, accessKey: key };
    return data;
  }

  async function validateAdminInstance(retried) {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("instance");
    if (!code) return null;
    const admin = params.get("admin") || (isTetrisDemoCode(code) ? "tetris-demo" : promptForUrlValue("admin", "Enter the admin code:", "Missing admin code."));
    const teacherKey = params.get("teacherKey") || "";
    if (!clientValidateCheckDigit(code)) showFatal("Invalid instance code. Please double-check the URL.");
    const teacherKeyQuery = teacherKey ? "&teacherKey=" + encodeURIComponent(teacherKey) : "";
    const passwordQuery = isTetrisDemoCode(code) ? "" : adminQuery();
    const res = await fetch(serverUrl("/instance/" + encodeURIComponent(code) + "/admin?admin=" + encodeURIComponent(admin) + teacherKeyQuery + passwordQuery));
    const data = await res.json();
    if (res.status === 403 && /teacher key/i.test(data.error || "") && !retried) {
      repromptUrlKey("teacherKey", "That teacher access key was not accepted. Enter the teacher access key:");
      return validateAdminInstance(true);
    }
    if (res.status === 403 && /admin code/i.test(data.error || "") && !retried) {
      repromptUrlValue("admin", "That admin code was not accepted. Enter the admin code:", "Missing admin code.");
      return validateAdminInstance(true);
    }
    if (!res.ok) showFatal(data.error || "This admin URL is not valid.");
    state.instance = {
      ...data,
      instanceCode: code,
      adminCode: admin,
      teacherKey,
      accessKey: data.accessKey || "",
      studentUrl: data.studentUrl || absoluteUrl("instructions.html?instance=" + encodeURIComponent(code) + "&key=" + encodeURIComponent(data.accessKey || "")),
      replayUrl: data.replayUrl || absoluteUrl("replay.html?instance=" + encodeURIComponent(code) + "&key=" + encodeURIComponent(data.accessKey || ""))
    };
    return state.instance;
  }

  function pictureFromMenu(id) {
    return (state.pictures || []).find((pic) => pic.id === id) || null;
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
    // Every picture (predefined and custom) is served from the server spec.js
    // endpoint. Prefer the server-provided URL/title from the loaded instance;
    // otherwise fall back to the menu entry (index browse) or build the URL from id.
    const fromMenu = pictureFromMenu(pictureId);
    const script = (state.instance && (state.instance.pictureSpecUrl || state.instance.pictureScript))
      || (fromMenu && fromMenu.script)
      || ("/pictures/" + encodeURIComponent(pictureId) + "/spec.js");
    const title = (state.instance && state.instance.pictureTitle)
      || (fromMenu && fromMenu.title)
      || pictureId;
    state.picture = { id: pictureId, title, script };
    if (!pictureId) showFatal("No picture is configured for this instance.");
    window.palette = undefined;
    window.pages = undefined;
    window.numRows = undefined;
    window.numCols = undefined;
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
        if (getTileStatus(row, col) !== "complete") labels.push({ col, row, label: pageLabel(row, col) });
      }
    }
    return labels;
  }

  function pageRangeLabel(start, end) {
    const colLetter = String.fromCharCode("A".charCodeAt(0) + start.col);
    if (start.row === end.row) return colLetter + String(start.row + 1);
    return colLetter + String(start.row + 1) + "-" + colLetter + String(end.row + 1);
  }

  function formatPageRanges(pages) {
    const ranges = [];
    let start = null;
    let previous = null;
    pages.forEach((page) => {
      if (!start) {
        start = page;
        previous = page;
        return;
      }
      if (page.col === previous.col && page.row === previous.row + 1) {
        previous = page;
        return;
      }
      ranges.push(pageRangeLabel(start, previous));
      start = page;
      previous = page;
    });
    if (start) ranges.push(pageRangeLabel(start, previous));
    return ranges.join(", ");
  }

  function setPagesThatRemain() {
    const pages = incompleteLabels();
    setText("remainingPages", pages.length ? "Here are some pages that remain to be filled in: " + formatPageRanges(pages) : "");
  }

  async function retrieveReplay() {
    const res = await fetch(serverUrl("/instance/" + encodeURIComponent(state.instance.instanceCode) + "/retrieve?key=" + encodeURIComponent(state.instance.accessKey || "")));
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
      body: JSON.stringify({ data: message, accessKey: state.instance.accessKey || "" })
    });
    if (!res.ok) {
      const responseText = await res.text().catch(() => "");
      let serverError = "";
      try { serverError = (JSON.parse(responseText) || {}).error || ""; } catch (e) { /* non-JSON body */ }
      logClient("error", "Replay insert failed", {
        url,
        status: res.status,
        statusText: res.statusText,
        responseText,
        instanceCode: state.instance && state.instance.instanceCode,
        message
      });
      const err = new Error("Replay insert failed with HTTP " + res.status);
      err.status = res.status;
      err.serverError = serverError;
      throw err;
    }
    return res;
  }

  function fayeChannel() {
    return "/faye/messages/" + state.instance.instanceCode;
  }

  // The class access key authorizes the realtime channel for this instance, the
  // same way it authorizes the HTTP status/insert/retrieve routes. The public
  // Tetris demo has an empty key and is exempt on the server.
  function realtimeKey() {
    return (state.instance && state.instance.accessKey) || "";
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
          message.ext = message.ext || {};
          if (message.channel === "/meta/handshake") {
            message.ext.origin = window.location.origin;
          }
          message.ext.key = realtimeKey();
          callback(message);
        }
      });
      state.fayeClient.subscribe(fayeChannel(), function (message) {
        onMessage(message.text);
      });
      return;
    }

    const wsBase = realtimeUrl("/faye").replace(/^http/, "ws");
    state.ws = new WebSocket(wsBase + "?channel=" + encodeURIComponent(fayeChannel()) + "&key=" + encodeURIComponent(realtimeKey()));
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
    const minTileWidth = 68;
    const minTileHeight = 48;
    const wantedWidth = Math.max(720, state.numCols * minTileWidth);
    const wantedHeight = Math.max(240, state.numRows * minTileHeight);
    if (canvas.width !== wantedWidth) canvas.width = wantedWidth;
    if (canvas.height !== wantedHeight) canvas.height = wantedHeight;
    const ctx = canvas.getContext("2d");
    const tileW = canvas.width / state.numCols;
    const tileH = canvas.height / state.numRows;
    const fontSize = Math.max(12, Math.min(18, Math.floor(Math.min(tileW, tileH) * 0.38)));
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = fontSize + "px Arial";
    for (let col = 0; col < state.numCols; col++) {
      for (let row = 0; row < state.numRows; row++) {
        const status = getTileStatus(row, col);
        ctx.fillStyle = status === "blank" ? "#FFF" : status === "complete" ? "#CCC" : status === "error" ? "#FFE0B2" : "#CCE5FF";
        ctx.fillRect(col * tileW + 1, row * tileH + 1, tileW - 2, tileH - 2);
        ctx.strokeStyle = state.selectedTile && state.selectedTile.row === row && state.selectedTile.col === col ? "#FF0000" : "#333";
        ctx.lineWidth = state.selectedTile && state.selectedTile.row === row && state.selectedTile.col === col ? 3 : 1;
        ctx.strokeRect(col * tileW, row * tileH, tileW, tileH);
        ctx.fillStyle = status === "complete" ? "#777" : "#333";
        ctx.fillText(pageLabel(row, col), col * tileW + tileW / 2, row * tileH + tileH / 2);
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
      const x = (event.clientX - rect.left) * (canvas.width / rect.width);
      const y = (event.clientY - rect.top) * (canvas.height / rect.height);
      const col = Math.floor(x / (canvas.width / state.numCols));
      const row = Math.floor(y / (canvas.height / state.numRows));
      if (row < 0 || col < 0 || row >= state.numRows || col >= state.numCols) return;
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
      // Optimistically draw the tile, but remember what was there so we can undo
      // it if the server rejects the submission (e.g. a 400 for the wrong color
      // on the public Tetris demo, which only accepts correct pixels).
      const previousCell = state.filled[ySquare][xSquare];
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
          status: err.status,
          serverError: err.serverError,
          stack: err.stack,
          selectedTile: state.selectedTile,
          message
        });
        // Roll back the optimistic draw: the server did not accept this pixel.
        state.filled[ySquare][xSquare] = previousCell;
        if (state.selectedTile) selectTile(state.selectedTile.row, state.selectedTile.col);
        // Surface the actual reason so the student can correct it and retry.
        const reason = (err && err.serverError) ? err.serverError : "Save failed.";
        const fullMessage = reason + " Please click that pixel again.";
        setText("tileStatusText", fullMessage);
        showToast(fullMessage);
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
    // Prefer an on-page Delay input (teacher dashboard) when present, then fall back
    // to the ?animationDelayMs= URL param, then the caller's default.
    const input = document.getElementById("adminAnimationDelayMs");
    if (input) {
      const value = Number(input.value);
      if (Number.isFinite(value) && value >= 0) return value;
    }
    const params = new URLSearchParams(window.location.search);
    const delay = Number(params.get("animationDelayMs"));
    return Number.isFinite(delay) && delay >= 0 ? delay : defaultDelay;
  }

  function replayDelay(defaultDelay) {
    const input = document.getElementById("replayDelayMs");
    const delay = input ? Number(input.value) : NaN;
    return Number.isFinite(delay) && delay >= 0 ? delay : defaultDelay;
  }

  function replayOrder() {
    const order = document.getElementById("replayOrder");
    return order ? order.value : "chronological";
  }

  function orderedRows(rows) {
    const copy = rows.slice();
    const order = document.getElementById("animationOrder");
    if ((order && order.value === "random") || (!order && replayOrder() === "random")) {
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
    // Derive the dimension presets from the server picture catalog (which now
    // includes numRows/numCols per picture) instead of fetching each script.
    if (!state.pictures) await loadPictures();
    const found = new Map();
    (state.pictures || []).forEach((picture) => {
      const rows = Number(picture.numRows);
      const cols = Number(picture.numCols);
      if (rows > 0 && cols > 0) found.set(`${cols * state.subcols}x${rows * state.subrows}`, [cols * state.subcols, rows * state.subrows]);
    });
    priorDimensions = Array.from(found.values()).sort((a, b) => (a[0] * a[1]) - (b[0] * b[1]) || a[0] - b[0]);
    if (!priorDimensions.length) priorDimensions = [[state.subcols, state.subrows]];
  }

  function populateDimensionPresets(imageWidth, imageHeight) {
    const select = document.getElementById("dimensionPreset");
    if (!select) return;
    const previousValue = select.value;
    const previousWidth = Number(document.getElementById("customWidth").value);
    const previousHeight = Number(document.getElementById("customHeight").value);
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
    const optionValues = Array.from(select.options).map((option) => option.value);
    if (previousValue === "custom" && previousWidth > 0 && previousHeight > 0) {
      select.value = "custom";
      document.getElementById("customWidth").value = previousWidth;
      document.getElementById("customHeight").value = previousHeight;
    } else if (previousValue && optionValues.includes(previousValue)) {
      select.value = previousValue;
      const parts = previousValue.split("x").map(Number);
      document.getElementById("customWidth").value = parts[0];
      document.getElementById("customHeight").value = parts[1];
    } else {
      select.selectedIndex = bestIndex;
      document.getElementById("customWidth").value = priorDimensions[bestIndex][0];
      document.getElementById("customHeight").value = priorDimensions[bestIndex][1];
    }
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

  function fitAspectDimensions(sourceWidth, sourceHeight, maxWidth, maxHeight) {
    const sourceAspect = sourceWidth / sourceHeight;
    const boxAspect = maxWidth / maxHeight;
    let width = maxWidth;
    let height = maxHeight;
    if (boxAspect > sourceAspect) width = Math.max(1, Math.round(maxHeight * sourceAspect));
    else height = Math.max(1, Math.round(maxWidth / sourceAspect));
    return { width, height };
  }

  function fitAspectGridDimensions(sourceWidth, sourceHeight, maxWidth, maxHeight) {
    const sourceAspect = sourceWidth / sourceHeight;
    const maxCols = Math.max(1, Math.floor(maxWidth / state.subcols));
    const maxRows = Math.max(1, Math.floor(maxHeight / state.subrows));
    let best = null;
    for (let cols = 1; cols <= maxCols; cols++) {
      for (let rows = 1; rows <= maxRows; rows++) {
        const width = cols * state.subcols;
        const height = rows * state.subrows;
        const aspectError = Math.abs(Math.log((width / height) / sourceAspect));
        const areaError = Math.abs(Math.log((width * height) / (maxWidth * maxHeight)));
        const score = aspectError * 10 + areaError;
        if (!best || score < best.score) best = { width, height, score };
      }
    }
    return { width: best.width, height: best.height };
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
    currentImageDimensions = { width: img.naturalWidth, height: img.naturalHeight };
    populateDimensionPresets(img.naturalWidth, img.naturalHeight);
    const dims = selectedDimensions();
    if (!dims.width || !dims.height) throw new Error("Choose output dimensions");
    const fitted = fitAspectGridDimensions(img.naturalWidth, img.naturalHeight, dims.width, dims.height);
    const canvas = document.createElement("canvas");
    canvas.width = fitted.width;
    canvas.height = fitted.height;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, 0, 0, fitted.width, fitted.height);
    const imageData = ctx.getImageData(0, 0, fitted.width, fitted.height);
    let palette = parsePaletteText(document.getElementById("paletteEditor").value);
    if (!palette.length) {
      palette = autoPaletteFromPixels(imageData.data, 12);
      document.getElementById("paletteEditor").value = paletteToText(palette);
    }
    const indexes = [];
    for (let i = 0; i < imageData.data.length; i += 4) {
      indexes.push(nearestPaletteIndex([imageData.data[i], imageData.data[i + 1], imageData.data[i + 2]], palette));
    }
    const spec = validateClientSpec(specFromIndexedPixels(indexes, fitted.width, fitted.height, palette));
    spec.sourceWidth = img.naturalWidth;
    spec.sourceHeight = img.naturalHeight;
    spec.requestedWidth = dims.width;
    spec.requestedHeight = dims.height;
    spec.fittedWidth = fitted.width;
    spec.fittedHeight = fitted.height;
    return spec;
  }

  async function analyzeCustomPicture() {
    const mode = document.getElementById("creationMode").value;
    if (mode === "static") return null;
    const title = document.getElementById("customTitle").value || "Custom Picture";
    const spec = mode === "spec" ? await analyzeSpecFiles() : await analyzeImageFile();
    const artifacts = generateClientArtifacts(title, spec);
    customDraft = { title, spec, artifacts };
    drawSpecPreview(spec);
    const fitted = spec.fittedWidth && spec.fittedHeight
      ? " Source image " + spec.sourceWidth + "x" + spec.sourceHeight + " fitted into " + spec.requestedWidth + "x" + spec.requestedHeight + " as " + spec.fittedWidth + "x" + spec.fittedHeight + " to preserve aspect ratio."
      : "";
    setHtml("customPictureStatus", '<p class="ok">Custom picture ready: ' + spec.numCols + " columns by " + spec.numRows + " rows." + fitted + "</p>");
    return customDraft;
  }

  async function ensureCustomPicture() {
    const mode = document.getElementById("creationMode").value;
    if (mode === "static") return document.getElementById("pictureId").value;
    if (!customDraft) await analyzeCustomPicture();
    const res = await fetch(serverUrl("/pictures/custom"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...customDraft, teacherAccessKey: teacherAccessKey() })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Custom picture upload failed");
    setHtml("customPictureStatus", '<p class="ok">Custom picture uploaded. <a href="' + serverUrl(data.zipUrl) + '">Download spec files zip</a></p>');
    return data.id;
  }

  async function initDashboard() {
    await loadConfig();
    await loadPictures();
    await ensureTeacherAccess();
    const createContent = document.getElementById("teacherCreateContent");
    if (createContent) createContent.style.display = "block";
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
    (state.pictures || []).forEach((pic) => {
      const option = document.createElement("option");
      option.value = pic.id;
      option.textContent = pic.title;
      pictureSelect.appendChild(option);
    });
    document.getElementById("expirationDays").value = Math.max(1, Math.round(Number(state.config.default_expiration_hours || 8760) / 24));
    document.getElementById("dateTime").value = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

    const params = new URLSearchParams(window.location.search);
    if (params.get("instance") && document.getElementById("resetInstanceCode")) {
      document.getElementById("resetInstanceCode").value = params.get("instance");
      document.getElementById("resetAdminCode").value = params.get("admin") || (isTetrisDemoCode(params.get("instance")) ? "tetris-demo" : "");
      document.getElementById("resetTeacherKey").value = params.get("teacherKey") || "";
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
        const draft = await analyzeCustomPicture();
        if (draft && draft.spec) {
          setHtml("customPictureStatus", document.getElementById("customPictureStatus").innerHTML.replace("Custom picture ready:", "Palette remapped. Custom picture ready:"));
        }
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
          instanceName: document.getElementById("instanceName").value,
          teacherName: document.getElementById("teacherName").value,
          dateTime: document.getElementById("dateTime").value,
          expirationHours: Number(document.getElementById("expirationDays").value) * 24,
          teacherAccessKey: teacherAccessKey()
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

    if (!document.getElementById("resetForm")) return;
    document.getElementById("resetForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const code = document.getElementById("resetInstanceCode").value;
      const adminCode = document.getElementById("resetAdminCode").value;
      const teacherKey = document.getElementById("resetTeacherKey").value;
      const res = await fetch(serverUrl("/instance/" + encodeURIComponent(code) + "/reset"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adminCode,
          teacherKey,
          adminPassword: isTetrisDemoCode(code) ? "" : adminPassword()
        })
      });
      const data = await res.json();
      setHtml("resetResult", res.ok ? '<p class="ok">Instance reset.</p>' : '<p class="error">' + (data.error || "Reset failed") + "</p>");
    });

    instanceListMode = "dashboard";
    attachInstanceListHandlers();
    if (!document.getElementById("adminReplayButton")) return;
    document.getElementById("adminReplayButton").addEventListener("click", async () => {
      try {
        await runAdminAnimation(false);
      } catch (err) {
        setHtml("dashboardAdminStatus", '<p class="error">' + err.message + "</p>");
      }
    });
    document.getElementById("adminFinishButton").addEventListener("click", async () => {
      try {
        await runAdminAnimation(true);
      } catch (err) {
        setHtml("dashboardAdminStatus", '<p class="error">' + err.message + "</p>");
      }
    });
    if (isTetrisDemoCode(params.get("instance"))) {
      loadDashboardInstance(tetrisDemoInstance()).catch((err) => {
        setHtml("dashboardAdminStatus", '<p class="error">' + err.message + "</p>");
      });
    }
  }

  async function adminFetchRows() {
    const passwordQuery = isTetrisDemoCode(state.instance.instanceCode)
      ? ""
      : instanceListMode === "dashboard"
        ? "&teacherAccessKey=" + encodeURIComponent(teacherAccessKey())
        : adminQuery();
    const res = await fetch(serverUrl("/instance/" + encodeURIComponent(state.instance.instanceCode) + "/admin?admin=" + encodeURIComponent(state.instance.adminCode) + "&teacherKey=" + encodeURIComponent(state.instance.teacherKey || "") + passwordQuery));
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
      "<thead><tr><th>ID</th><th>Timestamp</th><th>Data <span class=\"th-hint\">(x, y, width, height, color, gridX, gridY)</span></th><th>Actions</th></tr></thead><tbody>"
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
        if (status !== "complete") incomplete.push({ col, row, label: pageLabel(row, col) });
        if (status === "error") mistakes.push(pageLabel(row, col));
      }
    }
    setHtml("adminTileSummary", [
      "<p><strong>Incomplete pages:</strong> " + (incomplete.length ? formatPageRanges(incomplete) : "None") + "</p>",
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

  function updateAdminLinks() {
    if (!state.instance) return;
    document.getElementById("studentLink").href = state.instance.studentUrl || "#";
    document.getElementById("studentLink").textContent = state.instance.studentUrl || "";
    document.getElementById("replayLink").href = state.instance.replayUrl || "#";
    document.getElementById("replayLink").textContent = state.instance.replayUrl || "";
    const teacherLink = document.getElementById("teacherLink");
    if (teacherLink) {
      teacherLink.href = state.instance.teacherUrl || "#";
      teacherLink.textContent = state.instance.teacherUrl || "";
    }
  }

  function showAdminContent() {
    setHtml("adminAuthStatus", "");
    const content = document.getElementById("adminContent");
    if (content) content.style.display = "block";
  }

  function tetrisDemoInstance() {
    return {
      instanceCode: "tetris",
      instanceName: "tetris",
      pictureId: "tetris",
      pictureTitle: "Demo (Tetris)",
      teacherName: "Public Demo",
      adminCode: "tetris-demo",
      accessKey: "",
      teacherKey: "",
      studentUrl: absoluteUrl("instructions.html?instance=tetris"),
      replayUrl: absoluteUrl("replay.html?instance=tetris"),
      teacherUrl: absoluteUrl("teacher-dashboard.html?instance=tetris"),
      adminUrl: absoluteUrl("admin.html?instance=tetris")
    };
  }

  function htmlEscape(value) {
    return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function renderInstancesList(instances) {
    if (!instances.length) {
      setHtml("instancesList", "<p>No active instances found.</p>");
      return;
    }
    const rows = [
      '<table class="admin-table">',
      "<thead><tr><th>Instance</th><th>Picture</th><th>Teacher</th><th>Expires</th><th>Actions</th></tr></thead><tbody>"
    ];
    instances.forEach((instance, index) => {
      rows.push(
        "<tr>",
        "<td><span class=\"mono\">" + htmlEscape(instance.instanceName || instance.instanceCode) + "</span><br><small>" + htmlEscape(instance.instanceCode) + "</small></td>",
        "<td>" + htmlEscape(instance.pictureTitle || instance.pictureId) + "</td>",
        "<td>" + htmlEscape(instance.teacherName || "") + "</td>",
        "<td>" + htmlEscape(instance.expiresAt || "") + "</td>",
        '<td><button type="button" data-action="load-instance" data-index="' + index + '">Load</button> ' +
          '<a href="' + htmlEscape(instance.studentUrl || "") + '" target="_blank">Student</a> ' +
          '<a href="' + htmlEscape(instance.replayUrl || "") + '" target="_blank">Replay</a></td>',
        "</tr>"
      );
    });
    rows.push("</tbody></table>");
    setHtml("instancesList", rows.join(""));
  }

  async function loadExistingInstances(retried) {
    const endpoint = instanceListMode === "admin"
      ? "/instances?adminPassword=" + encodeURIComponent(adminPassword())
      : "/teacher/instances?teacherAccessKey=" + encodeURIComponent(teacherAccessKey());
    const res = await fetch(serverUrl(endpoint));
    const data = await res.json();
    if (res.status === 403 && instanceListMode === "admin" && !retried) {
      window.sessionStorage.removeItem("pixelPandemoniumAdminPassword");
      return loadExistingInstances(true);
    }
    if (!res.ok) throw new Error(data.error || "Could not load instances");
    state.instances = data.instances || [];
    renderInstancesList(state.instances);
    return state.instances;
  }

  async function loadDashboardInstance(instance) {
    state.instance = { ...instance };
    await loadPicture(state.instance.pictureId);
    makeReplayGrid();
    const rows = await adminFetchRows();
    renderAdminTileSummary();
    rowsFromFilled().forEach((row) => drawReplayMessage(row.DATA));
    document.getElementById("resetInstanceCode").value = state.instance.instanceCode;
    document.getElementById("resetAdminCode").value = state.instance.adminCode || "";
    document.getElementById("resetTeacherKey").value = state.instance.teacherKey || "";
    updateDashboardReplayLink();
    setHtml("dashboardAdminStatus", '<p class="ok">Loaded ' + htmlEscape(state.instance.instanceName || state.instance.instanceCode) + ".</p>");
  }

  function updateDashboardReplayLink() {
    const link = document.getElementById("dashboardReplayLink");
    if (!link) return;
    const row = document.getElementById("dashboardReplayLinkRow");
    const replayUrl = (state.instance && state.instance.replayUrl) || "";
    // The link text is the static "Replay page for this instance" label from the
    // markup; only set the href so the raw URL is not printed on the page.
    link.href = replayUrl || "#";
    if (row) row.style.display = replayUrl ? "" : "none";
  }

  function mergeAdminInstance(instance, adminData) {
    return {
      ...instance,
      ...adminData,
      instanceCode: adminData.instanceCode || instance.instanceCode,
      adminCode: adminData.adminCode || instance.adminCode || (isTetrisDemoCode(instance.instanceCode) ? "tetris-demo" : ""),
      teacherKey: adminData.teacherKey || instance.teacherKey || "",
      accessKey: adminData.accessKey || instance.accessKey || ""
    };
  }

  async function loadAdminInstance(instance, updateUrl) {
    state.instance = {
      ...instance,
      adminCode: instance.adminCode || (isTetrisDemoCode(instance.instanceCode) ? "tetris-demo" : ""),
      teacherKey: instance.teacherKey || "",
      accessKey: instance.accessKey || ""
    };
    const passwordQuery = isTetrisDemoCode(state.instance.instanceCode) ? "" : adminQuery();
    const res = await fetch(serverUrl("/instance/" + encodeURIComponent(state.instance.instanceCode) + "/admin?admin=" + encodeURIComponent(state.instance.adminCode) + "&teacherKey=" + encodeURIComponent(state.instance.teacherKey || "") + passwordQuery));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Admin fetch failed");
    state.instance = mergeAdminInstance(state.instance, data);
    await loadPicture(state.instance.pictureId);
    setText("pictureTitle", state.picture.title);
    setText("instanceCode", state.instance.instanceCode);
    updateAdminLinks();
    renderAdminRows(data.rows || []);
    resetFilled();
    (data.rows || []).forEach((row) => applyMessage(row.DATA));
    state.instance.rows = data.rows || [];
    renderAdminTileSummary();
    makeReplayGrid();
    rowsFromFilled().forEach((row) => drawReplayMessage(row.DATA));
    if (updateUrl) {
      const params = new URLSearchParams(window.location.search);
      params.set("instance", state.instance.instanceCode);
      if (state.instance.adminCode) params.set("admin", state.instance.adminCode);
      else params.delete("admin");
      if (state.instance.teacherKey) params.set("teacherKey", state.instance.teacherKey);
      else params.delete("teacherKey");
      window.history.replaceState(null, "", window.location.pathname + "?" + params.toString() + window.location.hash);
    }
    setHtml("adminStatus", '<p class="ok">Admin access loaded for ' + htmlEscape(state.instance.teacherName || state.instance.instanceCode) + ".</p>");
  }

  function populateAdminCreateForm() {
    const pictureSelect = document.getElementById("adminPictureId");
    if (!pictureSelect || pictureSelect.options.length) return;
    (state.pictures || []).forEach((pic) => {
      const option = document.createElement("option");
      option.value = pic.id;
      option.textContent = pic.title;
      pictureSelect.appendChild(option);
    });
    document.getElementById("adminExpirationDays").value = Math.max(1, Math.round(Number(state.config.default_expiration_hours || 8760) / 24));
    document.getElementById("adminDateTime").value = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }

  function renderAdminCreatedInstance(data) {
    setHtml("adminCreateResult", [
      '<p class="ok">Instance created.</p>',
      '<p><strong>Instance Code:</strong> <span class="mono">' + htmlEscape(data.instanceCode) + "</span></p>",
      '<p><strong>Instance Name:</strong> <span class="mono">' + htmlEscape(data.instanceName || data.instanceCode) + "</span></p>",
      '<label>Student URL<br><input class="url-box" readonly value="' + htmlEscape(data.studentUrl || "") + '"></label>',
      '<br><label>Replay URL<br><input class="url-box" readonly value="' + htmlEscape(data.replayUrl || "") + '"></label>',
      '<br><label>Teacher URL<br><input class="url-box" readonly value="' + htmlEscape(data.teacherUrl || "") + '"></label>',
      '<br><label>Admin URL<br><input class="url-box" readonly value="' + htmlEscape(data.adminUrl || "") + '"></label>'
    ].join(""));
  }

  function attachAdminCreateHandler() {
    const form = document.getElementById("adminCreateForm");
    if (!form) return;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const body = {
          pictureId: document.getElementById("adminPictureId").value,
          instanceName: document.getElementById("adminInstanceName").value,
          teacherName: document.getElementById("adminTeacherName").value,
          dateTime: document.getElementById("adminDateTime").value,
          expirationHours: Number(document.getElementById("adminExpirationDays").value) * 24,
          adminPassword: adminPassword()
        };
        const res = await fetch(serverUrl("/instance/create"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok) {
          setHtml("adminCreateResult", '<p class="error">' + (data.error || "Create failed") + "</p>");
          return;
        }
        renderAdminCreatedInstance(data);
        await loadExistingInstances();
        await loadAdminInstance(data, true);
      } catch (err) {
        setHtml("adminCreateResult", '<p class="error">' + err.message + "</p>");
      }
    });
  }

  async function loadTeacherKeys() {
    const res = await fetch(serverUrl("/teacher-keys?adminPassword=" + encodeURIComponent(adminPassword())));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not load teacher keys");
    const rows = (data.teacherKeys || []).map((key) => "<tr><td class=\"mono\">" + htmlEscape(key.teacherKey) + "</td><td>" + htmlEscape(key.label || "") + "</td><td>" + htmlEscape(key.createdAt || "") + "</td></tr>");
    setHtml("teacherKeysList", rows.length ? '<table class="admin-table"><thead><tr><th>Key</th><th>Label</th><th>Created</th></tr></thead><tbody>' + rows.join("") + "</tbody></table>" : "<p>No teacher keys found.</p>");
  }

  function attachTeacherKeyHandlers() {
    const loadButton = document.getElementById("loadTeacherKeysButton");
    if (loadButton) {
      loadButton.addEventListener("click", async () => {
        try {
          await loadTeacherKeys();
        } catch (err) {
          setHtml("teacherKeyStatus", '<p class="error">' + err.message + "</p>");
        }
      });
    }
    const form = document.getElementById("teacherKeyForm");
    if (form) {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
          const res = await fetch(serverUrl("/teacher-keys"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              teacherKey: document.getElementById("newTeacherKey").value,
              label: document.getElementById("newTeacherKeyLabel").value,
              adminPassword: adminPassword()
            })
          });
          const data = await res.json();
          if (!res.ok) {
            setHtml("teacherKeyStatus", '<p class="error">' + (data.error || "Teacher key creation failed") + "</p>");
            return;
          }
          setHtml("teacherKeyStatus", '<p class="ok">Teacher key created.</p>');
          await loadTeacherKeys();
        } catch (err) {
          setHtml("teacherKeyStatus", '<p class="error">' + err.message + "</p>");
        }
      });
    }
  }

  async function runAdminAnimation(finishOnly) {
    if (!state.instance) throw new Error("Load an instance first.");
    const rows = finishOnly ? (state.instance.rows || []) : await adminFetchRows();
    // The Source select was dropped from the teacher dashboard in favor of the two
    // buttons; when it is absent, the button (finishOnly) picks the source instead.
    const sourceEl = document.getElementById("animationSource");
    const source = sourceEl ? sourceEl.value : (finishOnly ? "finished" : "instance");
    const order = document.getElementById("animationOrder").value;
    if (finishOnly || source === "finished") {
      const baseRows = order === "random" ? orderedRows(rows) : rows;
      replayRows(completedImageRows(baseRows, order === "random" ? "random" : "existing-then-sequential"), adminAnimationDelay(finishOnly ? 1 : 5));
    } else {
      replayRows(orderedRows(rows), adminAnimationDelay(5));
    }
  }

  function attachInstanceListHandlers() {
    const loadButton = document.getElementById("loadInstancesButton");
    if (loadButton) {
      loadButton.addEventListener("click", async () => {
        try {
          await loadExistingInstances();
        } catch (err) {
          setHtml(instanceListMode === "admin" ? "adminStatus" : "dashboardAdminStatus", '<p class="error">' + err.message + "</p>");
        }
      });
    }
    const tetrisButton = document.getElementById("loadTetrisDemoButton");
    if (tetrisButton) {
      tetrisButton.addEventListener("click", async () => {
        try {
          if (instanceListMode === "admin") await loadAdminInstance(tetrisDemoInstance(), true);
          else await loadDashboardInstance(tetrisDemoInstance());
        } catch (err) {
          setHtml(instanceListMode === "admin" ? "adminStatus" : "dashboardAdminStatus", '<p class="error">' + err.message + "</p>");
        }
      });
    }
    const list = document.getElementById("instancesList");
    if (list) {
      list.addEventListener("click", async (event) => {
        const button = event.target.closest('button[data-action="load-instance"]');
        if (!button) return;
        const instance = (state.instances || [])[Number(button.dataset.index)];
        if (!instance) return;
        try {
          if (instanceListMode === "admin") await loadAdminInstance(instance, true);
          else await loadDashboardInstance(instance);
        } catch (err) {
          setHtml(instanceListMode === "admin" ? "adminStatus" : "dashboardAdminStatus", '<p class="error">' + err.message + "</p>");
        }
      });
    }
  }

  async function rotateInstanceKey(keyType) {
    if (!state.instance) {
      setHtml("adminStatus", '<p class="error">Load an instance first.</p>');
      return;
    }
    const label = keyType === "student" ? "class key" : "teacher key";
    if (!window.confirm("Reset this " + label + "? Old links using that key will stop working.")) return;
    const res = await fetch(serverUrl("/instance/" + encodeURIComponent(state.instance.instanceCode) + "/rotate-key"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keyType,
        adminCode: state.instance.adminCode,
        teacherKey: state.instance.teacherKey || "",
        adminPassword: isTetrisDemoCode(state.instance.instanceCode) ? "" : adminPassword()
      })
    });
    const data = await res.json();
    if (!res.ok) {
      setHtml("adminStatus", '<p class="error">' + (data.error || "Key reset failed") + "</p>");
      return;
    }
    state.instance = { ...state.instance, ...data };
    if (keyType === "teacher") {
      const params = new URLSearchParams(window.location.search);
      params.set("teacherKey", data.teacherKey);
      window.history.replaceState(null, "", window.location.pathname + "?" + params.toString() + window.location.hash);
    }
    updateAdminLinks();
    setHtml("adminStatus", '<p class="ok">Reset ' + label + ".</p>");
  }

  async function downloadAllData() {
    // The full export is gated on the admin password; send it as a header so it is
    // not placed in the URL. The server streams a data-export.json attachment.
    const res = await fetch(serverUrl("/download"), {
      headers: { "X-Admin-Password": adminPassword() }
    });
    if (!res.ok) {
      let message = "Download failed";
      try {
        const data = await res.json();
        message = data.error || message;
      } catch (err) {
        // non-JSON error body; keep the default message
      }
      throw new Error(message);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "data-export.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function initAdmin() {
    // Render the page shell immediately so the admin isn't staring at a blank page
    // while config, pictures, and instances load; a toast signals work in progress
    // and is dismissed once the data is in.
    showAdminContent();
    const dismissLoading = showToast("Loading the admin dashboard…", { type: "info", persist: true });
    try {
      await loadConfig();
      await loadPictures();
      instanceListMode = "admin";
      populateAdminCreateForm();
      attachInstanceListHandlers();
      attachAdminCreateHandler();
      attachTeacherKeyHandlers();
      const params = new URLSearchParams(window.location.search);
      if (params.get("instance")) {
        await validateAdminInstance();
        await loadAdminInstance(state.instance, false);
        if (!isTetrisDemoCode(params.get("instance"))) {
          loadExistingInstances().catch((err) => {
            setHtml("adminStatus", '<p class="error">' + err.message + "</p>");
          });
        }
      } else {
        await loadExistingInstances();
        setHtml("adminStatus", '<p class="ok">Admin access loaded. Choose an instance or create a new one.</p>');
      }
      showToast("Admin dashboard loaded.", { type: "success" });
    } catch (err) {
      setHtml("adminAuthStatus", '<p class="error">' + err.message + "</p>");
      showToast(err.message, { type: "error" });
    } finally {
      dismissLoading();
    }

    document.getElementById("refreshRowsButton").addEventListener("click", async () => {
      try {
        if (!state.instance) throw new Error("Load an instance first.");
        await refreshAdmin();
      } catch (err) {
        setHtml("adminStatus", '<p class="error">' + err.message + "</p>");
      }
    });
    document.getElementById("rotateStudentKeyButton").addEventListener("click", () => rotateInstanceKey("student"));
    document.getElementById("rotateTeacherKeyButton").addEventListener("click", () => rotateInstanceKey("teacher"));
    document.getElementById("adminReplayButton").addEventListener("click", async () => {
      try {
        await runAdminAnimation(false);
      } catch (err) {
        setHtml("adminStatus", '<p class="error">' + err.message + "</p>");
      }
    });
    document.getElementById("adminFinishButton").addEventListener("click", async () => {
      try {
        await runAdminAnimation(true);
      } catch (err) {
        setHtml("adminStatus", '<p class="error">' + err.message + "</p>");
      }
    });
    const downloadButton = document.getElementById("downloadAllButton");
    if (downloadButton) {
      downloadButton.addEventListener("click", async () => {
        try {
          setHtml("downloadStatus", "<p>Preparing download…</p>");
          await downloadAllData();
          setHtml("downloadStatus", '<p class="ok">Download started.</p>');
        } catch (err) {
          setHtml("downloadStatus", '<p class="error">' + err.message + "</p>");
        }
      });
    }
    const deleteButton = document.getElementById("deleteInstanceButton");
    if (deleteButton) {
      deleteButton.addEventListener("click", async () => {
        setHtml("adminStatus", '<p class="error">Instances cannot be deactivated or deleted.</p>');
      });
    }
    document.getElementById("adminRows").addEventListener("click", async (event) => {
      if (!state.instance) {
        setHtml("adminStatus", '<p class="error">Load an instance first.</p>');
        return;
      }
      const button = event.target.closest("button");
      if (!button) return;
      const rowEl = button.closest("tr[data-row-id]");
      const id = rowEl.dataset.rowId;
      const action = button.dataset.action;
      const endpoint = "/instance/" + encodeURIComponent(state.instance.instanceCode) + "/event/" + encodeURIComponent(id) + "/" + action;
      const body = { adminCode: state.instance.adminCode, teacherKey: state.instance.teacherKey || "", adminPassword: isTetrisDemoCode(state.instance.instanceCode) ? "" : adminPassword() };
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

  async function initTeacherDashboard() {
    await loadConfig();
    const params = new URLSearchParams(window.location.search);
    const code = params.get("instance");
    if (code && !isTetrisDemoCode(code)) {
      try {
        await ensureTeacherAccess();
      } catch (err) {
        setHtml("dashboardAdminStatus", '<p class="error">' + err.message + "</p>");
        return;
      }
    }
    if (code) {
      document.getElementById("resetInstanceCode").value = code;
      document.getElementById("resetAdminCode").value = params.get("admin") || (isTetrisDemoCode(code) ? "tetris-demo" : "");
      document.getElementById("resetTeacherKey").value = params.get("teacherKey") || "";
    }
    document.getElementById("resetForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const resetCode = document.getElementById("resetInstanceCode").value;
      const res = await fetch(serverUrl("/instance/" + encodeURIComponent(resetCode) + "/reset"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adminCode: document.getElementById("resetAdminCode").value,
          teacherKey: document.getElementById("resetTeacherKey").value,
          adminPassword: "",
          teacherAccessKey: isTetrisDemoCode(resetCode) ? "" : teacherAccessKey()
        })
      });
      const data = await res.json();
      setHtml("resetResult", res.ok ? '<p class="ok">Instance reset.</p>' : '<p class="error">' + (data.error || "Reset failed") + "</p>");
    });
    instanceListMode = "dashboard";
    attachInstanceListHandlers();
    document.body.dataset.ppReady = "teacher-dashboard";
    document.getElementById("adminReplayButton").addEventListener("click", async () => {
      try {
        await runAdminAnimation(false);
      } catch (err) {
        setHtml("dashboardAdminStatus", '<p class="error">' + err.message + "</p>");
      }
    });
    document.getElementById("adminFinishButton").addEventListener("click", async () => {
      try {
        await runAdminAnimation(true);
      } catch (err) {
        setHtml("dashboardAdminStatus", '<p class="error">' + err.message + "</p>");
      }
    });
    if (isTetrisDemoCode(code)) {
      loadDashboardInstance(tetrisDemoInstance()).catch((err) => {
        setHtml("dashboardAdminStatus", '<p class="error">' + err.message + "</p>");
      });
    }
  }

  function qrUrl(value) {
    return "https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=" + encodeURIComponent(value);
  }

  function renderCreatedInstance(data) {
    setHtml("createResult", [
      '<div class="panel">',
      '<p class="ok">Instance created.</p>',
      '<p><strong>Instance Code:</strong> <span class="mono">' + data.instanceCode + "</span></p>",
      '<p><strong>Instance Name:</strong> <span class="mono">' + (data.instanceName || data.instanceCode) + "</span></p>",
      '<p><strong>Expires:</strong> ' + data.expiresAt + "</p>",
      '<label>Student URL<br><input class="url-box" readonly value="' + data.studentUrl + '"></label>',
      '<br><label>Replay URL<br><input class="url-box" readonly value="' + data.replayUrl + '"></label>',
      '<br><label>Teacher URL<br><input class="url-box" readonly value="' + data.teacherUrl + '"></label>',
      '<br><label>Admin URL<br><input class="url-box" readonly value="' + data.adminUrl + '"></label>',
      '<div class="qr-row">',
      '<div><h3>Student QR</h3><img alt="Student QR" src="' + qrUrl(data.studentUrl) + '"></div>',
      '<div><h3>Teacher/Admin QR</h3><img alt="Teacher QR" src="' + qrUrl(data.adminUrl) + '"></div>',
      "</div>",
      "</div>"
    ].join(""));
    const resetInstanceCode = document.getElementById("resetInstanceCode");
    const resetAdminCode = document.getElementById("resetAdminCode");
    const resetTeacherKey = document.getElementById("resetTeacherKey");
    if (resetInstanceCode) resetInstanceCode.value = data.instanceCode;
    if (resetAdminCode) resetAdminCode.value = data.adminCode;
    if (resetTeacherKey) resetTeacherKey.value = data.teacherKey || "";
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
    replayRows(orderedRows(rows), replayDelay(5));
    document.getElementById("replayButton").addEventListener("click", async () => {
      const latestRows = await retrieveReplay();
      replayRows(orderedRows(latestRows), replayDelay(5));
    });
    document.getElementById("finishButton").addEventListener("click", async () => {
      const latestRows = await retrieveReplay();
      const order = replayOrder();
      const baseRows = order === "random" ? orderedRows(latestRows) : latestRows;
      replayRows(completedImageRows(baseRows, order), replayDelay(1));
    });
    await loadFayeScript();
    await setupRealtime((message) => {
      applyMessage(message);
      drawReplayMessage(message);
    });
  }

  async function initIndex() {
    await loadConfig();
    await loadPictures();
    const selector = document.getElementById("pageSelector");
    (state.pictures || []).forEach((pic) => {
      const option = document.createElement("option");
      option.value = pic.id;
      option.textContent = pic.title;
      selector.appendChild(option);
    });
  }

  window.PixelPandemonium = {
    initDashboard,
    initCreateInstance: initDashboard,
    initTeacherDashboard,
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
      fitAspectDimensions,
      fitAspectGridDimensions,
      formatPageRanges,
      state
    }
  };
})();
