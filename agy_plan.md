# Implementation Plan: Exponent Label, Log Contrast, Tick Lines, and Delta (Max - Min) Sliders

**File**: `agy_plan.md`  
**Workspace**: `/Users/alex/Documents/Teaching/3013_PerceptualSystems/gratingsVibeCoded`  
**Rule Compliance**: Saved in workspace with `agy` and `plan` in filename; substantive parameters in `config.js`.

---

## 1. Goal Description

Implement five key improvements to the grating psychophysics interface:
1. **Gamma Label Update**: Rename the gamma slider label to `RGB->luminance exponent (gamma)`.
2. **Contrast Spacing Dropdown**: Add a dropdown menu for contrast gradient spacing with options `Linear` (default) and `Logarithmic`.
3. **Always Include 0.00 Contrast Label**: Ensure that a `0.00` contrast label is always displayed at the exact vertical position where contrast reaches zero, regardless of collision skipping. In logarithmic mode, the top strip transitions to exact zero (with intermediate strips log-spaced) so `0.00` is explicitly anchored at the top.
4. **Tick Marks Extending Toward Gratings**: For every rendered contrast label in the right-side blank grey strip, draw a distinct black tick line (e.g. 8–12 physical pixels long) at that vertical position, extending from the text leftward toward the grating.
5. **Delta (Max − Min) Sliders**:
   - Replace the *Max Spatial Frequency* slider with a **Spatial Freq Range (Max − Min)** slider (range $0\text{ to }25\text{ cpd}$). When set to $0$, maximum spatial frequency equals minimum spatial frequency (uniform across $x$).
   - Replace the *Max Temporal Frequency* slider with a **Temporal Freq Range (Max − Min)** slider (range $0\text{ to }50\text{ Hz}$). When set to $0$, maximum temporal frequency equals minimum temporal frequency (uniform across $x$).

---

## 2. Technical & Mathematical Design

### 2.1 Slider Parameterization: Min & Delta (Max − Min)
Instead of independent $(f_{\min}, f_{\max})$ controls where user error could set $f_{\max} < f_{\min}$:
- **Spatial Frequency**:
  - Slider 1: `minSpatialFreqCpd` ($f_{s,\min} \in [0.1, 15.0]\text{ cpd}$)
  - Slider 2: `deltaSpatialFreqCpd` ($\Delta f_s \in [0.0, 25.0]\text{ cpd}$)
  - Derived: $f_{s,\max} = f_{s,\min} + \Delta f_s$.
  - When $\Delta f_s = 0$: $f_{s,\max} = f_{s,\min}$ (grating has identical spatial frequency across all $x$).
  - Bottom strip SF labels automatically disappear when $\Delta f_s < 0.01$.
- **Temporal Frequency**:
  - Slider 1: `minTemporalFreq` ($f_{t,\min} \in [0.0, 50.0]\text{ Hz}$)
  - Slider 2: `deltaTemporalFreq` ($\Delta f_t \in [0.0, 50.0]\text{ Hz}$)
  - Derived: $f_{t,\max} = f_{t,\min} + \Delta f_t$.
  - When $\Delta f_t = 0$: $f_{t,\max} = f_{t,\min}$ (uniform temporal flicker rate across all $x$).
  - When $f_{t,\min} = 0$ and $\Delta f_t = 0$: entirely static.
  - Bottom strip TF labels automatically disappear when $\Delta f_t < 0.01$.

---

### 2.2 Contrast Spacing Formulation & Guaranteed 0.00 Label

Let $N = \lceil H_{\text{grating}} / S \rceil$ strips, where strip $k = 0$ is at the bottom and $k = N - 1$ is at the top.
Normalized height fraction: $\alpha_k = \frac{k}{N - 1} \in [0, 1]$.

#### Linear Spacing (`linear`):
$$\text{Contrast}_k = \max\left(0,\; \text{maxContrast} \cdot (1 - \alpha_k)\right)$$
- At bottom ($k = 0$): $\text{Contrast} = \text{maxContrast}$.
- At top ($k = N - 1$): $\text{Contrast} = 0.00$.

#### Logarithmic Spacing (`logarithmic`):
To accommodate psychophysical log scaling while honoring the rule:
*"Always include a 0.00 contrast label where the contrast becomes exactly zero"*
- Bottom strip ($k = 0$): $\text{Contrast}_0 = \text{maxContrast}$.
- Top strip ($k = N - 1$): $\text{Contrast}_{N-1} = 0.00$ (exact zero, matching human infinite threshold / zero visibility).
- Intermediate strips ($1 \le k \le N - 2$): Logarithmically spaced from $\text{maxContrast}$ down to $C_{\min}$ (e.g. $0.005$):
  $$\text{Contrast}_k = \text{maxContrast} \cdot \left(\frac{C_{\min}}{\text{maxContrast}}\right)^{\frac{k}{N - 2}}$$
  This produces smooth logarithmic decay across all visible strips and terminates cleanly in an exact $0.00$ top strip.

#### Guaranteed 0.00 Label:
In `drawRightContrastLabels()`:
- Strip $k = N - 1$ (where contrast is $0.00$) is always unconditionally flagged for display.
- Other labels are drawn downward from top or upward from bottom, suppressing any that fall within $2 \times \text{lineHeight}$ of an already accepted label.
- The `0.00` label is guaranteed to be rendered with its black tick line.

---

### 2.3 Black Tick Lines Extending from Text Toward Gratings

On the right blank grey strip (background RGB 186):
- Grating area boundary is at $X_{\text{boundary}} = \text{gratingPhysW}$.
- Label text is rendered in white (`#ffffff`) at $X_{\text{text}} \approx X_{\text{boundary}} + 28\cdot\text{dpr}$.
- For every rendered label at vertical center $Y$:
  - A black horizontal line (`#000000`, width $1.5\cdot\text{dpr}$ physical px) is drawn extending toward the grating:
    - Starts near the left of the text: $X_{\text{start}} = X_{\text{text}} - 14\cdot\text{dpr}$.
    - Extends leftward to: $X_{\text{end}} = X_{\text{boundary}} + 2\cdot\text{dpr}$.
  - Length of line: ~12 physical pixels (proportional to display DPI).
  - Clean visual pointer directly connecting each contrast value to its corresponding strip.

---

### 2.4 Gamma Slider Label
Update label text in HTML:
- From: `Gamma (γ)`
- To: `RGB->luminance exponent (gamma)`

---

## 3. Configuration Updates (`config.js`)

```javascript
const CONFIG = {
  // Photometry
  lMin: 1.0,
  lMax: 300.0,
  vMid: 186,
  gamma: 2.20,

  // Geometry
  stripHeight: 20,
  maxContrast: 1.00,
  contrastScale: 'linear',  // 'linear' or 'logarithmic'
  minLogContrast: 0.005,    // Floor contrast for log scale

  rightMarginWidth: 70,
  bottomMarginHeight: 42,

  // Viewing geometry
  viewingDistanceCm: 57.0,
  gratingWidthCm: 30.0,

  // Spatial frequency (cpd)
  minSpatialFreqCpd: 0.5,
  deltaSpatialFreqCpd: 14.5, // max - min (max = min + delta = 15.0 cpd)

  // Temporal frequency (Hz)
  minTemporalFreq: 0.0,
  deltaTemporalFreq: 0.0,   // max - min (max = min + delta = 0.0 Hz)

  // Slider bounds & definitions
  sliderDefs: {
    stripHeight:         { min: 1,   max: 40,  step: 1,    unit: 'px' },
    maxContrast:         { min: 0.0, max: 1.0, step: 0.01, unit: '' },
    minSpatialFreqCpd:   { min: 0.1, max: 15,  step: 0.1,  unit: 'cpd' },
    deltaSpatialFreqCpd: { min: 0.0, max: 25,  step: 0.5,  unit: 'cpd' },
    viewingDistanceCm:   { min: 20,  max: 80,  step: 1,    unit: 'cm' },
    gratingWidthCm:      { min: 5,   max: 60,  step: 1,    unit: 'cm' },
    minTemporalFreq:     { min: 0.0, max: 50,  step: 0.5,  unit: 'Hz' },
    deltaTemporalFreq:   { min: 0.0, max: 50,  step: 0.5,  unit: 'Hz' },
    gamma:               { min: 1.0, max: 2.6, step: 0.05, unit: '' }
  }
};
```

---

## 4. Proposed File Changes

### [MODIFY] `config.js`
- Add `contrastScale`, `minLogContrast`.
- Replace `maxSpatialFreqCpd` with `deltaSpatialFreqCpd`.
- Replace `maxTemporalFreq` with `deltaTemporalFreq`.

### [MODIFY] `index.html`
- Add `<select id="contrastScale">` dropdown beneath `maxContrast`.
- Change `maxSpatialFreqCpd` slider to `deltaSpatialFreqCpd` with label `Spatial Freq Range (Max − Min)`.
- Change `maxTemporalFreq` slider to `deltaTemporalFreq` with label `Temporal Freq Range (Max − Min)`.
- Update gamma slider label to `RGB->luminance exponent (gamma)`.

### [MODIFY] `style.css`
- Add dark-theme styles for `<select id="contrastScale">`.

### [MODIFY] `script.js`
- Compute $f_{s,\max} = f_{s,\min} + \Delta f_s$ and $f_{t,\max} = f_{t,\min} + \Delta f_t$.
- Compute strip contrasts according to `linear` or `logarithmic` mode.
- Render white contrast labels on right blank grey strip with:
  - Guaranteed `0.00` label at the top.
  - Black tick lines extending from the text toward the grating area.
- Bottom strip frequency labels show spatial frequency only if $\Delta f_s > 0.05$, and temporal frequency only if $\Delta f_t > 0.05$.

---

## 5. Verification Plan

1. **Gamma Slider Label**:
   - Verify label displays `RGB->luminance exponent (gamma)`.
2. **Contrast Scale Dropdown**:
   - Verify dropdown defaults to `Linear`.
   - Switch to `Logarithmic`: verify intermediate strips drop off multiplicatively while top strip remains exactly `0.00`.
3. **0.00 Label & Black Tick Lines**:
   - Verify `0.00` is always present at the top.
   - Verify every contrast label has a crisp black line extending from its left toward the grating.
4. **Max − Min Delta Sliders**:
   - Set `Spatial Freq Range (Max − Min)` to `0.0 cpd`:
     - Verify spatial frequency is uniform across entire width.
     - Verify bottom axis SF labels disappear.
   - Increase delta slider: verify chirp gradient appears and bottom SF labels display min through max.
   - Set `Temporal Freq Range (Max − Min)` to `0.0 Hz`:
     - If min is 0: verify animation stops.
     - If min is >0: verify uniform counterphase across entire width and bottom TF labels disappear.
     - If delta > 0: verify temporal gradient and bottom TF labels appear.
