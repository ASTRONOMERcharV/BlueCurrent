# Blue Current 礁群、空间层次与生态构图

日期：2026-11-11  
范围：主从礁群、水道负空间、Overview 取景、远中近景、School/Predator 生态叙事机位。  
验证边界：Linux + SwiftShader 软件渲染；不作为硬件 GPU 性能证据。  
外部评审参数包：[`REEF_COMPOSITION_PARAMETERS.md`](REEF_COMPOSITION_PARAMETERS.md)。

## 1. 目标与约束

本轮针对三个视觉问题：五块礁石都像同高石柱、中央细节拥挤而水道不清楚、Overview/School/Predator 没有清楚分工。

约束保持不变：

- 不修改 Boids、捕食者 FSM、固定 60 Hz 步进或鱼群初始状态。
- 5 个 `REEF_OBSTACLES` 的中心和半径完全不变；主要水道沿用既有碰撞球之间的真实净距。
- 91 株海带及其共享 `kelpLayout` 不变；48 个 full-tier 珊瑚、5 个礁体、10 个中景和 12 个远景装饰实例数量不变。
- 目标鱼构图直接读取 `world.predator.targetIndex` 和真实鱼位置，不为截图改变追逐关系。
- 不调整水体、曝光、太阳/补光配置；空间层次来自体量、位置、朝向和镜头。

## 2. 当前礁群主从关系

| ID | 角色 | 锚点 / 碰撞球（不变） | 运行时本地目标尺寸：高 × 宽 × 深 | 朝向 / 倾斜 |
|---|---|---|---|---|
| hero | 唯一高主礁 | 2，r 3.6 m | **9.40 × 7.00 × 6.30 m** | yaw -16°，直立 |
| b / Spire | 次级尖礁 | 0，r 3.4 m | 6.30 × 6.20 × 5.50 m | yaw -30°，tilt 1.5° / -4° |
| d / Twin | 次级双柱礁 | 3，r 3.2 m | 6.70 × 6.10 × 5.20 m | yaw 76°，tilt 1° / 4° |
| c / Platform | 低矮横向平台 | 1，r 3.5 m | **4.30 × 7.00 × 5.80 m** | yaw 16°，tilt -2° / 3° |
| e / Terraces | 低矮退台 | 4，r 3.4 m | **4.90 × 6.80 × 6.00 m** | yaw -38°，tilt -1.5° / -3.5° |

主礁比任一次礁至少高 35%。Platform 和 Terraces 的宽高比分别约 1.63 和 1.39，不再被纵向拉成高柱。次礁的小幅倾斜有更大嵌入深度，主礁保持直立，形成稳定视觉锚点。

`ReefSample` 新增的是渲染层 Euler 倾斜；`Environment` 和变体预览使用同一组参数。资产 GLB、LOD 三角形和附着体资产未重建。

既有主要碰撞球间净距仍大于 4 m；降低次礁高度后，这些间隙在 Overview 中成为可见水道，而不是另造一套与避障不一致的视觉通道。

### 珊瑚层级

full-tier 仍保留 48 个个体，但按障碍锚点使用主从缩放：B/C/Hero/D/E = `0.78 / 0.62 / 1.0 / 0.74 / 0.66`。低礁旁的珊瑚不再盖住横向轮廓。前景枝状/扇形等珊瑚继续作为框景，但按物种缩小到原前景尺度的 68%–90%。位置随机流和实例数量不变。

## 3. Overview 与空间层次

共享机位常量：

```ts
OVERVIEW_CAMERA_POSITION = [30, 18, 29]
OVERVIEW_CAMERA_TARGET = [0, 6.5, -2]
```

相对旧机位 `(28,18,31) → (-2,9,0)`，相机与目标一起向右平移，同时降低观察目标。当前 1556×932 画布上 Hero 由旧投影约 60.4% 宽度处移到 56.5%，仍略偏右但更接近中心；顶部空水减少，礁石底脚与底部 HUD 之间出现安全区。`SceneManager` 首帧也使用同一常量，避免加载后跳变。

前景 observation 侧的浅色沙丘在随机拒绝采样完成后缩小到 0.68 倍，因此不改变其他岩石位置或随机调用序列。

远中小景从独立散点改为每组“较大主岩块 + 较低伴生块”：中景 4 组共 10 个，远景 4 组共 12 个。实例仍通过 `terrainHeightAt` 落地并嵌入；提高纵向轮廓、限制横向跨度，避免成组后读成扁平圆盘。装饰随机种子与生态模拟随机流仍完全分离。

## 4. School / Predator 生态叙事

### School

- 前导偏移由 1.4 m 降为 0.6 m，减少主群被推到画面左侧的问题。
- 跟随距离由 21 m 增至 23.5 m，侧向/高度偏移为 9/9.5 m。
- 17 s 同状态投影中，画面内主鱼群从 418/499（83.8%）提高到 438/499（87.8%）。这是取景覆盖率，不是生态指标。

### Predator

- pursuit/attack 且目标存活时，用目标鱼与鲨鱼的相对方向组织镜头；两者位置都按渲染 alpha 插值。
- 前导量为 `clamp(distance × 0.45, 2.2, 5)`；后退距离为 `13.5 + min(6, distance × 0.3)`，有上限，避免目标很远时鲨鱼过小。
- patrol/search 或无有效目标时回退到速度方向跟随。
- 调试诊断新增 `predatorTargetIndex` / `predatorTargetPosition`；无目标时为 `null`，不伪造目标。
- 没有添加 Observation 瞄准圈。投影验收显示目标已在中心区域，因此不引入游戏化准星。

## 5. 工程与真实状态验证

- `npx vitest run --isolate=false`：**35 个测试文件 / 240 tests 全部通过**。
- `npx tsc --noEmit`：通过。
- `npx vite build --outDir dist-final --emptyOutDir`：通过；仅有既有大 chunk 提示。
- `npx tsx scripts/simulation-regression.ts`：`deterministic=true`。
- `ObstacleSystem.ts`、`SimulationConfig.ts`、`BoidSystem.ts`、`SimulationWorld.ts`、`kelpPlacement.ts` 修改前后 SHA-256 一致。

| 时间 | 状态 | 浏览器 checksum | Headless checksum | 目标与鲨鱼投影 |
|---|---|---|---|---|
| 17 s | pursuit | `e9343dcdbe6cd223e385070e` | 同左，匹配 | 均在画面内 |
| 43 s | patrol | `e1f550b70d0e227bac3d2b65` | 同左，匹配 | 无目标；鲨鱼在画面内 |
| 52 s | search | `b33d33b9d92750242a6155b4` | 同左，匹配 | 无目标；鲨鱼在画面内 |
| 60 s | pursuit | `a372c9c009f241376a3ec0fd` | 同左，匹配 | 均在画面内 |
| 63 s | pursuit | `b6009e0c302fb03e31fc9842` | 同左，匹配 | 均在画面内 |

17 s 目标鱼投影像素约 `(432,248)`、鲨鱼约 `(361,319)`（800×560 环境捕获）。60/63 s 重新获取目标后也保持双方在画面内。所有最终 lighting 捕获和 UI 诊断的 `browserErrors` 均为空。

1920×1080 带完整 Observation console 的 UI 截图已检查：主礁、次礁、低礁与底部指标条安全区可读。该次 UI 捕获在 SwiftShader 浏览器关闭阶段触发 shell 超时，但 PNG 与诊断已完整写盘、`browserErrors=[]`；不把它算作一次完整 browser smoke。

## 6. 证据

目录：`test-artifacts/reef-composition/`

- `composition-contact-sheet.png`：Overview / School / Predator 的 Before-After 联系表。
- `before-overview.png`：本轮前 Overview。
- `after-reef-final-overview.png`：仅完成主从礁石后的 Overview。
- `narrative-t17-final-overview.png` / `-school.png` / `-predator.png`：17 s 三种最终机位。
- `final-t43-final-*.png`、`final-t52-final-*.png`：43/52 s 三机位。
- `final-t60-final-predator.png`、`final-t63-final-predator.png`：重新 pursuit 后的目标机位。
- `final-ui-overview-1920x1080.png`：完整 UI 验收图。
- `framing-metrics.json`：School 改造前后覆盖率及 17 s 目标投影。
- `final-validation-metrics.json`：五个时间点的状态、目标投影、浏览器/headless 校验和。
- `final-ui-overview-diagnostics.json`：完整 UI 对应的真实诊断。

回滚原件：`.task-locks/backups/reef-composition-20261111-092259/`。

## 7. 未完成与后续门禁

1. **硬件 GPU 视觉与性能仍未验收**：需要在 Windows/Iris Xe 上检查默认富场景、近中远 LOD、180 s 采样和 30 分钟稳定性。
2. 旧光照基线中的相机和装饰布局已被本轮有意替换；后续光照 A/B 必须建立同版新基线，不能要求与旧图像逐像素一致。`?lighting=base` 的逻辑未改。
3. 远景装饰的接地与对比仍应在本机 GPU 上复核；SwiftShader 图只能证明布局与功能。
4. 63 s 等近垂直追逐会自然出现正面向鲨鱼，这是目标方向取景的结果，没有为固定侧脸构图而扭曲行为。
