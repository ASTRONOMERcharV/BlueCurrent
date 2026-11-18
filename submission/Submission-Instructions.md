# Blue Current 提交说明

提交日期：2026-11-15  
课程：计算机动画  
作者：孙嘉泽（3230104713）

## 课程要求对应

| 课程要求 | 提交文件 |
| --- | --- |
| 源程序 | `BlueCurrent.zip` |
| 运行程序 | `BlueCurrent-Run.zip` |
| 实验报告 | `Report.pdf` |
| 演示视频（附加） | `Demo.mp4` |

## 提交文件

| 文件 | 内容 |
| --- | --- |
| `BlueCurrent.zip` | **源程序**。26 MB、365 个文件，压缩包内顶层文件夹为 `BlueCurrent/`：清理后的最小集合，含 `src/`、`public/` GLB 资产、`tests/`、4 个 checksum/回归脚本、配置与 README；已移除 `preview/` 和其余开发脚本。 |
| `BlueCurrent-Run.zip` | **运行程序**。26 MB 预构建包，含 `dist/`、本地静态服务器和启动脚本；解压后双击 `start.bat`（Windows）或执行 `bash start.sh` 即可运行，不需要 `npm install`。 |
| `Report.pdf` | **实验报告**。24 页 A4，2026-11-15 更新版。保留初版三项受控实验，新增第 3.3 节核心算法代码实现与第 3.4 节提交版运行画面。 |
| `Demo.mp4` | 1280×720、25 fps、49.6 s 的当前构建硬件录制。片头 + 实时鱼群、捕食者追逐、群体重组、Laboratory 网格诊断 + 片尾。 |
| `BlueCurrent-Full.zip` | 本地备用归档，90 MB：在精简源码集合之外还含 `docs/`、`screenshots/`、`benchmarks/`。不用于提交时保留在本地即可。 |

## 运行方式

### 直接运行（运行程序包）

解压 `BlueCurrent-Run.zip` 后：

- Windows：双击 `start.bat`。
- macOS / Linux：执行 `bash start.sh`。

脚本会启动本地服务器并自动打开浏览器；若没有自动打开，访问 `http://localhost:4173`。需要 Node.js 18+，不需要 `npm install`，不访问网络。端口被占用时可设置 `PORT` 环境变量。

### 从源码运行

```bash
npm ci
npm run build
npm run preview
```

用打印出的 HTTP 地址打开页面，不要直接双击 `index.html`。Node.js 22+ 推荐；默认 `/` 场景为 500 主鱼 + 100 小丑鱼 + 1 条 rigged 鲨鱼捕食者，本地 GLB 资产已包含在 `public/models/`。

## 当前验证摘要

- 全量 Vitest：**52 文件 / 400 tests 通过**；`tsc --noEmit`、生产构建通过。
- 预构建运行包已在本机 Chromium 中加载：`window.__blueCurrent.ready === true`，0 个 console error；静态服务器对 `index.html`、JS 和 GLB 均返回 200。
- 固定种子 encounter checksum fixture：五个 D026 动态 checksum 与 PRE_E2 旧基线逐位一致；`npm run sim:regression` 与 `npm run fixture:checksums` 通过。
- 硬件环境：Windows 11、Chrome 157、Intel Iris Xe Graphics D3D11、1280×720、DPR 1。
- 标准档 500+100+1、telemetry-off：P50 12.0/12.1/12.1 ms、P95 18.2/18.2/18.3 ms、0 dropped，三次均满足本项目设定的实时运行验收条件（P50 ≤ 16.7 ms、P95 ≤ 33 ms、0 dropped）；另一次复测 r3 出现热漂移（P50 18.2 ms、P95 30.2 ms、0 dropped）。
- F2 第一轮位相同 CPU 优化：500/1000/2000 主鱼 wall mean 约 −3%，checksum 不变；标准档优化后复核仍达 D028。
- pressure/extreme 仍为 1 捕食者代理，pressure telemetry-off 有 cadence decay；1440×900 的诊断 gate 一次尝试为 `INVALID`（运行中 Chrome 干扰 + 整机漂移），未作为验收结论。1280×720 是唯一 D028 验收视口。

## 清理结果

- 移除 56 个开发脚本，只保留 `simulation-checksum-lib.ts`、`simulation-regression.ts`、`checksum-fixture.ts`、`phase-f-gate-rule.ts`。
- 移除 `preview/` 的 13 个页面与 `src/preview/` 的 9 个模块，以及 `package.json` 中 40 个演示、基准、浏览器验收命令。
- 清理后的包已独立执行 `npm run build` 与 `npm test`：构建通过，52 文件 / 400 tests 通过。

## 说明与限制

- 视频中的实时 FPS 读数受屏幕录制、后台 Chrome 与整机负载影响，**不作为性能基准**；性能结论以报告 4.3 节和原始证据为准。
- 精简源码包未包含 `node_modules/`、`dist*/`、`test-artifacts/`（约 1.5 GB 原始证据）、`assets_src/`（约 207 MB Blender 工程源文件）、`docs/`、`screenshots/` 和 `benchmarks/`；运行所需的 GLB 资产均在 `public/models/`。预构建运行包单独包含 `dist/`。
- 精简包已验证：解压到空目录后 `npm run build` 成功；项目测试与 checksum 结果见上面的验证摘要。
- 本项目是 Three.js/WebGL + CPU 模拟，不是 WebGPU Compute；当前生态范围是单捕食者 + 主鱼群 + 小丑鱼群，不宣称多捕食者食物网或写实海底。
