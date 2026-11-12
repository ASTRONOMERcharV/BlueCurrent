# Blue Current — Underwater Lighting Phase 1 Report

日期：2026-11-10  
范围：基础光照、生物轮廓、静态阴影、基础地表材质与颜色管理。  
状态：Phase 1 实现与软件浏览器验收完成；硬件 GPU 性能验收未执行，不能据此声称 500/1000/2000 鱼的硬件帧率。

本轮严格停在基础光照层，没有新增水体散射、焦散或光柱算法。并行进行的“水体清晰度”会话已独立完成水介质修复；本报告保留并验证了其默认线性路径，同时把 `?lighting=base` 收紧为真正只保留基础灯光。

## 1. 交付结果

基础光照现在有明确的主次：

- 太阳从场景左上方斜射，照亮鱼群上缘、海藻迎光面和左侧礁石。
- HemisphereLight 只做水体环境填充，强度为太阳的 39%，不再用全屏环境光抹平体积。
- 共用轮廓光约为太阳的 18.5%，只负责分离主体；没有逐鱼灯光。
- 鲨鱼使用更强的 Fresnel 轮廓，但攻击状态不再全身自发光。
- 海床、岩石和沙丘改为一次性静态阴影：岩石投射，地表接收，鱼群/鲨鱼/海藻/珊瑚不投射。
- 海床与岩石实例色被提升到可读范围。右侧背光岩体仍保留深阴影，符合主光方向，而不是被整体提亮。

## 2. 真实浏览器对比

### 2.1 优化前后

![优化前后四面板](../test-artifacts/underwater-lighting-v1/final/before-after-four-panel.png)

上排为同一 Calm 场景、500 鱼、120 固定步后的 Overview；下排为 Predator Encounter、18 固定步后的捕食者近景。

可确认的变化：

- 鲨鱼从整条粉红色身体恢复为灰褐色皮肤、浅色腹部和冷色轮廓；攻击状态只保留暖色边缘。
- 优化前整体被水体蒙层抬亮，海床和鱼群明度接近；现在鱼群是最亮层，海床纹理可辨但保持偏暗。
- 右侧岩体保留背光深阴影，左侧岩面和海床受主光与半球填充，空间方向明确。
- 海藻仍然是深绿，没有变成荧光绿。
- 沙地焦散、光柱和悬浮颗粒在完整模式中存在，但没有成为画面主体。

### 2.2 只保留基础光照

![基础与完整模式四面板](../test-artifacts/underwater-lighting-v1/final/base-vs-full-four-panel.png)

`?lighting=base` 的真实诊断值为：

- `waterMediumActive: false`
- `waterEffectsVisible: false`
- 焦散、光柱、水面、颗粒全部关闭
- 鱼群、鲨鱼、海藻、海床和礁石仍可辨认
- 浏览器错误为 0，材质色彩空间问题为 0

这满足“关闭所有附加特效后，基础光照依旧成立”的验收条件。

独立文件：

- [基础模式 Calm](../test-artifacts/underwater-lighting-v1/final/base/calm-environment.png)
- [基础模式捕食者近景](../test-artifacts/underwater-lighting-v1/final/base/encounter-predator-environment.png)
- [完整模式 Calm](../test-artifacts/underwater-lighting-v1/final/full/calm-environment.png)
- [完整模式捕食者近景](../test-artifacts/underwater-lighting-v1/final/full/encounter-predator-environment.png)

原始优化前画面仍保留在：

- [优化前 Calm](../test-artifacts/underwater-lighting-v1/before/calm-environment.png)
- [优化前捕食者近景](../test-artifacts/underwater-lighting-v1/before/encounter-predator-environment.png)

## 3. 参数

所有基础灯光参数集中在 `src/rendering/lighting/UnderwaterLightingConfig.ts`。

| 参数 | 最终值 |
| --- | --- |
| Sun colour / intensity | `#B8E5E7` / `2.05` |
| Sun position → target | `(-18, 30, 12)` → `(0, 3, 0)` |
| Hemisphere sky / ground | `#86C6D2` / `#15414C` |
| Hemisphere intensity | `0.80`（太阳的 39.0%） |
| Shared rim colour / intensity | `#9FEAFF` / `0.38`（太阳的 18.5%） |
| School Fresnel | strength `0.12`, power `3.0` |
| Predator Fresnel | strength `0.58`, power `2.2` |
| Attack edge | colour `(1.0, 0.36, 0.16)`, added strength `0.16` |
| Exposure | `1.05` |
| Environment intensity | `0.55` |
| Shadow map | `1024 × 1024`, PCF Soft |
| Shadow coverage | ±38 m, near `1`, far `90` |
| Floor / rock tint / dune tint | `#3B626B` / `#FFFFFF` / `#E5EEF1` |

这些是 Three.js 美术调色值，不是物理标定后的海水参数。

## 4. 实现细节

### 4.1 静态阴影

- 海床、GLB 岩石、沙丘、珊瑚接收阴影。
- 岩石与沙丘的岩石部分投射；沙丘只接收，避免大片沙丘互相产生硬阴影。
- 普通鱼、鲨鱼、海藻和光柱不投射实时阴影。
- `shadowMap.autoUpdate = false`；初始化、岩石替换或障碍可见性变化时，仅重新生成一次阴影图。
- 因此移动鱼群与摄像机不会反复渲染阴影贴图。

### 4.2 鲨鱼攻击提示

攻击状态原来把 `ATTACK_EMISSIVE` 写进 `bodyMaterial.emissive`，导致全身变成粉红色。现在不再写身体自发光，只通过共享 `uRimAlert` 将 Fresnel 轮廓从冷青色过渡到暖橙色。

### 4.3 蒙皮轮廓坐标

`applyFresnelRim` 的世界坐标采样点从 `<begin_vertex>` 后移动到 `<skinning_vertex>` 后。骨骼鲨鱼的轮廓现在基于当前蒙皮姿态，而不是绑定姿态；实例化鱼群仍只乘一次 `instanceMatrix`。

### 4.4 自定义 Shader 输出

穹顶、光柱和悬浮颗粒：

- 颜色改为线性 `THREE.Color` uniform。
- 片元末尾显式执行 `<tonemapping_fragment>` 和 `<colorspace_fragment>`。
- 穹顶以 `renderOrder = -1000` 最先绘制，并关闭深度测试与深度写入。

最后一项修复了一个真实浏览器回归：穹顶原本可能按材质顺序最后绘制并覆盖整个场景。

### 4.5 基础模式

`?lighting=base` 不只关闭焦散和颗粒，还通过 `UnderwaterMedium` 的共享 uniform 关闭：

- Scene Fog / 介质合成
- Water Attenuation
- Volumetric Scattering
- Marine Particles
- Light Shafts
- Caustics
- Surface Light

`SceneManager.setLightingMode()` 是唯一入口；后续新增渲染层必须接入同一 gate。

## 5. 验证

| 检查 | 结果 |
| --- | --- |
| Vitest | 26 个文件、176 项测试全部通过 |
| TypeScript `tsc --noEmit` | 通过 |
| Vite production build | 通过 |
| Calm 完整模式真实浏览器截图 | 通过，0 错误 |
| Calm 基础模式真实浏览器截图 | 通过，0 错误 |
| Predator 完整/基础模式截图 | 通过，0 错误 |
| 材质色彩空间审计 | `colorSpaceIssues: []` |
| Observation 地板网格 | `observationGridVisible: false` |
| 基础模式水介质 | `waterMediumActive: false` |
| 固定模拟状态 | 相同场景与固定步数，500 鱼；截图等待不改变鱼数/模拟状态 |
| 攻击状态 | `attack`，无全身自发光 |

截图诊断：

| 指标 | 优化前 Calm | 最终完整 Calm | 最终基础 Calm |
| --- | ---: | ---: | ---: |
| Fish | 500 | 500 | 500 |
| Draw calls | 48 | 48 | 39 |
| Render triangles | 143,025 | 143,009 | 143,009 |
| 浏览器错误 | 0 | 0 | 0 |

三角形的小幅变化来自固定场景下岩石/地形散射的计数差异，不是鱼群几何变化。基础模式减少 9 个 draw call，对应关闭的颗粒、水面和 6 个光柱平面。

## 6. 性能数据与限制

本环境只有 SwiftShader 软件渲染。相同 500 鱼、predator-glb 场景的性能采样为：

| 模式 | FPS | P95 frame | Frames | Draw calls | Simulation EMA | Render CPU |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Full | 2.16 | 2666.6 ms | 16 | 50 | 13.96 ms | 23.11 ms |
| Base | 2.32 | 2633.2 ms | 11 | 41 | 17.38 ms | 27.23 ms |

这些数字**不能**用于判断基础模式比完整模式更快：Base 的 simulation EMA 反而更高，帧数只有 11，说明软件渲染调度和共享 VM 负载主导了结果。有效结论只有 draw call 数量差异。硬件 GPU 的 FPS、P95、GPU timestamp 仍需在 Windows 主机执行：

```bash
npm run accept:gpu -- --counts=500,1000,2000 --warmup-ms=3000 --sample-ms=10000 --max-sample-ms=60000 --min-frames=120 --repeats=3 --channel=chrome
```

原始采样：

- [Full 性能结果](../test-artifacts/underwater-lighting-v1/final/performance/full/results.json)
- [Base 性能结果](../test-artifacts/underwater-lighting-v1/final/performance/base/results.json)
- [优化前性能 smoke](../test-artifacts/underwater-lighting-v1/final/performance/before/results.json)

## 7. 文件

新增：

- `src/rendering/lighting/UnderwaterLightingConfig.ts`
- `src/rendering/lighting/UnderwaterLighting.ts`
- `src/rendering/lighting/MaterialColorSpace.ts`
- `tests/UnderwaterLighting.test.ts`
- `docs/UNDERWATER_LIGHTING_ANALYSIS.md`
- `docs/UNDERWATER_LIGHTING_REPORT.md`

修改：

- `src/rendering/Environment.ts`
- `src/rendering/SceneManager.ts`
- `src/rendering/FishRenderer.ts`
- `src/rendering/PredatorRenderer.ts`
- `src/rendering/MarineSnow.ts`
- `src/rendering/RockScatter.ts`
- `src/rendering/CoralAsset.ts`
- `src/rendering/UnderwaterLighting.ts`（兼容 re-export）
- `src/environment/UnderwaterOptics.ts`
- `src/main.ts`
- `scripts/visual-quality-capture.ts`（`--lighting=base|full` 与真实帧计数等待）
- `scripts/gpu-acceptance.ts`（`--lighting=base|full`）

## 8. 未包含 / 下一步

本轮没有继续实现新的 Phase 2 水体散射、Phase 3 焦散或 Phase 4 光柱算法。现有水体清晰度、焦散和光柱由并行会话维护，本报告只验证了与基础光照的兼容性。

按你给定的阶段门槛，Phase 2–4 的高成本效果不在本轮继续推进。确认本阶段视觉后，下一步应先做 500/1000/2000 鱼的硬件 GPU 基线，再决定是否分别处理：

1. 更明确的受光散射色与远近水色层次。
2. 海床焦散的尺度和强度微调。
3. 光柱的噪声、边缘衰减和遮挡。

当前已知限制：低多边形岩石和鱼群资产本身限制了极细节；右侧背光岩体仍较暗是有意保留的主光方向，不应通过提高全局曝光解决。

Phase 2 后续交付：受光散射色与远近水色层次已单独实现并验收，见 [UNDERWATER_LIGHTING_PHASE2.md](./UNDERWATER_LIGHTING_PHASE2.md)；Phase 3–4（焦散微调、光柱改进）尚未开始。
