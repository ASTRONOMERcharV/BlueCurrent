# Blue Current 实验 C：动态相机稳定性

日期：2026-11-12
范围：Overview / School / Predator 三个观察相机；不修改鱼群、捕食者、地形、边界约束与 UI。

## 1. 结论

- School 与 Predator 共用同一套稳定参考系与阻尼管线：方向先解析为安全 forward，再由 `StableCameraFrame` 生成正交的 right/up；垂直奇异点、目标切换和状态切换不再把方向向量归一化成零向量或产生帧间翻转。Overview 保持原有 `lookAt` 与 3.2 响应。
- School 相机加入速度一致性门控与 P95 屏幕包围盒拟合。六个固定时间点的实际可见比例为 90.6%–99.6%，拟合系数 1.027–1.400；同一批状态快照下旧控制器为 66.5%–89.1%。低一致性时航向保持并降速，恢复一致后回到正常跟踪。
- Predator 相机按 target → velocity → previous heading → 固定初始方向的顺序解析 forward；目标索引、目标死亡、patrol/search 状态共用同一条平滑管线，首帧角变化不超过 0.0194 rad，没有瞬时重定位。240 帧独立轨迹记录到 t37.33 s 的目标 371 失效切换，角变化 0.0578 rad，净空保持 1.100 m。
- 确定性回归覆盖 6 个预设、18 个模式切换、3 条连续跟踪、2 种视口、暂停/恢复与不规则 delta：`invariants=0`、`browserErrors=0`；地形净空最小值 1.879 m，全部高于 1.09 m 断言线。
- `npx tsx scripts/simulation-regression.ts` 在 t17/43/52/60/63 的 `deterministic=true`，浏览器 t43 状态 checksum 与 headless 一致；模拟初始条件、鱼体位置和捕食者决策未被相机代码改变。
- 相机数学基准（600 帧 × 500 鱼，纯 JS）：School 平均 0.040 ms/帧，Predator 平均 0.007 ms/帧。
- Vitest 39 文件 / 302 tests 全部通过；`tsc --noEmit` 与 `npm run build` 通过（99 modules，主包 54.75 kB，three-core 543.56 kB）。

## 2. 固定基线与约束

相机保持 `PerspectiveCamera`、垂直 FOV 48°、`viewportFit()`、世界边界与地形保护；构图常量未改：

| 模式 | back | side | up | lead | response |
| --- | --- | --- | --- | --- | --- |
| Overview | 44.65（`[30,18,29]-[0,6.5,-2]` 的模） | — | — | — | 3.2 |
| School | 23.5 | 9.0 | 9.5 | 0.6 | 2.4 |
| Predator | `13.5 + min(6, 0.3 × distance)` | 5.4 | 4.8 | `clamp(0.45 × distance, 2.2, 5.0)` | 3.0 |

Scene：Encounter，种子 `0x9e71c0de`，500 主群鱼 + 100 小丑鱼，固定 60 Hz。相机只读取 `world.flock`（主群）与 `world.predator`；小丑鱼不参与 School 构图与拟合。

阻尼统一为 `alpha = 1 - exp(-min(delta, 0.15) × response)`，不用固定 lerp 系数；模式切换从当前实际位姿起算，不读取过期缓存坐标。

## 3. 共享方向与参考系

`src/rendering/cameraStability.ts:82` 的 `StableCameraFrame` 维护 forward/right/up 三个持久向量：

1. 校验新 forward 有限且长度大于 `1e-4`，否则保留上一帧状态。
2. 将上一帧 right 投影到新 forward 的垂面；投影长度足够时作为 right 候选。
3. 投影退化时依次改用上一帧 up、再改用与 forward 最不平行的确定性世界轴。
4. 由 `up = right × forward` 求 up；使用上一帧 up 回退时改为 `right = forward × projectedUp`，再求 `up = right × forward`。三条轴均为单位长度且两两正交，`right × up = -forward` 的右手系由构造保证。
5. 失败路径不写入任何持久字段，不会把 NaN 传播到相机。

`SchoolHeadingTracker`（`cameraStability.ts:206`）与 `measureSchoolFit`（`cameraStability.ts:304`）分别处理航向可靠性与拟合；`resolvePredatorForward`（`cameraStability.ts:488`）实现目标/速度/历史/初始四级回退；`dampCameraUp`（`cameraStability.ts:519`）在相机上向量更新时剔除视线方向分量，退化时返回 false 并保留原 up。

## 4. School 相机

### 4.1 航向一致性

对存活主群鱼的速度逐条求模长并求和：

`coherence = length(sumVelocity) / sum(length(velocity_i))`

`coherence` 经 smoothstep(0.12, 0.55) 映射为 `reliability`；航向更新速率乘以 `reliability`，delta 上限 0.15 s。低于 0.12 时不再归一化不可靠的速度和，保留上一有效航向；0.12–0.55 之间连续降速；高于 0.55 恢复全速跟踪。鱼体速度数组只读，相机不写回。

### 4.2 屏幕空间拟合

拟合锚点沿用基线构图 `-forward × 23.5 + right × 9 + worldUp × 9.5`。对每尾存活主群鱼，计算其在当前相机朝向、FOV 与 canvas 宽高比下落入视口所需的缩放系数，取 P95 后乘屏幕留白 1.17，再钳制到 1.0–1.4。每 0.1 s 更新一次测量值，拟合系数按 `response=1.6` 做指数阻尼；孤立远鱼只影响 P95 尾部，不会逐帧拉动相机。

`measureSchoolFit` 输出 `scale / rawScale / percentileValue / visibleFraction / sampleCount`，其中 `visibleFraction` 用最终 scale 反算实际可见比例，供诊断与验收使用。空群或无效输入返回 scale=1 的安全回退。

## 5. Predator 相机

`resolvePredatorForward` 的顺序为：

1. 目标有效时用目标位移，前提是距离大于 0.25；
2. 目标无效或过近时用捕食者速度，速度模长需大于 0.02；
3. 仍无效时用上一有效 forward；
4. 首次初始化用 `(0,0,1)`。

目标有效性由 `isValidPredatorTarget` 统一判定：状态必须是 `pursuit` 或 `attack`，索引为整数且在 `[0, count)`，`alive[index] === 1`。读取插值目标位置前先通过该判定，死目标或越界索引不会参与构图。

forward 解析后交给独立的 `predatorFrame`，不共享 School 的上一帧 right；`back/side/up` 公式、世界 UP 高度偏移和 lead 公式保持基线。Predator 期望位置与目标分别阻尼，目标索引变化或多状态切换都只改变期望值，不重置方向历史或相机位置。

## 6. 更新管线

`CameraController.update`（`src/rendering/CameraController.ts:177`）固定为六步：

1. 由模式计算期望位置与期望目标（`updateSchool:218`、`updatePredator:309`、overview 分支）。
2. School/Predator 用各自持有的 `StableCameraFrame` 解析 forward/right/up；Overview 保持世界 UP 正交基。
3. 位置与目标分别按 `cameraDamping` 阻尼；模式切换的首帧从切换前实际位姿混合到新期望值。
4. 计算目标 up（Preset 用对应帧 up，Overview 用世界 UP），再由 `dampCameraUp` 平滑。
5. 调用 `applyWorldGuard`（`CameraController.ts:490`）：目标范围钳制、地形净空与世界半径保护。
6. 写入渲染相机与 `lookTarget`，恢复 OrbitControls 的交互目标。

`free/orbit` 模式恢复 `camera.up = (0,1,0)`，避免把 Preset 的倾斜 up 带入鼠标交互的球面坐标计算；`setPose` 与交互模式共用同一条收尾路径。

## 7. 验证

### 7.1 单元测试

`tests/cameraStability.test.ts` 36 项、`tests/CameraController.test.ts` 5 项，共 41 项通过。覆盖水平/精确垂直/近垂直/跨奇异点/反向/退化上一帧 right 的参考系，正交与手性断言，航向一致性与低一致性降速，P95 抗离群，宽窄视口，空群，三个模式的精确基线位姿，Predator 四级回退、目标有效性、上向量阻尼与安全归一化。

### 7.2 固定时间点

School（可见比例 / 拟合系数 / 原始 P95 / 一致性 / 可靠性 / NDC x 范围 / NDC y 范围）：

| t | 可见 | fit | raw | coherence | reliability | x | y |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 17 | 0.906 | 1.400 | 2.101 | 0.646 | 1.000 | [-0.382, 1.184] | [-1.047, 0.280] |
| 43 | 0.972 | 1.375 | 1.423 | 0.245 | 0.204 | [-0.545, 0.784] | [-0.894, 0.364] |
| 44.15 | 0.988 | 1.358 | 1.359 | 0.223 | 0.144 | [-0.591, 0.348] | [-0.826, 0.488] |
| 52 | 0.996 | 1.027 | 1.022 | 0.171 | 0.038 | [-0.679, 0.493] | [-0.817, 0.687] |
| 60 | 0.986 | 1.399 | 1.444 | 0.394 | 0.700 | [-0.821, 0.930] | [-0.399, 0.400] |
| 63 | 0.940 | 1.400 | 1.582 | 0.380 | 0.655 | [-0.382, 0.975] | [-0.834, 0.403] |

航向来源在六个点均为 `velocity-sum`，没有进入 `held`；t17/t63 的原始 P95 超过 1.4 上限，说明扩散群仍受 1.4 倍远摄限制。

Predator（状态 / forward 来源 / 目标距离 / 捕食者屏幕坐标 / 目标鱼屏幕坐标 / 地形净空）：

| t | 状态 | 来源 | 距离 | predator | target | clearance |
| --- | --- | --- | --- | --- | --- | --- |
| 17 | pursuit | target | 7.656 | (-0.085, -0.064) | (0.072, 0.051) | 4.20 |
| 43 | patrol | velocity | — | (-0.045, -0.041) | — | 20.50 |
| 44.15 | pursuit | target | 2.617 | (-0.018, -0.199) | (0.000, 0.034) | 12.36 |
| 52 | search | velocity | — | (-0.051, -0.039) | — | 8.38 |
| 60 | pursuit | target | 4.497 | (0.066, -0.080) | (-0.059, 0.063) | 2.58 |
| 63 | pursuit | target | 2.303 | (0.063, -0.006) | (-0.004, 0.134) | 17.97 |

patrol/search 不读取目标鱼，forward 回退到速度；t43/t52 的目标列因此为空。

### 7.3 模式切换

每个时间点执行 overview→school、school→predator、predator→overview 各 90 帧（1/60 s）。切换首帧角变化 0.0003–0.0194 rad，无瞬移；以下为每时间点三条切换的最大值：

| t | 最大角变化 (rad/帧) | 最大平移速度 (m/s) | 最小净空 (m) |
| --- | --- | --- | --- |
| 17 | 0.1523 | 94.557 | 6.185 |
| 43 | 0.0066 | 19.927 | 18.362 |
| 44.15 | 0.0734 | 40.802 | 12.372 |
| 52 | 0.0458 | 63.699 | 6.213 |
| 60 | 0.1017 | 98.849 | 1.879 |
| 63 | 0.1197 | 81.944 | 17.679 |

最大平移速度出现在远距离模式切换的收敛段，位置仍连续；最小净空 1.879 m 出现在 t60 school→predator 的下降段，高于 `CAMERA_FLOOR_CLEARANCE + 安全余量` 断言。

### 7.4 连续跟踪

`scripts/camera-regression.ts` 与 `scripts/camera-target-switch.ts` 的专用轨迹（重置到固定场景后逐帧推进；target-change 走独立启动时间线）：

| 轨迹 | 帧数 | 最大角变化 | 最大速度 | 最小净空 | 垂直比 | 最低一致性 | 最低可见 | 最大 fit | 目标切换 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| vertical-pursuit | 90 | 0.0868 | 76.829 | 11.769 | 0.9264 | — | — | — | 0 |
| target-change | 240 | 0.0695 | 40.674 | 1.100 | 0.9973 | — | — | — | 1 |
| low-coherence-school | 100 | 0.0021 | 4.655 | 29.819 | 0.9264 | 0.1866 | 0.9279 | 1.398 | 0 |

vertical-pursuit 从 t43.5 起连续 1.5 s，目标方向垂直比达到 0.926，相机角变化保持在 0.087 rad/帧以下；target-change 覆盖 34.5–38.5 s，在 37.33 s 记录到目标 371 失效（state patrol），forward 由 target 切到 velocity，切换帧角变化 0.0578 rad、速度 40.08 m/s，净空 1.100 m 仍高于 1.09 m 断言；low-coherence-school 的一致性降到 0.187，可见比例仍为 0.928，没有因航向不可靠而把相机甩出鱼群。

target-change 轨迹没有出现索引到索引的切换：探针在另一条运行时间线上记录到 17 次索引变化（切换点 34.83/36.32 s），但本轨迹窗口内只有 371→null 的失效切换。索引到索引的路径由单元测试的正反目标切换与目标有效性用例覆盖；浏览器轨迹覆盖目标失效、`pursuit→patrol` 与 forward 回退。

### 7.5 视口、暂停与不规则 delta

- 窄视口 1024×900、宽视口 1920×700：School fit 与 Predator 构图均通过有限性、净空与拟合范围断言，无越界。
- 暂停 0.5 s 再恢复：相机位移 0.06 m，没有因暂停积累相位。
- 不规则 delta `0.003 / 0.016 / 0.12 / 0.2 s`：全部使用同一指数阻尼，输出有限；0.15 s 上限截断长帧，避免跳变。

### 7.6 前后对比

`test-artifacts/camera-experiment-c/contact-sheet-all.png` 汇总三个机位的 2 行 × 5 列对比（上：旧控制器，下：新控制器；列：17/43/52/60/63 s），相同 canvas、光照、FOV 与初始条件；分机位版本为 `contact-sheet-{overview,school,predator}.png`。

- Overview 前后平均通道差 0.21–0.24/255，属于渲染噪声，机位未变。
- Predator 构图与鲨鱼屏幕位置接近基线，差异集中在目标切换/垂直段的平滑轨迹。
- School 旧版在 t17/t52 把鱼群推到画面边缘并裁掉外侧个体；按同一批状态快照与各自相机位姿反算，旧版可见比例为 66.5%–89.1%，新版为 90.6%–99.6%。

| t | 旧版可见 | 新版可见 |
| --- | --- | --- |
| 17 | 0.891 | 0.906 |
| 43 | 0.846 | 0.972 |
| 52 | 0.751 | 0.996 |
| 60 | 0.665 | 0.986 |
| 63 | 0.713 | 0.940 |

旧版按 500 尾存活个体的 `state-tNN.json` 位置、旧相机 position/target 与 48° FOV、1438×898 画布逐尾投影；t60 有 33.5% 个体落在视口外，t52 为 24.9%。

## 8. 性能

`scripts/camera-benchmark.ts` 在 Node 中跑 600 帧、500 尾主群鱼，测量纯相机数学：

- School：总 23.76 ms，平均 0.040 ms/帧，含每 0.1 s 一次的 P95 拟合。
- Predator：总 3.96 ms，平均 0.007 ms/帧，含 forward 解析与位姿计算。

每帧不新建 Vector3：`CameraController` 与 `cameraStability` 的临时向量均为实例字段；拟合缓冲为预分配 `Float32Array`，用原地 quickselect 取 P95。上述数字只覆盖 CPU 侧数学开销，不是 GPU 帧率；Chromium 运行在 SwiftShader 上，未取得硬件 GPU 数据。

## 9. 已知限制

- **可见比例上界超出 95% 目标**：t43/t44.15/t52/t60 的实际可见比例为 0.972–0.996。P95 本身已覆盖 95% 个体，再乘 1.17 屏幕留白后相机额外后退；这是“15–20% 留白”与“90–95% 可见”两个目标在紧凑群上的取舍。t17/t63 受 1.4 上限约束，落到 0.906/0.940；若后续要严格压到 95%，需要降低留白系数或引入可见比例反馈，而不是继续放大 P95。
- **浏览器索引切换样本缺失**：target-change 轨迹只覆盖 371→null 的目标失效切换，没有索引到索引；索引切换的数学与有效性由单元测试覆盖，浏览器轨迹提供了目标失效与 forward 回退样本。
- **软件渲染**：所有截图与浏览器回归均为 SwiftShader；没有硬件 GPU 的 180 s 稳定性、P95 帧时间或 1000/2000 鱼扩展性数据。
- **旧控制器缺少 t44.15**：前后联系表只使用 17/43/52/60/63 s 五个公共时间点；t44.15 仅有新版截图与指标。
- **拟合上限效应**：t17/t63 的原始 P95 为 2.101/1.582，被钳制在 1.4；更分散的群仍会有 5%–10% 个体落在视口外，这是本轮设定的硬上限，不是方向或阻尼缺陷。

## 10. 文件与回滚

新增：

- `src/rendering/cameraStability.ts`：稳定参考系、航向跟踪、P95 拟合、两种机位公式、Predator forward 解析、目标有效性、上向量阻尼。
- `tests/cameraStability.test.ts`：36 项相机数学与目标有效性测试。
- `scripts/camera-regression.ts`：确定性浏览器回归（预设、切换、轨迹、视口、暂停、不规则 delta）。
- `scripts/camera-target-switch.ts`：独立的目标失效/切换轨迹，保留逐帧 diagnostics。
- `scripts/camera-benchmark.ts`：纯相机数学基准。
- `test-artifacts/camera-experiment-c/`：汇总联系表、分机位联系表、生成脚本与旧控制器副本。
- `test-artifacts/camera-validation/`：新版六时间点截图与 diagnostics。
- `test-artifacts/camera-before-legacy/`：旧控制器五时间点截图。
- `test-artifacts/camera-regression-final/camera-regression.json`：最终回归原始数据。
- `test-artifacts/camera-target-switch/camera-target-switch.json`：240 帧目标失效/切换轨迹原始数据。

修改：

- `src/rendering/CameraController.ts`：接入共享数学与六步管线；保留 `CameraMode`、Overview 常量、`predatorFraming` 数值与 `targetOffset` 语义。
- `src/main.ts`：仅在 diagnostics 中增加相机指标与屏幕投影；不改变模拟循环。
- `scripts/world-continuity-capture.ts`：Vite cache 改到项目内、关闭 HMR，避免刷新中断长跑截图。

回滚：

- 旧控制器原件：`.task-locks/camera-experiment-c-backup/CameraController.ts`。
- 当前控制器副本：`test-artifacts/camera-experiment-c/CameraController.current.ts`。
- 删除 `src/rendering/cameraStability.ts`、恢复上述旧控制器、移除 `main.ts` 的相机诊断字段与 capture 脚本的 HMR/cache 改动，即可回到实验前状态；模拟与 UI 无回滚项。

## 11. 复现

```powershell
npx vitest run
npx tsc --noEmit
npm run build
npx tsx scripts/simulation-regression.ts
npx tsx scripts/camera-regression.ts --out=camera-regression-final --port=5208
npx tsx scripts/camera-target-switch.ts --out=camera-target-switch --port=5214
npx tsx scripts/camera-benchmark.ts
npx tsx scripts/world-continuity-capture.ts --out=camera-validation --tag=validation --port=5200 --times=17,43,44.15,52,60,63 --capture=canvas
```

`camera-regression` 在 SwiftShader 下约 21 分钟（1294 s），主要耗时是逐帧渲染 340 个轨迹帧；轨迹指标只依赖固定模拟步与相机数学，渲染仅用于屏幕投影诊断。`world-continuity-capture` 的 `--port` 必须对应未被占用的 Vite 端口，缓存目录已固定在 `node_modules/.vite-world`。
