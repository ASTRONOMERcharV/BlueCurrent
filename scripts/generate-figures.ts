import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Browser } from 'playwright';

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

// 中文字体优先（雅黑在前），保证 SVG 与 Chromium 截图中的 CJK 正常渲染。
const fontFamily = "'Microsoft YaHei', 'Aptos', 'Segoe UI', sans-serif";

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function text(
  x: number,
  y: number,
  value: string,
  size: number,
  fill = colors.text,
  anchor: 'start' | 'middle' | 'end' = 'start',
  weight = '400',
): string {
  return `<text x="${x}" y="${y}" font-family="${fontFamily}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" font-weight="${weight}">${escapeXml(value)}</text>`;
}

function rotatedText(x: number, y: number, value: string, size: number, fill: string): string {
  return `<text x="${x}" y="${y}" font-family="${fontFamily}" font-size="${size}" fill="${fill}" text-anchor="middle" transform="rotate(-90 ${x} ${y})">${escapeXml(value)}</text>`;
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
<desc>由 Blue Current 基准 JSON 文件直接生成。单位与测试条件均标注在图内。</desc>
<rect width="${width}" height="${height}" fill="${colors.background}"/>
${body}
</svg>`;
}

function panelLabel(
  x: number,
  y: number,
  index: string,
  title: string,
  indexSize: number,
  titleSize: number,
): string {
  return `${text(x, y, index, indexSize, colors.gridLine, 'start', '600')}${text(x + indexSize + 10, y, title, titleSize, colors.text, 'start', '600')}`;
}

const performance = JSON.parse(readFileSync(`${root}benchmarks/performance-grid-vs-brute.json`, 'utf8')) as PerformancePayload;
const counts = performance.environment.options.counts;
const performanceWidth = 980;
const performanceHeight = 580;
const left = 96;
const right = 60;
const top = 124;
const bottom = 150;
const plotWidth = performanceWidth - left - right;
const plotHeight = performanceHeight - top - bottom;
const yMax = Math.ceil(Math.max(...performance.summaries.map((row) => row.medianMeanStepMs)) / 20) * 20;
const xFor = (count: number): number => left + (counts.indexOf(count) / Math.max(1, counts.length - 1)) * plotWidth;
const yForStep = (value: number): number => top + plotHeight - (value / yMax) * plotHeight;
const axisY = top + plotHeight;
let performanceBody = text(left, 52, 'CPU 模拟步耗时：暴力搜索 vs. Uniform Grid', 26, colors.text, 'start', '600');
performanceBody += text(left, 84, '越低越好。单位：每个固定模拟步的毫秒数。', 17, colors.muted);
for (let tick = 0; tick <= yMax; tick += 20) {
  const y = yForStep(tick);
  performanceBody += line(left, y, left + plotWidth, y, colors.grid);
  performanceBody += text(left - 14, y + 6, String(tick), 17, colors.muted, 'end');
}
for (const count of counts) {
  const x = xFor(count);
  performanceBody += line(x, top, x, axisY, colors.grid, 1, '3 5');
  performanceBody += text(x, axisY + 28, count.toLocaleString('en-US'), 17, colors.muted, 'middle');
}
performanceBody += line(left, axisY, left + plotWidth, axisY, colors.pale, 1);
performanceBody += rotatedText(28, (top + axisY) / 2, '平均步耗时（ms）', 17, colors.muted);
performanceBody += text(left + plotWidth / 2, axisY + 58, '鱼数量', 17, colors.muted, 'middle');
const bruteRows = counts.map((count) => performance.summaries.find((row) => row.count === count && row.mode === 'brute-force')!);
const gridRows = counts.map((count) => performance.summaries.find((row) => row.count === count && row.mode === 'grid')!);
for (const mode of ['brute-force', 'grid'] as const) {
  const rows = mode === 'grid' ? gridRows : bruteRows;
  const color = mode === 'grid' ? colors.gridLine : colors.brute;
  const points = rows.map((row) => `${xFor(row.count)},${yForStep(row.medianMeanStepMs)}`).join(' ');
  performanceBody += `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2.5"/>`;
  for (const row of rows) {
    performanceBody += `<circle cx="${xFor(row.count)}" cy="${yForStep(row.medianMeanStepMs)}" r="4" fill="${colors.background}" stroke="${color}" stroke-width="2"/>`;
  }
  const legendX = left + (mode === 'grid' ? 240 : 70);
  performanceBody += line(legendX, 103, legendX + 24, 103, color, 3);
  performanceBody += text(legendX + 32, 109, mode === 'grid' ? 'Uniform Grid' : '暴力搜索', 17, colors.text);
}
// 两条曲线在低倍率区几乎重合：数值标注左右错开，避免 17px 字号下互相压盖。
for (let i = 0; i < counts.length; i += 1) {
  const x = xFor(counts[i]);
  const bruteY = yForStep(bruteRows[i].medianMeanStepMs);
  const gridY = yForStep(gridRows[i].medianMeanStepMs);
  const bruteLabel = bruteRows[i].medianMeanStepMs.toFixed(2);
  const gridLabel = gridRows[i].medianMeanStepMs.toFixed(2);
  if (Math.abs(bruteY - gridY) < 30) {
    performanceBody += text(x - 10, bruteY - 13, bruteLabel, 17, colors.brute, 'end');
    if (gridY + 28 < axisY - 6) {
      // 曲线在此处快速上升：把网格数值放在数据点正下方，避免折线穿过文字。
      performanceBody += text(x, gridY + 28, gridLabel, 17, colors.gridLine, 'middle');
    } else {
      performanceBody += text(x + 10, gridY - 13, gridLabel, 17, colors.gridLine, 'start');
    }
  } else {
    performanceBody += text(x, bruteY - 13, bruteLabel, 17, colors.brute, 'middle');
    performanceBody += text(x, gridY - 13, gridLabel, 17, colors.gridLine, 'middle');
  }
}
performanceBody += text(
  left,
  performanceHeight - 64,
  `环境：${performance.environment.cpu}；${performance.environment.logicalCores} 个逻辑核；Node ${performance.environment.node}；Linux 沙箱。`,
  17,
  colors.muted,
);
performanceBody += text(
  left,
  performanceHeight - 42,
  `参数：${performance.environment.options.steps} 步测量 × ${performance.environment.options.repeats} 次重复；${performance.environment.options.warmup} 步预热；无捕食者；无渲染。`,
  17,
  colors.muted,
);
performanceBody += text(
  left,
  performanceHeight - 20,
  '数据来源：benchmarks/performance-grid-vs-brute.json。数值为每轮运行实测均值，并非由加速比推算。',
  17,
  colors.gridLine,
);
writeFileSync(`${output}fig-performance.svg`, svg(performanceWidth, performanceHeight, '性能对比', performanceBody));

const ablation = JSON.parse(readFileSync(`${root}benchmarks/ablation-results.json`, 'utf8')) as AblationPayload;
const ablationWidth = 1060;
const ablationHeight = 560;
let ablationBody = text(65, 50, 'Boids 规则消融：空间与方向响应', 26, colors.text, 'start', '600');
ablationBody += text(
  65,
  82,
  `${ablation.methodology.fishCount} 条鱼、${ablation.methodology.seeds.length} 组随机种子、无捕食者。方向一致性越高，说明方向协同越强。`,
  18,
  colors.muted,
);
const panelWidth = 285;
const panelHeight = 250;
const panelTop = 155;
const ablationPanels = [
  { title: '回旋半径', unit: 'u', field: 'meanRadiusOfGyration' as const, max: 18 },
  { title: '方向一致性', unit: '0–1', field: 'meanPolarization' as const, max: 1 },
  { title: '群体数量（≥ 5 条鱼）', unit: '个', field: 'meanSchoolCount' as const, max: 10 },
];
for (let panelIndex = 0; panelIndex < ablationPanels.length; panelIndex += 1) {
  const panel = ablationPanels[panelIndex];
  const panelX = 65 + panelIndex * (panelWidth + 40);
  ablationBody += panelLabel(panelX, 116, `0${panelIndex + 1}`, panel.title, 18, 19);
  ablationBody += text(panelX, 142, `单位：${panel.unit}`, 18, colors.muted);
  ablationBody += line(panelX, panelTop + panelHeight, panelX + panelWidth, panelTop + panelHeight, colors.pale);
  for (let tick = 0; tick <= 4; tick += 1) {
    const value = (panel.max / 4) * tick;
    const y = panelTop + panelHeight - (value / panel.max) * panelHeight;
    ablationBody += line(panelX, y, panelX + panelWidth, y, colors.grid);
    ablationBody += text(panelX - 10, y + 6, value.toFixed(panel.max <= 1 ? 1 : 0), 18, colors.muted, 'end');
  }
  const barWidth = 54;
  ablation.aggregated.forEach((row, rowIndex) => {
    const value = row[panel.field];
    const barHeight = (value / panel.max) * panelHeight;
    const x = panelX + 42 + rowIndex * 86;
    ablationBody += rect(x, panelTop + panelHeight - barHeight, barWidth, barHeight, panelIndex === 1 ? colors.accent : colors.gridLine, 0.84);
    ablationBody += text(x + barWidth / 2, panelTop + panelHeight - barHeight - 10, value.toFixed(panel.max <= 1 ? 3 : 2), 18, colors.text, 'middle');
    const shortLabel = row.configuration.label === 'Separation only' ? '仅分离' : row.configuration.label === 'Separation + alignment' ? '分离+对齐' : '三者齐备';
    ablationBody += text(x + barWidth / 2, panelTop + panelHeight + 28, shortLabel, 18, colors.muted, 'middle');
  });
}
ablationBody += text(
  65,
  ablationHeight - 68,
  `环境：${ablation.environment.cpu}；${ablation.environment.logicalCores} 个逻辑核；Node ${ablation.environment.node}；Linux 沙箱。`,
  18,
  colors.muted,
);
ablationBody += text(
  65,
  ablationHeight - 44,
  `参数：${ablation.methodology.fishCount} 条鱼；${ablation.methodology.warmupSteps} 步预热 + ${ablation.methodology.measurementSteps} 步测量；${ablation.methodology.seeds.length} 组随机种子；关闭捕食者；${ablation.methodology.searchMode === 'grid' ? 'Uniform Grid' : '暴力搜索'} 搜索。`,
  18,
  colors.muted,
);
ablationBody += text(
  65,
  ablationHeight - 20,
  '数据来源：benchmarks/ablation-results.json，每 30 步采样一次；未绘制误差棒，逐种子精确值见 CSV。',
  18,
  colors.gridLine,
);
writeFileSync(`${output}fig-ablation.svg`, svg(ablationWidth, ablationHeight, 'Boids 规则消融', ablationBody));

const predator = JSON.parse(readFileSync(`${root}benchmarks/predator-results.json`, 'utf8')) as PredatorPayload;
const predatorWidth = 1120;
const predatorHeight = 600;
let predatorBody = text(65, 52, '捕食者条件：空间响应与恢复', 26, colors.text, 'start', '600');
predatorBody += text(65, 86, '四种条件，3 组随机种子。威胁期与恢复期按测量窗口取平均。', 19, colors.muted);
const predatorPanels = [
  { title: '回旋半径（按阶段）', unit: 'u', series: ['preRadius', 'threatRadius', 'recoveryRadius'] as const, max: 14 },
  { title: '威胁期间受惊鱼数量', unit: '条', series: ['meanThreatenedCount'] as const, max: 50 },
  {
    title: '恢复期宽连通群体数',
    unit: `个（宽阈值 ${predator.methodology.clusterThresholds.wide} u）`,
    series: ['recoverySchoolCount3p2'] as const,
    max: 2.5,
  },
];
const pPanelWidth = 290;
const pPanelHeight = 250;
const pPanelTop = 200;
const shortLabels = ['无捕食者', '巡逻', '追击', '追击+逃逸'];
for (let panelIndex = 0; panelIndex < predatorPanels.length; panelIndex += 1) {
  const panel = predatorPanels[panelIndex];
  const panelX = 65 + panelIndex * (pPanelWidth + 40);
  predatorBody += panelLabel(panelX, 156, `0${panelIndex + 1}`, panel.title, 19, 20);
  predatorBody += text(panelX, 182, `单位：${panel.unit}`, 19, colors.muted);
  predatorBody += line(panelX, pPanelTop + pPanelHeight, panelX + pPanelWidth, pPanelTop + pPanelHeight, colors.pale);
  for (let tick = 0; tick <= 4; tick += 1) {
    const value = (panel.max / 4) * tick;
    const y = pPanelTop + pPanelHeight - (value / panel.max) * pPanelHeight;
    predatorBody += line(panelX, y, panelX + pPanelWidth, y, colors.grid);
    predatorBody += text(panelX - 10, y + 6, value.toFixed(panel.max <= 2.5 ? 1 : 0), 19, colors.muted, 'end');
  }
  const groupWidth = 70;
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
        predatorBody += text(x + barWidth / 2, pPanelTop + pPanelHeight - barHeight - 9, value.toFixed(value < 10 ? 2 : 1), 19, colors.text, 'middle');
      }
    });
    predatorBody += text(startX + 32, pPanelTop + pPanelHeight + 30, shortLabels[rowIndex], 19, colors.muted, 'middle');
  });
}
const predatorLegend = ['威胁前', '威胁期间', '恢复期'];
predatorLegend.forEach((label, index) => {
  const x = 75 + index * 170;
  predatorBody += rect(x, 104, 14, 14, [colors.blue, colors.brute, colors.gridLine][index], 0.86);
  predatorBody += text(x + 22, 117, label, 19, colors.muted);
});
predatorBody += text(
  65,
  predatorHeight - 70,
  `环境：${predator.environment.cpu}；${predator.environment.logicalCores} 个逻辑核；Node ${predator.environment.node}；Linux 沙箱。`,
  19,
  colors.muted,
);
predatorBody += text(
  65,
  predatorHeight - 45,
  `参数：${predator.methodology.fishCount} 条鱼；${predator.methodology.predatorCount} 只捕食者；稳定/威胁/恢复各 ${predator.methodology.settleSteps}/${predator.methodology.threatSteps}/${predator.methodology.recoverySteps} 步；每 ${predator.methodology.sampleInterval} 步采样；3 组随机种子。`,
  19,
  colors.muted,
);
predatorBody += text(
  65,
  predatorHeight - 20,
  `数据来源：benchmarks/predator-results.json。捕获数为 3 组种子运行的均值；连通分量忽略少于 ${predator.methodology.clusterThresholds.minimumComponentSize} 条鱼的群体。`,
  19,
  colors.gridLine,
);
writeFileSync(`${output}fig-predator.svg`, svg(predatorWidth, predatorHeight, '捕食者实验', predatorBody));

const figures = [
  { svg: 'fig-performance.svg', png: 'fig-performance.png', width: performanceWidth, height: performanceHeight },
  { svg: 'fig-ablation.svg', png: 'fig-ablation.png', width: ablationWidth, height: ablationHeight },
  { svg: 'fig-predator.svg', png: 'fig-predator.png', width: predatorWidth, height: predatorHeight },
];
console.log('已生成 screenshots/fig-performance.svg、fig-ablation.svg、fig-predator.svg（中文标注，数据直接读取 benchmarks/*.json）。');

// PNG 渲染方案（按优先级尝试）：
//   1. 直接 chromium.launch()，使用 Playwright 自带的 Chromium（node_modules/playwright 与
//      %LOCALAPPDATA%\ms-playwright 下的 chromium-<revision>\chrome-win64\chrome.exe）；
//   2. chromium.launch({ channel: 'chrome' })，退回系统安装的 Chrome；
//   3. 显式扫描 %LOCALAPPDATA%\ms-playwright（以及 PLAYWRIGHT_BROWSERS_PATH）下所有
//      chromium-*/chrome-win64|chrome-win|chrome-win32\chrome.exe，逐一作为 executablePath 启动。
// 实际成功的那一档会打印在命令输出中。
function chromiumExecutableCandidates(): string[] {
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'ms-playwright') : undefined]
    .filter((value): value is string => Boolean(value));
  const candidates: string[] = [];
  for (const candidateRoot of roots) {
    if (!existsSync(candidateRoot)) continue;
    for (const entry of readdirSync(candidateRoot)) {
      if (!entry.startsWith('chromium-')) continue;
      for (const relative of ['chrome-win64\\chrome.exe', 'chrome-win\\chrome.exe', 'chrome-win32\\chrome.exe']) {
        const executable = join(candidateRoot, entry, relative);
        if (existsSync(executable)) candidates.push(executable);
      }
    }
  }
  return candidates.sort().reverse();
}

async function launchChromium(): Promise<{ browser: Browser; strategy: string }> {
  const { chromium } = await import('playwright');
  const attempts: Array<{ strategy: string; launch: () => Promise<Browser> }> = [
    { strategy: 'chromium.launch() 默认 Chromium', launch: () => chromium.launch() },
    { strategy: "chromium.launch({ channel: 'chrome' })", launch: () => chromium.launch({ channel: 'chrome' }) },
  ];
  for (const executablePath of chromiumExecutableCandidates()) {
    attempts.push({ strategy: `executablePath=${executablePath}`, launch: () => chromium.launch({ executablePath }) });
  }
  const failures: string[] = [];
  for (const attempt of attempts) {
    try {
      const browser = await attempt.launch();
      return { browser, strategy: attempt.strategy };
    } catch (error) {
      failures.push(`${attempt.strategy}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
    }
  }
  throw new Error(`Playwright 无法启动 Chromium，已尝试：\n${failures.join('\n')}`);
}

// 直接以 file:// 打开生成的 SVG，用 deviceScaleFactor 2 截图，PNG 尺寸即为 SVG 的 2 倍。
async function renderPngs(): Promise<void> {
  const { browser, strategy } = await launchChromium();
  console.log(`Playwright 浏览器启动成功（${strategy}）。`);
  try {
    const context = await browser.newContext({ viewport: { width: figures[0].width, height: figures[0].height }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    for (const figure of figures) {
      await page.setViewportSize({ width: figure.width, height: figure.height });
      await page.goto(pathToFileURL(`${output}${figure.svg}`).href, { waitUntil: 'load' });
      await page.evaluate(async () => {
        if (document.fonts) await document.fonts.ready;
      });
      await page.waitForTimeout(100);
      await page.screenshot({
        path: `${output}${figure.png}`,
        clip: { x: 0, y: 0, width: figure.width, height: figure.height },
      });
      console.log(`已生成 screenshots/${figure.png}（${figure.width * 2}×${figure.height * 2}）。`);
    }
  } finally {
    await browser.close();
  }
}

try {
  await renderPngs();
  console.log('三张 PNG 已由 Playwright Chromium 以 deviceScaleFactor=2 重新生成。');
} catch (error) {
  console.error('SVG 已生成，但 Playwright 渲染 PNG 失败：', error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
