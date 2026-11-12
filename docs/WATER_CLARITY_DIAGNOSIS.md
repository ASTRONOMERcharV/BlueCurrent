# Blue Current — 水体浑浊诊断与清澈水体优化

日期：2026-11-10  
范围：水体渲染与颜色管理。未修改 Boids、捕食者、固定步长调度、Uniform Grid 或 SimulationWorld 所有权。  
结论状态：软件渲染验证通过；真实 GPU 性能验收仍待执行。

## 1. 结论

当前浑浊感有两个已确认的渲染原因，而不是灯光不足或模型贴图错误：

1. `UnderwaterScattering.ts` 在 Three.js 已完成输出色彩转换后，又对 `fogColor` 执行了一次 `sRGBTransferOETF`。Three r180 的 `WebGLMaterials.refreshFogUniforms()` 已通过 `getUnlitUniformColorSpace(renderer)` 把雾色转到输出空间；二次编码把配置的 `#174853` 抬到约 `#55919B`，形成发白、发闷的蓝绿色蒙层。
2. 旧实现把吸收与 inscattering 都放在 Tone Mapping 之后，用显示空间颜色直接混合。近中景的黑位因此被整体抬高，鱼群、岩石和海藻的材质对比同时下降。

排查还确认了三件**不是**本轮主因的事实：

- 主场景没有 EffectComposer 或全屏后处理，Post Processing 是未安装（N/A），不是一层隐藏的蓝色滤镜。
- FishRenderer 和 PredatorRenderer 只注入顶点游动与 Fresnel 边缘，没有各自重复执行 Fog 或水体颜色混合。
- 场景材质色彩空间审计为零问题：Base Color 为 sRGB，Normal / Roughness / Metalness / AO 为 NoColorSpace；渲染器输出为 sRGB，Tone Mapping 为 ACES Filmic。
- 穹顶、光柱和悬浮颗粒原先缺少输出转换；并行灯光调整已为此补上 `<tonemapping_fragment>` / `<colorspace_fragment>`，最终验收报告中的 `colorSpaceIssues` 为空。

本轮已将水体合成统一到 `UnderwaterMedium`：只在 Tone Mapping 之前执行一次线性空间的 Beer-Lambert 吸收与 inscattering。旧的显示空间路径仅保留为显式 A/B 回退（`?water=legacy`），默认不再执行。

## 2. 为什么不是“加灯光”

固定对照中关闭全部水体层后，原始主体已经具备明确的明暗关系：鱼群是亮色，海藻保留绿色，岩石形成深色剪影。浑浊来自水体对其整体加蓝和抬黑位，而不是物体本身不可见。因此本轮没有提高太阳光或曝光来掩盖雾效。

原始基线仍有一个独立的灯光观感问题：岩石与海床较暗，纹理起伏不够突出。它与水体混合是两件事，应作为灯光/材质阶段单独处理，不应通过增加 inscattering 亮度来“修复”。

## 3. 分层排查与证据

固定条件：`encounter` 场景、500 鱼、18 个固定步、暂停模拟、960×600、SwiftShader 软件渲染、固定相机。每组截图直接读取 WebGL canvas，不包含 UI 暗角。报告同时断言所有截图之间的 `totalSteps`、`simulationTime` 和鱼数一致，证明开关只改变渲染。

| 状态 | 开启层 | 观察 |
| --- | --- | --- |
| 全关 | 无 | 鱼群、海藻、岩石保持原始对比；无全屏蓝绿混合 |
| 仅传输 | Scene Fog + Water Attenuation | 远物轻微变暗，近景基本不变 |
| 水体介质 | 上述 + In-scattering | 中远景获得蓝青色空间感，近景仍保留对比 |
| 加颗粒 | 上述 + Marine Particles | 颗粒只作为局部氛围，不再形成背景亮雾 |
| 完整 | 再加光柱、水面和焦散 | 水体层次完整，光束局部存在，无均匀蒙层 |

四个验收面板：

![Raw to full four-panel comparison](../test-artifacts/water-clarity/after/four-panel.png)

旧路径与当前完整效果：

![Before and after comparison](../test-artifacts/water-clarity/before-after.png)

独立文件：

- [原始基准：全部水体层关闭](../test-artifacts/water-clarity/after/01-raw.png)
- [仅传输：吸收开启、inscattering 关闭](../test-artifacts/water-clarity/after/02-transmission-only.png)
- [基础水体：传输 + inscattering](../test-artifacts/water-clarity/after/03-medium.png)
- [基础水体 + 悬浮颗粒](../test-artifacts/water-clarity/after/04-particles.png)
- [完整效果](../test-artifacts/water-clarity/after/05-full.png)
- [鲨鱼近景](../test-artifacts/water-clarity/after/predator-full.png)
- [旧显示空间路径，仅用于回退对照](../test-artifacts/water-clarity/comparison/legacy-model-current-colours.png)

## 4. 根因一：雾色被二次 sRGB 编码

Three r180 在刷新雾 uniform 时执行：

```js
fog.color.getRGB( uniforms.fogColor.value, getUnlitUniformColorSpace( renderer ) );
```

默认帧缓冲下 `getUnlitUniformColorSpace()` 返回 `renderer.outputColorSpace`，即 sRGB。旧的 `fog_fragment` 又执行：

```glsl
vec3 waterFogColor = sRGBTransferOETF( vec4( fogColor, 1.0 ) ).rgb;
```

因此 `#174853` 在完全起雾时会显示为约 `#55919B`。这是一个明亮的奶蓝色，与旧截图中均匀的蓝绿色覆盖完全吻合。旧的注释错误地假设 `fogColor` 仍是 linear working space。

当前默认路径不再做这次编码。完整原因记录在 `UnderwaterMedium.ts` 的 legacy 分支注释中，只有 `?water=legacy` 会进入该分支。

## 5. 根因二：在显示空间合成水体

旧顺序实际为：

```text
材质直接光照 → ACES Tone Mapping → sRGB 输出转换 → Fog 吸收/散射混合
```

把蓝绿色加到已经完成 Tone Mapping 的像素上，会抬高黑位，并让水色无法随场景高光自然压缩。正确顺序是：

```text
直接光照、阴影、Fresnel、焦散
→ 视线距离的 Beer-Lambert 传输与 inscattering（线性空间）
→ ACES Tone Mapping
→ sRGB 输出转换
```

焦散属于表面直接光照，本轮保留在介质合成之前；这与设计说明中“焦散放在散射之后”的逻辑分层略有不同，但它更符合“焦散先照亮表面，再经过相机到表面的水体路径”的物理关系。

统一公式：

```text
T(d) = exp(-β_rgb · (d - fogStart))
C(d) = C_object · T(d) + C_water · (1 - T(d)) · scatteringStrength
```

近景 `T` 接近 1，中景开始蓝青偏移，远景平滑融入背景；没有使用全屏颜色叠加。

本轮没有改用线性 Fog。分层结果说明浑浊的根因是颜色空间与合成位置，而不是 `FogExp2` 曲线本身；线性 Fog 会牺牲红/绿/蓝不同的衰减顺序，还需要额外的远景色带处理。修正后的指数曲线在 10 m 只贡献约 4%–7% 的水色，已经满足“近景极弱”，因此没有为了参数形式而替换一个没有造成问题的模型。

## 6. 统一配置

`UnderwaterMedium.ts` 暴露 `UnderwaterMediumConfig`，实际参数集中在 `UnderwaterLightingConfig.water`：

| 参数 | 当前值 | 用途 |
| --- | --- | --- |
| Background | `#071E2A` | 场景背景与穹顶最深处 |
| Water Medium | `#0A3546` | 水体介质、穹顶中段 |
| Light Scatter | `#146078` | 线性 inscattering 色，穹顶上部 |
| Surface Light | `#B5DDE0` | 水面/颗粒高光起点 |
| Base density | `0.0055 /m` | 以 RGB 乘数展开为分通道吸收 |
| β Red / Green / Blue | `0.00759 / 0.00583 / 0.00429` | 红光先衰减 |
| Visibility (Green, 5%) | 约 514 m | 派生值，不是独立可调输入 |
| Scattering strength | `0.9` | inscattering 强度 |
| Scattering anisotropy | `0` | 预留相函数参数，第一版仍为 isotropic |
| Fog start | `0 m` | Beer-Lambert 起点 |
| Particle density | 42% | 950 → 399 个可见颗粒 |
| Particle brightness | `0.32` | 降低颗粒对比 |
| Caustics strength | `0.5` | 降低沙地/岩石棋盘光斑 |
| Volumetric strength | `0.7` | 光柱透明度 `0.06 × 0.7 = 0.042` |

分通道透射率与融合比例：

| 距离 | T R/G/B | 水色占比 R/G/B |
| ---: | ---: | ---: |
| 5 m | 96.3% / 97.1% / 97.9% | 3.7% / 2.9% / 2.1% |
| 10 m | 92.7% / 94.3% / 95.8% | 7.3% / 5.7% / 4.2% |
| 20 m | 85.9% / 89.0% / 91.8% | 14.1% / 11.0% / 8.2% |
| 30 m | 79.6% / 84.0% / 87.9% | 20.4% / 16.0% / 12.1% |
| 40 m | 73.8% / 79.2% / 84.2% | 26.2% / 20.8% / 15.8% |
| 60 m | 63.4% / 70.5% / 77.3% | 36.6% / 29.5% / 22.7% |
| 100 m | 46.8% / 55.8% / 65.1% | 53.2% / 44.2% / 34.9% |

这些是美术调色起点，不是实测海水吸收光谱。

## 7. Water Debug Mode

Environment 面板新增可折叠的 “Water debug · render only”：

- Scene Fog（水体介质总开关）
- Water Attenuation（物体透射项）
- Volumetric Scattering（水体 inscattering 项）
- Marine Particles
- Light Shafts
- Caustics
- Surface Light

Post Processing 明确显示为禁用并标注 “N/A, not installed”，因为主场景没有 composer。它没有被伪装成可工作的开关。

调试 API：

```js
__blueCurrent.setWaterDebugLayer('waterAttenuation', false)
__blueCurrent.setWaterDebugLayers(false)
__blueCurrent.setWaterOpticsModel('legacy-display')
__blueCurrent.getDiagnostics().waterDebug
```

旧的 “Water effects” 总开关仍然保留，但现在作为四个本地层的便捷开关；任一本地层改变时，总开关状态会同步，不再出现“总开关关着但单项显示开启”的矛盾状态。

暂停时，悬浮颗粒的推进改用 `visualDelta`，因此固定对比不会因为截图等待时间不同而改变颗粒位置。鱼群与捕食者本来就由固定步长控制，不受影响。

## 8. 颜色管理复核

| 检查 | 结果 |
| --- | --- |
| Renderer outputColorSpace | `srgb` |
| Tone Mapping | ACES Filmic，exposure `0.98` |
| Base Color / Emissive | sRGB |
| Normal / Roughness / Metalness / AO | NoColorSpace |
| 主场景后处理 | 无 composer，仅直接 `renderer.render()` |
| 材质色彩空间审计 | `colorSpaceIssues: []` |
| 自定义穹顶/光柱/颗粒 | 各自包含 tonemapping 与 colorspace 输出 |
| 自定义 Shader 水体混合 | 排除，避免二次合成 |
| Fish / Predator Fog 重复 | 未发现 |

## 9. 验证

| 检查 | 结果 |
| --- | --- |
| Vitest | 26 个文件、176 项测试全部通过 |
| TypeScript `tsc --noEmit` | 通过 |
| Vite production build | 通过 |
| 桌面浏览器 smoke | `passed: true`，0 浏览器错误 |
| Laboratory 网格 + 水体 | 0 浏览器错误 |
| 分层截图模拟不变性 | `totalSteps` / `simulationTime` / 鱼数完全一致 |
| 截图 Draw Calls | 原始 42；完整 51 |
| 截图 Render Triangles | 原始 152,835；完整 152,851 |

证据文件：[最终报告](../test-artifacts/water-clarity/reports/final.json)、[旧路径报告](../test-artifacts/water-clarity/reports/legacy.json)、[浏览器 smoke](../test-artifacts/water-clarity/reports/smoke-results.json)。

### 性能测量说明

用户要求的 FPS / P95 已尝试记录，但 SwiftShader + headless 的结果不稳定且非单调。一次完整采集得到原始 P95 约 593 ms、仅传输约 16.7 ms、介质约 50.0 ms、颗粒约 33.4 ms、完整约 33.3 ms，样本只有 4–6 帧；另一次单独采集得到原始约 3.46 fps / P95 672.5 ms，完整约 5.29 fps / P95 616.6 ms，甚至出现“完整效果比原始更快”的矛盾结果。

因此这些数字**不能用于性能结论**，只能说明软件渲染的帧调度受初始化、编译和 headless 节流强烈干扰。真实硬件 FPS、P95 和 GPU timestamp 仍需在 Intel Iris Xe 上重新执行 `npm run accept:gpu`；本轮不声称 GPU 性能已验收。

## 10. 验收判断

| 目标 | 结果 |
| --- | --- |
| 近景鱼群清晰 | 通过；近景透射率约 97% 以上 |
| 中景鱼群可辨认 | 通过；对比如旧路径明显恢复 |
| 远景自然蓝化 | 通过；按通道平滑下降，无突然消失 |
| 无全屏蓝绿蒙层 | 通过 |
| 海藻保留深绿 | 通过 |
| 岩石保留明暗差异 | 部分通过；水体遮蔽已消除，但基础灯光下的岩石仍偏暗 |
| 沙地纹理可见 | 部分通过；焦散可见，但基底反射偏暗 |
| 鲨鱼眼睛/鳃裂 | 受低多边形资产与鱼群遮挡限制；轮廓和身体明暗清晰，极细节仍需资产或镜头调整 |
| 光束局部存在 | 通过；3 组主光柱，透明度降低 |
| 焦散不在鱼/鲨鱼身体上 | 通过；焦散仍只应用于海床、岩石、珊瑚 |

未完成项不是水体衰减造成的，而是基础灯光/材质与资产细节问题。本轮刻意没有用更亮的 inscattering 去掩盖它们，以免重新引入水体蒙层。

## 11. 主要文件与回退

新增或重写：

- `src/rendering/UnderwaterMedium.ts`
- `scripts/water-clarity.ts`
- `tests/UnderwaterMedium.test.ts`
- `docs/WATER_CLARITY_DIAGNOSIS.md`

修改：

- `src/rendering/lighting/UnderwaterLightingConfig.ts`
- `src/rendering/Environment.ts`
- `src/rendering/MarineSnow.ts`
- `src/rendering/SceneManager.ts`
- `src/rendering/CameraController.ts`
- `src/rendering/UnderwaterScattering.ts`（兼容导出）
- `src/ui/layout.ts`
- `src/ui/ControlPanel.ts`
- `src/style.css`
- `src/main.ts`
- `src/environment/UnderwaterOptics.ts` 测试适配
- `package.json`

回退视觉路径：

```text
http://localhost:5173/?water=legacy
```

该路径保留旧显示空间公式，但使用当前调色和密度，因此只用于确认“问题是否回来”，不是完整的历史源码快照。正式回退应同时恢复上述文件。旧的 Phase 3 源码归档仍在 `test-artifacts/visual-quality-phase3/phase-3-source.tar.gz`。
