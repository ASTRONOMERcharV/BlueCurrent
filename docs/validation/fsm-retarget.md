# Validation — Predator FSM Retarget Change

> 核实日期：2026-11-12。本文件记录“允许 direct index→index”的当前行为变更、证据和 Gate 影响；长期决策见 `../DECISIONS.md` D015。

## 变更

旧 `PredatorSystem` 只在 `patrol/search` 获取目标，所有切换都经过 `null`。2026-11-12 用户决定修改 FSM，新增 `pursuit` 中的直接重选：

- 每 0.35 s retarget 窗口检查。
- 新候选必须通过相同的 detection radius、礁石和海带视线过滤。
- 新目标距离 < 当前目标距离 × `predatorRetargetAdvantage`（默认 0.85，至少近 15%）。
- 当前目标必须在 attack radius 外；attack 不换目标。
- 切换后重置 `stateTime`。

## 当前证据

| 项目 | 结果 | 文件 |
| --- | --- | --- |
| Predator 单元测试 | 5/5 | `test-artifacts/fsm-retarget/2026-11-12T14-05-00Z/predator-tests.log` |
| 全量 Vitest | 39 文件、304/304 | 同目录 `vitest.log` |
| `tsc --noEmit` | exit 0 | `tsc.log` |
| 生产构建 | 128 文件、33,454,274 B、`1095005d…bb3284` | `build-retry.log`、`dist.sha256` |
| 模拟回归 | `deterministic=true`；五个 checksum 全变 | `sim-regression.log`、`regression-diff.json` |
| CPU 300 s 探针 | 139 次切换，42 direct，97 null-mediated | `probe/target-index-probe.json` |
| 浏览器 0–30 s | 11 次切换，4 direct，0 错误，`passed=true` | `browser/browser-target-switch.json` |

浏览器 direct 时间：5.083 / 12.417 / 12.783 / 30.383 s；对应状态均为 `pursuit`，前一目标 `aliveBefore=true`。最小相机净空 1.100 m，最大角变化 0.1164，最大垂直比 0.99999。

## 回归影响

`regression-diff.json` 记录 17/43/52/60/63 s 的旧/新 checksum；43–63 s 的 alive 从 498 降至 496。300 s CPU 探针的 captures 从旧 FSM 的 18 增至 25。这些都是预期行为变化，不是确定性失败；旧 WP1–WP4 的 checksum、截图和硬件数据均基于 pre-FSM 源码，不能复用。

## Gate 状态

**未通过。** 旧 WP0 源码锁因三个文件变更而失效。当前源码的新 WP0 run 为 `test-artifacts/integration-abc/2026-11-12T14-30-00Z/`；下一步必须在该锁上重跑：

1. WP1 构建/回归、WP2 碰撞、WP3 相机/UI、WP4 硬件/长时观察。
2. 决定 0.85 阈值和增加的捕获率是否可接受。

## 限制

- 浏览器样本使用 Vite dev server + SwiftShader，不是硬件 GPU 或 production dist。
- 0.85 是本次实现选择；尚未做视觉调参或长期稳定性复测。
- 第一次构建因 Windows esbuild 临时目录 ACL 失败；以项目 `.tmp` 重试成功。
- 未创建 commit、push 或 Git tag。
