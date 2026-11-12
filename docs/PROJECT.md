# Blue Current — Project

> 核实日期：2026-11-12。项目定位与默认范围在此维护；当前完成情况读 `CURRENT_STATE.md`。

## 目标与定位

Blue Current 是一个浏览器内实时三维捕食者—猎物生态观测项目，也是 Computer Animation 课程项目的独立组成部分。它用局部规则生成群体运动，以真实捕食者状态机、礁石避障和海带庇护形成可观察行为，再通过科学观测仪器式 UI 展示和控制模拟。

项目目标不是播放预录动画，也不是用脚本安排捕食结果。Observation 与 Laboratory 共用同一个 `SimulationWorld`：前者强调场景与叙事机位，后者暴露参数、真实指标和诊断。任何呈现层功能都不得改写模拟事实。

## 当前默认范围

默认 `/` 是富场景：500 条主鱼、100 条独立小丑鱼、1 条 rigged shayu 捕食者、5 块礁石、48 个 `CoralScatter` 实例、91 株海带和 6 处细节海草。当前默认场景使用 B1 Hero/D 资产与 Experiment C 相机参数；同版 B1+C 的整合/视觉基线尚未建立。默认碰撞仍是 Sphere，SDF ReefProxy 通过 `?obstacleShape=reefProxy` 显式启用。

已有三条叙事观察路径 Overview、School、Predator，以及 Free/Orbit 交互相机。三个固定种子场景的显示名为 Calm、Encounter、Navigation；内部 ID 分别为 `calm`、`encounter`、`obstacles`，URL 使用 `?scenario=obstacles` 选择 Navigation。多捕食者完整生态、食物网、WebGPU Compute、正式演示视频和当前富默认硬件验收不属于已交付范围。

## 技术栈与运行边界

| 项目 | 当前实现 |
| --- | --- |
| 语言与构建 | TypeScript、Vite、Node.js；`npm run build` 先执行 `tsc --noEmit` 再构建。 |
| 渲染 | Three.js 0.180 / WebGLRenderer，InstancedMesh、部分 GLB LOD、单一路径水下 Shader。 |
| 模拟 | CPU 固定 60 Hz、SoA 双缓冲 Boids、Uniform Grid / Brute Force、捕食者 FSM。 |
| UI | 原生 DOM/CSS，Observation / Laboratory，不使用独立前端框架。 |
| 资产 | 本地 GLB 与纹理，Blender 生成/烘焙管线；运行时不依赖在线模型服务。 |
| 测试 | Vitest、无渲染 CPU 脚本、Playwright 浏览器 smoke/捕获、Windows 硬件 GPU 验收脚本。 |

Three.js/WebGL 是已实施的选型；原始“为何不选 WebGPU、Unity 等”的决策理由没有独立 ADR，不应事后虚构。技术约束和不可破坏边界见 `DECISIONS.md`。

## 入口与目录

生产入口为 `index.html → src/main.ts`。`src/simulation/` 拥有模拟，`src/spatial/` 提供邻居搜索，`src/environment/` 提供海流与庇护场，`src/rendering/` 负责 Three.js 和相机，`src/ui/` 负责观测台。`public/` 是运行时资产，`assets_src/` 是资产源与自动化，`scripts/` 是实验和验收，`tests/` 是 Vitest，`test-artifacts/` 是带版本风险的原始证据。

完整目录导航不需要每次读取；处理具体模块时按 `AGENTS.md` 的路由打开文件即可。

## 基本运行

```bash
npm ci
npm run dev
npm test
npm run build
```

推荐 Node.js 22。生产文件通过 HTTP 服务访问，不使用 `file://`。更多 URL 分层开关和资产预览命令见 `README.md` 与 `systems/assets.md`；当前验收命令见 `validation/test-guide.md`。

## 文档职责

`ARCHITECTURE.md` 记录稳定结构，`CURRENT_STATE.md` 记录会过期的状态，`ROADMAP.md` 记录阶段顺序，`DECISIONS.md` 记录长期决策，`systems/` 记录实现接口，`visual/` 记录美术与构图规范，`validation/` 记录证据和验收方法。旧阶段报告用于追溯，不再作为每次任务的默认入口。
