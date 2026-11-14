# Validation — Test Guide

> 核实日期：2026-11-14。当前通过状态读 `../CURRENT_STATE.md`；本文只维护运行方法、证据规则和环境注意事项。

## 核心命令

```bash
npm test                 # Vitest 全量
npm run test:watch      # 开发时监听
npx tsc --noEmit        # 独立类型检查
npm run build           # tsc --noEmit && vite build
npm run sim:regression  # 固定种子模拟回归
npm run sim:regression -- --school-dynamics=legacy --habitat=legacy  # E2/E4 回滚对照
npm run smoke           # 基础 Playwright 桌面/移动 smoke
npm run smoke:rich      # 富默认场景
npm run accept:observatory
```

测试文件集中在 `tests/*.test.ts`。Vitest 配置排除依赖、`**/dist/**`、`.claude/**` 嵌套 worktree 与 `.task-locks` 回滚副本；没有显式排除所有 `dist-*`，新增构建目录时不要在其中放测试副本。备份测试文件必须改名为 `.test.ts.bak` 等非 `.test.ts` 后缀；`test-artifacts/` 下的 `.test.ts` 备份会被收集并因相对导入失败。静态声明数与 `it.each` 展开后的运行数不同，报告以实际 runner summary 为准。

局部修改优先运行相关测试，再跑全量。不要用“之前 365/365”替代当前改动后的运行；原始日志应写入新的证据路径，并记录命令、开始时间、版本和失败项。

## 专项脚本

| 范围 | 入口示例 |
| --- | --- |
| CPU 网格/行为基准 | `npm run benchmark`、`npm run quality:benchmark`、`npm run benchmark:observatory` |
| CPU 网格 A/B（Phase F F2） | `npm run benchmark -- --counts=500,1000,2000 --modes=grid --steps=150 --warmup=30 --repeats=4`；`--modes` 可只跑 `grid` 或 `brute-force`。每行输出 wall `mean ms`、`cpu ms`（`process.cpuUsage` delta）、P95、neighbors 与 candidates，写入 `benchmark/latest-results.json`/`.csv`。这是 Node 主线程的 CPU 模拟基准，不是浏览器/GPU 帧率；绝对值受电源方案和频率漂移影响，同版 A/B 必须固定电源方案、交替运行并先做丢弃预热。 |
| Boids / Predator 实验 | `npm run experiment:ablation`、`npm run experiment:predator` |
| Reef Proxy 覆盖 | `npx tsx scripts/measure-reef-collision.ts --bins`；固定输出会覆盖 `proxy-coverage.json`，需要先备份旧证据。 |
| Sphere / ReefProxy 行为 | `npx tsx scripts/reef-collision-experiment.ts --mode=both --out=test-artifacts/reef-collision/<new>.json` |
| Reef Proxy Debug | `npx tsx scripts/reef-collision-capture.ts --serve-dist=<existing-dist>`；可用 `--only=<names>`，输出目录固定在脚本中。Windows 下当前脚本的静态服务器 `rootPrefix` 会混用路径分隔符，导致 `dist/assets` 403；`waitForFunction` 的 options 也被当作 arg。WP2 使用 `test-artifacts/integration-abc/2026-11-12T08-22-20Z/wp2/tools/reef-collision-capture.win.ts` 修补副本，未改源码。 |
| Reef 轮廓与构图 | `npx tsx scripts/reef-hierarchy-probe.ts --out=<name>`、`npx tsx scripts/reef-hierarchy-capture.ts --tag=<tag>` |
| 相机回归 | `npx tsx scripts/camera-regression.ts --out=<name>`；脚本会写入 `test-artifacts/<name>`。WP3 观察到写出 JSON 后 Vite 进程可能不退出，文件完整后需停止。 |
| Predator 目标轨迹 | `npx tsx scripts/camera-target-switch.ts --out=<name>`；同样只需传目录名。固定 34.5–38.5 s；更长的死亡/重新捕获窗口使用 `wp3/tools/camera-target-switch-long.ts`。 |
| Predator FSM direct retarget | `npx tsx test-artifacts/fsm-retarget/2026-11-12T14-05-00Z/tools/target-index-probe.ts --seconds=300`；浏览器样本用同目录 `tools/browser-target-switch.ts --start=0 --seconds=30 --port=5217`。 | CPU 300 s：139 次切换、42 direct；浏览器 0–30 s：4 direct、0 错误。当前 FSM 允许 pursuit 直接重选；旧 `gate-target-index` 为 pre-FSM 对照。 |
| 相机 CPU 数学 | `npx tsx scripts/camera-benchmark.ts` |
| Observatory UI acceptance | `npm run accept:observatory -- --stage=<desktop|scenarios|checks|mobile|all>`；当前脚本已改为与 48 珊瑚默认场景一致，并在全珊瑚页前释放主页面 GL 上下文；2026-11-14 全套 `all` 通过（`passed=true`、`browserErrors=[]`）。旧 WP3 修补副本与超时记录只作历史。 |
| E2 结构捕获 | `npx tsx scripts/school-structure-capture.ts --mode=dynamic|legacy --out=<dir> --seconds=70 --step=30`；固定世界机位，输出事件帧、五时间点固定帧与结构 JSON。`--channel=chrome --headed=1 --software=0` 切换硬件。`--out` 可传完整 `test-artifacts/...` 或相对目录名。 |
| E4 栖息/沙尘捕获 | `npx tsx scripts/e4-capture.ts --kind=habitat|sediment --mode=<anemone|legacy|on|off> --out=<dir>`；habitat 用 reef-0 海葵机位，sediment 用 school 下方低机位并推进 90 个 1/30 s tick。硬件同上。 |
| 硬件 GPU | `npm run accept:gpu -- --channel=chrome`，详见 `performance.md`。 |
| Phase F 四档基线 | `npm run baseline:phase-f -- --row=standard --repeats=3 --cooldown-ms=90000 --append=1 --headed=1 --channel=chrome --out=test-artifacts/phase-f/<UTC>/rows`；`--rows=none --spot=1 --control=1` 只跑 1440×900 spot 与 telemetry-off 对照；`--quick=1` 做短探针。D028 验收用 `--telemetry=0` 跑 standard 3 repeats；`--telemetry=1` 只作 GPU/分项诊断。harness 的聚合表现在包含 telemetry-off 样本；仿真/渲染分项表仍只在 `--telemetry=1` 时产生。每个 sample 新页面并固定计数/相机/预热；pressure/extreme 目标 3/5 捕食者但当前只测 1 捕食者代理（D027）。采样前关闭动态壁纸和并发重负载，保持显示唤醒，数值与限制只在 `performance.md` 维护。 |
| 硬件 180 s / 30 分钟 | WP4 使用 `test-artifacts/integration-abc/2026-11-12T08-22-20Z/wp4/tools/hardware-monitor-180s.mjs`、`hardware-monitor-30min.mjs`；headed Chrome、`channel=chrome`、拒绝 SwiftShader，输出 `hardware-180s.json` / `hardware-30min.json`。30 分钟分析用 `summarize-30min.mjs`。 |

这些脚本不一定有 `--help` 实现；运行前读脚本顶部用法和参数解析。不要复用已不存在的构建目录，也不要让新实验覆盖旧 A/B/C 证据。

## 确定性与证据口径

固定时间点为 17 / 43 / 44.15 / 52 / 60 / 63 s。报告记录 URL、场景、种子、预热、视口、碰撞模式、资产前缀、构建和 renderer。Sphere 与 ReefProxy 分别双跑；不同脚本的 checksum 尾部可能混入不同状态，只有同口径值才能逐位比较。

代码事实、原始产物、文档声明、历史测量和推断分开写。`browserErrors=[]` 只说明该运行无记录错误，不等于视觉或性能通过。`invariants=[]` 也要说明覆盖哪些轨迹和统计范围。capture 文件存在不等于自动视觉回归通过。

SwiftShader 只能作功能与软件画面证据；真实硬件性能必须在 Windows 本机运行并读取 renderer。`renderMs`、模拟 step、障碍查询和相机数学分别属于不同 CPU 口径，GPU timestamp 未测写 N/A。180 s / 30 分钟观察是单机长跑，不是满帧或压力矩阵；运行期间不要并行 SwiftShader/Playwright 捕获，避免污染硬件采样。

## 环境与运行注意事项

Windows 宿主安装的 `node_modules` 可能缺 Linux 可选原生包，Linux Playwright 浏览器和系统库也可能缺失。不要为了审计随意 `npm install` 或 `npm audit fix --force`；原生依赖应在独立临时目录解决，不改共享依赖和锁文件。

Vite cache 使用项目内路径，避免 `os.tmpdir()` 或硬编码 `/tmp` 引起 Windows ACL/并发问题。Windows 临时目录被清理或 ACL 限制时，将 `TEMP`/`TMP` 指向项目 `.tmp`；挂载盘无法删除 dist 时使用独立 outDir 或由用户清理，不强行删除。

SwiftShader 页加载和 shader 编译很慢，静态 dist 捕获通常比 dev graph 便宜。捕获可使用当前脚本支持的 freeze/force-exit 环境变量，但每个脚本是否支持要先确认。Vitest、Playwright/SwiftShader 和 Blender 烘焙串行执行，长采集分段并保存进度。

## 新证据目录最低内容

每次正式验收使用独立目录，保存命令与日志、结果 JSON、必要截图和 summary。summary 写明版本、场景、参数、renderer、通过/失败项、已知限制和原始文件索引；无 Git 时同时保存源码/资产 manifest。任务完成后只更新受影响的 `../CURRENT_STATE.md`、`performance.md` 或 `visual-baseline.md`。
