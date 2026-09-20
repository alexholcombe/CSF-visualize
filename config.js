// ── Configuration File ────────────────────────────────────────────────────────
// Substantive parameters, slider defaults, ranges, and photometric constants.
// Follows workspace rule: Put substantive parameters in a plain config file.

const CONFIG = {
  // Photometric calibration
  lMin: 1.0,           // Minimum screen luminance (cd/m²)
  lMax: 300.0,         // Maximum screen luminance (cd/m²)
  vMid: 186,           // Mid-grey RGB anchor (0–255)
  gamma: 2.20,         // Default monitor gamma exponent (RGB->luminance exponent)

  // Display geometry & strip layout
  stripHeight: 20,     // Strip thickness in CSS pixels (1 to 40)
  maxContrast: 1.00,   // Maximum Weber contrast of bottom strip (0.0 to 1.0)
  contrastScale: 'linear', // 'linear' or 'logarithmic'
  minLogContrast: 0.005,   // Floor contrast for log scaling before 0.00 anchor

  // Margins for blank grey indicator strips
  rightMarginWidth: 70,    // Width of right vertical blank grey strip (CSS px)
  bottomMarginHeight: 42,  // Height of bottom horizontal blank grey strip (CSS px)

  // Physical viewing geometry
  viewingDistanceCm: 57.0, // Viewing distance in cm (20 to 80)
  gratingWidthCm: 30.0,    // Width of grating display area in cm (5 to 60)

  // Spatial frequency limits in cycles per degree (cpd)
  minSpatialFreqCpd: 0.06,   // Leftmost spatial frequency in cpd (min 0.03, default 0.06)
  deltaSpatialFreqCpd: 2.0,  // Max - Min range in cpd (default 2.0 cpd). 0 = uniform
  spatialFreqScale: 'linear', // 'linear' or 'logarithmic'

  // Temporal counterphase frequency limits in Hz (cycles/second)
  minTemporalFreq: 0.0,      // Leftmost temporal frequency in Hz (0 to 50)
  deltaTemporalFreq: 0.0,    // Max - Min range in Hz (0 to 50 Hz). 0 = uniform
  temporalFreqScale: 'linear', // 'linear' or 'logarithmic'
  minLogTemporalFreq: 0.1,   // Floor for temporal log scaling when min is 0

  // Slider range bounds and steps
  sliderDefs: {
    stripHeight:         { min: 1,    max: 40,  step: 1,    unit: 'px' },
    maxContrast:         { min: 0.0,  max: 1.0, step: 0.01, unit: '' },
    minSpatialFreqCpd:   { min: 0.03, max: 15,  step: 0.01, unit: 'cpd' },
    deltaSpatialFreqCpd: { min: 0.0,  max: 25,  step: 0.1,  unit: 'cpd' },
    viewingDistanceCm:   { min: 20,   max: 80,  step: 1,    unit: 'cm' },
    gratingWidthCm:      { min: 5,    max: 60,  step: 1,    unit: 'cm' },
    minTemporalFreq:     { min: 0.0,  max: 50,  step: 0.5,  unit: 'Hz' },
    deltaTemporalFreq:   { min: 0.0,  max: 50,  step: 0.5,  unit: 'Hz' },
    gamma:               { min: 1.0,  max: 2.6, step: 0.05, unit: '' }
  },

  // Aliases for URL query string parsing (?param=value)
  paramAliases: {
    stripHeight:         ['stripheight', 'strip_height', 'sh', 'strip'],
    maxContrast:         ['maxcontrast', 'max_contrast', 'contrast', 'c'],
    contrastScale:       ['contrastscale', 'contrast_scale', 'c_scale'],
    minSpatialFreqCpd:   ['minspatialfreqcpd', 'min_sf', 'minsf', 'sf_min'],
    deltaSpatialFreqCpd: ['deltaspatialfreqcpd', 'delta_sf', 'sf_range', 'sf_delta'],
    spatialFreqScale:    ['spatialfreqscale', 'sf_scale', 'spatial_scale'],
    viewingDistanceCm:   ['viewingdistancecm', 'viewing_distance', 'dist', 'distance'],
    gratingWidthCm:      ['gratingwidthcm', 'grating_width', 'width', 'w'],
    minTemporalFreq:     ['mintemporalfreq', 'min_tf', 'mintf', 'tf_min'],
    deltaTemporalFreq:   ['deltatemporalfreq', 'delta_tf', 'tf_range', 'tf_delta'],
    temporalFreqScale:   ['temporalfreqscale', 'tf_scale', 'temporal_scale'],
    gamma:               ['gamma', 'exponent', 'g']
  }
};
