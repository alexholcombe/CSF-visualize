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
  temporalStripWidth:  CONFIG.temporalStripWidth || 20,
  temporalOccluderWidth: CONFIG.temporalOccluderWidth || 0,
  gamma:               CONFIG.gamma,
  measuredRefreshRate: CONFIG.defaultFallbackFps || 60.0,
  nyquistLimit:        (CONFIG.defaultFallbackFps || 60.0) / 2,
  refreshRateCalibrated: false
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
    { key: 'temporalOccluderWidth', parse: parseInt },
    { key: 'gamma',               parse: parseFloat }
  ];

  sliderKeys.forEach(({ key, parse }) => {
    const rawVal = getParamVal(key);
    if (rawVal !== null) {
      const num = parse(rawVal);
      if (!isNaN(num)) {
        const def = defs[key];
        state[key] = Math.max(def.min, Math.min(def.max, num));
      }
    }
  });

  // Derived max_sf / max_tf aliases
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

  // 3. Temporal strip width
  const rawTSW = getParamVal('temporalStripWidth');
  if (rawTSW !== null) {
    const num = parseInt(rawTSW, 10);
    const def = defs.temporalStripWidth;
    if (!isNaN(num) && def) {
      state.temporalStripWidth = Math.max(def.min, Math.min(def.max, num));
    }
  }
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
      'temporalStripWidth', 'temporalOccluderWidth', 'gamma'
    ];

    keys.forEach(k => {
      params.set(k, state[k]);
    });

    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, '', newUrl);
  } catch (e) {
    // Gracefully ignore DOMException/SecurityError on local file:// URLs
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
 * Minimum non-zero Weber contrast imposed by integer RGB quantization.
 * Modulating by ±1 integer level (peak=187, trough=185) around mid-grey (186):
 * deltaL = (L(187) - L(185)) / 2
 * cMin = deltaL / L(186)
 */
function getMinRGBContrast(gamma) {
  const lMid = getMidLuminance(gamma);
  const lPlus = CONFIG.lMin + (CONFIG.lMax - CONFIG.lMin) * Math.pow((CONFIG.vMid + 1) / 255, gamma);
  const lMinus = CONFIG.lMin + (CONFIG.lMax - CONFIG.lMin) * Math.pow((CONFIG.vMid - 1) / 255, gamma);
  return Math.max(0.0001, (lPlus - lMinus) / (2 * lMid));
}

/**
 * Invert monitor gamma: Convert physical luminance (cd/m²) to 8-bit RGB value
 */
function luminanceToRGB(lum, gamma) {
  const norm = Math.max(0, Math.min(1, (lum - CONFIG.lMin) / (CONFIG.lMax - CONFIG.lMin)));
  return Math.round(255 * Math.pow(norm, 1 / gamma));
}

// ── Temporal Sampling, Refresh Rate Measurement & Nyquist Limits ─────────────
/**
 * Calculates effective temporal frequency accounting for the display's Nyquist limit (R / 2).
 * Folds frequencies above Nyquist back to their apparent/aliased frequencies.
 */
function getTemporalFreqInfo(specifiedTF) {
  const nyquist = state.nyquistLimit;
  const r = state.measuredRefreshRate;
  if (specifiedTF <= nyquist + 0.001) {
    return {
      specified: specifiedTF,
      actual: specifiedTF,
      isAliased: false,
      nyquist: nyquist
    };
  }
  const nearestHarmonic = r * Math.round(specifiedTF / r);
  const actual = Math.abs(specifiedTF - nearestHarmonic);
  return {
    specified: specifiedTF,
    actual: actual,
    isAliased: true,
    nyquist: nyquist
  };
}

/**
 * Returns sorted list of valid R/N frame harmonics based on measured refresh rate
 */
function getAvailableFrameHarmonics() {
  const r = state.measuredRefreshRate;
  const nyquist = state.nyquistLimit;
  const divisors = CONFIG.supportedFrameDivisors || [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 15, 16, 20, 24, 30, 40, 60, 120];
  const harmonics = [{ hz: 0.0, frames: Infinity, label: '0.0 Hz (static)' }];

  divisors.forEach(n => {
    const hz = r / n;
    if (hz <= nyquist + 0.001) {
      harmonics.push({
        hz: Math.round(hz * 100) / 100,
        frames: n,
        label: `${(Math.round(hz * 10) / 10).toFixed(1)} Hz (${n}f/cyc)`
      });
    }
  });

  harmonics.sort((a, b) => a.hz - b.hz);
  return harmonics;
}

/**
 * Snaps a frequency to the nearest available R/N frame harmonic
 */
function snapToFrameHarmonic(targetHz) {
  const harmonics = getAvailableFrameHarmonics();
  let closest = harmonics[0];
  let minDiff = Math.abs(targetHz - closest.hz);

  for (let i = 1; i < harmonics.length; i++) {
    const diff = Math.abs(targetHz - harmonics[i].hz);
    if (diff < minDiff) {
      minDiff = diff;
      closest = harmonics[i];
    }
  }
  return closest;
}

/**
 * Formats slider readout text for temporal frequencies, including frame count in integerFrames mode
 */
function formatTemporalValText(key, val) {
  if (key === 'minTemporalFreq') {
    if (state.temporalStepMode === 'integerFrames') {
      const h = snapToFrameHarmonic(val);
      return `${h.hz.toFixed(1)} Hz (${h.frames === Infinity ? 'static' : h.frames + 'f/cyc'})`;
    }
    return `${val.toFixed(1)} Hz`;
  } else if (key === 'deltaTemporalFreq') {
    if (state.temporalStepMode === 'integerFrames') {
      const maxHz = state.minTemporalFreq + val;
      const h = snapToFrameHarmonic(maxHz);
      return `${val.toFixed(1)} Hz (Max: ${h.hz.toFixed(1)} Hz${h.frames !== Infinity ? ', ' + h.frames + 'f' : ''})`;
    }
    return `${val.toFixed(1)} Hz`;
  }
  return `${val.toFixed(1)} Hz`;
}

/**
 * Clamps temporal frequency slider limits and current values to the detected Nyquist limit (R / 2)
 */
function applyNyquistClamping() {
  if (!CONFIG.clampTemporalToNyquist) return;

  const nyquist = state.nyquistLimit;
  CONFIG.sliderDefs.minTemporalFreq.max = nyquist;

  const minSlider = document.getElementById('minTemporalFreq');
  const deltaSlider = document.getElementById('deltaTemporalFreq');
  if (minSlider) minSlider.max = nyquist;

  if (state.temporalStepMode === 'integerFrames') {
    const hMin = snapToFrameHarmonic(state.minTemporalFreq);
    state.minTemporalFreq = Math.min(nyquist, hMin.hz);
  } else if (state.minTemporalFreq > nyquist) {
    state.minTemporalFreq = nyquist;
  }
  if (minSlider) minSlider.value = state.minTemporalFreq;
  const minValEl = document.getElementById('minTemporalFreqVal');
  if (minValEl) minValEl.textContent = formatTemporalValText('minTemporalFreq', state.minTemporalFreq);

  // The maximum allowed delta is what remains up to Nyquist: nyquist - minTemporalFreq
  const maxAllowedDelta = Math.max(0, nyquist - state.minTemporalFreq);
  CONFIG.sliderDefs.deltaTemporalFreq.max = nyquist;
  if (deltaSlider) deltaSlider.max = maxAllowedDelta;

  if (state.temporalStepMode === 'integerFrames') {
    const targetMax = state.minTemporalFreq + state.deltaTemporalFreq;
    const hMax = snapToFrameHarmonic(Math.min(nyquist, targetMax));
    state.deltaTemporalFreq = Math.max(0, Math.round((hMax.hz - state.minTemporalFreq) * 100) / 100);
  } else if (state.deltaTemporalFreq > maxAllowedDelta) {
    state.deltaTemporalFreq = maxAllowedDelta;
  }
  if (deltaSlider) deltaSlider.value = state.deltaTemporalFreq;
  const deltaValEl = document.getElementById('deltaTemporalFreqVal');
  if (deltaValEl) deltaValEl.textContent = formatTemporalValText('deltaTemporalFreq', state.deltaTemporalFreq);
}

/**
 * Probes the display's actual refresh rate (Hz / FPS) via consecutive RAF timestamps.
 * Runs on startup for CONFIG.fpsProbeFrames.
 */
function probeRefreshRate(onComplete) {
  let frameCount = 0;
  let lastTimestamp = null;
  const deltas = [];

  function probeStep(timestamp) {
    if (lastTimestamp !== null) {
      const delta = timestamp - lastTimestamp;
      if (delta >= (CONFIG.fpsMinValidDeltaMs || 4.0) && delta <= (CONFIG.fpsMaxValidDeltaMs || 45.0)) {
        deltas.push(delta);
      }
    }
    lastTimestamp = timestamp;
    frameCount++;

    if (frameCount < (CONFIG.fpsProbeFrames || 40)) {
      requestAnimationFrame(probeStep);
    } else {
      if (deltas.length >= 10) {
        deltas.sort((a, b) => a - b);
        const mid = Math.floor(deltas.length / 2);
        const medianDelta = deltas.length % 2 !== 0 ? deltas[mid] : (deltas[mid - 1] + deltas[mid]) / 2;
        let measuredFps = 1000.0 / medianDelta;

        if (CONFIG.snapStandardFps && Array.isArray(CONFIG.standardFpsList)) {
          for (const stdFps of CONFIG.standardFpsList) {
            if (Math.abs(measuredFps - stdFps) / stdFps <= 0.04) {
              measuredFps = stdFps;
              break;
            }
          }
        }
        state.measuredRefreshRate = Math.round(measuredFps * 10) / 10;
      } else {
        state.measuredRefreshRate = CONFIG.defaultFallbackFps || 60.0;
      }
      state.nyquistLimit = state.measuredRefreshRate / 2;
      state.refreshRateCalibrated = true;

      if (typeof onComplete === 'function') {
        onComplete();
      }
    }
  }

  requestAnimationFrame(probeStep);
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

  // isTemporalActive is needed before sinChirp (for isZeroSFMode)
  const isTemporalActive = state.minTemporalFreq > 0 || state.deltaTemporalFreq > 0;

  // Zero-SF special mode: when both SF sliders are at 0 and TF is active,
  // treat the display as a uniform counterphase field (no spatial grating).
  // The field oscillates between minimum luminance (dark, at t=0) and maximum
  // luminance (bright, at t=T/2), demonstrating temporal frequency directly.
  const isZeroSFMode = state.minSpatialFreqCpd < 0.001
                    && state.deltaSpatialFreqCpd < 0.001
                    && isTemporalActive;

  // Integrated spatial phase: Linear vs Logarithmic chirp
  const isSpatialChirp = state.deltaSpatialFreqCpd > 0.0001;
  if (isZeroSFMode) {
    sinChirp.fill(1.0);  // uniform field — temporal factor drives all contrast
  } else if (!isSpatialChirp) {
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
  // Frequencies are partitioned into vertical strips of temporalStripWidth CSS pixels,
  // each snapped to the nearest integer-frames-per-cycle harmonic (R/N).
  if (!isTemporalActive) {
    temporalFactor.fill(1.0);
  } else {
    const bandPhysW = Math.max(1, Math.round(state.temporalStripWidth * dpr));

    // For each band, compute the nominal frequency from the strip's centre x position,
    // snap it to the nearest R/N harmonic, then fill the band's columns with a single cosine.
    for (let xStart = 0; xStart < gratingPhysW; xStart += bandPhysW) {
      const xEnd = Math.min(xStart + bandPhysW, gratingPhysW);
      // Fractional position of band centre in [0, 1]
      const frac = (xStart + (xEnd - xStart) * 0.5) / gratingPhysW;

      let nominalTF;
      if (state.deltaTemporalFreq <= 0.0001) {
        nominalTF = state.minTemporalFreq;
      } else if (state.temporalFreqScale === 'logarithmic') {
        const f0 = state.minTemporalFreq;
        const f1 = maxTemporalFreq;
        if (f0 > 0.01) {
          nominalTF = f0 * Math.pow(f1 / f0, frac);
        } else {
          const floorTF = Math.min(CONFIG.minLogTemporalFreq, f1);
          nominalTF = frac === 0 ? 0 : floorTF * Math.pow(f1 / floorTF, frac);
        }
      } else {
        nominalTF = state.minTemporalFreq + frac * state.deltaTemporalFreq;
      }

      // Snap to nearest integer-frames-per-cycle harmonic (R/N)
      const snapped = snapToFrameHarmonic(nominalTF);
      const rawFactor = snapped.hz > 0 ? Math.cos(2 * Math.PI * snapped.hz * tSec) : 1.0;
      // In zero-SF mode: negate so field starts dark (−cos(0) = −1 → minimum luminance)
      const factor = isZeroSFMode ? -rawFactor : rawFactor;

      for (let x = xStart; x < xEnd; x++) {
        temporalFactor[x] = factor;
      }
    }
  }


  // 3. Strip Distribution: Bottom strip = maxContrast, Top strip = min RGB contrast
  const stripH_phys = state.stripHeight * dpr;
  const numStrips = Math.ceil(gratingCssH / state.stripHeight);
  const cMin = getMinRGBContrast(gamma);
  const cMax = state.maxContrast;

  let currentBottomY_phys = gratingPhysH;
  const stripRowBuffer = new Uint32Array(gratingPhysW);
  const stripLabels = [];

  for (let k = 0; k < numStrips; k++) {
    const stripTopY_phys = Math.max(0, Math.round(gratingPhysH - (k + 1) * stripH_phys));
    const stripBottomY_phys = currentBottomY_phys;
    const actualStripHeight = stripBottomY_phys - stripTopY_phys;

    if (actualStripHeight <= 0) break;

    // Calculate strip contrast:
    // k=0 (bottom) is cMax.
    // k=numStrips-1 (top) is cMin (minimum non-zero contrast imposed by integer RGB).
    let stripContrast;
    if (numStrips === 1 || cMax <= cMin) {
      stripContrast = cMax;
    } else if (k === 0) {
      stripContrast = cMax;
    } else if (k === numStrips - 1) {
      stripContrast = cMin;
    } else {
      const alpha = k / (numStrips - 1);
      if (state.contrastScale === 'logarithmic') {
        stripContrast = cMax * Math.pow(cMin / cMax, alpha);
      } else {
        stripContrast = cMax - alpha * (cMax - cMin);
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
  drawTemporalBoundaryOccluders();
  drawRightContrastLabels(stripLabels, physW);
  drawBottomFrequencyLabels(physH);
}

// ── Temporal Strip Boundary Occluders ────────────────────────────────────────
function drawTemporalBoundaryOccluders() {
  if (state.temporalOccluderWidth <= 0 || gratingPhysW <= 0 || gratingPhysH <= 0) return;

  const bandPhysW = Math.max(1, Math.round(state.temporalStripWidth * dpr));
  const occluderPhysW = state.temporalOccluderWidth * dpr;

  // Match the light blue used for slider/readout accents in style.css (#38bdf8).
  ctx.save();
  ctx.fillStyle = '#38bdf8';

  // Internal boundaries only: no occluder on the left or right outer edge.
  for (let boundaryX = bandPhysW; boundaryX < gratingPhysW; boundaryX += bandPhysW) {
    ctx.fillRect(boundaryX - occluderPhysW / 2, 0, occluderPhysW, gratingPhysH);
  }

  ctx.restore();
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
  const topLabel = stripLabels[stripLabels.length - 1];
  const labelsToDraw = [{ contrast: topLabel.contrast, yCenter: topLabel.yCenter }];

  let lastY = -Infinity;
  for (let i = 0; i < stripLabels.length - 1; i++) {
    const item = stripLabels[i];
    if (Math.abs(item.yCenter - lastY) >= minSeparation &&
        Math.abs(item.yCenter - topLabel.yCenter) >= minSeparation) {
      labelsToDraw.push(item);
      lastY = item.yCenter;
    }
  }

  labelsToDraw.forEach(item => {
    const y = Math.round(item.yCenter);
    ctx.beginPath();
    ctx.moveTo(tickStartX, y);
    ctx.lineTo(tickEndX, y);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = Math.max(1, Math.round(1.5 * dpr));
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';

    let txt;
    if (item.contrast >= 0.10) {
      txt = item.contrast.toFixed(2);
    } else {
      let decimals = 3;
      do {
        txt = item.contrast.toFixed(decimals);
        decimals++;
      } while (parseFloat(txt) === 0 && decimals <= 8);
    }
    ctx.fillText(txt, textX, y);
  });

  // Vertical axis title, farther from the grating than the numeric labels.
  const rightMarginPhysW = physW - gratingPhysW;
  const axisX = gratingPhysW + rightMarginPhysW - Math.round(8 * dpr);
  const axisY = gratingPhysH / 2;
  ctx.save();
  ctx.translate(axisX, axisY);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('contrast', 0, 0);
  ctx.restore();
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

  // Keep numeric labels higher, reserving the bottom of the margin for the TF axis title.
  let sfY, tfY, tfTitleY;
  if (showSF && showTF) {
    sfY = gratingPhysH + bottomMarginPhysH * 0.22;
    tfY = gratingPhysH + bottomMarginPhysH * 0.55;
    tfTitleY = gratingPhysH + bottomMarginPhysH * 0.84;
  } else if (showSF) {
    sfY = gratingPhysH + bottomMarginPhysH * 0.50;
  } else {
    tfY = gratingPhysH + bottomMarginPhysH * 0.30;
    tfTitleY = gratingPhysH + bottomMarginPhysH * 0.72;
  }

  const fractions = [0.0, 0.25, 0.50, 0.75, 1.0];
  const maxSF = state.minSpatialFreqCpd + state.deltaSpatialFreqCpd;
  const maxTF = state.minTemporalFreq + state.deltaTemporalFreq;

  // Spatial-frequency labels retain their existing cpd units.
  if (showSF) {
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

      let sfVal;
      if (state.spatialFreqScale === 'logarithmic') {
        const ratio = maxSF / state.minSpatialFreqCpd;
        sfVal = state.minSpatialFreqCpd * Math.pow(ratio, frac);
      } else {
        sfVal = state.minSpatialFreqCpd + frac * state.deltaSpatialFreqCpd;
      }
      const sfText = idx === 0 ? `SF: ${sfVal.toFixed(2)} cpd` : `${sfVal.toFixed(2)} cpd`;
      ctx.fillText(sfText, posX, sfY);
    });
  }

  if (showTF) {
    const bandPhysW = Math.max(1, Math.round(state.temporalStripWidth * dpr));

    // Use one centered number per rendered temporal strip when the strip is wide
    // enough to contain its own label. Otherwise fall back to five axis samples.
    let allBandsFit = true;
    const bandLabels = [];
    for (let xStart = 0; xStart < gratingPhysW; xStart += bandPhysW) {
      const xEnd = Math.min(xStart + bandPhysW, gratingPhysW);
      const frac = (xStart + (xEnd - xStart) * 0.5) / gratingPhysW;
      let nominalTF;
      if (state.temporalFreqScale === 'logarithmic') {
        const f0 = state.minTemporalFreq;
        if (f0 > 0.01) {
          nominalTF = f0 * Math.pow(maxTF / f0, frac);
        } else {
          const floorTF = Math.min(CONFIG.minLogTemporalFreq, maxTF);
          nominalTF = frac === 0 ? 0 : floorTF * Math.pow(maxTF / floorTF, frac);
        }
      } else {
        nominalTF = state.minTemporalFreq + frac * state.deltaTemporalFreq;
      }
      const harmonic = snapToFrameHarmonic(nominalTF);
      const label = harmonic.hz.toFixed(1);
      const available = (xEnd - xStart) - Math.round(6 * dpr);
      if (ctx.measureText(label).width > available) allBandsFit = false;
      bandLabels.push({ x: (xStart + xEnd) / 2, label });
    }

    if (allBandsFit && bandLabels.length > 0) {
      ctx.textAlign = 'center';
      bandLabels.forEach(item => ctx.fillText(item.label, item.x, tfY));
    } else {
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

        let tfVal;
        if (state.temporalFreqScale === 'logarithmic') {
          const f0 = state.minTemporalFreq;
          if (f0 > 0.01) {
            tfVal = f0 * Math.pow(maxTF / f0, frac);
          } else {
            const floorTF = Math.min(CONFIG.minLogTemporalFreq, maxTF);
            tfVal = frac === 0 ? 0 : floorTF * Math.pow(maxTF / floorTF, frac);
          }
        } else {
          tfVal = state.minTemporalFreq + frac * state.deltaTemporalFreq;
        }
        const harmonic = snapToFrameHarmonic(tfVal);
        ctx.fillText(harmonic.hz.toFixed(1), posX, tfY);
      });
    }

    // Units appear once as the temporal-frequency axis title, never after each number.
    ctx.textAlign = 'center';
    ctx.fillText('cycles per second (Hz)', gratingPhysW / 2, tfTitleY);
  }
}

// ── Animation Loop ────────────────────────────────────────────────────────────
// ── Animation Loop ────────────────────────────────────────────────────────────
let lastInfoUpdateMs = 0;

function animationLoop(timestamp) {
  if (animStartTime === null) {
    animStartTime = timestamp;
  }
  const tSec = (timestamp - animStartTime) / 1000.0;
  renderGrating(tSec);

  // Throttle the sidebar temporal readout to every 500 ms during animation
  // (static parameters don't change frame-to-frame; only actual max TF readout is dynamic)
  if (timestamp - lastInfoUpdateMs >= 500) {
    updateInfo();
    lastInfoUpdateMs = timestamp;
  }

  animFrameId = requestAnimationFrame(animationLoop);
}

function updateAnimationState() {
  const isTemporalActive = state.minTemporalFreq > 0 || state.deltaTemporalFreq > 0;

  if (isTemporalActive) {
    if (!animFrameId) {
      animStartTime = null;
      lastInfoUpdateMs = 0;
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
  const cMin = getMinRGBContrast(state.gamma);
  const cMax = state.maxContrast;
  const topContrast = (cMax > cMin) ? cMin : cMax;

  document.getElementById('infoStripCount').textContent = numStrips;
  document.getElementById('infoTopContrast').textContent = topContrast.toFixed(3);

  const labelEl = document.getElementById('infoContrastLabel');
  const stepEl = document.getElementById('infoContrastStep');

  if (state.contrastScale === 'logarithmic') {
    labelEl.textContent = 'Contrast ratio (step):';
    if (numStrips > 1 && cMax > cMin) {
      const ratio = Math.pow(cMin / cMax, 1 / (numStrips - 1));
      stepEl.textContent = `${ratio.toFixed(3)}x`;
    } else {
      stepEl.textContent = '-';
    }
  } else {
    labelEl.textContent = 'Contrast step (auto):';
    const step = (numStrips > 1 && cMax > cMin) ? (cMax - cMin) / (numStrips - 1) : 0;
    stepEl.textContent = step.toFixed(4);
  }

  // Refresh rate, Nyquist limit, and actual highest temporal frequency
  const refreshEl = document.getElementById('infoRefreshRate');
  if (refreshEl) {
    if (state.refreshRateCalibrated) {
      const fpsStr = state.measuredRefreshRate % 1 === 0
        ? state.measuredRefreshRate.toFixed(0)
        : state.measuredRefreshRate.toFixed(1);
      refreshEl.textContent = `${fpsStr} Hz`;
    } else {
      refreshEl.textContent = 'Measuring...';
    }
  }

  const nyquistEl = document.getElementById('infoNyquistLimit');
  if (nyquistEl) {
    nyquistEl.textContent = `${state.nyquistLimit.toFixed(1)} Hz`;
  }

  const actualTfEl = document.getElementById('infoActualMaxTF');
  if (actualTfEl) {
    const specifiedMaxTF = state.minTemporalFreq + state.deltaTemporalFreq;
    const tfInfo = getTemporalFreqInfo(specifiedMaxTF);
    if (tfInfo.isAliased) {
      actualTfEl.textContent = `${tfInfo.actual.toFixed(1)} Hz (aliased from ${tfInfo.specified.toFixed(1)} Hz)`;
      actualTfEl.style.color = '#f59e0b';
    } else if (state.temporalStepMode === 'integerFrames') {
      const h = snapToFrameHarmonic(tfInfo.actual);
      const fStr = h.frames === Infinity ? 'static' : `${h.frames} frames/cyc`;
      actualTfEl.textContent = `${h.hz.toFixed(1)} Hz (${fStr})`;
      actualTfEl.style.color = '#e2e8f0';
    } else {
      actualTfEl.textContent = `${tfInfo.actual.toFixed(1)} Hz`;
      actualTfEl.style.color = '#e2e8f0';
    }
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
    { id: 'minTemporalFreq',     key: 'minTemporalFreq',     parse: parseFloat, fmt: v => formatTemporalValText('minTemporalFreq', v) },
    { id: 'deltaTemporalFreq',   key: 'deltaTemporalFreq',   parse: parseFloat, fmt: v => formatTemporalValText('deltaTemporalFreq', v) },
    { id: 'temporalStripWidth',  key: 'temporalStripWidth',  parse: parseInt,   fmt: v => `${v} px` },
    { id: 'temporalOccluderWidth', key: 'temporalOccluderWidth', parse: parseInt, fmt: v => `${v} px` },
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
      let val = parse(slider.value);

      if (key === 'minTemporalFreq' || key === 'deltaTemporalFreq') {
        if (key === 'minTemporalFreq') {
          const h = snapToFrameHarmonic(val);
          val = Math.min(state.nyquistLimit, h.hz);
          slider.value = val;
        } else if (key === 'deltaTemporalFreq') {
          const targetMax = state.minTemporalFreq + val;
          const h = snapToFrameHarmonic(
            Math.min(state.nyquistLimit, targetMax)
          );
          val = Math.max(
            0,
            Math.round((h.hz - state.minTemporalFreq) * 100) / 100
          );
          slider.value = val;
        }

        state[key] = val;

        if (CONFIG.clampTemporalToNyquist) {
          const maxAllowedDelta = Math.max(
            0,
            state.nyquistLimit - state.minTemporalFreq
          );

          const deltaSlider =
            document.getElementById('deltaTemporalFreq');

          if (deltaSlider) {
            deltaSlider.max = maxAllowedDelta;
          }

          if (state.deltaTemporalFreq > maxAllowedDelta) {
            state.deltaTemporalFreq = maxAllowedDelta;

            if (deltaSlider) {
              deltaSlider.value = state.deltaTemporalFreq;
            }
          }
        }

        display.textContent =
          formatTemporalValText(key, state[key]);

      } else {
        state[key] = val;
        display.textContent = fmt(state[key]);
      }

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

  const contrastSelect =
    setupSelect('contrastScale', 'contrastScale');

  const spatialSelect =
    setupSelect('spatialFreqScale', 'spatialFreqScale');

  const temporalSelect =
    setupSelect('temporalFreqScale', 'temporalFreqScale');

  // Copy Shareable Link button
  const copyBtn = document.getElementById('copyUrlBtn');

  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      updateURL();

      const currentUrl = window.location.href;

      if (navigator.clipboard &&
          navigator.clipboard.writeText) {

        navigator.clipboard.writeText(currentUrl)
          .then(() => {
            showCopySuccess();
          })
          .catch(() => {
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
  document.getElementById('resetBtn')
    .addEventListener('click', () => {

      sliderKeys.forEach(({ id, key, fmt }) => {
        state[key] = CONFIG[key];

        const slider = document.getElementById(id);
        slider.value = state[key];

        document.getElementById(id + 'Val').textContent =
          fmt(state[key]);
      });

      state.contrastScale = CONFIG.contrastScale;
      contrastSelect.value = state.contrastScale;

      state.spatialFreqScale = CONFIG.spatialFreqScale;
      spatialSelect.value = state.spatialFreqScale;

      state.temporalFreqScale = CONFIG.temporalFreqScale;
      temporalSelect.value = state.temporalFreqScale;

      try {
        if (window.history &&
            window.history.replaceState) {

          window.history.replaceState(
            null,
            '',
            window.location.pathname
          );
        }
      } catch (e) {
        // Ignore on local file://
      }

      applyNyquistClamping();
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

  // Run refresh rate calibration probe on startup
  probeRefreshRate(() => {
    applyNyquistClamping();
    updateInfo();
    if (state.minTemporalFreq > 0 || state.deltaTemporalFreq > 0) {
      renderGrating((performance.now() - (animStartTime || performance.now())) / 1000.0);
    } else {
      renderGrating(0);
    }
  });

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
