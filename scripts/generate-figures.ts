import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

interface PerformancePayload {
  environment: {
    cpu: string;
    logicalCores: number;
    node: string;
    options: { counts: number[]; steps: number; repeats: number; warmup: number };
  };
  summaries: Array<{
    count: number;
    mode: 'grid' | 'brute-force';
    medianMeanStepMs: number;
    medianP95StepMs: number;
  }>;
}

interface AblationPayload {
  environment: { cpu: string; logicalCores: number; node: string };
  methodology: {
    fishCount: number;
    warmupSteps: number;
    measurementSteps: number;
    seeds: number[];
    searchMode: string;
  };
  aggregated: Array<{
    configuration: { id: string; label: string };
    meanRadiusOfGyration: number;
    meanPolarization: number;
    meanSchoolCount: number;
  }>;
}

interface PredatorPayload {
  environment: { cpu: string; logicalCores: number; node: string };
  methodology: {
    fishCount: number;
    settleSteps: number;
    threatSteps: number;
    recoverySteps: number;
    sampleInterval: number;
    predatorCount: number;
    clusterThresholds: { wide: number; strict: number; minimumComponentSize: number };
  };
  aggregated: Array<{
    condition: { id: string; label: string };
    preRadius: number;
    threatRadius: number;
    recoveryRadius: number;
    meanThreatenedCount: number;
    recoverySchoolCount3p2: number;
    preSchoolCount3p2: number;
    captures: number;
    maxThreatSchoolCount2p0: number;
  }>;
}

const root = fileURLToPath(new URL('../', import.meta.url));
const output = `${root}screenshots/`;
mkdirSync(output, { recursive: true });
const colors = {
  background: '#071f28',
  panel: '#0a2831',
  text: '#dcece6',
  muted: '#89a8a5',
  grid: 'rgba(160, 211, 204, 0.18)',
  brute: '#f49a7f',
  gridLine: '#78ded2',
  pale: '#b4d2cb',
  accent: '#d7ad68',
  blue: '#5d9da6',
};

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function text(
  x: number,
  y: number,
  value: string,
  size = 12,
  fill = colors.text,
  anchor: 'start' | 'middle' | 'end' = 'start',
  weight = '400',
): string {
  return `<text x="${x}" y="${y}" font-family="Aptos, Segoe UI, sans-serif" font-size="${size}" fill="${fill}" text-anchor="${anchor}" font-weight="${weight}">${escapeXml(value)}</text>`;
}

function line(x1: number, y1: number, x2: number, y2: number, stroke: string, width = 1, dash = ''): string {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
}

function rect(x: number, y: number, width: number, height: number, fill: string, opacity = 1): string {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}" opacity="${opacity}" rx="1"/>`;
}

function svg(width: number, height: number, title: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">
<title>${escapeXml(title)}</title>
<desc>Generated directly from Blue Current benchmark JSON files. Unit and test conditions are printed inside the figure.</desc>
<rect width="${width}" height="${height}" fill="${colors.background}"/>
${body}
</svg>`;
}

function panelLabel(x: number, y: number, index: string, title: string): string {
  return `${text(x, y, index, 11, colors.gridLine, 'start', '600')}${text(x + 24, y, title, 14, colors.text, 'start', '600')}`;
}

const performance = JSON.parse(readFileSync(`${root}benchmarks/performance-grid-vs-brute.json`, 'utf8')) as PerformancePayload;
const counts = performance.environment.options.counts;
const chartWidth = 980;
const chartHeight = 520;
const left = 90;
const right = 55;
const top = 108;
const bottom = 145;
const plotWidth = chartWidth - left - right;
const plotHeight = chartHeight - top - bottom;
const yMax = Math.ceil(Math.max(...performance.summaries.map((row) => row.medianMeanStepMs)) / 20) * 20;
const xFor = (count: number): number => left + (counts.indexOf(count) / Math.max(1, counts.length - 1)) * plotWidth;
const yForStep = (value: number): number => top + plotHeight - (value / yMax) * plotHeight;
let performanceBody = text(left, 48, 'CPU simulation step time: brute force vs uniform grid', 21, colors.text, 'start', '600');
performanceBody += text(left, 72, 'Lower is better. Unit: milliseconds per fixed simulation step.', 12, colors.muted);
for (let tick = 0; tick <= yMax; tick += 20) {
  const y = yForStep(tick);
  performanceBody += line(left, y, left + plotWidth, y, colors.grid);
  performanceBody += text(left - 12, y + 4, String(tick), 11, colors.muted, 'end');
}
for (const count of counts) {
  const x = xFor(count);
  performanceBody += line(x, top, x, top + plotHeight, colors.grid, 1, '3 5');
  performanceBody += text(x, top + plotHeight + 24, count.toLocaleString('en-US'), 11, colors.muted, 'middle');
}
performanceBody += line(left, top + plotHeight, left + plotWidth, top + plotHeight, colors.pale, 1);
performanceBody += text(24, top + plotHeight / 2, 'mean step (ms)', 11, colors.muted, 'middle').replace(
  '<text ',
  `<text transform="rotate(-90 24 ${top + plotHeight / 2})" `,
);
performanceBody += text(left + plotWidth / 2, top + plotHeight + 50, 'fish count', 12, colors.muted, 'middle');
for (const mode of ['brute-force', 'grid'] as const) {
  const rows = counts.map((count) => performance.summaries.find((row) => row.count === count && row.mode === mode)!);
  const color = mode === 'grid' ? colors.gridLine : colors.brute;
  const points = rows.map((row) => `${xFor(row.count)},${yForStep(row.medianMeanStepMs)}`).join(' ');
  performanceBody += `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2.5"/>`;
  for (const row of rows) {
    performanceBody += `<circle cx="${xFor(row.count)}" cy="${yForStep(row.medianMeanStepMs)}" r="4" fill="${colors.background}" stroke="${color}" stroke-width="2"/>`;
    performanceBody += text(xFor(row.count), yForStep(row.medianMeanStepMs) - 11, row.medianMeanStepMs.toFixed(2), 10, color, 'middle');
  }
  const legendX = left + (mode === 'grid' ? 230 : 70);
  performanceBody += line(legendX, 93, legendX + 24, 93, color, 3);
  performanceBody += text(legendX + 32, 97, mode === 'grid' ? 'Uniform grid' : 'Brute force', 12, colors.text);
}
performanceBody += text(
  left,
  chartHeight - 55,
  `Environment: ${performance.environment.cpu}; ${performance.environment.logicalCores} logical cores; Node ${performance.environment.node}; Linux sandbox.`,
  10,
  colors.muted,
);
performanceBody += text(
  left,
  chartHeight - 37,
  `Parameters: ${performance.environment.options.steps} measured steps x ${performance.environment.options.repeats} repeats; ${performance.environment.options.warmup}-step warm-up; predator off; no rendering.`,
  10,
  colors.muted,
);
performanceBody += text(
  left,
  chartHeight - 19,
  'Source: benchmarks/performance-grid-vs-brute.json. Values are measured means per run, not derived from speed-up ratios.',
  10,
  colors.gridLine,
);
writeFileSync(`${output}fig-performance.svg`, svg(chartWidth, chartHeight, 'Performance comparison', performanceBody));

const ablation = JSON.parse(readFileSync(`${root}benchmarks/ablation-results.json`, 'utf8')) as AblationPayload;
const ablationWidth = 1060;
const ablationHeight = 500;
let ablationBody = text(65, 45, 'Boids rule ablation: spatial and directional response', 21, colors.text, 'start', '600');
ablationBody += text(65, 69, '500 fish, three seeds, no predator. Higher polarization means stronger directional agreement.', 12, colors.muted);
const panelWidth = 285;
const panelHeight = 240;
const panelTop = 125;
const panels = [
  { title: 'Radius of gyration', unit: 'u', field: 'meanRadiusOfGyration' as const, max: 18 },
  { title: 'Polarization', unit: '0–1', field: 'meanPolarization' as const, max: 1 },
  { title: 'Schools (≥ 5 fish)', unit: 'count', field: 'meanSchoolCount' as const, max: 10 },
];
for (let panelIndex = 0; panelIndex < panels.length; panelIndex += 1) {
  const panel = panels[panelIndex];
  const panelX = 65 + panelIndex * (panelWidth + 40);
  ablationBody += panelLabel(panelX, 103, `0${panelIndex + 1}`, panel.title);
  ablationBody += text(panelX, 120, `unit: ${panel.unit}`, 10, colors.muted);
  ablationBody += line(panelX, panelTop + panelHeight, panelX + panelWidth, panelTop + panelHeight, colors.pale);
  for (let tick = 0; tick <= 4; tick += 1) {
    const value = (panel.max / 4) * tick;
    const y = panelTop + panelHeight - (value / panel.max) * panelHeight;
    ablationBody += line(panelX, y, panelX + panelWidth, y, colors.grid);
    ablationBody += text(panelX - 8, y + 4, value.toFixed(panel.max <= 1 ? 1 : 0), 9, colors.muted, 'end');
  }
  const barWidth = 54;
  ablation.aggregated.forEach((row, rowIndex) => {
    const value = row[panel.field];
    const barHeight = (value / panel.max) * panelHeight;
    const x = panelX + 42 + rowIndex * 86;
    ablationBody += rect(x, panelTop + panelHeight - barHeight, barWidth, barHeight, panelIndex === 1 ? colors.accent : colors.gridLine, 0.84);
    ablationBody += text(x + barWidth / 2, panelTop + panelHeight - barHeight - 8, value.toFixed(panel.max <= 1 ? 3 : 2), 10, colors.text, 'middle');
    ablationBody += text(x + barWidth / 2, panelTop + panelHeight + 17, row.configuration.label === 'Separation only' ? 'Sep only' : row.configuration.label === 'Separation + alignment' ? 'Sep + align' : 'All three', 9, colors.muted, 'middle');
  });
}
ablationBody += text(
  65,
  ablationHeight - 55,
  `Environment: ${ablation.environment.cpu}; ${ablation.environment.logicalCores} logical cores; Node ${ablation.environment.node}; Linux sandbox.`,
  10,
  colors.muted,
);
ablationBody += text(
  65,
  ablationHeight - 36,
  `Parameters: ${ablation.methodology.fishCount} fish; ${ablation.methodology.warmupSteps} warm-up + ${ablation.methodology.measurementSteps} measured steps; ${ablation.methodology.seeds.length} seeds; predator disabled; ${ablation.methodology.searchMode} search.`,
  10,
  colors.muted,
);
ablationBody += text(
  65,
  ablationHeight - 17,
  'Source: benchmarks/ablation-results.json, sampled every 30 steps. Error bars are not shown; exact per-seed values are in the CSV.',
  10,
  colors.gridLine,
);
writeFileSync(`${output}fig-ablation.svg`, svg(ablationWidth, ablationHeight, 'Boids rule ablation', ablationBody));

const predator = JSON.parse(readFileSync(`${root}benchmarks/predator-results.json`, 'utf8')) as PredatorPayload;
const predatorWidth = 1120;
const predatorHeight = 540;
let predatorBody = text(65, 45, 'Predator conditions: spatial response and recovery', 21, colors.text, 'start', '600');
predatorBody += text(65, 69, 'Four conditions, three seeds. Threat and recovery are averaged over the measured windows.', 12, colors.muted);
const predatorPanels = [
  { title: 'Radius of gyration by phase', unit: 'u', series: ['preRadius', 'threatRadius', 'recoveryRadius'] as const, max: 14 },
  { title: 'Threatened fish during threat', unit: 'fish', series: ['meanThreatenedCount'] as const, max: 50 },
  { title: 'Wide components after recovery', unit: `count @ ${predator.methodology.clusterThresholds.wide} u`, series: ['recoverySchoolCount3p2'] as const, max: 2.5 },
];
const pPanelWidth = 290;
const pPanelHeight = 240;
const pPanelTop = 150;
const shortLabels = ['No predator', 'Patrol', 'Pursuit', 'Pursuit + evasion'];
for (let panelIndex = 0; panelIndex < predatorPanels.length; panelIndex += 1) {
  const panel = predatorPanels[panelIndex];
  const panelX = 65 + panelIndex * (pPanelWidth + 40);
  predatorBody += panelLabel(panelX, 105, `0${panelIndex + 1}`, panel.title);
  predatorBody += text(panelX, 122, `unit: ${panel.unit}`, 10, colors.muted);
  predatorBody += line(panelX, pPanelTop + pPanelHeight, panelX + pPanelWidth, pPanelTop + pPanelHeight, colors.pale);
  for (let tick = 0; tick <= 4; tick += 1) {
    const value = (panel.max / 4) * tick;
    const y = pPanelTop + pPanelHeight - (value / panel.max) * pPanelHeight;
    predatorBody += line(panelX, y, panelX + pPanelWidth, y, colors.grid);
    predatorBody += text(panelX - 8, y + 4, value.toFixed(panel.max <= 2.5 ? 1 : 0), 9, colors.muted, 'end');
  }
  const groupWidth = 64;
  predator.aggregated.forEach((row, rowIndex) => {
    const startX = panelX + 8 + rowIndex * groupWidth;
    const seriesColors = [colors.blue, colors.brute, colors.gridLine];
    panel.series.forEach((field, seriesIndex) => {
      const value = row[field];
      const barHeight = (value / panel.max) * pPanelHeight;
      const barWidth = panel.series.length === 1 ? 34 : 15;
      const x = startX + seriesIndex * (panel.series.length === 1 ? 15 : 17);
      predatorBody += rect(x, pPanelTop + pPanelHeight - barHeight, barWidth, barHeight, seriesColors[seriesIndex], 0.86);
      if (panel.series.length === 1) {
        predatorBody += text(x + barWidth / 2, pPanelTop + pPanelHeight - barHeight - 7, value.toFixed(value < 10 ? 2 : 1), 9, colors.text, 'middle');
      }
    });
    predatorBody += text(startX + 31, pPanelTop + pPanelHeight + 18, shortLabels[rowIndex], 8.5, colors.muted, 'middle');
  });
}
const predatorLegend = ['Pre-threat', 'Threat', 'Recovery'];
predatorLegend.forEach((label, index) => {
  const x = 75 + index * 140;
  predatorBody += rect(x, 130, 9, 9, [colors.blue, colors.brute, colors.gridLine][index], 0.86);
  predatorBody += text(x + 15, 138, label, 9, colors.muted);
});
predatorBody += text(
  65,
  predatorHeight - 55,
  `Environment: ${predator.environment.cpu}; ${predator.environment.logicalCores} logical cores; Node ${predator.environment.node}; Linux sandbox.`,
  10,
  colors.muted,
);
predatorBody += text(
  65,
  predatorHeight - 36,
  `Parameters: ${predator.methodology.fishCount} fish; ${predator.methodology.predatorCount} predator; ${predator.methodology.settleSteps}/${predator.methodology.threatSteps}/${predator.methodology.recoverySteps} settle/threat/recovery steps; samples every ${predator.methodology.sampleInterval} steps; 3 seeds.`,
  10,
  colors.muted,
);
predatorBody += text(
  65,
  predatorHeight - 17,
  'Source: benchmarks/predator-results.json. Capture counts are means per 3-seed run; components ignore groups below five fish.',
  10,
  colors.gridLine,
);
writeFileSync(`${output}fig-predator.svg`, svg(predatorWidth, predatorHeight, 'Predator split and recovery experiment', predatorBody));

console.log('Generated screenshots/fig-performance.svg, fig-ablation.svg and fig-predator.svg from raw benchmark JSON.');
