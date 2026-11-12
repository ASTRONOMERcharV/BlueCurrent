# Blue Current — Visual Quality Phase 3：真实水下光照与材质

日期：2026-11-09  
范围：三层水下光照、基于视线距离的水体散射、海床动态焦散、随海流运动的悬浮颗粒。  
未包含：硬件 GPU 性能验收、正式视频录制、体积光（god ray）算法重写、海藻/海带表面的焦散投影。

本轮只修改渲染与环境表现，没有修改 Boids 行为、固定步长调度、Uniform Grid / Brute Force 共用逻辑或 SimulationWorld 的所有权边界。截图与数字来自真实 Three.js 运行；渲染器为 SwiftShader 软件渲染，不能当作硬件性能数据。

## 1. 修改前基线

Phase 2 结束时，整体海水接近单一深色，鱼群亮度几乎一致，背景与鱼群缺少前后层次。海床只有一层旧式屏幕空间焦散，悬浮颗粒是固定点云并整体旋转，没有与海流发生关系。

- [修改前：Calm 环境视图](../test-artifacts/visual-quality-phase3/before/calm-environment.png)
- [修改后：Calm 环境视图](../test-artifacts/visual-quality-phase3/after/calm-environment.png)
- [修改后：Predator 跟随视角（Attack 状态）](../test-artifacts/visual-quality-phase3/after/encounter-predator-environment.png)

## 2. 三层光照

新增 `src/rendering/UnderwaterLighting.ts`，取代原先的“半球光 + 两盏方向光”组合：

| 层 | 参数 | 作用 |
| --- | --- | --- |
| Sun | `0xe6f6ff`，强度 `1.7`，位置 `(-14, 34, 10)`，目标 `(0, 4, 0)` | 从水面进入的主光源，偏冷白 |
| Hemisphere | 天空 `0x7fc4d6` / 地面 `0x082229`，强度 `0.65` | 保留阴影侧可读性，同时压平环境漫反射 |
| Rim | `0x9feaff`，强度 `0.85` | 每帧按相机与 OrbitControls 焦点放到主体后上方，稳定勾出轮廓 |

Rim 光的位置不是固定世界坐标。`computeRimLightPose()` 根据相机位置和当前焦点计算“主体背后偏上”的灯光位置，并以 5–6/s 的阻尼跟随相机；聚焦目标移动时不会出现跳光。`SceneManager.update()` 在相机控制器更新之后调用 `Environment.update(time, frameDelta, camera, focus)`。

除场景级 Rim 光外，动物材质还加入了轻量 Fresnel 边缘项：

- 鲨鱼：强度 `0.75`、指数 `2.2`，轮廓更明显；
- 鱼群：强度 `0.18`、指数 `3.0`，只保留很薄的共同边缘，避免 500 条鱼被逐条打亮；
- 两者都乘以按世界高度 `2–18 m` 从 `0.68` 到 `1.0` 的深度衰减，让鱼群下半部分略暗，避免全体同一亮度。

渲染曝光从 `1.12` 降到 `1.0`，环境贴图强度从 `0.55` 降到 `0.42`。没有启用实时阴影：当前场景为 InstancedMesh 鱼群与海藻，阴影贴图成本会高于本轮视觉收益。

## 3. 视线距离水体散射

`src/environment/UnderwaterOptics.ts` 定义按通道衰减的公式，`src/rendering/UnderwaterScattering.ts` 在首次创建渲染器前替换 Three.js 的全局 `fog_fragment`：

\\[
C(d) = C_{object}\cdot e^{-\beta_{rgb} d} + C_{water}\cdot\left(1-e^{-\beta_{rgb} d}\right)
\\]

其中 `d = vFogDepth`，即片元到相机的视线距离，而不是物体相对海床的高度。基础密度为 `0.0095 /m`，RGB 乘数分别为 `1.38 / 1.06 / 0.78`，红光先消失，蓝绿保留最久。

水色贡献比例（`1 - e^{-βd}`）：

| 距离 | 红 | 绿 | 蓝 |
| ---: | ---: | ---: | ---: |
| 10 m | 12.3% | 9.6% | 7.1% |
| 25 m | 28.0% | 22.2% | 16.9% |
| 50 m | 48.1% | 39.5% | 30.9% |
| 80 m | 65.0% | 55.3% | 44.7% |

近景保留物体色，中景降低对比度，远景向水体颜色融合。海面颜色、`scene.background`、`scene.fog` 和背景穹顶使用同一组色值；穹顶改为深/中/上三段渐变，避免 3D 视口出现一条亮色水线。海面平面扩大为 `400 × 400 m`，其边缘落在雾中，不再产生可见矩形边。

一个容易忽略的管线问题是：Three.js 的 `fog_fragment` 在颜色空间转换之后执行，而 `fogColor` 是 linear working-space 颜色。直接混合会让水色被二次 gamma 压暗。本实现先在 chunk 内用 `sRGBTransferOETF` 编码 `fogColor`，再混合，确保配置的水色就是屏幕上的水色。

## 4. 海床动态焦散

新增 `src/rendering/Caustics.ts`，用世界坐标 XZ 计算连续焦散场，而不是按每个模型的 UV 重复：

- 三层域扭曲加高频细节，`pow` 后形成细亮光斑；
- 用世界法线的向上分量 `0.12 + 0.88·up^1.6` 控制强度，水平面最明显，垂直面只保留少量环绕光；
- 参与实例化网格：顶点着色器将 `instanceMatrix` 折入世界坐标和世界法线；
- 在 `<opaque_fragment>` 之后、Tone Mapping 之前加到 outgoing radiance；
- 共享 `uCausticTime` 与 `uCausticStrength`；勾选 Water Effects 时强度归零，关闭焦散。

应用范围与强度：

| 材质 | 强度 | 世界尺度 |
| --- | ---: | ---: |
| 海床 | 0.075 | 4.2 |
| GLB 岩石 / 沙丘 | 0.06 / 0.07 | 4.0 / 4.2 |
| 程序化礁石 | 0.06 | 4.0 |
| 珊瑚 | 0.04–0.045 | 3.6 |
| 远景 / 前景装饰岩 | 0.025–0.03 | 3.5 |

海带、海草、鱼和鲨鱼没有叠加焦散：它们已有自己的摆动/游动着色，继续加投影会增加片元成本并让画面过亮。这是本轮的有意取舍。

## 5. 随海流运动的 Marine Snow

`src/environment/MarineSnowField.ts` 是纯逻辑、可单测的部分；`src/rendering/MarineSnow.ts` 是一次 `Points` 绘制：

- 950 个粒子，固定种子 `0x5eaf00d`；
- 体积 `[-30, 0.8, -30]` 到 `[30, 19.6, 30]`，超出后按轴回绕；
- 每个粒子每帧采样同一个 `OceanCurrentField`，水平速度乘以 `1.15` 可视化系数；
- 12% 为微小气泡，垂直速度为正（上浮）；其余缓慢下沉；
- 顶点着色器按视深缩放点尺寸，并在近处 `2–7 m`、远处 `42–70 m` 淡出，避免近处出现大块白色圆点；
- 片元用圆形软边、轻微闪烁与加法混合。

因此颗粒运动来自与海带摆动相同的基础流、周期湍流和礁石涡旋，不是独立随机漂移。粒子的数量与回绕体积是视觉参数，不是生态粒子浓度。

## 6. 材质统一与其它调整

- 岩石/沙丘的蓝色实例 tint 与海床冷色，避免暖棕岩石在蓝绿水中成为突兀色块；共享图集再乘一层轻微冷色。
- 海带基色与两组 tint 降饱和并略降亮度，保持温带海藻的橄榄绿，而不是荧光绿。
- 程序化鱼群的实例明度范围扩大到 `0.24–0.42`，加强群体内部层次；鲨鱼贴图乘以冷色，减少原贴图的粉红色偏。
- 光柱在相机接近时按视深淡出，修复 Predator 跟随视角中靠近光柱平面时出现的硬边楔形。
- 当前截图中的 12 个温带珊瑚来自并行进行的珊瑚克制模式；本轮没有修改珊瑚数量规则。

## 7. 验证

| 检查 | 结果 |
| --- | --- |
| Vitest | 24 个测试文件、167 项测试全部通过 |
| TypeScript `tsc --noEmit` | 通过 |
| Vite production build | 通过；仅有 Three.js core chunk 体积提示 |
| Browser smoke（desktop + mobile） | `passed: true`，0 浏览器错误 |
| Calm 环境截图 | 真实 Three.js + GLB，0 浏览器错误 |
| Predator 跟随截图 | 真实 Three.js + GLB，0 浏览器错误 |
| 水下光学单测 | 6 项通过（单调性、通道顺序、互补性、非法输入） |
| Marine Snow 单测 | 8 项通过（确定性、随流、回绕、沉降/上浮、采样次数） |

`test-artifacts/smoke-results.json` 记录 smoke 的 `passed: true` 与空 `browserErrors`。桌面与移动截图分别是 `test-artifacts/blue-current-desktop.png` 与 `blue-current-mobile.png`。

同一 Calm 环境的截图诊断：

| 指标 | Phase 2 基线 | Phase 3 |
| --- | ---: | ---: |
| 鱼数 | 500 | 500 |
| Average Neighbors | 76.68 | 76.68 |
| Draw calls | 52 | 48 |
| Render triangles | 231,033 | 143,025 |
| 珊瑚 | 48 | 12（并行温带模式） |
| 浏览器错误 | 0 | 0 |

Draw calls 与三角形数下降主要来自并行会话的珊瑚克制模式，不是本轮的雾/焦散/粒子改动；两组截图因此不是纯粹的 Phase 3 A/B 性能对照。SwiftShader 的 `renderMs`/FPS 同样不能用于硬件判断。

Observatory 的完整 `--stage=checks` 在进入新增的 `?coral=full` 页面时因 SwiftShader 页面加载超时没有生成最终报告；本轮改动不涉及模式切换或模拟步进，模式不变性仍由既有测试与 smoke 覆盖。硬件验收仍是下一项独立工作。

## 8. 性能与风险

- 焦散是新增的主要片元成本：受影响材质每片元增加约 12 次三角函数；海床占屏幕面积大，建议在 Intel Iris Xe 上以 500 鱼复测。
- Marine Snow 每帧在 CPU 采样 950 次 `OceanCurrentField`，并上传一次位置缓冲；这比独立随机点云多一次流场采样，但仍只有一个 draw call。
- 全局 `ShaderChunk.fog_fragment` 替换会影响所有启用 fog 的内置材质；自定义 ShaderMaterial（穹顶、光柱、颗粒）不受影响。
- Water Effects 开关会同时关闭焦散、颗粒、海面和光柱，可作为演示时的性能降级开关。
- 真实 Windows GPU 的 500/1000/2000 FPS、P95 与 GPU timestamp 尚未重新测量；不能把本轮截图中的 FPS 当作硬件结果。

## 9. 文件与回退

新增：

- `src/environment/UnderwaterOptics.ts`
- `src/environment/MarineSnowField.ts`
- `src/rendering/UnderwaterScattering.ts`
- `src/rendering/UnderwaterLighting.ts`
- `src/rendering/Caustics.ts`
- `src/rendering/MarineSnow.ts`
- `tests/UnderwaterOptics.test.ts`
- `tests/MarineSnowField.test.ts`

修改：

- `src/rendering/Environment.ts`
- `src/rendering/SceneManager.ts`
- `src/rendering/FishRenderer.ts`
- `src/rendering/PredatorRenderer.ts`
- `src/rendering/KelpScatter.ts`
- `src/rendering/KelpAsset.ts`
- `src/rendering/RockScatter.ts`
- `scripts/visual-quality-capture.ts`（新增 `--out` / `--camera` / `--steps`）
- `scripts/browser-smoke.ts`（新增 `--port`）
- `scripts/observatory-acceptance.ts`（为 full-coral 页面设置 120 s 超时）

归档：

- `test-artifacts/visual-quality-phase3/phase-2-source.tar.gz` 是 Phase 3 开始时的近似快照，SHA-256 `5cc1532b3969f76bf6430a7ab0c9ad3b04e238be48d32b4f7aeee4ac416a7cf2`。它在并行珊瑚会话尚未结束时截取，因此不是“只回退 Phase 3”的干净补丁。
- `test-artifacts/visual-quality-phase3/phase-3-source.tar.gz` 是本轮结束时的完整源码快照，供 Phase 4 前回退；SHA-256 见同目录 `.sha256` sidecar。
