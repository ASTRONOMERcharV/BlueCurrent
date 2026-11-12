# Blue Current — Observatory UI 与生态场景验收

> 2026-11-09 Visual Quality V1 更新：海藻布局已改为 91 株左右群落，鱼群默认行为参数和海床高度函数也已调整。本文保留 Observatory 阶段的验收语境；当前数值与截图以 [VISUAL_QUALITY_V1.md](VISUAL_QUALITY_V1.md) 为准。

## 1. 交付定位

Blue Current 当前形态为 **Real-time Underwater Ecosystem Observatory**。三维生态场景是视觉主体，控制台用于观察和修改真实模拟，不是独立的静态概念页。默认进入 Observation，按需展开 Laboratory；本轮没有新增 Boids、捕食者或避障算法。

默认主场景使用完整 Blender 岩石、48 株完整珊瑚、91 株海藻、6 株细节海菜、两套 Blender 鱼模型（500 条主鱼群 + 100 条小丑鱼）和 shayu 捕食者；`?coral=temperate` 可降为 12 株温带珊瑚，`?coral=0` 关闭珊瑚。`?fish=procedural` 回退程序化主鱼群，`?clownfish=0` 关闭小丑鱼群。`?seaweed=0` 关闭细节海菜。`?environment=bare` 可关闭完整岩石、珊瑚和海藻装饰，用于轻量调试或对照实验。

## 2. 桌面布局与视觉规范

设计基准为 1440 × 900。顶部导航为 56 px，右侧控制台为 328 px，底部模拟控制栏为 70 px；主视口自动占据剩余空间。在 1440 px 验收视口中，控制台展开时画布宽 1076 px，折叠后为 1414 px，画布与相机宽高比同步更新。

| 区域 | 实现 | 主要职责 |
| --- | --- | --- |
| 顶部导航 | `src/ui/layout.ts` | 品牌、当前生态系统、双模式、运行状态、全屏和控制台开关 |
| 三维视口 | `SceneManager.ts` + `Environment.ts` | 鱼群、捕食者、海底环境、实时生态叙事和少量核心读数 |
| 右侧控制台 | `ControlPanel.ts` | Behavior、Ecology、Environment、Performance 四个逻辑页签 |
| 底部控制栏 | `layout.ts` + `main.ts` | Pause、Reset、Speed 和三个固定种子场景 |
| 移动端抽屉 | `style.css` + `ControlPanel.ts` | 700 px 以下从底部展开，带遮罩和关闭按钮 |

设计 Token 集中在 `src/style.css`：Deep Ocean `#071B26`、Panel `#0E2C39`、Elevated `#164453`、Primary Cyan `#70C8D0`、School Fish `#8BC7CF`、Predator `#E49A68`。标题使用 Space Grotesk / Inter 回退栈，中文使用思源黑体回退栈，数值使用 JetBrains Mono / Roboto Mono 回退栈。控制台以细分隔线组织内容，不使用卡片矩阵或装饰性发光渐变。

## 3. 控制台职责与真实数据来源

| 页签 | 控件或读数 | 来源 |
| --- | --- | --- |
| Behavior | Separation、Alignment、Cohesion、Neighbor Radius、Maximum Speed、Evasion、高级感知参数 | 直接修改 `world.config`，在下一固定步生效 |
| Ecology | 存活鱼数、群体数、平均邻居、威胁鱼数、海藻庇护鱼数、逃逸强度、捕获、捕食者状态、离散度和方向一致性 | `world.metrics`、`world.flock.fear`、`world.predator`；海藻庇护数为 `coverAt` 超过阈值的真实鱼数；逃逸强度为存活鱼 fear 的平均值 |
| Environment | 四个相机、五个真实礁石碰撞体、水效、网格和算法图层 | `CameraController`、`world.config.obstaclesEnabled`、渲染层可见性 |
| Performance | FPS、平均模拟步耗时、CPU 渲染提交耗时、P95 帧时间、固定/丢弃步数、候选检查、占用网格、draw calls | `requestAnimationFrame` 测量、`world.metrics`、`renderer.info`、搜索遥测 |

`Render CPU` 不是 GPU 时间。Brute Force 下 Occupied Cells 显示 `N/A`。P95 使用最近最多 240 个真实帧间隔；样本不足或不可用时显示 `N/A`，没有填入估计值。所有 DOM 读数由 `StatisticsPanel` 统一刷新。

## 4. Observation 与 Laboratory

Observation 隐藏算法线框和复杂调试读数，保留生态环境、核心参数、生态状态与捕食叙事。Laboratory 展开占用网格、最近 24 条真实邻居连接、样本鱼速度、三种行为力、捕食目标和逃逸方向，并显示水域与海底参考线框。

`BoidSystem` 只在正常行为计算之后复制一条样本鱼已经产生的邻居索引和加权力分量。`DebugVisualizer` 只读这些数据，不参与 Steering。邻居线按真实距离排序后最多绘制 24 条，搜索和力计算仍处理完整邻居集合。箭头方向来自真实数据，长度为可读性归一化，界面已注明这一点。

专项验收对同一种子分别执行 Observation 和 Laboratory 后，存活鱼数均为 500、平均邻居均为 163.256、候选检查均为 197676、固定模拟时间相同，证明模式切换没有改变模拟。原始数据见 `test-artifacts/observatory/results-checks.json`。

## 5. 三层场景构图与碰撞边界

前景由模拟边界外左右礁石和低矮珊瑚组成；中景保留中央开放水域，由鱼群、捕食者和五个既有礁石碰撞体构成；远景使用低对比岩石、珊瑚和指数雾。默认珊瑚层为 6 个 `InstancedMesh`、48 个实例、121,728 个三角形（六物种完整展示层，分物种 3.6–4.2× 缩放，约 1.2–5.0 m 高）；`?coral=temperate` 降为 2 个 `InstancedMesh`、12 个实例、33,720 个三角形（扇状 + 脑珊瑚，0.94–1.45 缩放）。低模海藻为 91 个实例（前景 1.15–2.1、中景 0.9–1.75、背景 0.8–1.35 缩放），珊瑚已整体放大并压低实例明度，与海藻林和 0.9–1.1 m 鱼群协调；细节海菜为 6 个英雄实例（默认启用，82,752 三角形、3 × 2048² 贴图）；完整岩石集保持原有 13 资产实例化路径。第一礁石上方另有 100 条小丑鱼的独立礁区鱼群（`?clownfish=0` 关闭）。

五个主礁石继续使用 `ObstacleSystem` 的球体定义，视觉网格是对球体的近似，而非复杂网格碰撞。装饰性珊瑚、海藻、碎石和沙丘没有独立碰撞体；前缘大型装饰位于游泳边界外，UI 也明确区分视觉装饰与五个真实 collider。Reef Obstacles 同时切换 `world.config.obstaclesEnabled` 和主礁石渲染，不是单纯隐藏模型。

水效开关只控制颗粒、水面光束和焦散强度。暂停时固定步模拟与鱼/鲨鱼视觉动画时间停止，相机仍可平滑移动。

## 6. 相机系统

| 相机 | 行为 |
| --- | --- |
| Overview | 平滑回到生态全局视角；窄屏按画布宽高比增加距离，避免裁掉鱼群 |
| School Follow | 跟随群体中心，根据群体平均速度预留运动前方空间 |
| Predator Focus | 使用与鲨鱼渲染一致的插值位置，跟随速度方向并保留前方视野 |
| Free Camera | 从当前相机姿态无缝接管 OrbitControls，支持旋转、缩放和平移 |

相机位置和目标点均使用指数阻尼。旧自动化使用的 `orbit` 名称保留为 Free 的兼容别名，`school` 与 `predator` API 也保持有效。

## 7. 三个确定性场景

| 场景 | 固定种子 | 确定预热 | 初始条件 |
| --- | --- | ---: | --- |
| Calm Ecosystem | `0x0ca17a11` | 120 步 | 500 鱼、无捕食者，展示局部群体规则 |
| Predator Encounter | `0x9e71c0de` | 150 步后在群体附近释放捕食者 | 500 鱼、Aggression 1.0、Evasion 2.4 |
| Obstacle Navigation | `0x0b57ac1e` | 180 步 | 500 鱼、无捕食者、加强避障和聚合 |

`applyScenario()` 先恢复完整行为基线，再保留构造期数组、边界引用和实例化渲染资源，只重置一次模拟并执行确定预热。场景切换恢复 Uniform Grid、1× 速度、Overview 和隐藏网格，暂停状态保持不变。普通 Reset 仍按当前参数和种子重置，不额外执行场景预热。

## 8. 性能对比

### 无渲染重复 CPU 基准

测试使用 Obstacle Navigation、500 鱼、固定种子，每种搜索 4 次重复；每次在场景预热后再执行 40 步搜索预热和 120 步测量，不运行渲染。

| 搜索方式 | 平均步耗时中位数 | 四次平均耗时范围 | 候选检查 / 步 |
| --- | ---: | ---: | ---: |
| Uniform Grid | 10.207 ms | 10.140–10.296 ms | 221609 |
| Brute Force | 11.480 ms | 11.461–11.987 ms | 249500 |

Brute Force / Grid 的平均步耗时中位数比为 **1.125×**。这只表示当前沙箱、当前密度和这次 CPU 实验，不能写成普遍加速保证。原始结果见 `test-artifacts/observatory/cpu-benchmark.json` 和 `.md`，复现命令为 `npm run benchmark:observatory`。

### 浏览器单次对照

同一导航场景在浏览器阻塞任务中额外执行 180 步后，Grid 的 EMA 为 15.263 ms，Brute Force 为 13.429 ms；这一次网格反而较慢。该结果与上面的重复无渲染基准一起保留，用于说明单次测量和运行环境会改变结论。两者都不是显示 FPS 或 GPU 时间。

Playwright 沙箱强制使用 SwiftShader，截图中的 FPS/P95 仅用于发现软件渲染问题，**不是本机硬件性能验收**。

### 本机 Intel Iris Xe 硬件实测（2026-11-09）

用户已在 Windows 主机完成四资产组合 × 500/1000/2000 的硬件运行。500 鱼四组合均为 122.9–155.7 fps、P95 约 12 ms、0 丢步，通过实时目标；1000 鱼约 7 fps，2000 鱼约 1.7 fps，未通过。1000/2000 的 CPU 渲染提交仍仅约 2–3 ms，而平均模拟步分别约 17.3–17.9 ms 和 55.6–56.4 ms，候选检查增至约 50 万和 191 万，瓶颈明确指向 CPU 模拟和密集邻居查询。2000 每组只有 7 帧，不能当作稳定 P95；真正的 GPU timestamp 也未测量。完整表格和优化顺序见 [本机硬件 GPU 验收分析](GPU_ACCEPTANCE_2026-11-09.md)。

## 9. 自动化验收结果

| 检查 | 结果 |
| --- | --- |
| TypeScript `tsc --noEmit` | 通过 |
| Vitest | 12 个测试文件、83 项测试全部通过 |
| Vite production build | 通过；保留 Three.js core chunk 大小提示，无构建错误 |
| 通用桌面/移动 `browser-smoke.ts` | 通过，无浏览器错误或横向溢出 |
| Observatory desktop / scenarios / checks / mobile | 四阶段全部通过，无浏览器错误 |
| 控制台折叠 | 1076 px → 1414 px，真实扩展 |
| 四个相机入口 | Overview、School、Predator、Free 全部通过 |
| 双模式算法不变性 | 通过 |
| 既有完整岩石、海藻、珊瑚资产冒烟 | 分别通过 |

沙箱软件渲染下长截图任务按阶段执行：`npm run accept:observatory -- --stage=desktop`、`--stage=scenarios`、`--stage=checks`、`--stage=mobile`。硬件浏览器可直接运行完整的 `npm run accept:observatory`。

## 10. 截图索引

| 内容 | 文件 |
| --- | --- |
| Observation 整体界面 | [observation.png](../test-artifacts/observatory/observation.png) |
| Laboratory 算法界面 | [laboratory.png](../test-artifacts/observatory/laboratory.png) |
| Calm Ecosystem | [scenario-calm.png](../test-artifacts/observatory/scenario-calm.png) |
| Predator Encounter | [scenario-encounter.png](../test-artifacts/observatory/scenario-encounter.png) |
| Obstacle Navigation | [scenario-obstacles.png](../test-artifacts/observatory/scenario-obstacles.png) |
| 移动端 Observation | [mobile-observation.png](../test-artifacts/observatory/mobile-observation.png) |
| 移动端底部抽屉 | [mobile-drawer.png](../test-artifacts/observatory/mobile-drawer.png) |

这些截图均来自当前真实 Three.js 模拟和真实测量 UI，不是静态设计稿。硬件渲染器和 500 鱼实时运行已通过本机验收；1000/2000 鱼 CPU 扩展性、2000 鱼长窗口 P95、真正的 GPU timestamp，以及正式演示视频录制仍是后续事项。
