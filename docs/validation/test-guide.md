# Validation — Test Guide

> 核实日期：2026-11-12。当前通过状态读 `../CURRENT_STATE.md`；本文只维护运行方法、证据规则和环境注意事项。

## 核心命令

```bash
npm test                 # Vitest 全量
npm run test:watch      # 开发时监听
npx tsc --noEmit        # 独立类型检查
npm run build           # tsc --noEmit && vite build
npm run sim:regression  # 固定种子模拟回归
npm run smoke           # 基础 Playwright 桌面/移动 smoke
npm run smoke:rich      # 富默认场景
npm run accept:observatory
```

测试文件集中在 `tests/*.test.ts`。Vitest 配置排除依赖、`**/dist/**` 和 `.task-locks` 回滚副本；没有显式排除所有 `dist-*`，新增构建目录时不要在其中放测试副本。静态声明数与 `it.each` 展开后的运行数不同，报告以实际 runner summary 为准。

局部修改优先运行相关测试，再跑全量。不要用“之前 302/302”替代当前改动后的运行；原始日志应写入新的证据路径，并记录命令、开始时间、版本和失败项。

## 专项脚本

| 范围 | 入口示例 |
| --- | --- |
| CPU 网格/行为基准 | `npm run benchmark`、`npm run quality:benchmark`、`npm run benchmark:observatory` |
| Boids / Predator 实验 | `npm run experiment:ablation`、`npm run experiment:predator` |
| Reef Proxy 覆盖 | `npx tsx scripts/measure-reef-collision.ts --bins`；固定输出会覆盖 `proxy-coverage.json`，需要先备份旧证据。 |
| Sphere / ReefProxy 行为 | `npx tsx scripts/reef-collision-experiment.ts --mode=both --out=test-artifacts/reef-collision/<new>.json` |
| Reef Proxy Debug | `npx tsx scripts/reef-collision-capture.ts --serve-dist=<existing-dist>`；可用 `--only=<names>`，输出目录固定在脚本中。 |
| Reef 轮廓与构图 | `npx tsx scripts/reef-hierarchy-probe.ts --out=<name>`、`npx tsx scripts/reef-hierarchy-capture.ts --tag=<tag>` |
| 相机回归 | `npx tsx scripts/camera-regression.ts --out=<name>`；脚本会写入 `test-artifacts/<name>`。 |
| Predator 目标轨迹 | `npx tsx scripts/camera-target-switch.ts --out=<name>`；同样只需传目录名。 |
| 相机 CPU 数学 | `npx tsx scripts/camera-benchmark.ts` |
| 硬件 GPU | `npm run accept:gpu -- --channel=chrome`，详见 `performance.md`。 |

这些脚本不一定有 `--help` 实现；运行前读脚本顶部用法和参数解析。不要复用已不存在的构建目录，也不要让新实验覆盖旧 A/B/C 证据。

## 确定性与证据口径

固定时间点为 17 / 43 / 44.15 / 52 / 60 / 63 s。报告记录 URL、场景、种子、预热、视口、碰撞模式、资产前缀、构建和 renderer。Sphere 与 ReefProxy 分别双跑；不同脚本的 checksum 尾部可能混入不同状态，只有同口径值才能逐位比较。

代码事实、原始产物、文档声明、历史测量和推断分开写。`browserErrors=[]` 只说明该运行无记录错误，不等于视觉或性能通过。`invariants=[]` 也要说明覆盖哪些轨迹和统计范围。capture 文件存在不等于自动视觉回归通过。

SwiftShader 只能作功能与软件画面证据；真实硬件性能必须在 Windows 本机运行并读取 renderer。`renderMs`、模拟 step、障碍查询和相机数学分别属于不同 CPU 口径，GPU timestamp 未测写 N/A。

## 环境与运行注意事项

Windows 宿主安装的 `node_modules` 可能缺 Linux 可选原生包，Linux Playwright 浏览器和系统库也可能缺失。不要为了审计随意 `npm install` 或 `npm audit fix --force`；原生依赖应在独立临时目录解决，不改共享依赖和锁文件。

Vite cache 使用项目内路径，避免 `os.tmpdir()` 或硬编码 `/tmp` 引起 Windows ACL/并发问题。Windows 临时目录被清理或 ACL 限制时，将 `TEMP`/`TMP` 指向项目 `.tmp`；挂载盘无法删除 dist 时使用独立 outDir 或由用户清理，不强行删除。

SwiftShader 页加载和 shader 编译很慢，静态 dist 捕获通常比 dev graph 便宜。捕获可使用当前脚本支持的 freeze/force-exit 环境变量，但每个脚本是否支持要先确认。Vitest、Playwright/SwiftShader 和 Blender 烘焙串行执行，长采集分段并保存进度。

## 新证据目录最低内容

每次正式验收使用独立目录，保存命令与日志、结果 JSON、必要截图和 summary。summary 写明版本、场景、参数、renderer、通过/失败项、已知限制和原始文件索引；无 Git 时同时保存源码/资产 manifest。任务完成后只更新受影响的 `../CURRENT_STATE.md`、`performance.md` 或 `visual-baseline.md`。
