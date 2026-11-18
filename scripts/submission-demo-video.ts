import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

/**
 * One-off submission demo recorder. Records the current rich default scene
 * through a headed hardware Chrome context and writes raw WebM plus timing
 * metadata; the caller trims the loading segment and encodes MP4.
 */

interface DemoApi {
  ready: boolean;
  getDiagnostics(): {
    fishCount: number;
    clownfishCount: number;
    predatorState: string;
    captures: number;
    searchMode: string;
    fishModel: string;
    clownfishModel: string;
    predatorModel: string;
    coralModel: string;
    kelpModel: string;
    seaweedModel: string;
  };
  setViewMode(mode: 'observation' | 'laboratory'): void;
  setCameraMode(mode: 'overview' | 'free' | 'orbit' | 'school' | 'predator'): void;
  setCameraPose(position: [number, number, number], target: [number, number, number]): void;
  releasePredator(): void;
  regroupSchool(): void;
  setGridVisible(visible: boolean): void;
}

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const artifacts = `${projectRoot}submission/demo`;
mkdirSync(artifacts, { recursive: true });

const server = await createServer({
  root: projectRoot,
  cacheDir: `${projectRoot}.vite/submission-demo`,
  server: { host: '127.0.0.1', port: 0, strictPort: false },
});
await server.listen();
const baseUrl = server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:5173/';

const browser = await chromium.launch({
  headless: false,
  channel: 'chrome',
  args: ['--no-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});

const started = Date.now();
let readySeconds = 0;
const errors: string[] = [];

try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    recordVideo: { dir: `${artifacts}/raw`, size: { width: 1280, height: 720 } },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(180000);
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  await page.goto(`${baseUrl}?scenario=encounter&lighting=full&obstacleShape=sphere`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(() => (
    window as unknown as { __blueCurrent?: DemoApi }
  ).__blueCurrent?.ready === true, undefined, { polling: 250 });
  await page.waitForFunction(() => {
    const api = (window as unknown as { __blueCurrent: DemoApi }).__blueCurrent;
    const diagnostics = api.getDiagnostics();
    return diagnostics.fishModel === 'blender'
      && diagnostics.clownfishModel === 'blender'
      && diagnostics.predatorModel === 'blender'
      && diagnostics.coralModel !== 'off'
      && diagnostics.kelpModel === 'blender'
      && diagnostics.seaweedModel === 'blender';
  }, undefined, { timeout: 180000, polling: 500 });
  readySeconds = (Date.now() - started) / 1000;
  await page.bringToFront();
  await page.waitForTimeout(600);

  await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('.observatory');
    root?.classList.add('panel-closed');
    const style = document.createElement('style');
    style.textContent = `
      #bc-demo-title { position:fixed; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center;
        background:rgba(3,18,26,.78); color:#eaf6ff; z-index:99999; transition:opacity .45s;
        font-family:"Microsoft YaHei","Segoe UI",sans-serif; text-align:center; }
      #bc-demo-title h1 { margin:0; font-size:52px; letter-spacing:.12em; font-weight:700; }
      #bc-demo-title p { margin:16px 0 0; font-size:19px; letter-spacing:.06em; color:#a9d9e4; }
      #bc-demo-caption { position:fixed; left:30px; bottom:28px; padding:12px 18px; z-index:99998;
        background:rgba(3,18,26,.72); border-left:3px solid #4cc9dc; color:#eaf6ff;
        font-family:"Microsoft YaHei","Segoe UI",sans-serif; font-size:17px; letter-spacing:.03em;
        box-shadow:0 4px 18px rgba(0,0,0,.25); }
    `;
    document.head.appendChild(style);
    const title = document.createElement('div');
    title.id = 'bc-demo-title';
    title.innerHTML = '<h1>BLUE CURRENT</h1><p>实时三维捕食者—猎物群体生态模拟</p>';
    document.body.appendChild(title);
    const caption = document.createElement('div');
    caption.id = 'bc-demo-caption';
    caption.textContent = '500 条猎物 + 100 条小丑鱼 + 1 条捕食者';
    document.body.appendChild(caption);
  });
  await page.waitForTimeout(4800);
  await page.evaluate(() => {
    const title = document.getElementById('bc-demo-title');
    if (title) title.style.opacity = '0';
  });
  await page.waitForTimeout(600);

  const caption = async (text: string): Promise<void> => {
    await page.evaluate((value) => {
      const element = document.getElementById('bc-demo-caption');
      if (element) element.textContent = value;
    }, text);
  };

  await page.evaluate(() => {
    const api = (window as unknown as { __blueCurrent: DemoApi }).__blueCurrent;
    api.setViewMode('observation');
    api.setCameraMode('orbit');
    api.setCameraPose([30, 18, 29], [0, 6.5, -2]);
  });
  await caption('局部规则：分离 · 对齐 · 聚合');
  await page.mouse.move(640, 360);
  await page.mouse.down();
  for (let step = 1; step <= 30; step += 1) {
    await page.mouse.move(640 + step * 7, 360 + Math.sin(step / 5) * 10);
    await page.waitForTimeout(60);
  }
  await page.mouse.up();
  await page.waitForTimeout(1500);

  await caption('跟随鱼群：局部规则形成整体运动');
  await page.evaluate(() => (window as unknown as { __blueCurrent: DemoApi }).__blueCurrent.setCameraMode('school'));
  await page.waitForTimeout(7500);

  await caption('实时诊断：所有数值来自正在运行的模拟');
  await page.evaluate(() => document.querySelector<HTMLElement>('.observatory')?.classList.remove('panel-closed'));
  await page.waitForTimeout(5500);
  await page.evaluate(() => document.querySelector<HTMLElement>('.observatory')?.classList.add('panel-closed'));

  await caption('捕食者状态机：巡逻 → 追逐 → 捕获');
  await page.evaluate(() => {
    const api = (window as unknown as { __blueCurrent: DemoApi }).__blueCurrent;
    api.releasePredator();
    api.setCameraMode('predator');
  });
  for (let elapsed = 0; elapsed < 12000; elapsed += 500) {
    await page.waitForTimeout(500);
    const diagnostics = await page.evaluate(() => (
      window as unknown as { __blueCurrent: DemoApi }
    ).__blueCurrent.getDiagnostics());
    if (diagnostics.captures > 0) {
      await page.waitForTimeout(1800);
      break;
    }
  }

  await caption('威胁解除后的群体重组');
  await page.evaluate(() => {
    const api = (window as unknown as { __blueCurrent: DemoApi }).__blueCurrent;
    api.regroupSchool();
    api.setCameraMode('school');
  });
  await page.waitForTimeout(7000);

  await caption('Laboratory：占用网格与障碍碰撞诊断');
  await page.evaluate(() => {
    const api = (window as unknown as { __blueCurrent: DemoApi }).__blueCurrent;
    api.setViewMode('laboratory');
    api.setCameraMode('orbit');
    api.setGridVisible(true);
    api.setCameraPose([24, 12, 22], [0, 6, -1]);
  });
  await page.waitForTimeout(7000);

  await caption('Blue Current · 可交互、可复现的群体生态实验');
  await page.evaluate(() => {
    const api = (window as unknown as { __blueCurrent: DemoApi }).__blueCurrent;
    api.setViewMode('observation');
    api.setGridVisible(false);
    api.setCameraMode('orbit');
    api.setCameraPose([32, 20, 31], [0, 6.5, -2]);
  });
  await page.waitForTimeout(5500);

  await page.evaluate(() => {
    const title = document.getElementById('bc-demo-title');
    if (title) {
      title.style.opacity = '1';
      title.innerHTML = '<h1>BLUE CURRENT</h1><p>谢谢观看</p>';
    }
    const caption = document.getElementById('bc-demo-caption');
    if (caption) caption.textContent = '';
  });
  await page.waitForTimeout(4200);

  const video = page.video();
  const finalDiagnostics = await page.evaluate(() => (
    window as unknown as { __blueCurrent: DemoApi }
  ).__blueCurrent.getDiagnostics());
  await context.close();
  if (!video) throw new Error('Playwright produced no video.');
  const rawPath = await video.path();
  renameSync(rawPath, `${artifacts}/BlueCurrent-demo-raw.webm`);
  const durationSeconds = (Date.now() - started) / 1000;
  writeFileSync(`${artifacts}/capture.json`, JSON.stringify({
    capturedAt: new Date().toISOString(),
    baseUrl,
    viewport: { width: 1280, height: 720 },
    renderer: 'hardware Chrome via Playwright recordVideo',
    readySeconds,
    durationSeconds,
    trimStartSeconds: readySeconds,
    finalDiagnostics,
    errors,
  }, null, 2));
  console.log(JSON.stringify({ raw: `${artifacts}/BlueCurrent-demo-raw.webm`, readySeconds, durationSeconds, errors }, null, 2));
  if (errors.length > 0) throw new Error(`Browser errors:\n${errors.join('\n')}`);
} finally {
  await browser.close();
  await server.close();
}
