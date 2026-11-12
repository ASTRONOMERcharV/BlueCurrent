# System — Rendering and Observation UI

> 核实日期：2026-11-12。修改 SceneManager、水体、光照、鱼体渲染、散布或 UI 前阅读；资产契约见 `assets.md`。

## 渲染所有权与顺序

`src/rendering/SceneManager.ts` 创建 renderer、camera、Environment、Fish/Predator Renderer 和诊断层。每帧先更新鱼与捕食者视觉，再更新网格/碰撞 debug、CameraController、Environment/光照，最后调用一次 `renderer.render()`。暂停不阻止渲染。

`src/main.ts` 负责生产资产加载与 URL 开关，`Environment.ts` 负责地形、 Reef/岩石/珊瑚/海带/海草和局部视觉效果。不要在 preview 或 UI 中复制一套独立生产场景更新规则。

## Renderer 与相机默认值

WebGLRenderer 使用 antialias、高性能偏好、sRGB 输出、ACES Filmic、曝光 1.05，像素比上限 1.75。主相机 48° vFOV，near 0.1、far 400；legacy terrain 为 far 180。阴影为 PCFSoft，`autoUpdate=false`，只有 Environment consume dirty 时才请求更新。

新阴影 caster 必须触发 dirty。`captureRockMask()` 临时使用 layer 7 并改场景状态，其他功能不得占用该层；恢复逻辑不能绕过。

## 水体与光照唯一链路

`UnderwaterMedium.ts` 在材质编译前一次性修改 Three.js fog ShaderChunk。默认 `clear` 路径在 `<tonemapping_fragment>` 前完成 Beer–Lambert 吸收、近远散射与合成；`legacy-display` 仅复现旧显示域公式。没有后处理 composer。

`lighting/UnderwaterLightingConfig.ts` 集中保存灯光、水体、焦散和光柱参数，数值是 art-directed，不是实测海水光谱。新增材质必须在编译前 attach medium，重复注入已 patch 材质可能导致 shader 错误。

`setWaterEffects(false)` 只关闭 snow/surface/shafts/caustics 等局部效果，不关闭材质中的吸收和散射；`lighting=base` 才用于完整 base 对照。不得新增第二条雾链、tonemap 后混雾或重复 sRGB 转换。

## 生物与环境渲染

FishRenderer 用 InstancedMesh、速度朝向、bank 和尾权重顶点动画；死亡鱼保留实例槽并零缩放，因此 mesh.count 不等于 aliveCount。PredatorRenderer 使用 rigged shayu 和 `PredatorAnimationController`，以实际模拟增量驱动；即使视觉隐藏也继续更新控制器，避免重新显示时朝向跳变。

CoralScatter、EpibiontScatter、KelpScatter、RockScatter 和 SeaweedScatter 是不同放置系统。视觉散布不自动创建碰撞；海带布局必须与模拟共用。具体数量和资产规则由 `assets.md` 与 `../visual/composition.md` 维护。

光柱是交叉平面、深度测试和解析淡出，不是完整体积 ray march。焦散注入海床、岩石和珊瑚等材质；远景效果必须接受距离与性能约束，不能为近景效果无差别提高全场成本。

## UI 与真实数据边界

`src/ui/ControlPanel.ts` 通过 actions 改配置并同步 DOM，`StatisticsPanel.ts` 读取真实 metrics/config/predator。Observation 与 Laboratory 只改变呈现和诊断，不改变模拟算法。Collision Debug、SDF 数值和线框属于 Laboratory，不进入正式 Observation 展示。

统计 UI 通常 4 Hz 更新，Laboratory 碰撞读数约 8 Hz；详细生态指标每 30 个固定步重算。`renderMs` 是 CPU 提交侧 EMA，FPS/P95 来自帧样本，均不是 GPU timestamp。不可测数据必须显示 N/A。

`window.__blueCurrent` 是验收诊断 API。新增读数要来自真实状态；新增写操作必须走明确 action，并考虑固定种子回归。调试捕获可以暂停、设视觉时间或机位，但不能伪造生态结果。

## 相关测试与工具

```bash
npx vitest run tests/UnderwaterMedium.test.ts tests/UnderwaterLighting.test.ts tests/Caustics.test.ts tests/LightShafts.test.ts
npx vitest run tests/PredatorRenderer.test.ts tests/PredatorAnimation.test.ts tests/PredatorAnimationController.test.ts
npm run smoke:rich
npm run quality:capture
npm run capture:lighting
npm run water:clarity
npm run accept:observatory
```

捕获脚本的静态目录、端口、freeze/force-exit 和输出参数以当前脚本为准。软件捕获只作功能/画面证据；性能验收见 `../validation/performance.md`。

## 修改完成条件

渲染修改保留单一路径线性水体、真实遥测和只读模拟边界；提供同版 Base/Final 或修改前后对照，记录 renderer 和实际资产版本。 shader/光照变化跑相关测试与 `lighting=base` 检查，UI 变化验证 Observation/Laboratory 和 Console 开/关及窄屏。
