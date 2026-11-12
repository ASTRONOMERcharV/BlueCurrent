import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

/**
 * Deterministic world-continuity evidence capture.
 *
 * One browser session produces either:
 * - `presets`: Overview / School / Predator / Free at fixed simulation times.
 * - `boundary`: 8 azimuths × 3 polar angles at the maximum orbit distance.
 *
 * The render loop is frozen before any capture and every frame is produced by
 * an explicit debug render, so SwiftShader screenshots show exactly the paused
 * simulation state rather than a wall-clock-dependent frame.
 */

type CameraMode = 'overview' | 'school' | 'predator' | 'free';

interface Diagnostics {
  simulationTime: number;
  cameraPosition: [number, number, number];
  cameraTarget: [number, number, number];
  cameraDistance: number;
  maxCameraDistance: number;
  drawCalls: number;
  renderTriangles: number;
  frameSampleCount: number;
  fishCount: number;
  captures: number;
  predatorState: string;
}

interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
}

interface DebugApi {
  ready: boolean;
  pause(): void;
  setScenario(id: string): void;
  setViewMode(mode: 'observation' | 'laboratory'): void;
  setGridVisible(visible: boolean): void;
  setCameraMode(mode: CameraMode): void;
  setCameraPose(position: [number, number, number], target: [number, number, number]): void;
  step(count?: number): Diagnostics;
  setVisualTime(seconds: number): Diagnostics;
  settleCamera(seconds?: number, frames?: number): Diagnostics;
  captureCameraSheet(
    poses: readonly CameraPose[],
    columns: number,
    rows: number,
    width?: number,
    height?: number,
  ): string;
  setShadowMapEnabled(enabled: boolean): void;
  getDiagnostics(): Diagnostics;
  getSimulationSnapshot(): Record<string, unknown>;
}

function argument(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const entry = process.argv.find((value) => value.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : fallback;
}

function numbersArgument(name: string, fallback: string): number[] {
  return argument(name, fallback)
    .split(',')
    .map((value) => Number.parseFloat(value))
    .filter((value) => Number.isFinite(value));
}

function tupleArgument(name: string, fallback: string): [number, number, number] {
  const values = numbersArgument(name, fallback);
  if (values.length !== 3) throw new Error(`--${name} needs three comma-separated numbers.`);
  return [values[0], values[1], values[2]];
}

const outputName = argument('out', 'world-continuity');
if (!/^[a-z0-9/-]+$/.test(outputName)) throw new Error('Invalid --out value.');
const tag = argument('tag', 'baseline');
if (!/^[a-z0-9-]+$/.test(tag)) throw new Error('Invalid --tag value.');
const captureSet = argument('set', 'presets');
if (!['presets', 'boundary'].includes(captureSet)) throw new Error('Invalid --set value.');
const scenario = argument('scenario', 'encounter');
if (!['calm', 'encounter', 'obstacles'].includes(scenario)) throw new Error('Invalid --scenario value.');
const times = numbersArgument('times', '17,43,52,63');
if (times.length === 0 || times.some((value) => value < 0)) throw new Error('Invalid --times value.');
const boundaryTime = Number.parseFloat(argument('boundary-time', '17'));
if (!Number.isFinite(boundaryTime) || boundaryTime < 0) throw new Error('Invalid --boundary-time value.');
const target = tupleArgument('target', '-2,9,0');
const distance = Number.parseFloat(argument('distance', '90'));
if (!Number.isFinite(distance) || distance <= 0) throw new Error('Invalid --distance value.');
const azimuths = numbersArgument('azimuths', '0,45,90,135,180,225,270,315');
const polarDegrees = numbersArgument('polar-degrees', '84,89,94');
if (polarDegrees.length < 1) throw new Error('--polar-degrees needs at least one angle.');
const uiMode = argument('ui', 'environment');
if (!['environment', 'full'].includes(uiMode)) throw new Error('Invalid --ui value.');
const captureMode = argument('capture', 'sheet');
if (['sheet', 'canvas', 'page'].includes(captureMode) === false) throw new Error('Invalid --capture value.');
if (captureMode !== 'page' && uiMode === 'full') {
  throw new Error('--capture=sheet|canvas captures the WebGL canvas only; use --ui=environment.');
}
const sheetColumns = Math.max(1, Number.parseInt(argument('sheet-cols', '4'), 10));
const sheetRows = Math.max(1, Number.parseInt(argument('sheet-rows', '3'), 10));
const sheetWidth = Math.max(1, Number.parseInt(argument('sheet-width', '1920'), 10));
const sheetHeight = Math.max(1, Number.parseInt(argument('sheet-height', '1080'), 10));
const width = Number.parseInt(argument('width', '1440'), 10);
const height = Number.parseInt(argument('height', '900'), 10);
const port = Number.parseInt(argument('port', '5195'), 10);
const extraQuery = argument('extra-query', '');
const captureExtras = argument('extras', '1') === '1';
const captureFree = argument('free', '1') === '1';
const cameraModes = argument('modes', 'overview,school,predator')
  .split(',')
  .filter((mode) => ['overview', 'school', 'predator'].includes(mode)) as CameraMode[];
if (cameraModes.length === 0) throw new Error('--modes needs at least one preset camera.');
const lightingArgument = argument('lighting', 'full');
if (lightingArgument !== 'full' && lightingArgument !== 'base') throw new Error('Invalid --lighting value.');
const shadowsEnabled = argument('shadows', '1') === '1';
const visualTimeOverride = Number.parseFloat(argument('visual-time', 'NaN'));

const startedAt = Date.now();
const stage = (message: string) => console.log(`[world ${((Date.now() - startedAt) / 1000).toFixed(1)}s] ${message}`);
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const artifacts = `${projectRoot}test-artifacts/${outputName}`;
mkdirSync(artifacts, { recursive: true });

const server = await createServer({
  root: projectRoot,
  cacheDir: join(projectRoot, 'node_modules', '.vite-world', `world-continuity-${port}`),
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
});
await server.listen();
stage(`vite server listening on ${port}`);

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors: string[] = [];
const entries: Record<string, unknown>[] = [];

try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(180000);
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  stage('page.goto');
  await page.goto(`http://127.0.0.1:${port}/?scenario=${scenario}&lighting=${lightingArgument}${extraQuery ? `&${extraQuery}` : ''}`, {
    waitUntil: 'networkidle',
  });
  await page.waitForFunction(() => (
    window as unknown as { __blueCurrent?: DebugApi }
  ).__blueCurrent?.ready === true);
  stage('app ready');

  await page.evaluate(({ id }) => {
    const api = (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent;
    api.pause();
    api.setScenario(id);
    api.setViewMode('observation');
    api.setGridVisible(false);
  }, { id: scenario });

  if (uiMode === 'environment') {
    await page.addStyleTag({
      content: `
        .masthead,
        .control-panel,
        .panel-scrim,
        .viewport-topbar,
        .depth-rail,
        .predator-watch,
        .scene-caption,
        .telemetry-strip,
        .scene-search-state,
        .viewport-vignette,
        .capture-toast {
          display: none !important;
        }
        .workspace {
          display: block !important;
          padding: 0 !important;
        }
        .viewport-shell {
          position: fixed !important;
          inset: 0 !important;
          border-radius: 0 !important;
        }
      `,
    });
  } else {
    await page.locator('#panel-toggle').click();
    await page.waitForFunction(() => (
      document.querySelector('.observatory')?.classList.contains('panel-closed') === true
    ));
  }

  if (!shadowsEnabled) {
    await page.evaluate(() => (
      window as unknown as { __blueCurrent: DebugApi }
    ).__blueCurrent.setShadowMapEnabled(false));
  }

  // Freeze the animation loop. Every capture below draws synchronously through
  // a debug call, so no wall-clock frame can leak into the evidence.
  await page.evaluate(() => {
    (window as unknown as { requestAnimationFrame: (callback: FrameRequestCallback) => number })
      .requestAnimationFrame = () => 0;
  });
  await page.waitForTimeout(500);
  stage('render loop frozen');

  const currentDiagnostics = () => page.evaluate(() => (
    window as unknown as { __blueCurrent: DebugApi }
  ).__blueCurrent.getDiagnostics());

  const advanceTo = async (seconds: number) => {
    const diagnostics = await currentDiagnostics();
    const targetStep = Math.round(seconds * 60);
    const currentStep = Math.round(diagnostics.simulationTime * 60);
    const count = targetStep - currentStep;
    if (count > 0) {
      await page.evaluate((steps) => (
        window as unknown as { __blueCurrent: DebugApi }
      ).__blueCurrent.step(steps), count);
    }
    await page.evaluate((time) => (
      window as unknown as { __blueCurrent: DebugApi }
    ).__blueCurrent.setVisualTime(time), visualTimeOverride >= 0 ? visualTimeOverride : seconds);
    stage(`simulation time ${seconds}s ready`);
  };

  const snapshot = async (label: string) => {
    const state = await page.evaluate(() => (
      window as unknown as { __blueCurrent: DebugApi }
    ).__blueCurrent.getSimulationSnapshot());
    writeFileSync(`${artifacts}/${label}.json`, `${JSON.stringify(state, null, 2)}\n`);
  };

  const writeShot = async (filename: string, metadata: Record<string, unknown>) => {
    if (captureMode === 'canvas') {
      const result = await page.evaluate(() => {
        const api = (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent;
        const diagnostics = api.step(0);
        const canvas = document.querySelector('canvas');
        if (!canvas) throw new Error('Missing WebGL canvas.');
        return { diagnostics, dataUrl: canvas.toDataURL('image/png') };
      });
      const prefix = 'data:image/png;base64,';
      if (!result.dataUrl.startsWith(prefix)) throw new Error('Canvas capture did not return PNG data.');
      writeFileSync(
        `${artifacts}/${filename}.png`,
        Buffer.from(result.dataUrl.slice(prefix.length), 'base64'),
      );
      entries.push({
        file: `${filename}.png`,
        cameraPosition: result.diagnostics.cameraPosition,
        cameraTarget: result.diagnostics.cameraTarget,
        cameraDistance: result.diagnostics.cameraDistance,
        maxCameraDistance: result.diagnostics.maxCameraDistance,
        simulationTime: result.diagnostics.simulationTime,
        fishCount: result.diagnostics.fishCount,
        captures: result.diagnostics.captures,
        predatorState: result.diagnostics.predatorState,
        drawCalls: result.diagnostics.drawCalls,
        renderTriangles: result.diagnostics.renderTriangles,
        ...metadata,
      });
      stage(`captured ${filename} (canvas)`);
      return;
    }
    const diagnostics = await page.evaluate(() => {
      const api = (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent;
      return api.step(0);
    });
    await page.screenshot({
      path: `${artifacts}/${filename}.png`,
      fullPage: true,
      timeout: 120000,
    });
    entries.push({
      file: `${filename}.png`,
      cameraPosition: diagnostics.cameraPosition,
      cameraTarget: diagnostics.cameraTarget,
      cameraDistance: diagnostics.cameraDistance,
      maxCameraDistance: diagnostics.maxCameraDistance,
      simulationTime: diagnostics.simulationTime,
      fishCount: diagnostics.fishCount,
      captures: diagnostics.captures,
      predatorState: diagnostics.predatorState,
      drawCalls: diagnostics.drawCalls,
      renderTriangles: diagnostics.renderTriangles,
      ...metadata,
    });
    stage(`captured ${filename}`);
  };

  const renderFreePose = async (position: [number, number, number], poseTarget: [number, number, number]) => {
    await page.evaluate(({ position: cameraPosition, target: cameraTarget }) => {
      const api = (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent;
      api.setCameraPose(cameraPosition, cameraTarget);
    }, { position, target: poseTarget });
  };

  const writeSheet = async (
    filename: string,
    poses: readonly CameraPose[],
    columns: number,
    rows: number,
    width: number,
    height: number,
    metadata: Record<string, unknown>,
  ) => {
    const result = await page.evaluate(({ sheetPoses, sheetCols, sheetRows, sheetW, sheetH }) => {
      const api = (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent;
      const dataUrl = api.captureCameraSheet(sheetPoses, sheetCols, sheetRows, sheetW, sheetH);
      return { dataUrl, diagnostics: api.getDiagnostics() };
    }, {
      sheetPoses: poses,
      sheetCols: columns,
      sheetRows: rows,
      sheetW: width,
      sheetH: height,
    });
    const prefix = 'data:image/png;base64,';
    if (!result.dataUrl.startsWith(prefix)) throw new Error('Camera sheet did not return PNG data.');
    writeFileSync(
      `${artifacts}/${filename}.png`,
      Buffer.from(result.dataUrl.slice(prefix.length), 'base64'),
    );
    entries.push({
      file: `${filename}.png`,
      sheet: true,
      columns,
      rows,
      width,
      height,
      poses,
      drawCalls: result.diagnostics.drawCalls,
      renderTriangles: result.diagnostics.renderTriangles,
      simulationTime: result.diagnostics.simulationTime,
      fishCount: result.diagnostics.fishCount,
      ...metadata,
    });
    stage(`captured ${filename} (${poses.length}-pose sheet)`);
  };

  if (captureSet === 'presets') {
    for (const time of times) {
      await advanceTo(time);
      await snapshot(`state-t${time.toFixed(2)}`);
      const poses: CameraPose[] = [];
      for (const mode of cameraModes) {
        const diagnostics = await page.evaluate((cameraMode) => {
          const api = (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent;
          api.setCameraMode(cameraMode);
          return api.settleCamera(2.4, 14);
        }, mode);
        poses.push({
          position: diagnostics.cameraPosition,
          target: diagnostics.cameraTarget,
        });
        if (captureMode !== 'sheet') {
          await writeShot(`${tag}-t${time.toFixed(2)}-${mode}`, { camera: mode, requestedTime: time });
        }
      }
      const azimuth = (45 * Math.PI) / 180;
      const polar = Math.PI / 2;
      const freePosition: [number, number, number] = [
        target[0] + distance * Math.sin(polar) * Math.sin(azimuth),
        target[1] + distance * Math.cos(polar),
        target[2] + distance * Math.sin(polar) * Math.cos(azimuth),
      ];
      if (captureFree) poses.push({ position: freePosition, target });
      if (captureMode === 'sheet') {
        if (captureFree) {
          await writeSheet(
            `${tag}-t${time.toFixed(2)}-presets-sheet`,
            poses,
            2,
            2,
            sheetWidth,
            sheetHeight,
            { cameraSet: [...cameraModes, 'free-max'], requestedTime: time },
          );
        }
      } else if (captureFree) {
        await renderFreePose(freePosition, target);
        await writeShot(`${tag}-t${time.toFixed(2)}-free-max`, {
          camera: 'free', requestedTime: time, pose: [freePosition, target],
        });
      }
      if (captureExtras && Math.abs(time - times[0]) < 1e-6) {
        const extras: CameraPose[] = [
          { position: [target[0], 55, target[2] + 0.1], target: [target[0], 6, target[2]] },
          { position: [target[0] + 60, 18, target[2]], target: [target[0], 9, target[2]] },
        ];
        if (captureMode === 'sheet') {
          await writeSheet(
            `${tag}-t${time.toFixed(2)}-free-views-sheet`,
            extras,
            2,
            1,
            sheetWidth,
            Math.floor(sheetWidth / 2 / (16 / 9)),
            { cameraSet: ['free-top', 'free-side'], requestedTime: time },
          );
        } else {
          for (const [index, extra] of extras.entries()) {
            await renderFreePose(extra.position, extra.target);
            await writeShot(`${tag}-t${time.toFixed(2)}-free-${index === 0 ? 'top' : 'side'}`, {
              camera: 'free', requestedTime: time, pose: [extra.position, extra.target],
            });
          }
        }
      }
    }
  } else {
    await advanceTo(boundaryTime);
    await snapshot(`state-t${boundaryTime.toFixed(2)}`);
    const poses: CameraPose[] = [];
    for (const polarDegree of polarDegrees) {
      for (const azimuthDegree of azimuths) {
        const azimuth = (azimuthDegree * Math.PI) / 180;
        const polar = (polarDegree * Math.PI) / 180;
        const position: [number, number, number] = [
          target[0] + distance * Math.sin(polar) * Math.sin(azimuth),
          target[1] + distance * Math.cos(polar),
          target[2] + distance * Math.sin(polar) * Math.cos(azimuth),
        ];
        poses.push({ position, target });
        if (captureMode !== 'sheet') {
          await renderFreePose(position, target);
          await writeShot(
            `${tag}-boundary-az${String(azimuthDegree).padStart(3, '0')}-polar${polarDegree}`,
            { camera: 'free', requestedTime: boundaryTime, pose: [position, target], polarDegree, azimuthDegree },
          );
        }
      }
    }
    if (captureMode === 'sheet') {
      const chunkSize = sheetColumns * sheetRows;
      for (let start = 0; start < poses.length; start += chunkSize) {
        const chunk = poses.slice(start, start + chunkSize);
        await writeSheet(
          `${tag}-boundary-sheet-${Math.floor(start / chunkSize) + 1}`,
          chunk,
          sheetColumns,
          sheetRows,
          sheetWidth,
          sheetHeight,
          {
            polarDegrees,
            azimuths,
            chunkPoses: chunk.length,
            order: 'rows top-to-bottom, each row left-to-right',
            requestedTime: boundaryTime,
          },
        );
      }
    }
  }

  writeFileSync(`${artifacts}/${tag}-${captureSet}.json`, `${JSON.stringify({
    scenario,
    captureSet,
    times,
    boundaryTime,
    target,
    distance,
    azimuths,
    polarDegrees,
    uiMode,
    renderer: 'SwiftShader software rendering; screenshots only, not hardware performance data.',
    entries,
    browserErrors: errors,
  }, null, 2)}\n`);
  if (errors.length > 0) throw new Error(errors.join('\n'));
} finally {
  if (process.env.BLUE_CURRENT_CAPTURE_FORCE_EXIT === '1') {
    process.exit(0);
  }
  await browser.close();
  await server.close();
}
