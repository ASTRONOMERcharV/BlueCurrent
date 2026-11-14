# Blue Current

**A Real-time 3D Predator–Prey Flocking Simulation**

Blue Current 是一个独立的 TypeScript + Three.js 实时生态观测系统：500 条初始猎物鱼通过局部 Boids 规则形成群体，在三维水域中避开礁石、响应捕食者，并在威胁离开后重新组织；另有 100 条小丑鱼组成独立礁区鱼群。默认 Observation 场景使用两套 Blender GLB 鱼模型、完整 48 株珊瑚、91 株海藻、6 处细节海菜、完整岩石/沙丘集以及用户提供的 shayu 捕食者；`?fish=procedural` 可回退程序化主鱼群，所有 GLB 加载失败都有回退路径。`?environment=bare` 可恢复轻量场景。

本目录与 `Project/ElementalWorld` 完全分离，没有修改原有水火蒸汽项目。

## 当前完成范围

已实现：

- SoA（Structure of Arrays）鱼群数据、双缓冲更新、60 Hz 固定模拟步长和插值渲染。
- Separation、Alignment、Cohesion，各自独立的感知半径和权重。
- 可切换的三维 Uniform Grid / Brute Force 邻居搜索，两种搜索共用相同行为计算。
- Patrol / Pursuit / Attack / Search 捕食者状态机、预测追踪、捕获与存活数量变化。
- 距离相关的猎物逃逸、预测式球体避障、软边界和最终安全约束。
- Three.js `InstancedMesh` 鱼群、速度朝向、转弯倾斜和每鱼不同相位的尾鳍顶点动画。
- Blender School Fish GLB（1,448 三角形、PBR 贴图、`_TAILWEIGHT` 顶点权重、双材质实例化）默认启用；`?fish=procedural` 回退程序化几何。加载或契约校验失败时自动回退。
- Blender Clownfish School GLB（2,399 三角形、1024² 双 JPEG 贴图、`_TAILWEIGHT`、单材质实例化）默认启用，100 条独立礁区鱼群，0.50–0.60 m，围绕第一礁石上方的海葵区活动；`?clownfish=0` 关闭，`?clownfish=N` 调整数量（0–400）。主鱼群世界长度同步调整为 0.90–1.10 m，两种鱼比例约 1.9:1。
- Blender Predator（用户 shayu 模型）**rigged SkinnedMesh**（9,826 三角形、3 材质、11 骨骼、1024² PBR 贴图、口腔 + 牙齿；`PredatorAnimationController` 程序化驱动身体行波、尾鳍摆动、转弯弯曲、平滑俯仰、胸鳍迎角、攻击包络与转弯侧倾）；默认启用，`?predator=shayu` 回到静态 GLB，`?predator=v2` 切换 v2 大白鲨，`?predator=procedural` 回退程序化捕食者。
- 六种 Blender 珊瑚基地模（枝状、桌面、管状海绵、扇状、脑珊瑚、海葵；1.9k–2.9k 三角形，共享 1024² 图集）。默认使用最丰富层：五礁石 + 远景 + 前缘的 48 实例 / 6 个 `InstancedMesh` / 121,728 三角形，分物种 3.6–4.2× 放大到约 1.2–5.0 m 高；`?coral=temperate` 回到 12 实例温带层，`?coral=0` 关闭。独立预览仍为 `preview/coral-preview.html`。
- 13 个 Blender 岩石/沙丘资产（3 大礁石、4 中岩石、4 碎石、2 沙丘；7,869 三角形，2048² 法线/AO 共享图集），默认在主场景替换 5 块主礁石并按固定种子散布 54 个装饰实例；`?glbRocks=0` 关闭，`?environment=bare` 使用轻量环境，失败回退。
- 两株 Blender 海藻基地模（`kelp_a` 密集卷曲丛 184 三角形 / `kelp_b` 宽叶扇 168 三角形；`_SWAYWEIGHT` + `_BLADEPHASE` 顶点摆动，每株/每叶独立相位），默认在主场景左右林带散布 91 株（48 + 43）；`?kelp=0` 关闭，独立预览 `preview/kelp-preview.html`。同一份 91 株布局同时驱动渲染与 `KelpRefugeField` 物理庇护场：竖直圆柱遮蔽、海藻后恐惧衰减、覆盖拖速、受威胁时寻找遮蔽和真实 `shelteredCount` 指标。
- 用户提供的细节海菜丛（13,792 三角形、1.2 m、3 × 2048² PBR 贴图、302 个独立叶片组件；岩石/海星底座静止，叶片按组件相位摆动）默认在主场景放置 6 株英雄实例；`?seaweed=0` 关闭，独立预览 `preview/seaweed-preview.html`。
- 前、中、远三层海底构图、水下颗粒、动态焦散、水面光束、深度雾效，以及 Overview / School Follow / Predator Focus / Free 四种平滑相机。
- 科研观测仪桌面布局、可折叠四区控制台、Observation / Laboratory 双模式、真实邻居/行为力/目标调试图层和移动端底部抽屉。
- 三个固定种子演示场景：Calm Ecosystem、Predator Encounter、Obstacle Navigation；统一种子重置与确定预热，不新增行为算法。
- 确定性、网格一致性、避障、捕获及固定步长自动化测试。
- 无渲染 CPU 基准、Boids 消融和捕食者三阶段实验脚本及原始 JSON/CSV。
- 正式实验报告、环境验证记录、演示录制脚本和真实运行截图。

后续开发总入口：[Blue Current Development Roadmap](docs/DEVELOPMENT_ROADMAP.md)。A/B/C 单项实验已有证据，但 **Integration Gate 尚未执行，Phase D–G 尚未启动**；后续顺序为整合验收 → 环境视觉深化 → 生态行为 → 真实硬件性能验收 → 产品化交付，未通过整合验收前不进入新的 Phase D。

正式文档：

- [后续开发路线与 Integration Gate](docs/DEVELOPMENT_ROADMAP.md)
- [本机硬件 GPU 验收分析（2026-11-09）](docs/GPU_ACCEPTANCE_2026-11-09.md)
- [观测台布局与验收](docs/OBSERVATORY_LAYOUT.md)
- [礁群主从关系、Overview 与生态构图](docs/REEF_COMPOSITION.md)
- [构图外部评审参数包（世界/镜头/UI 数值）](docs/REEF_COMPOSITION_PARAMETERS.md)
- [海藻庇护场与珊瑚分档](docs/KELP_REFUGE_AND_CORAL_TIER.md)
- [礁石碰撞代理实验 A：设计与实现](docs/REEF_COLLISION_PROXY_EXPERIMENT.md)
- [礁石碰撞代理实验 A：交付报告](docs/REEF_COLLISION_PROXY_EXPERIMENT_REPORT.md)
- [最终实验报告](docs/FINAL_REPORT.md)
- [性能与技术实验分析](docs/BENCHMARK_RESULTS.md)
- [验证记录](docs/VALIDATION_REPORT.md)
- [演示视频录制脚本](docs/DEMO_VIDEO_SCRIPT.md)
- [Blender 资产规格](docs/ASSET_SPEC.md)
- [双鱼群与小丑鱼资产验收](docs/CLOWNFISH_SCHOOL.md)
- [Blender 资产制作流程与验收](docs/ASSET_PIPELINE.md)
- [Blender 资产契约](docs/BLENDER_ASSET_CONTRACT.md)
- [Blender MCP 配置清单](docs/BLENDER_MCP_SETUP.md)
- [Blender Agent 提示词](docs/BLENDER_AGENT_PROMPTS.md)

外部 GLB 模型现在默认接入完整岩石/沙丘集、48 株珊瑚、91 株海藻、6 处细节海菜、两套 Blender 鱼模型和用户 shayu 捕食者。`?coral=temperate` 恢复 12 株温带珊瑚，`?coral=0` 关闭珊瑚；`?fish=procedural` 回退程序化主鱼群；`?clownfish=0` 关闭小丑鱼群，`?clownfish=N` 调整其数量（0–400）。`?environment=bare` 关闭完整岩石/珊瑚/海藻环境，`?glbRocks=0`、`?kelp=0`、`?seaweed=0` 可分别关闭对应层，`?glbRocks=1` 保留 legacy 单礁石入口。所有加载或契约校验失败均自动回退；小丑鱼资产失败时第二鱼群自动关闭，不会用普通鱼冒充。当前为双鱼群、单捕食者；尚未实现多捕食者、WebGPU Compute 和 LOD。鱼群避障支持可切换的球体基线或基于真实 GLB 变换的 SDF 复合代理（实验 A，默认仍为球体，`?obstacleShape=reefProxy` 启用；详见实验文档）。鱼体碰撞采用个体间分离力，而不是刚体接触求解。正式演示视频尚未录制，需在本机硬件 GPU 环境完成；当前提供录制脚本和真实运行截图。

## 运行

推荐 Node.js 22（Vite 7 要求 Node.js 20.19+ 或 22.12+）。

```bash
npm ci
npm run dev
```

打开终端显示的本地地址。首次运行只需以上两步，不需要素材目录。`npm install` 也可使用，但本交付的锁文件已经固定，优先使用 `npm ci` 重现验证环境。

```bash
npm run build       # TypeScript 类型检查 + 生产构建
npm run preview     # 预览 dist/
npm test            # Vitest 算法测试
npm run smoke       # Playwright 桌面/移动浏览器验收
npm run smoke:demo  # 90 s Demo Mode 的 16:9、技术网格与时间线验收
npm run accept:observatory  # 观测台双模式/三场景/相机/移动抽屉/真实数据验收
npm run smoke:glb   # GLB 礁石浏览器验收（?glbRocks=1）
npm run benchmark   # 暴力搜索 / Uniform Grid 性能实验
npm run benchmark:observatory  # 导航场景同种子、无渲染、4 次重复 CPU 对比
npm run experiment:ablation
npm run experiment:predator
npm run figures
npm run capture:demo -- --desktop-only
npm run smoke:fish        # Blender School Fish 集成/资产契约/浏览器错误
npm run smoke:predator    # Blender Predator 集成/资产契约/Chase/组合 GLB（默认 rigged shayu）
npm run smoke:predator:shayu  # 静态 shayu Hero/Close/Chase/Main 专项验收
npm run smoke:predator-animation  # 骨骼程序游动：巡游/左右转/升降/冲刺/恢复（SwiftShader 可加 -- --phase=a|b）
npm run smoke:predator-animation:main  # 主场景 rigged 默认路径集成
npm run capture:predator-animation     # 固定帧截图（Side/Top/Front/Quarter/Skeleton）
npm run video:predator-animation       # 26 s 连续机动序列 WebM
npm run smoke:coral       # 六种珊瑚 GLB 加载/契约/实例化预览
npm run smoke:rocks       # 13 个岩石/沙丘 GLB 主场景验收（?glbRocks=2）
npm run smoke:rocks-preview  # 岩石独立预览页验收（13 资产 / 7,869 三角形）
npm run smoke:kelp        # 两株海藻 GLB 预览 + 摆动 + 主场景 ?kelp=1 验收
npm run smoke:seaweed     # 细节海菜预览 / 资产契约 / 摆动验收
npm run smoke:seaweed:main    # 主场景 ?seaweed=1 诊断与截图
npm run smoke:seaweed:combo   # 细节海菜 + 完整岩石/珊瑚/低模海藻组合检查
npm run accept:gpu        # 本机硬件 GPU 验收（四组场景 × 500/1000/2000）
npm run perf:fish -- --mode=blender --counts=500,1000,2000 --gpu
npm run quality:behavior     # 三个固定种子的鱼群空间/逃逸指标
npm run quality:benchmark    # 500/1000/2000 无渲染 CPU 扩展测量
npm run quality:capture -- --scenario=calm --view=console  # 真实浏览器截图
```

生产文件位于 `dist/`。请通过 HTTP 服务器访问，不要直接双击 `index.html` 使用 `file://`。实际全部命令以 `package.json` 为准。

## Demo Mode

90 秒演示时间线只控制固定种子场景、相机、Observation/Laboratory、搜索模式和 UI 显隐；鱼群、捕食目标与捕食状态仍由 `SimulationWorld` 更新。

```text
/?demo=cinematic
```

该入口会隐藏浏览器页面内的控制台和指标 UI，使 3D 画布填满 16:9 录制区域。53–70 秒自动展示 Uniform Grid、Brute Force 与网格返回。调试接口提供 `getDemoState()`、`restartDemo()`、`stopDemo()` 和仅用于预检的 `seekDemo(seconds)`。

视频方案与拍摄交付：

- [项目审查](docs/demo-video/project-audit.md)
- [90 秒分镜](docs/demo-video/storyboard.md)
- [镜头清单](docs/demo-video/shot-list.md)
- [录制检查表](docs/demo-video/capture-checklist.md)

视觉质量 V1 的鱼群行为、温带海藻森林布局、A/B CPU 性能、截图和待办项见 [docs/VISUAL_QUALITY_V1.md](docs/VISUAL_QUALITY_V1.md)。

GLB 礁石：默认主场景加载完整 13 资产岩石/沙丘集。`?glbRocks=1` 使用 legacy `public/models/reef_rock_a.glb`；`?glbRocks=2` 显式选择完整集；`?glbRocks=0` 或 `?environment=bare` 回退轻量环境。对应浏览器验收分别为 `npm run smoke:glb` 与 `npm run smoke:rocks`。

## Blender 资产（实验）

`public/models/fish_school.glb`、`public/models/clownfish_school.glb`、`public/models/predator_shayu_rigged.glb`（默认，11 骨骼 SkinnedMesh）、`public/models/predator_shayu.glb`（静态回退）、`public/models/predator_reef_shark.glb`（v2 备选）、六个 `coral_*.glb` / `sponge_tube.glb` / `anemone.glb`、`public/models/kelp_a.glb` / `kelp_b.glb`、`public/models/seaweed_detail.glb`，以及 `public/models/rocks/` 下的 13 个岩石/沙丘 GLB，是由 `assets_src/scripts/` 下的 Blender 5.2 脚本生成并导出的资产，规格见 [docs/ASSET_SPEC.md](docs/ASSET_SPEC.md)。GLB 均为本地文件，不依赖网络；完整环境、两套鱼模型和 rigged shayu 捕食者默认加载：

| 入口 | 作用 |
| --- | --- |
| `/?fish=procedural` | 主鱼群回退程序化几何；默认 `/` 已加载 `fish_school.glb`。 |
| `/?clownfish=0` | 关闭 100 条小丑鱼组成的第二鱼群；默认 `/` 启用。 |
| `/?clownfish=200` | 调整小丑鱼数量（0–400），独立于主鱼群数量。 |
| `/?fishCount=150` | 降低主鱼群数量，便于快速调试。 |
| `/?predator=v2` | 切换到 v2 大白鲨 GLB（4 材质 / 5,990 三角形）；默认 `/` 已加载 rigged shayu（3 材质 / 9,826 三角形 / 11 骨骼）。 |
| `/?predator=shayu` | 回退到静态 shayu GLB（旧的 `_TAILWEIGHT` + Shader 路径）。 |
| `/?predator=rigged` | 显式选择 rigged shayu（与默认相同）。 |
| `/?predator=procedural` | 显式回退程序化捕食者。 |
| `/?glbRocks=2` | 完整岩石集：5 块主礁石换成 3 种大型礁石，并散布 16 中岩石 / 33 碎石 / 5 沙丘（固定种子）；默认 `/` 已启用。 |
| `/?glbRocks=0` | 关闭完整岩石集。 |
| `/?kelp=1` | 低模海藻层（当前布局 91 株：48 `kelp_a` + 43 `kelp_b`）；默认 `/` 已启用。 |
| `/?kelp=0` | 关闭低模海藻层及海藻庇护场。 |
| `/?coral=temperate` | 回到 12 株温带珊瑚层；默认 `/` 为 48 株完整珊瑚。 |
| `/?coral=0` | 关闭珊瑚层。 |
| `/?seaweed=0` | 关闭 6 株细节海菜；默认 `/` 启用。 |
| `/?environment=bare` | 关闭完整岩石/珊瑚/海藻环境，只保留基础场景。 |
| `/preview/index.html` | 所有独立资产、礁石和动画预览的总览入口。 |
| `/preview/fish-preview.html?mode=hero` | Fish 独立资产转台：材质、贴图、包围盒、尾部属性、GLB 大小。 |
| `/preview/fish-preview.html?mode=school&count=500` | 真实 Boids + `FishRenderer` 实例化路径。 |
| `/preview/fish-preview.html?mode=school&close=1` | Fish 近景检查鳞片、眼睛、鳍和尾摆。 |
| `/preview/predator-preview.html?mode=hero` | 静态 shayu 独立转台：三角形、3 材质、长度、尾权重、三张贴图；自动演示 C 形弯曲、倾斜与加速/减速；导航可切换 V2 / Phase 2。 |
| `/preview/predator-animation-preview.html` | rigged shayu 程序化游泳测试：巡航/左转/右转/上升/下潜/冲刺/恢复，Side/Top/Front/Quarter 视图、骨骼开关、固定时间 `?t=12.5&view=top&hud=0`。 |
| `/preview/predator-preview.html?mode=close` | Predator 头部/嘴部/鳃裂/胸鳍近景。 |
| `/preview/predator-preview.html?mode=chase` | 真实捕食者 FSM 追逐 400 条鱼，验证尾摆、转弯倾斜与集成路径。 |
| `/preview/predator-preview.html?mode=hero&poseTime=2.856&view=top` | 固定强转弯姿态的俯视检查，用于对照脊柱弯曲和尾部延迟。 |
| `/preview/coral-preview.html` | 六种珊瑚基地模的实例化预览：40 株、共享 1024² 图集、随机缩放/旋转/成簇。 |
| `/preview/kelp-preview.html` | 两株海藻的实例化预览：15 株、每株/每叶独立摆动相位、共享单材质。 |
| `/preview/seaweed-preview.html` | 细节海菜预览：5 株、302 个叶片组件相位、3 张 2048² PBR 贴图。 |
| `/preview/rocks-preview.html` | 13 个岩石/沙丘资产阵容 + 三角形列表；验证共享 2048² 图集与材质。 |
| `/preview/rocks-preview.html?focus=reef_large_a` | 单一岩石近景（可替换为任一资产名）。 |
| `/preview/reef-sample-preview.html` | Hero 礁石组合的独立工作室预览（near/mid/far LOD、表生物）。 |
| `/preview/reef-variants-preview.html` | Hero、Spire、Platform、Twin、Terraces 五种礁石变体对照。 |

资产管线命令（细节见 [docs/ASSET_PIPELINE.md](docs/ASSET_PIPELINE.md)）：

```bash
python3 assets_src/scripts/generate_fish_textures.py
python3 assets_src/scripts/verify_fish_glb.py
npm run smoke:fish
npm run perf:fish -- --mode=blender --counts=500,1000,2000 --gpu

python3 assets_src/scripts/verify_clownfish_glb.py
npm run smoke:rich
# Blender 会话内执行：build_clownfish_school.py（导入 light GLB → 焊接 → 减面 → 尾权重 → 导出）

python3 assets_src/scripts/generate_shayu_maps.py
python3 assets_src/scripts/verify_predator_glb.py public/models/predator_shayu.glb
# Blender 内执行：assets_src/scripts/import_shayu_predator.py
npm run smoke:predator
npm run smoke:predator:shayu

python3 assets_src/scripts/generate_coral_textures.py
python3 assets_src/scripts/verify_coral_glbs.py
npm run smoke:coral

python3 assets_src/scripts/compose_rock_atlas.py
python3 assets_src/scripts/verify_rocks_glb.py
npm run smoke:rocks
npm run smoke:rocks-preview
# Blender 会话内按顺序执行：build_rocks.py → bake_rocks.py → finalize_rocks.py

python3 assets_src/scripts/verify_kelp_glbs.py
npm run smoke:kelp
# Blender 会话内执行：build_kelp.py → render_kelp_previews.py

python3 assets_src/scripts/verify_seaweed_glb.py
npm run smoke:seaweed
npm run smoke:seaweed:main
npm run smoke:seaweed:combo
# Blender 会话内执行：build_seaweed_detail.py → render_seaweed_detail_previews.py
```

注意：沙箱内 Playwright 使用 SwiftShader，软件渲染帧率不代表本机 GPU；`--gpu` 会启动带界面的浏览器，结果 JSON 中会记录实际的 WebGL renderer。2026-11-09 已在 Intel Iris Xe 硬件路径完成四组合 × 500/1000/2000 实测：500 鱼通过实时目标，1000/2000 受 CPU 模拟与密集邻居查询限制，尚未通过；真正的 GPU timestamp 仍未测量。详见 [本机硬件 GPU 验收分析](docs/GPU_ACCEPTANCE_2026-11-09.md)。

## 本机 GPU 验收

沙箱无法访问本机 GPU，以下命令需要在 Windows 终端执行：

```bash
cd C:\Users\86159\Desktop\CA-ComputerAnimation\Project\BlueCurrent
npm ci
npx playwright install chromium
npm run accept:gpu
```

脚本会打开带 GPU 的 Chromium，先读取 `WEBGL_debug_renderer_info`；如果检测到 SwiftShader/llvmpipe 会直接失败（退出码 2），避免把软件渲染误当成 GPU 结果。随后它自动运行四组场景（procedural、GLB 鱼、GLB Predator、组合 GLB），每组 500 / 1000 / 2000 条鱼，记录 FPS、Mean / P50 / P95 帧时间、draw calls、鱼/捕食者三角形和截图，输出到：

```text
test-artifacts/gpu-acceptance/<timestamp>/results.json
test-artifacts/gpu-acceptance/<timestamp>/summary.md
test-artifacts/gpu-acceptance/latest.json
test-artifacts/gpu-acceptance/latest.md
```

保持浏览器窗口可见、笔记本接通电源并关闭其他占用 GPU 的程序。若默认 Chromium 检测不到硬件 GPU，可改用本机 Chrome/Edge：

```bash
npm run accept:gpu -- --channel=chrome
npm run accept:gpu -- --channel=msedge
```

`FPS` 受显示器刷新率上限影响；重点看 P95 帧时间。验收后把 `latest.md` / `latest.json` 或截图路径发给我，我按实测数据更新结论。

## 界面操作

| 控件 | 实际作用 |
| --- | --- |
| `Pause / Resume` | 暂停或恢复固定步长模拟；相机仍可操作。 |
| `Reset` | 使用相同种子和当前参数恢复初始状态。 |
| `Speed` | 以 0.25×、0.5×、1×、1.5× 或 2× 改变模拟时间推进速度。 |
| `Initial fish count` | 100–2000；松开滑块后重建本模拟，捕获数和时间归零。 |
| `Uniform grid / Brute force` | 只替换邻居候选来源，不替换 Boids 规则。 |
| `Separation / Alignment / Cohesion` | 实时修改对应行为权重。 |
| `Perception radii` | 修改三个独立半径和视野角；360° 表示无方向裁剪。 |
| `Evasion response` | 修改距离相关的逃逸力权重。 |
| `Predator aggression` | 修改检测半径与追逐速度。 |
| `Release` | 将捕食者放到群体附近，随后仍由状态机自主决策。 |
| `Retreat` | 将捕食者撤到远处并暂时抑制重新检测，观察自然恢复。 |
| `Reef obstacles` | 同时切换五个真实碰撞体及其渲染，不只隐藏模型。 |
| `Occupied grid cells` | 显示当前实际占用单元；暴力搜索时显示 `N/A`。 |

| `Observation / Laboratory` | 只切换 UI 与调试图层；固定种子回归证明不会改变模拟计算。 |
| `Calm / Encounter / Navigation` | 应用固定种子、完整行为基线和确定预热步数的三种演示场景。 |
| `Overview / School / Predator / Free` | 平滑切换全局、群体跟随、捕食者跟随和自由相机。 |

自由相机中鼠标拖动旋转、滚轮缩放、右键拖动平移。快捷键：`Space` 暂停，`R` 重置，`G` 切换网格线框（并进入 Laboratory）。窄屏控制台从底部展开。

## 模拟实现

### 数据与更新顺序

每条鱼的位置和速度分别存储在连续 `Float32Array` 中：

```text
positions = [x0, y0, z0, x1, y1, z1, ...]
velocities = [vx0, vy0, vz0, vx1, vy1, vz1, ...]
```

一个固定步内，所有个体读取当前帧数组，将结果写入 `nextPositions / nextVelocities`，完成全部计算后再交换缓冲区。因此个体编号不会改变同一步内的行为结果。高频循环使用预分配邻居数组和临时向量，避免为每条鱼创建对象。

渲染使用 `previousPositions` 与当前位置按累加器比例插值。单帧最多补算 8 步，输入帧差限制为 150 ms，防止卡顿后进入无限追帧。

### Boids

对邻居集合 \(N_i\)：

\[
S_i=-\sum_{j\in N_i}\frac{p_j-p_i}{\|p_j-p_i\|^2+\epsilon}
\]

\[
A_i=\frac{1}{|N_i|}\sum_{j\in N_i}v_j-v_i,\qquad
C_i=\frac{1}{|N_i|}\sum_{j\in N_i}p_j-p_i
\]

合力还包含逃逸 \(E_i\)、避障 \(O_i\) 和软边界 \(B_i\)：

\[
a_i=w_sS_i+w_aA_i+w_cC_i+w_pE_i+O_i+B_i
\]

加速度和速度均有上限。猎物受惊时允许最高 25% 的短期速度/加速度提升。分离在所有方向生效；视野角只裁剪对齐和聚合感知。

默认调试参数为：分离半径 1.4、对齐半径 4、聚合半径 6；权重分别为 2.4、0.9、0.32；最大速度 6。它们不是理论最优值，可在面板中继续调节。

### 三维均匀网格

网格单元边长为 \(h=R_{max}\)，其中 \(R_{max}\) 是三个感知半径的最大值。每帧通过 `head[cell]` 与 `next[fish]` 重建链表索引。查询只检查相邻 27 个单元，再执行精确距离筛选。

当单元尺寸不小于查询半径时，27 单元查询不会漏掉球体内邻居。测试在多个半径、边界位置和死亡个体条件下，逐一比较网格与暴力搜索的排序后邻居集合。

网格仍可能退化：鱼群非常密集时，相邻单元包含大量个体，而且三项规则、避障和积分成本并未因网格消失。因此应使用实测数据，而不是只写平均复杂度结论。

### 捕食者与环境

捕食者定期选择检测范围内的最近猎物，追逐时使用：

\[
p_{target}=p_{prey}+t\,v_{prey},\qquad
t=clamp(d/|v_{predator}|,0,1.1)
\]

目标具有保持时间、丢失半径、攻击持续时间与捕获后的检测冷却，避免每帧切换目标。只有进入捕获半径后才会移除一条存活鱼，界面捕获数由该事件累加。

礁石使用与渲染位置一致的五个球体。避让力同时考虑当前位置与短时间预测位置，并加入切向分量；积分后还有安全投影，防止数值误差导致穿入球体。水域边界以二次增长的软力为主，最终位置约束仅作为安全保障。

## 统计口径

- `Simulation step`：当前固定步耗时的指数滑动平均，不包含 Three.js 渲染。
- `Render CPU`：场景更新和 WebGL 提交的 CPU 时间，**不是 GPU 时间**。
- `Frame rate`：`requestAnimationFrame` 的实际显示帧率。
- `Avg. neighbors`：每条存活鱼在最大感知半径内的平均邻居数。
- `Schools ≥ 5 fish`：以 3.2 单位距离建立无向连接后的连通分量数，忽略少于 5 条鱼的碎片；每 30 步更新。
- `Group dispersion`：回旋半径 \(R_g=\sqrt{\frac1N\sum_i\|p_i-\bar p\|^2}\)。
- `Direction agreement`：单位速度合向量长度除以存活数量，即 0–1 的极化指标。
- `Occupied cells`：只来自真实网格；暴力搜索显示 `N/A`，不填估计值。

## 性能实测

运行：

```bash
npm run benchmark
```

默认测试 100 / 250 / 500 / 1000 / 2000 条，预热 60 步，测量 300 步，重复 5 次。快速检查：

```bash
npm run benchmark -- --quick
# 或自定义
npm run benchmark -- --counts=100,250,500,1000,2000 --steps=120 --repeats=3 --warmup=40
```

脚本关闭捕食者以保持数量不变，保留避障和边界，关闭额外群体统计，不创建 Three.js 渲染器。每次重复都从相同种子开始。输出：

- `benchmark/latest-results.csv`：汇总表。
- `benchmark/latest-results.json`：环境、参数、汇总和每轮原始测量。

本原型随附一次实际运行结果（2026-11-08，Linux，Node 22.23.4，i7-13700H，沙箱分配 2 个逻辑核；120 步 × 3 次，预热 40 步）：

| 鱼数 | 暴力平均步耗时 | 网格平均步耗时 | 暴力 P95 | 网格 P95 | 实测加速比 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 0.525 ms | 0.617 ms | 0.748 ms | 0.894 ms | 0.85× |
| 250 | 2.828 ms | 2.634 ms | 3.163 ms | 2.930 ms | 1.07× |
| 500 | 9.454 ms | 8.341 ms | 10.248 ms | 9.118 ms | 1.13× |
| 1000 | 28.223 ms | 23.849 ms | 35.674 ms | 29.427 ms | 1.18× |
| 2000 | 86.222 ms | 68.642 ms | 123.376 ms | 103.089 ms | 1.26× |

这里的 `1000 / meanStepMs` 只是模拟模块理论吞吐，不是显示 FPS。小规模和密集群体下网格可能不占优；2000 条在本测试中也没有达到 60 Hz 模拟预算。不同设备、浏览器和参数必须重新测量。`benchmarks/` 另含消融、捕食者实验和图表生成脚本。

## 验证

```bash
npm test
npx playwright install chromium   # 首次浏览器验收
npm run smoke
```

`npm run smoke` 会自行启动 Vite，检查真实 WebGL 画布、运行步进、暂停后的精确 120 步、搜索切换、Brute Force 下网格 `N/A` 与开关状态、桌面布局和移动端抽屉，并输出：

- `test-artifacts/smoke-results.json`
- `test-artifacts/blue-current-desktop.png`
- `test-artifacts/blue-current-mobile.png`

本次已通过 31 项 Vitest 测试、生产构建和 Playwright/Chromium 验收，浏览器无脚本错误；桌面运行截图与诊断保存在 `screenshots/`。沙箱浏览器使用 **SwiftShader 软件渲染**，其低 FPS 不代表本机 GPU 性能；仍建议在本机 Chrome/Edge 做一次硬件加速下的视觉和交互验收。验收的当前状态、限制和干净目录结果见 [VALIDATION_REPORT.md](docs/VALIDATION_REPORT.md)。

调试接口 `window.__blueCurrent` 提供诊断读取、暂停、固定步进、重置、搜索切换和场景操作，便于复现浏览器测试。接口数值直接来自 `SimulationWorld`。

## 目录

```text
src/
├── simulation/       # 配置、SoA 数据、Boids、捕食者、障碍、固定步长、统一世界
├── spatial/          # UniformGrid3D、BruteForceSearch 和共同接口
├── rendering/        # 场景、实例化鱼群、捕食者、环境、相机、网格线框
├── ui/               # 控件绑定、真实统计、帧率图、语义布局
├── main.ts           # 应用组合与 requestAnimationFrame
└── style.css         # 响应式观测仪界面
preview/              # 独立资产、礁石和动画预览；总览入口 preview/index.html
docs/                 # 正式报告、验证记录、实验分析、视频录制脚本
scripts/              # 基准、消融、捕食者实验、图表和浏览器验收/截图
tests/                # 31 项算法与资产集成自动化测试
benchmark/            # 第一轮性能基准的未改动原始文件
benchmarks/           # 三项实验的正式原始 JSON/CSV 和说明
screenshots/          # 最终真实运行截图、图表和诊断记录
test-artifacts/       # 浏览器自动化输出；round-1/ 保留上一轮验收
dist/                 # 生产构建，需要 HTTP 服务器
```
