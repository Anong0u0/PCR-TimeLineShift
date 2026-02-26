(function (global) {
  "use strict";

  const VERSION = "7.0.0";
  const GLOBAL_NS = "PPOCRv5";
  const SCRIPT_CACHE_KEY = "__ppocrv5_script_cache__";
  const RESOURCE_CACHE_KEY = "__ppocrv5_resource_cache__";
  const IDB_CACHE_KEY = "__ppocrv5_idb_cache__";
  const SINGLETON_KEY = "__ppocrv5_singleton__";

  function logError(tag, err) {
    console.error(`[PPOCRv5] ${tag}:`, err);
  }

  function scriptBaseUrl() {
    const cs = document.currentScript;
    if (cs && cs.src) return new URL(".", cs.src).href;
    return new URL(".", window.location.href).href;
  }

  function toAbs(base, rel) {
    return new URL(rel, base).href;
  }

  function clampInt(v, min, max, fallback) {
    let x = Number(v);
    if (!Number.isFinite(x)) return fallback;
    x = Math.round(x);
    if (x < min) x = min;
    if (x > max) x = max;
    return x;
  }

  function finiteNumber(v, fallback) {
    const x = Number(v);
    return Number.isFinite(x) ? x : fallback;
  }

  function errorMessage(err) {
    return err && err.message ? err.message : String(err);
  }

  const RECOGNIZE_OVERALL = {
    start: 0,
    prep: 10,
    det: 35,
    rec: 95,
    done: 100,
  };
  const INIT_PROGRESS_POINTS = Object.freeze({
    "init:start": 0,
    "deps:loading": 5,
    "deps:done": 15,
    "dict:loading": 18,
    "dict:done": 25,
    "download:done": 75,
    "service:creating": 80,
    "service:done": 88,
    "warmup:done": 99,
    "ready:done": 100,
  });

  function noop() { }

  function createRecognizeEmitter(engine, enabled) {
    return enabled ? engine._emitRecognize.bind(engine) : noop;
  }

  function buildRecDetail(current, total) {
    const ratio = total > 0 ? (current / total) : 1;
    return {
      current: current,
      total: total,
      percent: ratio * 100,
      overallPercent: total > 0 ? (RECOGNIZE_OVERALL.det + ratio * (RECOGNIZE_OVERALL.rec - RECOGNIZE_OVERALL.det)) : RECOGNIZE_OVERALL.rec,
    };
  }

  function stageDetail(percent, overallPercent, extra) {
    return Object.assign({ percent: percent, overallPercent: overallPercent }, extra || {});
  }

  function emitProgressEvent(emit, state, stage, detail, err) {
    if (err !== undefined) {
      emit(state, stage, detail, err);
      return;
    }
    emit(state, stage, detail);
  }

  function clampPercent(v, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    if (n < 0) return 0;
    if (n > 100) return 100;
    return n;
  }

  function mapRange(percent, fromStart, fromEnd) {
    const p = clampPercent(percent, 0) / 100;
    return fromStart + (fromEnd - fromStart) * p;
  }

  function deriveUnifiedProgress(payload, prev) {
    const phase = payload && payload.phase ? payload.phase : "";
    const state = payload && payload.state ? payload.state : "";
    const last = prev || null;

    if (phase === "recognize") {
      const rec = payload && payload.recognize ? payload.recognize : {};
      let percent = clampPercent(rec.overallPercent, NaN);
      if (!Number.isFinite(percent)) {
        percent = state === "done" ? 100 : (last && Number.isFinite(last.percent) ? last.percent : 0);
      }
      return {
        kind: "recognize",
        stage: rec.stage || "recognize",
        state: state || "running",
        percent: percent,
      };
    }

    const lastPercent = last && Number.isFinite(last.percent) ? last.percent : 0;
    if (phase === "error" && state === "failed") {
      return {
        kind: (last && last.kind) ? last.kind : "init",
        stage: (last && last.stage) ? last.stage : "error",
        state: "failed",
        percent: clampPercent(lastPercent, 0),
      };
    }

    let percent = lastPercent;
    if (phase === "download" && state === "running") {
      const raw = payload && payload.download && payload.download.overall ? payload.download.overall.percent : 0;
      percent = mapRange(raw, 25, 75);
    } else if (phase === "warmup" && state === "running") {
      const raw = payload && payload.warmup ? payload.warmup.percent : 0;
      percent = mapRange(raw, 88, 99);
    } else {
      const key = phase + ":" + state;
      if (Object.prototype.hasOwnProperty.call(INIT_PROGRESS_POINTS, key)) {
        percent = INIT_PROGRESS_POINTS[key];
      }
    }

    return {
      kind: "init",
      stage: phase || "init",
      state: state || "running",
      percent: clampPercent(percent, 0),
    };
  }

  function mergeOptions(base, override) {
    const out = Object.assign({}, base || {});
    if (!override) return out;
    const keys = Object.keys(override);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (override[k] !== undefined) out[k] = override[k];
    }
    return out;
  }

  function mb(bytes) {
    return Number(bytes || 0) / (1024 * 1024);
  }

  function getGlobalCache(cacheKey) {
    if (!global[cacheKey]) global[cacheKey] = Object.create(null);
    return global[cacheKey];
  }

  function loadScriptOnce(src, checkReady) {
    if (checkReady && checkReady()) return Promise.resolve();

    const cache = getGlobalCache(SCRIPT_CACHE_KEY);
    if (cache[src]) return cache[src];

    cache[src] = new Promise(function (resolve, reject) {
      const found = document.querySelector('script[src="' + src.replace(/"/g, "\\\"") + '"]');
      if (found) {
        if (checkReady && checkReady()) {
          resolve();
          return;
        }
        found.addEventListener("load", function () { resolve(); }, { once: true });
        found.addEventListener("error", function () { reject(new Error("Failed to load script: " + src)); }, { once: true });
        return;
      }

      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("Failed to load script: " + src)); };
      (document.head || document.documentElement).appendChild(s);
    }).then(function () {
      if (checkReady && !checkReady()) {
        throw new Error("Script loaded but global not found: " + src);
      }
    }).catch(function (e) {
      delete cache[src];
      throw e;
    });

    return cache[src];
  }

  async function idbGetValue(dbName, storeName, key) {
    const db = await openIndexedDB(dbName, storeName);
    if (!db) return null;

    return await new Promise(function (resolve) {
      try {
        const tx = db.transaction(storeName, "readonly");
        const req = tx.objectStore(storeName).get(key);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
      } catch (_) {
        resolve(null);
      }
    });
  }

  async function idbPutValue(dbName, storeName, key, value) {
    const db = await openIndexedDB(dbName, storeName);
    if (!db) return false;

    return await new Promise(function (resolve) {
      try {
        const tx = db.transaction(storeName, "readwrite");
        tx.objectStore(storeName).put(value, key);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { resolve(false); };
        tx.onabort = function () { resolve(false); };
      } catch (_) {
        resolve(false);
      }
    });
  }

  async function idbGetText(dbName, storeName, key) {
    const val = await idbGetValue(dbName, storeName, key);
    if (typeof val === "string") return val;
    if (val instanceof ArrayBuffer) {
      try {
        return new TextDecoder("utf-8").decode(new Uint8Array(val));
      } catch (_) {
        return null;
      }
    }
    return null;
  }

  async function fetchTextCached(url, options) {
    const cache = getGlobalCache(RESOURCE_CACHE_KEY);
    const key = "dict::" + VERSION + "::" + url;
    if (cache[key]) return await cache[key];

    cache[key] = (async function () {
      const settings = getPersistenceSettings(options, "persistDictInIndexedDB");
      const persist = settings.persist;
      const dbName = settings.dbName;
      const storeName = settings.storeName;

      if (persist && global.indexedDB) {
        const cachedText = await idbGetText(dbName, storeName, key);
        if (typeof cachedText === "string" && cachedText.length > 0) return cachedText;
      }

      const r = await fetch(url, { cache: "force-cache" });
      if (!r.ok) throw new Error("Failed to fetch text: " + url + " (" + r.status + ")");
      const text = await r.text();
      if (persist && global.indexedDB) {
        await idbPutValue(dbName, storeName, key, String(text));
      }
      return text;
    })().catch(function (e) {
      delete cache[key];
      throw e;
    });
    return await cache[key];
  }

  function openIndexedDB(dbName, storeName) {
    if (!global.indexedDB) return Promise.resolve(null);
    const cache = getGlobalCache(IDB_CACHE_KEY);
    const key = dbName + "::" + storeName;
    if (cache[key]) return cache[key];

    cache[key] = new Promise(function (resolve) {
      const req = global.indexedDB.open(dbName, 1);
      req.onupgradeneeded = function () {
        const db = req.result;
        if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { resolve(null); };
      req.onblocked = function () { resolve(null); };
    });
    return cache[key];
  }

  async function idbGetArrayBuffer(dbName, storeName, key) {
    const val = await idbGetValue(dbName, storeName, key);
    if (val instanceof ArrayBuffer) return val;
    if (val && val.buffer instanceof ArrayBuffer) return val.buffer;
    return null;
  }

  function patchObjectOptions(target, nextValues) {
    const has = Object.prototype.hasOwnProperty;
    const backup = {};
    for (const key in nextValues) {
      if (!has.call(nextValues, key)) continue;
      backup[key] = has.call(target, key) ? { has: true, value: target[key] } : { has: false };
      target[key] = nextValues[key];
    }
    return function restorePatchedOptions() {
      for (const key in backup) {
        if (!has.call(backup, key)) continue;
        const prev = backup[key];
        if (prev.has) target[key] = prev.value;
        else delete target[key];
      }
    };
  }

  function getIdbLocation(options) {
    return {
      dbName: (options && options.idbDatabaseName) || "ppocrv5-model-cache",
      storeName: (options && options.idbStoreName) || "models",
    };
  }

  function getPersistenceSettings(options, disableFlagName) {
    const loc = getIdbLocation(options);
    return {
      persist: !(options && options[disableFlagName] === false),
      dbName: loc.dbName,
      storeName: loc.storeName,
    };
  }

  async function fetchModelArrayBuffer(url, onProgress, options) {
    const settings = getPersistenceSettings(options, "persistModelsInIndexedDB");
    const persist = settings.persist;
    const dbName = settings.dbName;
    const storeName = settings.storeName;
    const cacheKey = VERSION + "::" + url;

    if (persist && global.indexedDB) {
      const cached = await idbGetArrayBuffer(dbName, storeName, cacheKey);
      if (cached) {
        if (onProgress) onProgress(cached.byteLength, cached.byteLength, true);
        return cached;
      }
    }

    const network = await fetchArrayBufferWithProgress(url, onProgress);
    if (persist && global.indexedDB) {
      await idbPutValue(dbName, storeName, cacheKey, network);
    }
    return network;
  }

  async function fetchArrayBufferWithProgress(url, onProgress) {
    const response = await fetch(url, { cache: "force-cache" });
    if (!response.ok) throw new Error("Failed to fetch binary: " + url + " (" + response.status + ")");

    const total = Number(response.headers.get("content-length")) || 0;
    if (!response.body || !response.body.getReader) {
      const ab = await response.arrayBuffer();
      if (onProgress) onProgress(ab.byteLength, ab.byteLength || total, true);
      return ab;
    }

    const reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      const value = part.value;
      chunks.push(value);
      loaded += value.byteLength;
      if (onProgress) onProgress(loaded, total, false);
    }

    const out = new Uint8Array(loaded);
    let offset = 0;
    for (let i = 0; i < chunks.length; i++) {
      out.set(chunks[i], offset);
      offset += chunks[i].byteLength;
    }
    if (onProgress) onProgress(loaded, total || loaded, true);
    return out.buffer;
  }

  const BASE = scriptBaseUrl();
  const DEFAULTS = {
    ortScriptUrl: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.2/dist/ort.webgpu.min.js",
    paddleScriptUrl: "https://cdn.jsdelivr.net/npm/paddleocr@1.0.7/dist/index.min.js",
    wasmPaths: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.2/dist/",
    detModelUrl: toAbs(BASE, "./model/PP-OCRv5_mobile_det_infer.onnx"),
    recModelUrl: toAbs(BASE, "./model/PP-OCRv5_server_rec_infer.onnx"),
    dictPreparedUrl: toAbs(BASE, "./model/ppocrv5_dict.prepared.txt"),
    maxSideLength: 1280,
    inputMaxSide: 1280,
    dynamicDetMaxSide: true,
    allowDetUpscale: false,
    minDetMaxSide: 32,
    filterDetections: true,
    minBoxWidth: 3,
    minBoxHeight: 10,
    minBoxArea: 120,
    maxBoxes: 0,
    detectionPaddingBoxVertical: 0.4,
    detectionPaddingBoxHorizontal: 0.5,
    detectionTextPixelThreshold: 0.5,
    detectionMinimumAreaThreshold: 20,
    recognitionImageHeight: 48,
    executionProviders: ["webgpu", "wasm"],
    fallbackExecutionProviders: ["wasm"],
    persistModelsInIndexedDB: true,
    persistDictInIndexedDB: true,
    idbDatabaseName: "ppocrv5-model-cache",
    idbStoreName: "models",
    warmupTimes: 2,
    warmupImageWidth: 256,
    warmupImageHeight: 96,
    reportRecognitionProgress: true,
    onProgress: null,
  };

  function Engine(options) {
    this.options = mergeOptions(DEFAULTS, options);
    this._ocr = null;
    this._dict = null;
    this._dictUrlLoaded = null;
    this._canvas = null;
    this._busy = false;
    this._destroyed = false;
    this._initialized = false;
    this._initPromise = null;
    this._configKey = null;
    this._lastProgress = null;
    this._progressListeners = new Set();
  }

  Engine.prototype._ensureNotDestroyed = function () {
    if (this._destroyed) throw new Error("Engine already destroyed");
  };

  Engine.prototype._emitProgress = function (payload) {
    const prev = this._lastProgress && this._lastProgress.progress ? this._lastProgress.progress : null;
    const data = Object.assign({}, payload || {}, { ts: Date.now() });
    data.progress = deriveUnifiedProgress(data, prev);
    this._lastProgress = data;

    const listeners = this._progressListeners;
    listeners.forEach(function (fn) {
      try { fn(data); } catch (_) { /* ignore listener error */ }
    });
    if (typeof this.options.onProgress === "function") {
      try { this.options.onProgress(data); } catch (_) { /* ignore callback error */ }
    }
  };

  Engine.prototype._emitRecognize = function (state, stage, detail, err) {
    const payload = {
      phase: "recognize",
      state: state,
      recognize: Object.assign({ stage: stage }, detail || {}),
    };
    if (err !== undefined) payload.message = errorMessage(err);
    this._emitProgress(payload);
  };

  Engine.prototype.getInitProgress = function () {
    return this._lastProgress;
  };

  Engine.prototype.onInitProgress = function (fn) {
    if (typeof fn !== "function") return function () { };
    this._progressListeners.add(fn);
    if (this._lastProgress) {
      try { fn(this._lastProgress); } catch (_) { /* ignore */ }
    }
    const self = this;
    return function () {
      self._progressListeners.delete(fn);
    };
  };

  Engine.prototype._buildConfigKey = function () {
    return [
      this.options.detModelUrl || "",
      this.options.recModelUrl || "",
      this.options.dictPreparedUrl || "",
      String(clampInt(this.options.recognitionImageHeight, 16, 128, 48)),
      String(finiteNumber(this.options.detectionPaddingBoxVertical, 0.4)),
      String(finiteNumber(this.options.detectionPaddingBoxHorizontal, 0.5)),
      String(finiteNumber(this.options.detectionTextPixelThreshold, 0.5)),
      String(finiteNumber(this.options.detectionMinimumAreaThreshold, 20)),
      JSON.stringify(this.options.executionProviders || []),
      JSON.stringify(this.options.fallbackExecutionProviders || []),
    ].join("|");
  };

  Engine.prototype._ensureDeps = async function () {
    this._emitProgress({ phase: "deps", state: "loading" });
    await loadScriptOnce(this.options.ortScriptUrl, function () { return Boolean(global.ort); });
    await loadScriptOnce(this.options.paddleScriptUrl, function () {
      return Boolean(global.paddleocr && global.paddleocr.PaddleOcrService);
    });
    if (!global.ort || !global.ort.env) throw new Error("onnxruntime-web unavailable");
    global.ort.env.wasm = global.ort.env.wasm || {};
    global.ort.env.wasm.wasmPaths = this.options.wasmPaths;
    this._emitProgress({ phase: "deps", state: "done" });
  };

  Engine.prototype._loadPreparedDict = async function () {
    if (this._dict && this._dictUrlLoaded === this.options.dictPreparedUrl) return this._dict;
    const text = await fetchTextCached(this.options.dictPreparedUrl, this.options);
    const dict = text.split("\n");
    if (!dict.length) throw new Error("Prepared dict is empty");
    this._dict = dict;
    this._dictUrlLoaded = this.options.dictPreparedUrl;
    return dict;
  };

  Engine.prototype._createServiceWithProviders = async function (createOptions) {
    const ort = global.ort;
    const inf = ort && ort.InferenceSession;
    if (!inf || typeof inf.create !== "function") {
      return await global.paddleocr.PaddleOcrService.createInstance(createOptions);
    }

    const rawCreate = inf.create;
    const createBound = rawCreate.bind(inf);
    const preferred = Array.isArray(this.options.executionProviders) ? this.options.executionProviders : ["webgpu", "wasm"];
    const fallback = Array.isArray(this.options.fallbackExecutionProviders) ? this.options.fallbackExecutionProviders : ["wasm"];

    inf.create = async function (model, sessionOptions) {
      if (sessionOptions) return await createBound(model, sessionOptions);
      try {
        return await createBound(model, { executionProviders: preferred });
      } catch (_) {
        return await createBound(model, { executionProviders: fallback });
      }
    };

    try {
      return await global.paddleocr.PaddleOcrService.createInstance(createOptions);
    } finally {
      inf.create = rawCreate;
    }
  };

  Engine.prototype._downloadModelsWithProgress = async function () {
    const self = this;
    const state = {
      det: { loaded: 0, total: 0, done: false },
      rec: { loaded: 0, total: 0, done: false },
    };

    function report(which) {
      const det = state.det;
      const rec = state.rec;
      const totalLoaded = det.loaded + rec.loaded;
      const totalKnown = (det.total > 0 && rec.total > 0) ? (det.total + rec.total) : 0;
      const overallPercent = totalKnown > 0 ? (totalLoaded / totalKnown) * 100 : 0;
      self._emitProgress({
        phase: "download",
        state: "running",
        file: which,
        download: {
          det: {
            loadedBytes: det.loaded,
            totalBytes: det.total,
            loadedMB: mb(det.loaded),
            totalMB: mb(det.total),
            percent: det.total > 0 ? (det.loaded / det.total) * 100 : 0,
            done: Boolean(det.done),
          },
          rec: {
            loadedBytes: rec.loaded,
            totalBytes: rec.total,
            loadedMB: mb(rec.loaded),
            totalMB: mb(rec.total),
            percent: rec.total > 0 ? (rec.loaded / rec.total) * 100 : 0,
            done: Boolean(rec.done),
          },
          overall: {
            loadedBytes: totalLoaded,
            totalBytes: totalKnown,
            loadedMB: mb(totalLoaded),
            totalMB: mb(totalKnown),
            percent: overallPercent,
          }
        }
      });
    }

    const tasks = [
      { key: "det", url: this.options.detModelUrl },
      { key: "rec", url: this.options.recModelUrl },
    ];
    const bufs = await Promise.all(tasks.map(function (task) {
      return fetchModelArrayBuffer(task.url, function (loaded, total, done) {
        state[task.key].loaded = loaded;
        state[task.key].total = total || state[task.key].total;
        state[task.key].done = Boolean(done);
        report(task.key);
      }, self.options);
    }));
    this._emitProgress({ phase: "download", state: "done" });
    return { detBuf: bufs[0], recBuf: bufs[1] };
  };

  Engine.prototype._bitmapToInput = function (bitmap, inputMaxSide) {
    const maxSide = clampInt(inputMaxSide, 320, 4096, this.options.inputMaxSide);
    const srcW = bitmap.width;
    const srcH = bitmap.height;
    const srcMax = Math.max(srcW, srcH);
    const scale = srcMax > maxSide ? (maxSide / srcMax) : 1;
    const dstW = Math.max(1, Math.round(srcW * scale));
    const dstH = Math.max(1, Math.round(srcH * scale));

    const canvas = this._canvas || (this._canvas = document.createElement("canvas"));
    canvas.width = dstW;
    canvas.height = dstH;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, dstW, dstH);
    ctx.drawImage(bitmap, 0, 0, dstW, dstH);

    const img = ctx.getImageData(0, 0, dstW, dstH);
    const data = new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength);
    return {
      width: dstW,
      height: dstH,
      data: data,
    };
  };

  Engine.prototype._filterDetections = function (detection, runOptions) {
    if (!Array.isArray(detection)) return detection;
    if (runOptions.filterDetections === false) return detection;

    const minW = clampInt(runOptions.minBoxWidth, 0, 4096, 3);
    const minH = clampInt(runOptions.minBoxHeight, 0, 4096, 10);
    const minA = clampInt(runOptions.minBoxArea, 0, 1e9, 120);
    const maxBoxes = clampInt(runOptions.maxBoxes, 0, 1e6, 0);
    const out = [];
    for (let i = 0; i < detection.length; i++) {
      const b = detection[i];
      if (!b) continue;
      const w = clampInt(b.width, 0, 1e7, 0);
      const h = clampInt(b.height, 0, 1e7, 0);
      if (w < minW || h < minH || (w * h) < minA) continue;
      out.push(b);
      if (maxBoxes > 0 && out.length >= maxBoxes) break;
    }
    return out;
  };

  Engine.prototype._recognizeInput = async function (input, runOptions) {
    const ocr = this._ocr;
    const detSvc = ocr && ocr.detectionService;
    const recSvc = ocr && ocr.recognitionService;
    if (!detSvc || !recSvc) throw new Error("Invalid OCR service");
    const enableRecognizeProgress = runOptions.reportRecognitionProgress !== false;

    const detOpt = detSvc.options || (detSvc.options = {});
    const recOpt = recSvc.options || (recSvc.options = {});

    const configuredDetMaxSide = clampInt(runOptions.maxSideLength, 32, 4096, 1280);
    let effectiveDetMaxSide = configuredDetMaxSide;
    if (runOptions.dynamicDetMaxSide !== false) {
      const srcMax = Math.max(input.width, input.height);
      if (runOptions.allowDetUpscale === false) {
        effectiveDetMaxSide = Math.min(configuredDetMaxSide, srcMax);
      }
      effectiveDetMaxSide = Math.max(clampInt(runOptions.minDetMaxSide, 32, 4096, 32), effectiveDetMaxSide);
    }

    const restoreDet = patchObjectOptions(detOpt, {
      maxSideLength: effectiveDetMaxSide,
      paddingBoxVertical: finiteNumber(runOptions.detectionPaddingBoxVertical, 0.4),
      paddingBoxHorizontal: finiteNumber(runOptions.detectionPaddingBoxHorizontal, 0.5),
      textPixelThreshold: finiteNumber(runOptions.detectionTextPixelThreshold, 0.5),
      minimumAreaThreshold: finiteNumber(runOptions.detectionMinimumAreaThreshold, 20),
    });
    const restoreRec = patchObjectOptions(recOpt, {
      imageHeight: clampInt(runOptions.recognitionImageHeight, 16, 128, 48),
    });

    const detRunRaw = detSvc.run;
    const recRunRaw = recSvc.run;
    const recProcessBoxRaw = recSvc.processBox;
    const engine = this;
    const emit = createRecognizeEmitter(engine, enableRecognizeProgress);
    let filteredFromDet = null;
    let detectionFromDet = null;

    detSvc.run = async function (image) {
      emitProgressEvent(emit, "running", "det", stageDetail(0, RECOGNIZE_OVERALL.prep));
      try {
        const detection = await detRunRaw.call(detSvc, image);
        const filtered = engine._filterDetections(detection, runOptions);
        detectionFromDet = detection;
        filteredFromDet = filtered;
        emitProgressEvent(emit, "running", "det", stageDetail(100, RECOGNIZE_OVERALL.det, {
          detectedBoxes: Array.isArray(detection) ? detection.length : 0,
          boxes: Array.isArray(filtered) ? filtered.length : 0,
        }));
        return detection;
      } catch (e) {
        emitProgressEvent(emit, "failed", "det", stageDetail(100, RECOGNIZE_OVERALL.det), e);
        throw e;
      }
    };

    recSvc.run = async function (image, detection, options) {
      const filtered = (detection === detectionFromDet && Array.isArray(filteredFromDet))
        ? filteredFromDet
        : engine._filterDetections(detection, runOptions);
      detectionFromDet = null;
      filteredFromDet = null;
      const total = Array.isArray(filtered) ? filtered.length : 0;
      let completed = 0;
      emitProgressEvent(emit, "running", "rec", Object.assign(buildRecDetail(0, total), { overallPercent: RECOGNIZE_OVERALL.det }));

      const canTrackPerBox = enableRecognizeProgress && typeof recProcessBoxRaw === "function" && total > 0;
      try {
        if (canTrackPerBox) {
          recSvc.processBox = async function (task) {
            const result = await recProcessBoxRaw.call(recSvc, task);
            completed += 1;
            emitProgressEvent(emit, "running", "rec", buildRecDetail(completed, total));
            return result;
          };
        }
        const out = await recRunRaw.call(recSvc, image, filtered, options);
        emitProgressEvent(emit, "running", "rec", buildRecDetail(total, total));
        return out;
      } catch (e) {
        emitProgressEvent(emit, "failed", "rec", buildRecDetail(completed, total), e);
        throw e;
      } finally {
        if (canTrackPerBox) recSvc.processBox = recProcessBoxRaw;
      }
    };

    try {
      const recResults = await ocr.recognize(input);
      try {
        emitProgressEvent(emit, "running", "post", stageDetail(0, RECOGNIZE_OVERALL.rec));
        const final = ocr.processRecognition(recResults);
        emitProgressEvent(emit, "running", "post", stageDetail(100, RECOGNIZE_OVERALL.done));
        return {
          text: final && final.text ? final.text : "",
          confidence: final && Number.isFinite(final.confidence) ? final.confidence : 0,
          lines: final && Array.isArray(final.lines) ? final.lines : [],
        };
      } catch (e) {
        emitProgressEvent(emit, "failed", "post", stageDetail(100, RECOGNIZE_OVERALL.done), e);
        throw e;
      }
    } finally {
      detSvc.run = detRunRaw;
      recSvc.run = recRunRaw;
      restoreDet();
      restoreRec();
    }
  };

  Engine.prototype._withLock = async function (fn) {
    if (this._busy) throw new Error("Engine busy");
    this._busy = true;
    try {
      return await fn();
    } finally {
      this._busy = false;
    }
  };

  Engine.prototype._withReadyLock = async function (overrideOptions, fn) {
    this._ensureNotDestroyed();
    await this.init(overrideOptions);
    return await this._withLock(fn);
  };

  Engine.prototype._warmupOnce = async function (runOptions) {
    const w = clampInt(runOptions.warmupImageWidth, 32, 1024, 256);
    const h = clampInt(runOptions.warmupImageHeight, 32, 1024, 96);
    const dummy = {
      width: w,
      height: h,
      data: new Uint8Array(w * h * 4).fill(255),
    };
    const warmupOptions = mergeOptions(runOptions, { reportRecognitionProgress: false });
    await this._recognizeInput(dummy, warmupOptions);
  };

  Engine.prototype.init = async function (overrideOptions) {
    this._ensureNotDestroyed();
    if (overrideOptions) this.options = mergeOptions(this.options, overrideOptions);

    const nextKey = this._buildConfigKey();
    if (this._initialized && this._ocr && this._configKey === nextKey) return this;
    if (this._initPromise) return await this._initPromise;

    if (this._initialized && this._ocr && this._configKey !== nextKey) {
      try {
        if (typeof this._ocr.destroy === "function") await this._ocr.destroy();
      } catch (e) {
        logError("destroy old service failed", e);
      }
      this._ocr = null;
      this._initialized = false;
    }

    const self = this;
    this._initPromise = (async function () {
      self._emitProgress({ phase: "init", state: "start" });
      await self._ensureDeps();

      self._emitProgress({ phase: "dict", state: "loading" });
      const dict = await self._loadPreparedDict();
      self._emitProgress({ phase: "dict", state: "done" });

      const dl = await self._downloadModelsWithProgress();
      self._emitProgress({ phase: "service", state: "creating" });
      self._ocr = await self._createServiceWithProviders({
        ort: global.ort,
        detection: {
          modelBuffer: dl.detBuf,
          maxSideLength: clampInt(self.options.maxSideLength, 32, 4096, 1280),
          paddingBoxVertical: finiteNumber(self.options.detectionPaddingBoxVertical, 0.4),
          paddingBoxHorizontal: finiteNumber(self.options.detectionPaddingBoxHorizontal, 0.5),
          textPixelThreshold: finiteNumber(self.options.detectionTextPixelThreshold, 0.5),
          minimumAreaThreshold: finiteNumber(self.options.detectionMinimumAreaThreshold, 20),
        },
        recognition: {
          modelBuffer: dl.recBuf,
          charactersDictionary: dict,
          imageHeight: clampInt(self.options.recognitionImageHeight, 16, 128, 48),
        },
      });
      self._emitProgress({ phase: "service", state: "done" });

      const warmupTimes = clampInt(self.options.warmupTimes, 0, 8, 2);
      const runOptions = self.options;
      for (let i = 0; i < warmupTimes; i++) {
        self._emitProgress({
          phase: "warmup",
          state: "running",
          warmup: {
            current: i + 1,
            total: warmupTimes,
            percent: warmupTimes > 0 ? ((i + 1) / warmupTimes) * 100 : 100,
          }
        });
        await self._warmupOnce(runOptions);
      }
      self._emitProgress({ phase: "warmup", state: "done", warmup: { current: warmupTimes, total: warmupTimes, percent: 100 } });

      self._initialized = true;
      self._configKey = nextKey;
      self._emitProgress({ phase: "ready", state: "done" });
      return self;
    })();

    try {
      return await this._initPromise;
    } catch (e) {
      logError("init failed", e);
      this._emitProgress({ phase: "error", state: "failed", message: errorMessage(e) });
      throw e;
    } finally {
      this._initPromise = null;
    }
  };

  Engine.prototype._recognizeBitmap = async function (bitmap, overrideOptions) {
    const runOptions = overrideOptions ? mergeOptions(this.options, overrideOptions) : this.options;
    const enableRecognizeProgress = runOptions.reportRecognitionProgress !== false;
    const emit = createRecognizeEmitter(this, enableRecognizeProgress);
    emitProgressEvent(emit, "running", "start", stageDetail(0, RECOGNIZE_OVERALL.start));
    emitProgressEvent(emit, "running", "prep", stageDetail(0, RECOGNIZE_OVERALL.start));

    let input = null;
    try {
      input = this._bitmapToInput(bitmap, runOptions.inputMaxSide);
    } catch (e) {
      emitProgressEvent(emit, "failed", "prep", stageDetail(100, RECOGNIZE_OVERALL.prep), e);
      throw e;
    }

    emitProgressEvent(emit, "running", "prep", stageDetail(100, RECOGNIZE_OVERALL.prep));
    const result = await this._recognizeInput(input, runOptions);
    emitProgressEvent(emit, "done", "done", stageDetail(100, RECOGNIZE_OVERALL.done));
    return result;
  };

  Engine.prototype.recognizeFile = async function (file, overrideOptions) {
    return await this._withReadyLock(overrideOptions, async () => {
      let bitmap = null;
      try {
        bitmap = await createImageBitmap(file);
        return this._recognizeBitmap(bitmap, overrideOptions);
      } finally {
        if (bitmap && typeof bitmap.close === "function") bitmap.close();
      }
    });
  };

  Engine.prototype.recognizeBlob = async function (blob, overrideOptions) {
    return await this.recognizeFile(blob, overrideOptions);
  };

  Engine.prototype.recognizeImageBitmap = async function (bitmap, overrideOptions) {
    return await this._withReadyLock(overrideOptions, async () => this._recognizeBitmap(bitmap, overrideOptions));
  };

  Engine.prototype.destroy = async function () {
    if (this._destroyed) return;
    try {
      if (this._ocr && typeof this._ocr.destroy === "function") await this._ocr.destroy();
    } catch (e) {
      logError("destroy failed", e);
    }
    this._ocr = null;
    this._dict = null;
    this._dictUrlLoaded = null;
    this._initialized = false;
    this._destroyed = true;
    this._configKey = null;
  };

  function getSingletonEngine(createIfMissing, options) {
    let engine = global[SINGLETON_KEY] || null;
    if (!engine && createIfMissing) {
      engine = new Engine(options || null);
      global[SINGLETON_KEY] = engine;
      return engine;
    }
    if (engine && options) {
      engine.options = mergeOptions(engine.options, options);
    }
    return engine;
  }

  async function init(options) {
    const engine = getSingletonEngine(true, options);
    await engine.init();
    return engine;
  }

  const api = {
    version: VERSION,
    defaults: mergeOptions({}, DEFAULTS),
    create: function (options) { return new Engine(options); },
    init: init,
    onInitProgress: function (fn) {
      return getSingletonEngine(true, null).onInitProgress(fn);
    },
    getInitProgress: function () {
      const engine = getSingletonEngine(false, null);
      return engine ? engine.getInitProgress() : null;
    },
    getSingleton: function () { return global[SINGLETON_KEY] || null; },
    Engine: Engine,
  };

  global[GLOBAL_NS] = api;
})(window);
