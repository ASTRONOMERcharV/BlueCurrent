export function renderLayout(): string {
  const range = (
    id: string,
    label: string,
    minimum: number,
    maximum: number,
    step: number,
    value: number,
    suffix = '',
  ): string => `
    <label class="range-control" for="${id}">
      <span class="range-label"><span>${label}</span><output id="${id}-value" for="${id}">${value}${suffix}</output></span>
      <input id="${id}" type="range" min="${minimum}" max="${maximum}" step="${step}" value="${value}" />
    </label>`;

  const toggle = (id: string, label: string, note: string, checked = false, extraClass = ''): string => `
    <label class="toggle-control ${extraClass}"><span><strong>${label}</strong><small id="${id}-note">${note}</small></span><input id="${id}" type="checkbox" ${checked ? 'checked' : ''} /><span class="toggle-track" aria-hidden="true"></span></label>`;

  return `
    <div class="observatory" data-view-mode="observation">
      <header class="masthead">
        <div class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 44 44"><path d="M4 23c9-12 22-12 36 0-14 12-27 12-36 0Z"/><path d="M10 23c8 4 17 3 26-2M22 12V5M22 39v-7"/></svg>
        </div>
        <div class="brand-copy">
          <h1>Blue Current</h1>
          <p>Real-time underwater ecosystem observatory</p>
        </div>
        <div class="header-scenario">
          <span>Ecosystem</span>
          <strong id="header-scenario">Predator Encounter</strong>
        </div>
        <div class="mode-switch" role="group" aria-label="Interface mode">
          <button type="button" data-mode="observation" aria-pressed="true"><span class="mode-icon" aria-hidden="true">◉</span>Observation</button>
          <button type="button" data-mode="laboratory" aria-pressed="false"><span class="mode-icon" aria-hidden="true">⌗</span>Laboratory</button>
        </div>
        <div class="header-actions">
          <div class="run-status" id="run-status"><span class="status-dot"></span><span id="status-label">Live</span></div>
          <button class="icon-button" id="fullscreen-button" type="button" aria-label="Enter fullscreen" title="Fullscreen">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 8V3h5M12 3h5v5M17 12v5h-5M8 17H3v-5"/></svg>
          </button>
          <button class="quiet-button" id="panel-toggle" type="button" aria-controls="control-panel" aria-expanded="true"><span class="console-glyph" aria-hidden="true">☷</span><span>Console</span></button>
        </div>
      </header>

      <main class="workspace">
        <section class="viewport-shell" aria-label="Live three-dimensional ecosystem">
          <div id="viewport" class="viewport"></div>
          <div class="viewport-vignette" aria-hidden="true"></div>
          <div class="viewport-topbar">
            <div class="zone-readout">
              <span class="instrument-label">Pelagic zone <i></i> Live ecosystem</span>
              <strong id="scene-name">Predator Encounter</strong>
              <span class="zone-detail">3D simulation <b>/</b> Predator–prey</span>
            </div>
            <div class="view-switch" role="group" aria-label="Camera view">
              <button type="button" data-view="overview" aria-pressed="true">Overview</button>
              <button type="button" data-view="school" aria-pressed="false">School</button>
              <button type="button" data-view="predator" aria-pressed="false">Predator</button>
              <button type="button" data-view="orbit" aria-pressed="false">Free</button>
            </div>
          </div>

          <div class="depth-rail" aria-hidden="true">
            <span>20<small>m</small></span><i></i><i></i><span>10</span><i></i><i></i><span>0<small>m</small></span>
            <b>Water column</b>
          </div>

          <div class="predator-watch" id="predator-watch">
            <span class="watch-reticle" aria-hidden="true"></span>
            <div>
              <span>Predator</span><strong id="predator-watch-state">Tracking</strong>
              <span id="predator-watch-event" class="watch-event">Listening</span>
              <span id="predator-watch-school" class="watch-school">Listening</span>
            </div>
          </div>

          <div class="scene-caption" aria-live="polite">
            <span class="instrument-label">Observation</span>
            <strong id="scene-caption-title">Coordinated movement</strong>
            <span id="scene-caption-copy">Separation, alignment and cohesion shape the school.</span>
          </div>

          <div class="debug-legend lab-only" aria-label="Debug vector legend">
            <span><i style="--legend:#d7eef0"></i>Velocity</span>
            <span><i style="--legend:#e49a68"></i>Separation / target</span>
            <span><i style="--legend:#70c8d0"></i>Alignment</span>
            <span><i style="--legend:#a9c79b"></i>Cohesion</span>
            <small>Vectors show measured direction; arrow lengths are normalized.</small>
          </div>

          <div class="collision-readout lab-only" id="collision-readout" role="status" aria-live="polite">
            Collision proxy: idle
          </div>

          <div class="capture-toast" id="capture-toast" role="status" aria-live="polite"></div>
          <div class="loading-screen" id="loading-screen">
            <span class="loading-ring" aria-hidden="true"></span>
            <span>Initializing the water column…</span>
          </div>

          <div class="telemetry-strip" aria-label="Live ecosystem measurements">
            <div class="telemetry-primary"><span>Fish population</span><strong id="metric-fish">—</strong><small>alive</small></div>
            <div><span>Groups ≥ 5</span><strong id="metric-schools-inline">—</strong></div>
            <div><span>Average neighbors</span><strong id="metric-neighbors-inline">—</strong></div>
            <div><span>Predator state</span><strong class="metric-word predator-value" id="metric-predator">—</strong></div>
            <div><span>Simulation time</span><strong class="metric-time" id="metric-time">—</strong></div>
          </div>
          <div class="scene-search-state"><span class="model-pulse"></span><span id="search-badge">Uniform grid</span><span>/</span><span>60 Hz fixed step</span></div>
        </section>

        <button class="panel-scrim" id="panel-scrim" type="button" aria-label="Close observation console"></button>
        <aside class="control-panel" id="control-panel" aria-label="Ecosystem observatory console">
          <div class="panel-heading">
            <div><span class="instrument-label">Ecosystem observatory</span><h2 id="console-title">Observation console</h2></div>
            <button type="button" class="panel-close" id="panel-close" aria-label="Close console"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"/></svg></button>
          </div>
          <div class="console-tabs" role="tablist" aria-label="Console sections">
            <button type="button" role="tab" id="tab-behavior" data-tab="behavior" aria-controls="panel-behavior" aria-selected="true">Behavior</button>
            <button type="button" role="tab" id="tab-ecology" data-tab="ecology" aria-controls="panel-ecology" aria-selected="false">Ecology</button>
            <button type="button" role="tab" id="tab-environment" data-tab="environment" aria-controls="panel-environment" aria-selected="false">Environment</button>
            <button type="button" role="tab" id="tab-performance" data-tab="performance" aria-controls="panel-performance" aria-selected="false">Performance</button>
          </div>

          <div class="panel-scroll">
            <section class="console-panel" id="panel-behavior" data-panel="behavior" role="tabpanel" aria-labelledby="tab-behavior">
              <div class="section-intro"><span class="section-index">Input</span><p>Local rules update the running school immediately.</p></div>
              <div class="control-section">
                <h3>Flocking weights</h3>
                ${range('separation-weight', 'Separation', 0, 3, 0.05, 2.4)}
                ${range('alignment-weight', 'Alignment', 0, 2, 0.05, 0.9)}
                ${range('cohesion-weight', 'Cohesion', 0, 2, 0.05, 0.32)}
              </div>
              <div class="control-section">
                <h3>Perception & motion</h3>
                ${range('cohesion-radius', 'Neighbor radius', 3, 10, 0.1, 6, ' m')}
                ${range('max-speed', 'Maximum speed', 3, 9, 0.1, 6, ' m/s')}
                ${range('evasion-weight', 'Predator evasion', 0, 4, 0.05, 2.1)}
                <details class="advanced-controls">
                  <summary>Advanced perception radii</summary>
                  ${range('separation-radius', 'Separation radius', 0.6, 3, 0.1, 1.4, ' m')}
                  ${range('alignment-radius', 'Alignment radius', 2, 8, 0.1, 4, ' m')}
                  ${range('field-of-view', 'Field of view', 120, 360, 10, 360, '°')}
                </details>
              </div>
              <div class="behavior-note"><span class="note-rule"></span><p>These are steering weights, not ecological measurements. Observe their effect in Ecology.</p></div>
            </section>

            <section class="console-panel" id="panel-ecology" data-panel="ecology" role="tabpanel" aria-labelledby="tab-ecology" hidden>
              <div class="section-intro"><span class="section-index">State</span><p>Live population and predator–prey response.</p></div>
              <div class="ecology-hero"><span>School fish alive</span><strong id="metric-ecology-fish">—</strong><small id="metric-ecology-initial">of — initial</small></div>
              <dl class="measurement-grid ecology-grid">
                <div><dt>Group count</dt><dd id="metric-schools">—</dd></div>
                <div><dt>Clownfish alive</dt><dd id="metric-clownfish">—</dd></div>
                <div><dt>Average neighbors</dt><dd id="metric-neighbors">—</dd></div>
                <div><dt>Threatened fish</dt><dd id="metric-threatened">—</dd></div>
                <div><dt>Sheltered in kelp</dt><dd id="metric-sheltered">—</dd></div>
                <div><dt>Escape intensity</dt><dd id="metric-escape-intensity">—</dd></div>
                <div><dt>Total captures</dt><dd id="metric-captures">—</dd></div>
                <div><dt>Predator state</dt><dd id="metric-ecology-predator">—</dd></div>
                <div><dt>Group dispersion</dt><dd id="metric-dispersion">—</dd></div>
                <div><dt>Direction agreement</dt><dd id="metric-polarization">—</dd></div>
              </dl>
              <div class="control-section">
                <h3>Population</h3>
                ${range('fish-count', 'Initial fish count', 100, 2000, 50, 500)}
                ${range('clownfish-count', 'Clownfish school', 0, 300, 20, 100)}
                <p class="control-note">Changing population resets the current scenario state.</p>
              </div>
              <div class="control-section">
                <h3>Predator control</h3>
                ${toggle('predator-enabled', 'Predator active', 'Patrol, pursuit, attack and search', true)}
                ${range('predator-aggression', 'Aggression', 0, 1.5, 0.05, 0.8)}
                <div class="scenario-controls">
                  <button type="button" id="chase-button" class="secondary-button">Release</button>
                  <button type="button" id="regroup-button" class="secondary-button">Retreat</button>
                </div>
              </div>
            </section>

            <section class="console-panel" id="panel-environment" data-panel="environment" role="tabpanel" aria-labelledby="tab-environment" hidden>
              <div class="section-intro"><span class="section-index">View</span><p>Frame the ecosystem without changing its behavior.</p></div>
              <div class="control-section">
                <h3>Camera presets</h3>
                <div class="camera-list" role="group" aria-label="Camera preset">
                  <button type="button" data-view="overview" aria-pressed="true"><span>Overview</span><small>Whole ecosystem</small></button>
                  <button type="button" data-view="school" aria-pressed="false"><span>School follow</span><small>Move with the centroid</small></button>
                  <button type="button" data-view="predator" aria-pressed="false"><span>Predator focus</span><small>Lead the pursuit</small></button>
                  <button type="button" data-view="orbit" aria-pressed="false"><span>Free camera</span><small>Drag, pan and zoom</small></button>
                </div>
              </div>
              <div class="control-section">
                <h3>Water & reef</h3>
                ${toggle('water-effects', 'Water effects', 'Particles, surface light and caustics', true)}
                ${toggle('obstacles-enabled', 'Reef obstacles', 'Five predictive sphere colliders', true)}
                <p class="control-note environment-note">Decorative flora and seabed debris are visual scenery. The five reef cores are the simulated colliders.</p>
              </div>
              <details class="control-section water-debug" id="water-debug">
                <summary><span>Water debug <small>render only</small></span><output id="water-debug-count">8 / 8</output></summary>
                <p class="control-note">Isolate each real rendering contribution. These switches never alter the flock, predator or fixed-step simulation.</p>
                <label class="debug-toggle"><span>Scene Fog · medium master</span><input type="checkbox" data-water-debug="sceneFog" checked /></label>
                <label class="debug-toggle"><span>Water Attenuation · transmission</span><input type="checkbox" data-water-debug="waterAttenuation" checked /></label>
                <label class="debug-toggle"><span>Volumetric Scattering · lit in-scattering</span><input type="checkbox" data-water-debug="volumetricScattering" checked /></label>
                <label class="debug-toggle"><span>Marine Particles</span><input type="checkbox" data-water-debug="marineParticles" checked /></label>
                <label class="debug-toggle"><span>Sediment Plume · near-bed</span><input type="checkbox" data-water-debug="sediment" checked /></label>
                <label class="debug-toggle"><span>Light Shafts</span><input type="checkbox" data-water-debug="lightShafts" checked /></label>
                <label class="debug-toggle"><span>Caustics</span><input type="checkbox" data-water-debug="caustics" checked /></label>
                <label class="debug-toggle"><span>Surface Light</span><input type="checkbox" data-water-debug="surfaceLight" checked /></label>
                <label class="debug-toggle unavailable"><span>Post Processing · N/A, not installed</span><input type="checkbox" disabled /></label>
                <div class="scenario-controls water-debug-actions">
                  <button type="button" class="secondary-button" data-water-preset="all-off">All off · raw baseline</button>
                  <button type="button" class="secondary-button" data-water-preset="all-on">Restore layers</button>
                </div>
              </details>
              <div class="control-section lab-only">
                <h3>Algorithm layers</h3>
                ${toggle('grid-visible', 'Occupied grid cells', 'Visible in Uniform grid mode')}
                <label class="debug-toggle"><span>Nearest 24 neighbor links</span><input type="checkbox" data-debug="neighbors" checked /></label>
                <label class="debug-toggle"><span>Velocity vector</span><input type="checkbox" data-debug="vectors" checked /></label>
                <label class="debug-toggle"><span>Behavior force vectors</span><input type="checkbox" data-debug="forces" checked /></label>
                <label class="debug-toggle"><span>Predator target</span><input type="checkbox" data-debug="predator" checked /></label>
                <label class="debug-toggle"><span>Escape direction</span><input type="checkbox" data-debug="escape" checked /></label>
                <p class="control-note">The inspected fish follows the predator target when one exists.</p>
              </div>
              <div class="control-section lab-only">
                <h3>Reef collision proxy · experiment</h3>
                ${toggle('reef-proxy-mode', 'SDF reef proxy', 'Compound collider built from the five GLB reefs')}
                <label class="debug-toggle"><span>Proxy wireframe</span><input type="checkbox" data-collision-debug="proxy" checked /></label>
                <label class="debug-toggle"><span>Obstacle margin shell</span><input type="checkbox" data-collision-debug="margin" /></label>
                <label class="debug-toggle"><span>Selected fish SDF normal</span><input type="checkbox" data-collision-debug="sdf" checked /></label>
                <label class="debug-toggle"><span>Fish inside a proxy</span><input type="checkbox" data-collision-debug="penetration" checked /></label>
                <p class="control-note">Requires the five-reef set. Sphere mode remains the production baseline; the margin is applied once outside the SDF.</p>
              </div>
            </section>

            <section class="console-panel" id="panel-performance" data-panel="performance" role="tabpanel" aria-labelledby="tab-performance" hidden>
              <div class="section-intro"><span class="section-index">Measure</span><p>Actual browser and fixed-step measurements.</p></div>
              <div class="performance-hero"><span>Frame rate</span><strong id="metric-performance-fps">—</strong><small>fps</small></div>
              <canvas id="performance-graph" width="300" height="72" aria-label="Recent measured frame rate"></canvas>
              <div class="graph-caption"><span>Recent frame rate</span><span>60 fps reference</span></div>
              <dl class="measurement-grid performance-grid">
                <div><dt>Simulation step</dt><dd id="metric-step">—</dd></div>
                <div><dt>Render CPU</dt><dd id="metric-render">—</dd></div>
                <div><dt>P95 frame time</dt><dd id="metric-p95">—</dd></div>
                <div><dt>Fixed steps</dt><dd id="metric-steps">—</dd></div>
                <div><dt>Dropped steps</dt><dd id="metric-dropped">—</dd></div>
                <div><dt>Candidate checks</dt><dd id="metric-candidates">—</dd></div>
                <div><dt>Occupied cells</dt><dd id="metric-cells">—</dd></div>
                <div><dt>Draw calls</dt><dd id="metric-draw-calls">—</dd></div>
              </dl>
              <div class="control-section search-section">
                <h3>Neighbor search</h3>
                <div class="segmented-control" role="group" aria-label="Neighbor search algorithm">
                  <button type="button" data-search="grid" aria-pressed="true">Uniform grid</button>
                  <button type="button" data-search="brute-force" aria-pressed="false">Brute force</button>
                </div>
                <p class="control-note">Both searches execute the same behavior calculation. Candidate checks refer to the latest fixed step.</p>
              </div>
            </section>
          </div>
          <footer class="panel-footer"><span><kbd>Space</kbd> pause</span><span><kbd>R</kbd> reset</span><span><kbd>G</kbd> grid</span><span id="measurement-rate">4 Hz readout</span></footer>
        </aside>
      </main>

      <footer class="transport-bar">
        <div class="transport-controls">
          <button type="button" class="primary-button" id="pause-button"><span id="pause-icon" aria-hidden="true">Ⅱ</span><span id="pause-label">Pause</span></button>
          <button type="button" class="secondary-button" id="reset-button">Reset</button>
          <label class="speed-select"><span>Speed</span><select id="time-scale" aria-label="Simulation speed"><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label>
        </div>
        <div class="scenario-switch" role="group" aria-label="Ecosystem scenario">
          <span class="scenario-label">Scenario</span>
          <button type="button" data-scenario="calm" aria-pressed="false"><i class="scenario-dot calm"></i>Calm</button>
          <button type="button" data-scenario="encounter" aria-pressed="true"><i class="scenario-dot encounter"></i>Encounter</button>
          <button type="button" data-scenario="obstacles" aria-pressed="false"><i class="scenario-dot navigation"></i>Navigation</button>
          <span class="scenario-seed" id="scenario-seed">Seed —</span>
        </div>
        <div class="footer-metrics" aria-label="Current performance">
          <div><span>FPS</span><strong id="metric-footer-fps">—</strong></div>
          <div><span>Sim</span><strong id="metric-footer-step">—</strong><small>ms</small></div>
          <div><span>P95</span><strong id="metric-footer-p95">—</strong><small>ms</small></div>
        </div>
      </footer>
    </div>`;
}
