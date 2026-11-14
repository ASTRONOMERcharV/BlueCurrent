# System — Rendering and Observation UI

> 核实日期：2026-11-14。修改 SceneManager、水体、光照、鱼体渲染、散布、沙尘或 UI 前阅读；资产契约见 `assets.md`。

## 渲染所有权与顺序

`src/rendering/SceneManager.ts` 创建 renderer、camera、Environment、Fish/Predator Renderer 和诊断层。每帧先更新鱼与捕食者视觉，再更新网格/碰撞 debug、CameraController、Environment/光照，最后调用一次 `renderer.render()`。暂停不阻止渲染。

`src/main.ts` 负责生产资产加载与 URL 开关，`Environment.ts` 负责地形、 Reef/岩石/珊瑚/海带/海草和局部视觉效果。不要在 preview 或 UI 中复制一套独立生产场景更新规则。

## Renderer 与相机默认值

WebGLRenderer 使用 antialias、高性能偏好、sRGB 输出、ACES Filmic、曝光 1.05，像素比上限 1.75。主相机 48° vFOV，near 0.1、far 400；legacy terrain 为 far 180。阴影为 PCFSoft，`autoUpdate=false`，只有 Environment consume dirty 时才请求更新。

新阴影 caster 必须触发 dirty。`captureRockMask()` 临时使用 layer 7 并改场景状态，其他功能不得占用该层；恢复逻辑不能绕过。

## 水体与光照唯一链路

`UnderwaterMedium.ts` 在材质编译前一次性修改 Three.js fog ShaderChunk。默认 `clear` 路径在 `<tonemapping_fragment>` 前完成 Beer–Lambert 吸收、近远散射与合成；`legacy-display` 仅复现旧显示域公式。没有后处理 composer。

`lighting/UnderwaterLightingConfig.ts` 集中保存灯光、水体、焦散和光柱参数，数值是 art-directed，不是实测海水光谱。新增材质必须在编译前 attach medium，重复注入已 patch 材质可能导致 shader 错误。Phase D 两轮都在该配置内定稿：第一轮 D4 全局光照与 D1 水体，第二轮新增 `materials.seabed`（海床顶点/片元细节）与 `water.currentSway`（海草/海带受流摆动）；链路仍是唯一 `UnderwaterMedium`，参数值与前后对照见 `../validation/visual-baseline.md`。

`setWaterEffects(false)` 只关闭 snow/surface/shafts/caustics 等局部效果，不关闭材质中的吸收和散射；`lighting=base` 才用于完整 base 对照。不得新增第二条雾链、tonemap 后混雾或重复 sRGB 转换。

## 生物与环境渲染

FishRenderer 用 InstancedMesh、速度朝向、bank 和尾权重顶点动画；E1 起 pitch 由逐实例指数趋近、速率限制和 0.9 rad 硬限幅产生（首帧、时间跳变、`dt>0.25` 或时间回退直接对齐），转弯弯曲由模拟 bank 派生的 `instanceTurn` 在尾权重处叠加，头部为零、尾部最大。这些只写实例姿态，不写模拟状态；`?fishMotion=legacy` 复现 E1 前的瞬时俯仰与零弯曲，仅供同版对照。死亡鱼保留实例槽并零缩放，因此 mesh.count 不等于 aliveCount。PredatorRenderer 使用 rigged shayu 和 `PredatorAnimationController`，以实际模拟增量驱动；即使视觉隐藏也继续更新控制器，避免重新显示时朝向跳变。

CoralScatter、EpibiontScatter、KelpScatter、RockScatter 和 SeaweedScatter 是不同放置系统。视觉散布不自动创建碰撞；海带布局必须与模拟共用。具体数量和资产规则由 `assets.md` 与 `../visual/composition.md` 维护。礁基海葵的 x/z 由 `src/environment/AnemoneHabitat.ts` 提供，`CoralScatter` 不得再复制一份公式；模拟栖息锚点与渲染实例因此逐位一致，海葵本身仍不是硬碰撞体。

Phase E4 的近底沙尘由 `SedimentPlume.ts` 用单个 `Points` draw 呈现（`ShaderMaterial`、沙色 `0xb9a27c`、加色混合、`depthWrite=false`、`renderOrder=2`，自定义点尺寸/软圆片）。`Environment` 持有 `SedimentField` 与 plume，`SceneManager.update()` 每帧调用 `environment.updateSediment(world, delta, time)`；`WaterDebugLayer` 的 `sediment` 层与 Environment 开关只改变呈现。`?sediment=0` 保留模拟但关闭粒子；沙尘不改变任何 checksum，也不得成为第二条雾链或后处理。

光柱是交叉平面、深度测试和解析淡出，不是完整体积 ray march。焦散注入海床、岩石和珊瑚等材质；远景效果必须接受距离与性能约束，不能为近景效果无差别提高全场成本。

Phase D2 的海床细节由 `SeabedDetail.ts` 在连续海床材质上追加静态世界空间噪声与粗糙度微调，18 m 内渐入、55 m 外归零，与焦散链式共存；不新增贴图、UV 或 draw call。Phase D3 的海草与海带通过 `currentSway.ts` 共享同一受流摆动 chunk，方向和速度来自同一 `OceanCurrentField`；海草是纯装饰层，不进入碰撞或 `KelpRefugeField`。

### Phase F 渲染性能遥测

`SceneManager.renderPerformance` 是默认关闭的相位记录器，按帧记录 `fish`、`clownfish`、`predator`、`debug`、`camera`、`environment`、`draw` 与派生 `other`；`GpuTimer`（`src/rendering/GpuTimer.ts`）在遥测开启时用 WebGL2 `EXT_disjoint_timer_query_webgl2` 包裹 `renderer.render`，最多两个查询在飞，读取时检查 `GPU_DISJOINT_EXT`，disjoint 结果丢弃而不是上报。GPU 时间只有在至少一个有效查询后才标记 `measured=true`；扩展不可用时为 `N/A`。`getRendererStats()` 还返回 `renderer.info.memory`（geometries/textures）与 program 数。`renderMs` 仍是 CPU 提交 EMA，不是 GPU 时间；SwiftShader 的 timer query 结果也只能作软件诊断，不能当硬件 GPU 性能。

## UI 与真实数据边界
`src/ui/ControlPanel.ts` 通过 actions 改配置并同步 DOM，`StatisticsPanel.ts` 读取真实 metrics/config/predator。Observation 与 Laboratory 只改变呈现和诊断，不改变模拟算法。Collision Debug、SDF 数值和线框属于 Laboratory，不进入正式 Observation 展示。

统计 UI 通常 4 Hz 更新，Laboratory 碰撞读数约 8 Hz；详细生态指标每 30 个固定步重算。`renderMs` 是 CPU 提交侧 EMA，FPS/P95 来自帧样本，均不是 GPU timestamp。不可测数据必须显示 N/A。

`predator-watch` 自 E2 起有第二行 `#predator-watch-school`，显示 `School N · median M`（无结构事件时）或附加最新 split/merge 类型；7px 大写 mono、暖橙，390×844 窄屏随整个 watch 区块隐藏。它读取 `SchoolStructureTracker` 的只读快照，不参与模拟。

`window.__blueCurrent` 是验收诊断 API。新增读数要来自真实状态；新增写操作必须走明确 action，并考虑固定种子回归。调试捕获可以暂停、设视觉时间或机位，但不能伪造生态结果。

## 相关测试与工具

```bash
npx vitest run tests/UnderwaterMedium.test.ts tests/UnderwaterLighting.test.ts tests/Caustics.test.ts tests/LightShafts.test.ts
npx vitest run tests/SedimentField.test.ts tests/CoralScatter.test.ts
npx vitest run tests/PredatorRenderer.test.ts tests/PredatorAnimation.test.ts tests/PredatorAnimationController.test.ts
npm run smoke:rich
npm run quality:capture
npm run capture:lighting
npm run water:clarity
npm run accept:observatory
```

捕获脚本的静态目录、端口、freeze/force-exit 和输出参数以当前脚本为准。软件捕获只作功能/画面证据；性能验收见 `../validation/performance.md`。

## 修改完成条件

渲染修改保留单一路径线性水体、真实遥测和只读模拟边界；提供同版 Base/Final 或修改前后对照，记录 renderer 和实际资产版本。 shader/光照变化跑相关测试与 `lighting=base` 检查，UI 变化验证 Observation/Laboratory 和 Console 开/关及窄屏。E4 沙尘必须给出 `sediment=0` 的同机位对照并证明 checksum 不变；海葵锚点改动要同时验证 `CoralScatter` 实例位置。
