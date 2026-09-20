'use strict';

// ── Application State ─────────────────────────────────────────────────────────
// Initialized from plain config file (config.js)
const state = {
  stripHeight:         CONFIG.stripHeight,
  maxContrast:         CONFIG.maxContrast,
  contrastScale:       CONFIG.contrastScale,
  minSpatialFreqCpd:   CONFIG.minSpatialFreqCpd,
  deltaSpatialFreqCpd: CONFIG.deltaSpatialFreqCpd,
  spatialFreqScale:    CONFIG.spatialFreqScale,
  viewingDistanceCm:   CONFIG.viewingDistanceCm,
  gratingWidthCm:      CONFIG.gratingWidthCm,
  minTemporalFreq:     CONFIG.minTemporalFreq,
  deltaTemporalFreq:   CONFIG.deltaTemporalFreq,
  temporalFreqScale:   CONFIG.temporalFreqScale,
  gamma:               CONFIG.gamma
};

// ── URL Query Parameter Parsing & Synchronization ─────────────────────────────
/**
 * Reads URL query parameters (e.g. from GitHub Pages) and overrides state
 */
function parseURLParams() {
  if (!window.location.search) return;

  const params = new URLSearchParams(window.location.search);
  const defs = CONFIG.sliderDefs;
  const aliases = CONFIG.paramAliases || {};

  // Helper to find param value case-insensitively across canonical key and aliases
  const getParamVal = (key) => {
    if (params.has(key)) return params.get(key);
    const keyLower = key.toLowerCase();
    for (const [pKey, pVal] of params.entries()) {
      if (pKey.toLowerCase() === keyLower) return pVal;
    }
    const aliasList = aliases[key] || [];
    for (const alias of aliasList) {
      for (const [pKey, pVal] of params.entries()) {
        if (pKey.toLowerCase() === alias.toLowerCase()) return pVal;
      }
    }
    return null;
  };

  // 1. Slider Parameters
  const sliderKeys = [
    { key: 'stripHeight',         parse: parseInt },
    { key: 'maxContrast',         parse: parseFloat },
    { key: 'minSpatialFreqCpd',   parse: parseFloat },
    { key: 'deltaSpatialFreqCpd', parse: parseFloat },
    { key: 'viewingDistanceCm',   parse: parseInt },
    { key: 'gratingWidthCm',      parse: parseInt },
    { key: 'minTemporalFreq',     parse: parseFloat },
    { key: 'deltaTemporalFreq',   parse: parseFloat },
    { key: 'gamma',               parse: parseFloat }
  ];

  sliderKeys.forEach(({ key, parse }) => {
    const rawVal = getParamVal(key);
    if (rawVal !== null) {
      const num = parse(rawVal);
      if (!isNaN(num)) {
        const def = defs[key];
        // Safely clamp within slider bounds
        state[key] = Math.max(def.min, Math.min(def.max, num));
      }
    }
  });

  // Convenience: allow max_sf or max_tf in URL to derive delta
  const rawMaxSF = params.get('max_sf') || params.get('maxsf');
  if (rawMaxSF !== null && !getParamVal('deltaSpatialFreqCpd')) {
    const maxSF = parseFloat(rawMaxSF);
    if (!isNaN(maxSF)) {
      state.deltaSpatialFreqCpd = Math.max(0, Math.min(defs.deltaSpatialFreqCpd.max, maxSF - state.minSpatialFreqCpd));
    }
  }

  const rawMaxTF = params.get('max_tf') || params.get('maxtf');
  if (rawMaxTF !== null && !getParamVal('deltaTemporalFreq')) {
    const maxTF = parseFloat(rawMaxTF);
    if (!isNaN(maxTF)) {
      state.deltaTemporalFreq = Math.max(0, Math.min(defs.deltaTemporalFreq.max, maxTF - state.minTemporalFreq));
    }
  }

  // 2. Dropdown Scale Parameters
  const scaleKeys = ['contrastScale', 'spatialFreqScale', 'temporalFreqScale'];
  scaleKeys.forEach(key => {
    const rawVal = getParamVal(key);
    if (rawVal) {
      const valLower = rawVal.toLowerCase().trim();
      if (valLower === 'log' || valLower === 'logarithmic') {
        state[key] = 'logarithmic';
      } else if (valLower === 'lin' || valLower === 'linear') {
        state[key] = 'linear';
      }
    }
  });
}

/**
 * Updates URL search string in the browser address bar without reloading
 */
function updateURL() {
  if (!window.history || !window.history.replaceState) return;

  try {
    const params = new URLSearchParams();
    const keys = [
      'stripHeight', 'maxContrast', 'contrastScale',
      'minSpatialFreqCpd', 'deltaSpatialFreqCpd', 'spatialFreqScale',
      'viewingDistanceCm', 'gratingWidthCm',
      'minTemporalFreq', 'deltaTemporalFreq', 'temporalFreqScale',
      'gamma'
    ];

    keys.forEach(k => {
      params.set(k, state[k]);
    });

    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, '', newUrl);
  } catch (e) {
    // Gracefully ignore DOMException/SecurityError on local file:// URLs in some browsers
  }
}

// ── Canvas Setup ──────────────────────────────────────────────────────────────
const canvas = document.getElementById('gratingCanvas');
const ctx = canvas.getContext('2d', { willReadFrequently: false });
let dpr = window.devicePixelRatio || 1;

let animFrameId = null;
let animStartTime = null;

// Pixel buffers
let imgData = null;
let imgDataU32 = null;
let canvasCssW = 0;
let canvasCssH = 0;

// Grating sub-area dimensions
let gratingCssW = 0;
let gratingCssH = 0;
let gratingPhysW = 0;
let gratingPhysH = 0;

// ── Photometric Calculations ──────────────────────────────────────────────────
/**
 * Luminance of mid-grey anchor point (RGB 186)
 * L(v) = L_min + (L_max - L_min) * (v / 255)^gamma
 */
function getMidLuminance(gamma) {
  return CONFIG.lMin + (CONFIG.lMax - CONFIG.lMin) * Math.pow(CONFIG.vMid / 255, gamma);
}

/**
 * Invert monitor gamma: Convert physical luminance (cd/m²) to 8-bit RGB value
 */
function luminanceToRGB(lum, gamma) {
  const norm = Math.max(0, Math.min(1, (lum - CONFIG.lMin) / (CONFIG.lMax - CONFIG.lMin)));
  return Math.round(255 * Math.pow(norm, 1 / gamma));
}

// ── Resize & Layout Geometry ──────────────────────────────────────────────────
function resizeCanvas() {
  const container = document.getElementById('canvasContainer');
  canvasCssW = container.clientWidth;
  canvasCssH = container.clientHeight;
  dpr = window.devicePixelRatio || 1;

  gratingCssW = Math.max(10, canvasCssW - CONFIG.rightMarginWidth);
  gratingCssH = Math.max(10, canvasCssH - CONFIG.bottomMarginHeight);

  const physW = Math.max(1, Math.round(canvasCssW * dpr));
  const physH = Math.max(1, Math.round(canvasCssH * dpr));

  gratingPhysW = Math.max(1, Math.round(gratingCssW * dpr));
  gratingPhysH = Math.max(1, Math.round(gratingCssH * dpr));

  if (canvas.width !== physW || canvas.height !== physH) {
    canvas.width = physW;
    canvas.height = physH;
    imgData = ctx.createImageData(physW, physH);
    imgDataU32 = new Uint32Array(imgData.data.buffer);
  }
}

// ── Render Grating & Margin Strips ────────────────────────────────────────────
function renderGrating(tSec) {
  if (!imgData || !imgDataU32) return;

  const physW = canvas.width;
  const physH = canvas.height;
  const gamma = state.gamma;
  const lMid = getMidLuminance(gamma);
  const vMid = CONFIG.vMid;
  const midGreyPixel = (255 << 24) | (vMid << 16) | (vMid << 8) | vMid;

  // 1. Physical Calibration: Pixels per visual degree
  const pixelsPerCm = gratingPhysW / state.gratingWidthCm;
  const degPerCm = 2 * Math.atan(1 / (2 * state.viewingDistanceCm)) * (180 / Math.PI);
  const pixelsPerDegree = pixelsPerCm / degPerCm;

  // Derive maximum frequencies from min + delta
  const maxSpatialFreqCpd = state.minSpatialFreqCpd + state.deltaSpatialFreqCpd;
  const maxTemporalFreq = state.minTemporalFreq + state.deltaTemporalFreq;

  // Spatial frequency in cycles per physical pixel
  const fPxMin = Math.max(0.00001, state.minSpatialFreqCpd / pixelsPerDegree);
  const fPxMax = Math.max(0.00001, maxSpatialFreqCpd / pixelsPerDegree);

  // 2. Pre-calculate integrated spatial phase chirp & temporal frequencies
  const sinChirp = new Float64Array(gratingPhysW);
  const temporalFactor = new Float64Array(gratingPhysW);

  // Integrated spatial phase: Linear vs Logarithmic chirp
  const isSpatialChirp = state.deltaSpatialFreqCpd > 0.0001;
  if (!isSpatialChirp) {
    const twoPiF0 = 2 * Math.PI * fPxMin;
    for (let x = 0; x < gratingPhysW; x++) {
      sinChirp[x] = Math.sin(twoPiF0 * x);
    }
  } else if (state.spatialFreqScale === 'logarithmic') {
    const kRatio = fPxMax / fPxMin;
    const lnK = Math.log(kRatio);
    const coeff = (2 * Math.PI * fPxMin * gratingPhysW) / lnK;
    for (let x = 0; x < gratingPhysW; x++) {
      const phase = coeff * (Math.pow(kRatio, x / gratingPhysW) - 1.0);
      sinChirp[x] = Math.sin(phase);
    }
  } else {
    const deltaF_px = (fPxMax - fPxMin) / (2.0 * gratingPhysW);
    for (let x = 0; x < gratingPhysW; x++) {
      const phase = 2 * Math.PI * (fPxMin * x + deltaF_px * x * x);
      sinChirp[x] = Math.sin(phase);
    }
  }

  // Temporal counterphase modulation across width
  const isTemporalActive = state.minTemporalFreq > 0 || state.deltaTemporalFreq > 0;
  if (!isTemporalActive) {
    temporalFactor.fill(1.0);
  } else if (state.deltaTemporalFreq <= 0.0001) {
    const factor = Math.cos(2 * Math.PI * state.minTemporalFreq * tSec);
    temporalFactor.fill(factor);
  } else if (state.temporalFreqScale === 'logarithmic') {
    const f0 = state.minTemporalFreq;
    const f1 = maxTemporalFreq;
    if (f0 > 0.01) {
      const kRatioTF = f1 / f0;
      for (let x = 0; x < gratingPhysW; x++) {
        const localTF = f0 * Math.pow(kRatioTF, x / gratingPhysW);
        temporalFactor[x] = Math.cos(2 * Math.PI * localTF * tSec);
      }
    } else {
      const floorTF = Math.min(CONFIG.minLogTemporalFreq, f1);
      const kRatioTF = f1 / floorTF;
      temporalFactor[0] = 1.0;
      for (let x = 1; x < gratingPhysW; x++) {
        const localTF = floorTF * Math.pow(kRatioTF, x / gratingPhysW);
        temporalFactor[x] = Math.cos(2 * Math.PI * localTF * tSec);
      }
    }
  } else {
    const deltaTF = state.deltaTemporalFreq / gratingPhysW;
    for (let x = 0; x < gratingPhysW; x++) {
      const localTF = state.minTemporalFreq + deltaTF * x;
      temporalFactor[x] = Math.cos(2 * Math.PI * localTF * tSec);
    }
  }

  // 3. Strip Distribution & Contrast Spacing (Linear vs Logarithmic)
  const stripH_phys = state.stripHeight * dpr;
  const numStrips = Math.ceil(gratingCssH / state.stripHeight);

  let currentBottomY_phys = gratingPhysH;
  const stripRowBuffer = new Uint32Array(gratingPhysW);
  const stripLabels = [];

  for (let k = 0; k < numStrips; k++) {
    const stripTopY_phys = Math.max(0, Math.round(gratingPhysH - (k + 1) * stripH_phys));
    const stripBottomY_phys = currentBottomY_phys;
    const actualStripHeight = stripBottomY_phys - stripTopY_phys;

    if (actualStripHeight <= 0) break;

    // Calculate strip contrast
    let stripContrast = 0;
    if (k === numStrips - 1) {
      stripContrast = 0.00;
    } else if (k === 0) {
      stripContrast = state.maxContrast;
    } else {
      if (state.contrastScale === 'logarithmic') {
        if (numStrips > 2 && state.maxContrast > 0) {
          const minC = Math.min(CONFIG.minLogContrast, state.maxContrast);
          const alpha = k / (numStrips - 2);
          stripContrast = state.maxContrast * Math.pow(minC / state.maxContrast, alpha);
        } else {
          stripContrast = 0;
        }
      } else {
        const step = state.maxContrast / (numStrips - 1);
        stripContrast = Math.max(0, state.maxContrast - k * step);
      }
    }

    // Save vertical center and contrast for label rendering
    stripLabels.push({
      k: k,
      isTop: (k === numStrips - 1),
      contrast: stripContrast,
      yCenter: (stripTopY_phys + stripBottomY_phys) / 2
    });

    // Compute horizontal pixel row for strip k
    for (let x = 0; x < gratingPhysW; x++) {
      const deltaL = stripContrast * lMid * temporalFactor[x];
      const lum = lMid + deltaL * sinChirp[x];
      const v = luminanceToRGB(lum, gamma);
      stripRowBuffer[x] = (255 << 24) | (v << 16) | (v << 8) | v;
    }

    // Copy to all rows belonging to strip k
    for (let y = stripTopY_phys; y < stripBottomY_phys; y++) {
      const rowOffset = y * physW;
      imgDataU32.set(stripRowBuffer, rowOffset);
      for (let x = gratingPhysW; x < physW; x++) {
        imgDataU32[rowOffset + x] = midGreyPixel;
      }
    }

    currentBottomY_phys = stripTopY_phys;
    if (stripTopY_phys === 0) break;
  }

  // 4. Fill bottom horizontal blank grey strip (and bottom-right corner)
  for (let y = gratingPhysH; y < physH; y++) {
    const rowOffset = y * physW;
    for (let x = 0; x < physW; x++) {
      imgDataU32[rowOffset + x] = midGreyPixel;
    }
  }

  // 5. Blit pixel buffer to canvas
  ctx.putImageData(imgData, 0, 0);

  // 6. Draw Text Overlays
  drawRightContrastLabels(stripLabels, physW);
  drawBottomFrequencyLabels(physH);
}

// ── Right Strip: White Contrast Labels with Black Tick Lines ──────────────────
function drawRightContrastLabels(stripLabels, physW) {
  if (!stripLabels.length) return;

  const fontSize = Math.max(10, Math.round(11 * dpr));
  ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, "SF Mono", Menlo, Consolas, monospace`;
  ctx.textBaseline = 'middle';

  const tickLen = Math.round(10 * dpr);
  const tickStartX = gratingPhysW + Math.round(2 * dpr);
  const tickEndX = tickStartX + tickLen;
  const textX = tickEndX + Math.round(6 * dpr);

  const minSeparation = fontSize * 2.2;
  const topLabel = stripLabels[stripLabels.length - 1]; // Guaranteed 0.00 label

  const labelsToDraw = [];

  // Always include top 0.00 label
  labelsToDraw.push({
    contrast: 0.00,
    yCenter: topLabel.yCenter
  });

  // Select remaining labels from bottom (k=0) upward
  let lastY = -Infinity;
  for (let i = 0; i < stripLabels.length - 1; i++) {
    const item = stripLabels[i];
    if (Math.abs(item.yCenter - lastY) >= minSeparation &&
        Math.abs(item.yCenter - topLabel.yCenter) >= minSeparation) {
      labelsToDraw.push(item);
      lastY = item.yCenter;
    }
  }

  // Render each label with black tick line
  labelsToDraw.forEach(item => {
    const y = Math.round(item.yCenter);

    // Black tick line extending toward grating
    ctx.beginPath();
    ctx.moveTo(tickStartX, y);
    ctx.lineTo(tickEndX, y);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = Math.max(1, Math.round(1.5 * dpr));
    ctx.stroke();

    // White text
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';

    let txt;
    if (item.contrast === 0) {
      txt = '0.00';
    } else if (item.contrast >= 0.10) {
      txt = item.contrast.toFixed(2);
    } else {
      txt = item.contrast.toFixed(3);
    }

    ctx.fillText(txt, textX, y);
  });
}

// ── Bottom Strip: Conditional Spatial & Temporal Frequency Labels ─────────────
function drawBottomFrequencyLabels(physH) {
  const showSF = state.deltaSpatialFreqCpd >= 0.01;
  const showTF = state.deltaTemporalFreq >= 0.01;

  if (!showSF && !showTF) return;

  const bottomMarginPhysH = physH - gratingPhysH;
  const fontSize = Math.max(9, Math.round(10.5 * dpr));
  ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, "SF Mono", Menlo, Consolas, monospace`;
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';

  let sfY, tfY;
  if (showSF && showTF) {
    sfY = gratingPhysH + bottomMarginPhysH * 0.32;
    tfY = gratingPhysH + bottomMarginPhysH * 0.72;
  } else if (showSF) {
    sfY = gratingPhysH + bottomMarginPhysH * 0.50;
  } else {
    tfY = gratingPhysH + bottomMarginPhysH * 0.50;
  }

  // 5 evenly spaced anchor points: 0%, 25%, 50%, 75%, 100%
  const fractions = [0.0, 0.25, 0.50, 0.75, 1.0];
  const maxSF = state.minSpatialFreqCpd + state.deltaSpatialFreqCpd;
  const maxTF = state.minTemporalFreq + state.deltaTemporalFreq;

  fractions.forEach((frac, idx) => {
    let posX = Math.round(frac * gratingPhysW);
    if (idx === 0) {
      ctx.textAlign = 'left';
      posX += Math.round(8 * dpr);
    } else if (idx === fractions.length - 1) {
      ctx.textAlign = 'right';
      posX -= Math.round(8 * dpr);
    } else {
      ctx.textAlign = 'center';
    }

    // Spatial Frequency label
    if (showSF) {
      let sfVal;
      if (state.spatialFreqScale === 'logarithmic') {
        const ratio = maxSF / state.minSpatialFreqCpd;
        sfVal = state.minSpatialFreqCpd * Math.pow(ratio, frac);
      } else {
        sfVal = state.minSpatialFreqCpd + frac * state.deltaSpatialFreqCpd;
      }
      const sfText = idx === 0 ? `SF: ${sfVal.toFixed(2)} cpd` : `${sfVal.toFixed(2)} cpd`;
      ctx.fillText(sfText, posX, sfY);
    }

    // Temporal Frequency label
    if (showTF) {
      let tfVal;
      if (state.temporalFreqScale === 'logarithmic') {
        const f0 = state.minTemporalFreq;
        if (f0 > 0.01) {
          const ratio = maxTF / f0;
          tfVal = f0 * Math.pow(ratio, frac);
        } else {
          const floorTF = Math.min(CONFIG.minLogTemporalFreq, maxTF);
          tfVal = frac === 0 ? 0 : floorTF * Math.pow(maxTF / floorTF, frac);
        }
      } else {
        tfVal = state.minTemporalFreq + frac * state.deltaTemporalFreq;
      }
      const tfText = idx === 0 ? `TF: ${tfVal.toFixed(1)} Hz` : `${tfVal.toFixed(1)} Hz`;
      ctx.fillText(tfText, posX, tfY);
    }
  });
}

// ── Animation Loop ────────────────────────────────────────────────────────────
function animationLoop(timestamp) {
  if (animStartTime === null) {
    animStartTime = timestamp;
  }
  const tSec = (timestamp - animStartTime) / 1000.0;
  renderGrating(tSec);
  animFrameId = requestAnimationFrame(animationLoop);
}

function updateAnimationState() {
  const isTemporalActive = state.minTemporalFreq > 0 || state.deltaTemporalFreq > 0;

  if (isTemporalActive) {
    if (!animFrameId) {
      animStartTime = null;
      animFrameId = requestAnimationFrame(animationLoop);
    }
  } else {
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
      animStartTime = null;
    }
    renderGrating(0);
  }
}

// ── Info Card Readouts ────────────────────────────────────────────────────────
function updateInfo() {
  const numStrips = Math.ceil(gratingCssH / state.stripHeight);

  document.getElementById('infoStripCount').textContent = numStrips;
  document.getElementById('infoTopContrast').textContent = '0.00';

  const labelEl = document.getElementById('infoContrastLabel');
  const stepEl = document.getElementById('infoContrastStep');

  if (state.contrastScale === 'logarithmic') {
    labelEl.textContent = 'Contrast ratio (step):';
    if (numStrips > 2 && state.maxContrast > 0) {
      const minC = Math.min(CONFIG.minLogContrast, state.maxContrast);
      const ratio = Math.pow(minC / state.maxContrast, 1 / (numStrips - 2));
      stepEl.textContent = `${ratio.toFixed(3)}x`;
    } else {
      stepEl.textContent = '-';
    }
  } else {
    labelEl.textContent = 'Contrast step (auto):';
    const step = numStrips > 1 ? state.maxContrast / (numStrips - 1) : 0;
    stepEl.textContent = step.toFixed(4);
  }
}

// ── Slider Initialization & Event Binding ─────────────────────────────────────
function setupSliders() {
  const defs = CONFIG.sliderDefs;

  const sliderKeys = [
    { id: 'stripHeight',         key: 'stripHeight',         parse: parseInt,   fmt: v => `${v} px` },
    { id: 'maxContrast',         key: 'maxContrast',         parse: parseFloat, fmt: v => v.toFixed(2) },
    { id: 'minSpatialFreqCpd',   key: 'minSpatialFreqCpd',   parse: parseFloat, fmt: v => `${v.toFixed(2)} cpd` },
    { id: 'deltaSpatialFreqCpd', key: 'deltaSpatialFreqCpd', parse: parseFloat, fmt: v => `${v.toFixed(1)} cpd` },
    { id: 'viewingDistanceCm',   key: 'viewingDistanceCm',   parse: parseInt,   fmt: v => `${v} cm` },
    { id: 'gratingWidthCm',      key: 'gratingWidthCm',      parse: parseInt,   fmt: v => `${v} cm` },
    { id: 'minTemporalFreq',     key: 'minTemporalFreq',     parse: parseFloat, fmt: v => `${v.toFixed(1)} Hz` },
    { id: 'deltaTemporalFreq',   key: 'deltaTemporalFreq',   parse: parseFloat, fmt: v => `${v.toFixed(1)} Hz` },
    { id: 'gamma',               key: 'gamma',               parse: parseFloat, fmt: v => v.toFixed(2) }
  ];

  sliderKeys.forEach(({ id, key, parse, fmt }) => {
    const slider = document.getElementById(id);
    const display = document.getElementById(id + 'Val');
    const def = defs[key];

    slider.min = def.min;
    slider.max = def.max;
    slider.step = def.step;
    slider.value = state[key];
    display.textContent = fmt(state[key]);

    slider.addEventListener('input', () => {
      state[key] = parse(slider.value);
      display.textContent = fmt(state[key]);
      updateInfo();
      updateAnimationState();
      updateURL();
    });
  });

  // Dropdown selectors
  const setupSelect = (id, key) => {
    const select = document.getElementById(id);
    select.value = state[key];
    select.addEventListener('change', () => {
      state[key] = select.value;
      updateInfo();
      updateAnimationState();
      updateURL();
    });
    return select;
  };

  const contrastSelect = setupSelect('contrastScale', 'contrastScale');
  const spatialSelect = setupSelect('spatialFreqScale', 'spatialFreqScale');
  const temporalSelect = setupSelect('temporalFreqScale', 'temporalFreqScale');

  // Copy Shareable Link button
  const copyBtn = document.getElementById('copyUrlBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      updateURL();
      const currentUrl = window.location.href;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(currentUrl).then(() => {
          showCopySuccess();
        }).catch(() => {
          prompt('Copy this link:', currentUrl);
        });
      } else {
        prompt('Copy this link:', currentUrl);
      }
    });

    function showCopySuccess() {
      const origText = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      copyBtn.classList.add('copied');
      setTimeout(() => {
        copyBtn.textContent = origText;
        copyBtn.classList.remove('copied');
      }, 1800);
    }
  }

  // Reset button
  document.getElementById('resetBtn').addEventListener('click', () => {
    sliderKeys.forEach(({ id, key, fmt }) => {
      state[key] = CONFIG[key];
      const slider = document.getElementById(id);
      slider.value = state[key];
      document.getElementById(id + 'Val').textContent = fmt(state[key]);
    });

    state.contrastScale = CONFIG.contrastScale;
    contrastSelect.value = state.contrastScale;

    state.spatialFreqScale = CONFIG.spatialFreqScale;
    spatialSelect.value = state.spatialFreqScale;

    state.temporalFreqScale = CONFIG.temporalFreqScale;
    temporalSelect.value = state.temporalFreqScale;

    // Clear URL query parameters on reset
    try {
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', window.location.pathname);
      }
    } catch (e) {
      // Ignore on local file://
    }

    updateInfo();
    updateAnimationState();
  });
}

// ── App Initialization ────────────────────────────────────────────────────────
function init() {
  parseURLParams();
  resizeCanvas();
  setupSliders();
  updateInfo();
  updateAnimationState();

  window.addEventListener('resize', () => {
    resizeCanvas();
    updateInfo();
    if (state.minTemporalFreq === 0 && state.deltaTemporalFreq === 0) {
      renderGrating(0);
    }
  });
}

// Ensure init() executes whether loaded before or after DOMContentLoaded
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
