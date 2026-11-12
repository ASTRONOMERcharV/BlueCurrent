# Blue Current 资产制作流程（ASSET_PIPELINE）

版本：v1.7（2026-11-09，shayu 柔性转身版）
适用范围：School Fish 已完成交付；本文件记录可复现流程、验收结果、已知限制和后续资产的工作方式。资产契约以 [ASSET_SPEC.md](ASSET_SPEC.md) 为准。

## 1. 交付物

| 文件 | 说明 |
| --- | --- |
| `public/models/fish_school.glb` | 运行时资产，866 KB，1448 三角形 |
| `assets_src/blender/fish_school.blend` | 可编辑 Blender 源文件（贴图已打包） |
| `assets_src/textures/fish_school_basecolor.jpg` | 1024² Base Color，111,565 B |
| `assets_src/textures/fish_school_normal.png` | 1024² 切线空间法线，426,072 B |
| `assets_src/textures/fish_school_roughness.png` | 1024² 粗糙度，140,958 B |
| `assets_src/scripts/generate_fish_textures.py` | 程序化贴图生成器 |
| `assets_src/scripts/build_fish_school.py` | Blender 建模、材质、导出脚本 |
| `assets_src/scripts/render_fish_previews.py` | EEVEE 资产预览渲染 |
| `assets_src/scripts/verify_fish_glb.py` | 纯 Python GLB 结构验收 |
| `src/rendering/FishAsset.ts` | GLTFLoader 加载、primitive 合并、契约校验 |
| `src/rendering/FishRenderer.ts` | `aTailWeight` Shader、实例化、颜色与受惊响应 |
| `src/rendering/UnderwaterEnvironment.ts` | 水下 PMREM 环境贴图 |
| `fish-preview.html` + `src/preview/fish-preview.ts` | 独立测试场景（Hero / 真实群体 / 近景） |
| `scripts/fish-glb-smoke.ts` | 浏览器集成烟雾测试 |
| `scripts/fish-perf.ts` | 帧时间对比脚本（SwiftShader 或本机 GPU） |
| `docs/asset-previews/` | Blender 与浏览器预览截图 |

## 2. 工具链

- Blender 5.2.4 LTS Release Candidate（本机连接，MCP add-on 1.8）。
- Blender 内置 Python + bpy；贴图生成使用系统 Python 3.12 + numpy 2.2 + Pillow 12。若没有 Pillow，可直接使用已交付的三张贴图，不必重跑生成器。
- Three.js 0.180、Vite 7、TypeScript 5.9、Vitest 3、Playwright 1.56。
- 贴图不依赖外部素材；全部由脚本生成，未使用商业模型或扫描资产。

## 3. 复现流程

### 3.1 生成贴图

```bash
cd Project/BlueCurrent
python3 assets_src/scripts/generate_fish_textures.py
```

脚本生成 1024² 图集：

- 躯干区域 `x 20–660, y 12–1012`：约 44 列 × 42 行的重叠鳞片，带鳞片后缘、侧线、鳃盖弧线、眼窝暗环和口裂暗线；
- 鱼鳍区域 `x 700–1012, y 12–500`：沿鳍条方向的脊线；
- 另含横向可平铺处理、边缘 padding 和粗糙度/法线生成。

参数、随机种子和布局都在脚本内固定；重复运行输出稳定。

### 3.2 在 Blender 中建模与导出

在已连接 MCP 的 Blender 中执行：

```python
exec(open(r"C:\...\Project\BlueCurrent\assets_src\scripts\build_fish_school.py", encoding="utf-8").read())
```

脚本执行以下步骤：

1. 保存当前场景（若是鱼文件本身则跳过，避免预览灯光污染）。
2. 清空对象并清理孤立数据块。
3. 以程序化截面放样生成躯干（24 段环向、17 个截面），生成 7 片鱼鳍（尾、背、臀、腹 ×2、胸 ×2）与 2 个眼球。
4. 按运行时公式 `1 − smoothstep(−0.95, 0.12, z)` 烘焙 `_TAILWEIGHT` 顶点属性。
5. 生成单图集 UV；建立 Principled BSDF 材质（BaseColor / Normal / Roughness）与独立眼睛材质。
6. 保存 `assets_src/blender/fish_school.blend`（贴图打包）。
7. 以 `use_selection=True` 导出 `public/models/fish_school.glb`：
   - `export_format="GLB"`、`export_yup=True`
   - `export_attributes=True`（导出 `_TAILWEIGHT`）
   - `export_tangents=True`
   - `export_animations=False`、`export_skins=False`、`export_morph=False`

坐标：Blender 中鱼头指向 **−Y**，尾指向 +Y；导出器按 `glTF(x,y,z)=Blender(x,z,−y)` 转换后得到 +Z 朝前。**不要**在 Blender 中把鱼做成 +Y 朝前后依赖导出旋转；必须按本约定建模。

### 3.3 结构验收

```bash
python3 assets_src/scripts/verify_fish_glb.py
```

检查 1 节点 / 1 mesh / 2 primitives、三角形数量、包围盒与 +Z 朝向、`_TAILWEIGHT`、UV/NORMAL、材质数、贴图数、无动画和骨骼、文件大小。当前输出：

```text
triangles 1448, length Z 1.6413, materials 2, images 3, animations/skins 0/0
PASS
```

### 3.4 渲染预览

在 Blender 中执行 `assets_src/scripts/render_fish_previews.py`，输出到 `docs/asset-previews/`：

- `fish_school_side.png`
- `fish_school_three_quarter.png`
- `fish_school_closeup.png`

预览使用 EEVEE、AgX、三点照明；脚本不保存 `.blend`，因此源文件保持干净。

### 3.5 Three.js 集成与测试

```bash
npm run dev
# 主场景，默认 procedural
http://localhost:5173/
# 主场景，启用 Blender GLB
http://localhost:5173/?fish=blender
# 独立资产测试场景
http://localhost:5173/fish-preview.html?mode=hero
http://localhost:5173/fish-preview.html?mode=school&count=500
http://localhost:5173/fish-preview.html?mode=school&count=150&close=1
```

加载路径：

1. `loadFishAsset()` 用 GLTFLoader 读取 GLB。
2. 多 primitive 合并为带 groups 的几何体；GLTFLoader 把 `_TAILWEIGHT` 小写为 `_tailweight`，加载器统一改名为 `aTailWeight`。
3. 校验三角形、长度、朝向、权重、材质和动画；失败时回退 procedural，不白屏。
4. `FishRenderer` 把 `aTailWeight` 注入 `MeshStandardMaterial.onBeforeCompile`：
   ```glsl
   float tailWeight = aTailWeight;
   float tailWave = sin(uSwimTime * (5.0 + instanceSpeed * 5.0) + instancePhase + position.z * 2.4);
   transformed.x += tailWave * tailWeight * 0.16;
   ```
5. 继续使用一个 `InstancedMesh`；身体与眼睛用 2 个材质组，全体鱼共享 2 个 draw call。
6. `instanceColor` 对贴图鱼只做低饱和明度扰动（0.92–0.99），受惊时仍向橙色 lerp。

### 3.6 浏览器验收与性能

```bash
npm test                 # 16 项算法测试
npm run build            # tsc + vite build（含 fish-preview.html 入口）
npm run smoke            # 原有主场景/移动端烟雾测试
npm run smoke:fish       # GLB 鱼集成、资产契约和浏览器错误检查
npm run perf:fish -- --mode=procedural --counts=500,1000,2000
npm run perf:fish -- --mode=blender --counts=500,1000,2000
```

本机硬件 GPU 验收（沙箱内无法完成）：

```bash
npx playwright install chromium
npm run perf:fish -- --mode=procedural --counts=500,1000,2000 --gpu
npm run perf:fish -- --mode=blender --counts=500,1000,2000 --gpu
```

`--gpu` 会启动带界面的 Chromium（默认使用本机 GPU）。结果 JSON 中 `environment.renderer` 会记录实际的 WebGL renderer 字符串；如果显示 SwiftShader，则不是硬件结果。

## 4. 实测结果

### 4.1 资产结构

| 项目 | 实测 |
| --- | --- |
| GLB 大小 | 886,872 B（866 KB） |
| 三角形 / 顶点 | 1448 / 821（body+fins 1160 / eyes 288） |
| 包围盒 | min (−0.218, −0.314, −1.051)，max (+0.218, +0.475, +0.590) |
| 总长 Z | 1.641（目标 1.650，误差 −0.5%） |
| 属性 | POSITION, NORMAL, TANGENT, TEXCOORD_0, _TAILWEIGHT |
| 材质 | body（BaseColor + Normal + Roughness，doubleSided）、eye（纯色高光） |
| 动画 / 骨骼 | 0 / 0 |

### 4.2 模拟回归（CPU，无渲染）

与 `README.md` 中基准同环境（Node 22，沙箱 2 逻辑核，120 步 ×3 次，预热 40）：

| 鱼数 | 基线 grid mean | 本轮 grid mean | 差异 |
| ---: | ---: | ---: | ---: |
| 500 | 8.341 ms | 8.336 ms | −0.06% |
| 1000 | 23.849 ms | 24.238 ms | +1.6% |
| 2000 | 68.642 ms | 67.413 ms | −1.8% |

差异均在噪声范围内；资产工作没有修改模拟内核。

### 4.3 渲染结构

| 指标 | procedural | Blender GLB |
| --- | ---: | ---: |
| 三角形 / 鱼 | 124 | 1448 |
| 500 条总三角形 | 62,000 | 724,000 |
| 2000 条总三角形 | 248,000 | 2,896,000 |
| 鱼的 draw call | 1 | 2（身体 + 眼睛） |
| 主场景总 draw call（500 条，实测） | 82 | 83 |
| 贴图显存 | 0 | ≈16.8 MB（3×1024² RGBA + mips 估算） |
| GLB 下载 | 0 | 866 KB |

### 4.4 浏览器验证

- `npm run smoke:fish` 通过：主场景以 `?fish=blender` 启动，`fishModel: "blender"`，500 条鱼，1448 三角形；预览页确认 `_TAILWEIGHT` 存在且范围 [0,1]、长度 1.641、材质 2。
- `npm run smoke`（procedural）通过；`npm test` 16/16 通过；`npm run build` 通过。
- 视觉验证：`docs/asset-previews/` 中的浏览器 Hero、群体近景和主场景截图；近景可看到多条鱼的尾鳍处于不同弯曲相位，说明顶点 Shader 正常工作。
- **软件渲染警告**：沙箱 Chromium 使用 SwiftShader。Blender 鱼主场景在 774×418、500 条鱼时低于 1 fps；`perf:fish` 在 1280×720 下测得 procedural 为 2.7 / 1.2 / 0.5 fps（500/1000/2000）。这两组数据仅用于确认脚本可运行，分辨率和渲染器不同，不能作为 GPU 性能对比；必须用 `--gpu` 或本机浏览器复测后才能给出 FPS/GPU 时间结论。

### 4.5 尚未完成

- 本机硬件 GPU 下的 500/1000/2000 FPS、P95 帧时间和 GPU 时间（脚本已提供，待用户执行）。
- LOD：当前所有距离共用 1448 三角形模型；远处可考虑 300–500 三角形 LOD。
- 阴影、焦散、景深、体积光等环境效果尚未加入本轮资产工作。
- 资产质量定位为 **Stylized Realism**，不是扫描/雕刻级照片写实；见下节人工精修路径。

## 5. 已知限制与人工精修路径

本轮模型由 bpy 程序化放样生成，具备完整鱼体、7 片鱼鳍、眼球、UV、PBR 贴图和尾部权重；但它不是手工雕刻/重拓扑的影视级资产。若需要更高写实度，建议按以下顺序人工精修（这些步骤无法由当前程序化脚本替代）：

1. **雕刻与重拓扑**：在 Blender 中用 Sculpt 模式细化头部、鳃盖、口部、鳍基和体侧肌肉线条；用 Retopo 重建四边面主环线，保持 1000–1500 三角形。
2. **口部与鳃盖几何**：制作上下颌、口裂、鳃盖边缘的独立几何和厚度；当前仅用贴图暗线表现。
3. **鱼鳍结构**：为鳍条制作真实厚度和弯曲；当前为双面薄片；胸鳍在不同视角下仍偏薄。
4. **贴图手绘**：在 Krita/Substance 3D 中绘制个体斑纹、鳞片色差、鳍的透明度层次；当前为程序化单图集，所有个体共享同一纹理，仅靠 `instanceColor` 变化。
5. **法线与 AO**：烘焙高模到低模的 Normal/AO，增加眼窝、鳃盖、鳍基的遮蔽细节。
6. **LOD 与 impostor**：为远距离鱼群生成低模或公告板 LOD；在 2000 条鱼场景中按距离切换。
7. **硬件 GPU 采样**：在目标笔记本/台式机上运行 `npm run perf:fish -- --gpu`，记录 renderer 字符串、P50/P95 帧时间、draw calls，并与 procedural 对比。

## 6. 后续资产建议顺序

沿用本轮流程，下一批按风险从低到高：

1. ~~Predator（独立尾节点或改为 `aTailWeight` Shader；高精度，≤20k 三角形）~~ — **已完成**，见第 7 节。
2. ~~Branching / plate coral（单材质、可实例化、≤600–3000 三角形）~~ — **已完成**（6 种珊瑚集），见第 8 节。
3. ~~Reef rock 变体（A/B/C 与沙滩、碎石）~~ — **已完成**（13 资产岩石/沙丘集），见第 9 节。
4. ~~Kelp（叶片 + 高度权重 Shader 摆动）~~ — **已完成**（Phase C），见第 10 节。
5. 环境粒子、焦散和远景雾层（不需要 GLB）— 下一步。

每个资产仍按“独立预览页 → 结构校验 → 浏览器烟雾测试 → 性能采样 → 主场景 flag”的顺序接入。

## 7. Predator v2（大白鲨）交付（2026-11-09）

### 7.1 交付物

| 文件 | 说明 |
| --- | --- |
| `public/models/predator_shayu_rigged.glb` | **当前默认**运行时资产，1,753,144 B，9,826 三角形，11 骨骼 SkinnedMesh（用户 shayu，2026-11-09 绑定） |
| `assets_src/blender/predator_shayu_rigged.blend` | rigged shayu 可编辑源文件（贴图已打包） |
| `assets_src/scripts/rig_predator_shayu.py` | 在 shayu 上建立 Spine_00..05 / Caudal_Peduncle / Tail_Fin / Pectoral_L/R 骨骼，按位置分配连续权重并导出 GLB |
| `assets_src/scripts/verify_predator_rig.py` | 纯 Python GLB 结构验收（skin/joints/权重和/尾端权重/胸鳍/材质/长度） |
| `src/rendering/PredatorRigAsset.ts` | GLTFLoader 加载 SkinnedMesh、骨骼名/层级/权重契约校验、派生动画 bindings |
| `src/rendering/PredatorAnimationController.ts` | 行波、频率、转弯、俯仰、侧倾、胸鳍、攻击包络的程序化骨骼动画 |
| `predator-animation-preview.html` + `src/preview/predator-animation-preview.ts` | 独立游泳测试场景（Side / Top / Front / Quarter，骨骼开关，固定时间） |
| `scripts/predator-animation-smoke.ts` | 动画验收（巡游/左右转/升降/冲刺/恢复、相位连续、NaN） |
| `scripts/predator-animation-main-smoke.ts` | 主场景 rigged 默认路径集成验收 |
| `scripts/predator-animation-capture.ts` | 固定帧截图（Side/Top/Front/Quarter/Skeleton） |
| `scripts/predator-animation-video.ts` | 26 s 连续机动序列 WebM 录制 |
| `tests/PredatorAnimationController.test.ts` | 11 项控制器单元测试（包络、频率、相位、俯仰限速、转向、胸鳍、四元数） |
| `public/models/predator_shayu.glb` | 静态 shayu 回退资产，1,600,488 B，9,826 三角形（`?predator=shayu`） |
| `assets_src/blender/predator_shayu.blend` | 静态 shayu 可编辑源文件（贴图已打包） |
| `assets_src/scripts/generate_shayu_maps.py` | 从 shayu GLB 提取 BaseColor，生成 1024² 平坦法线/粗糙度贴图 |
| `assets_src/scripts/import_shayu_predator.py` | shayu 导入、合并、旋转/缩放、`_TAILWEIGHT`、材质与导出脚本 |
| `scripts/predator-shayu-check.ts` | 静态 shayu Hero/Close/Chase/Main 浏览器专项验收 |
| `public/models/predator_reef_shark.glb` | v2 备选运行时资产，1,347,140 B，5990 三角形（`?predator=v2`） |
| `assets_src/blender/predator_reef_shark.blend` | 可编辑 Blender 源文件（贴图已打包） |
| `assets_src/textures/predator_basecolor.jpg` | 2048² Base Color，236,237 B |
| `assets_src/textures/predator_normal.png` | 2048² 切线空间法线，626,609 B |
| `assets_src/textures/predator_roughness.png` | 1024² 粗糙度，121,786 B |
| `assets_src/scripts/generate_predator_textures.py` | 程序化贴图生成器（大白鲨反荫蔽、鳃裂、眼窝） |
| `assets_src/scripts/build_predator.py` | Blender 建模、材质、导出脚本（身体、7 组鳍、下颚、口腔、35 颗牙、双眼） |
| `assets_src/scripts/render_predator_previews.py` | EEVEE 资产预览渲染 |
| `assets_src/scripts/verify_predator_glb.py` | 纯 Python GLB 结构验收（4 primitive / 4 材质 / 3 贴图） |
| `src/rendering/PredatorAsset.ts` | GLTFLoader 加载、primitive 合并、4 材质契约校验 |
| `src/rendering/PredatorRenderer.ts` | 四材质共享尾摆 Shader、C 形弯曲、转弯倾斜、加速/减速响应、攻击自发光 |
| `predator-preview.html` + `src/preview/predator-preview.ts` | 独立测试场景（Hero / Close-up / Chase），Hero 自动演示 turn/thrust/bank |
| `scripts/predator-glb-smoke.ts` | 浏览器集成烟雾测试（默认 GLB、资产统计、Chase、组合 GLB、bank/thrust/turn） |
| `tests/PredatorAnimation.test.ts` | 转弯倾斜方向/钳制与 C 形弯曲输入的单元测试 |

### 7.2 复现流程

```bash
cd Project/BlueCurrent
python3 assets_src/scripts/generate_predator_textures.py
python3 assets_src/scripts/verify_predator_glb.py
python3 assets_src/scripts/verify_predator_rig.py

# 在已连接 MCP 的 Blender 5.2 中执行：
# assets_src/scripts/build_predator.py
# assets_src/scripts/render_predator_previews.py
# assets_src/scripts/rig_predator_shayu.py   （shayu 骨骼 + rigged GLB）

npm run smoke:predator
npm run smoke:predator-animation          # 或 -- --phase=a / --phase=b（慢速 SwiftShader）
npm run smoke:predator-animation:main
npm run capture:predator-animation
npm run video:predator-animation
npm run dev
# http://localhost:5173/                         默认加载 rigged shayu 捕食者
# http://localhost:5173/?predator=shayu          回退静态 shayu
# http://localhost:5173/?predator=v2             切换回 v2 大白鲨
# http://localhost:5173/?predator=procedural     显式回退程序化捕食者
# http://localhost:5173/predator-preview.html?mode=hero
# http://localhost:5173/predator-preview.html?mode=close
# http://localhost:5173/predator-preview.html?mode=chase
```

建模脚本的坐标约定与 School Fish 相同：Blender 中头朝 −Y、尾朝 +Y，导出后 +Z 朝前。尾权重公式为 `1.0 − smoothstep(−1.95, 1.30, z)`，与运行时 Shader 的回退公式一致。构建脚本会先把当前 Blender 场景复制到 `_scene_before_predator.blend`（`copy=True`），再清空场景；不会把其他资产源文件（如 `rocks.blend`）另存覆盖。

### 7.3 实测结果

| 项目 | 实测 |
| --- | --- |
| GLB 大小 | 1,347,140 B（1316 KB） |
| 三角形 / 顶点 | 5990 / 3134（Blender）；GLB accessor 顶点 3394 |
| 部件三角形 | 身体 + 鱼鳍 + 下颚外壁 4564；眼睛 ×2 880；牙齿 ×35 350；口腔 196 |
| 包围盒 | min (−1.2681, −0.8601, −2.9578)，max (+1.2681, +1.1331, +2.3200) |
| 总长 Z | 5.2778（目标 5.280，−0.04%） |
| 属性 | POSITION, NORMAL, TANGENT, TEXCOORD_0, _TAILWEIGHT |
| 材质 / primitive / 图片 | 4 / 4 / 3 |
| 动画 / 骨骼 | 0 / 0；动画全部由运行时完成 |
| 尾权重 | 0.0–1.0；>0.9 的 666 个顶点平均 z = −2.053（−2.958…−1.321）；0 权重顶点 z ≥ +1.265 |
| 主场景 draw calls | 500 条 procedural 鱼 + GLB Predator：**82**；Predator 本体 6 → 4 |
| 组合 GLB draw calls | 150 条 GLB 鱼 + GLB Predator：**83** |
| 贴图显存估算 | ≈ 50 MB（2048² ×2 + 1024² + mips） |

### 7.4 集成路径

1. `loadPredatorAsset('/models/predator_shayu.glb')` 加载默认 GLB（`?predator=v2` 时加载 v2），将 `_tailweight` 改名为 `aTailWeight`，校验三角形、长度、朝向、权重、3–4 材质、`predator_body` 的 3 张贴图、动画/骨骼数量。
2. `PredatorRenderer` 用单 mesh + 3–4 材质绘制；所有材质都注入 `onBeforeCompile` 尾摆 Shader，牙、口腔与身体一起弯曲，避免头部部件脱离。转身时头部按四元数平滑跟随速度，躯干沿脊柱旋转，尾柄/尾鳍使用 `uTurnLag` 延迟跟随，避免整体像刚体旋转。
3. 尾摆幅度随速度、攻击状态和 `uThrust` 变化；`uTurn` 在身体中线加入正弦 C 形弯曲；yaw rate 驱动绕局部 +Z 的 roll（`−yawRate × 0.22`，钳制 ±0.6 rad）。
4. 加速/减速：速度差分除以参考加速度 9，平滑为 `uThrust ∈ [−1, 1]`；追击加速时摆动更宽，搜索阶段减速时收窄。
5. 攻击状态用 `emissive = 0xff5a24` 的自发光脉冲表示：v2 为 0–0.55，shayu（3 材质）为 0–0.30，**不**把整张贴图染橙；程序化回退仍保留原有 color lerp。
6. **默认启用 shayu GLB**；`?predator=v2` 切换 v2，`?predator=procedural` 显式回退；加载或校验失败自动回退并输出警告。
7. 预览页 Chase 模式使用真实 `SimulationWorld`、`PredatorSystem` 和 `SceneManager`，不是静态摆拍；相机目标带 −3 单位的横向偏移，避免固定 HUD 遮挡捕食者。

### 7.5 验收

- `verify_predator_glb.py`：PASS（1 mesh / 3 primitive / 3 材质 / 3 图片 / 0 动画 / 0 骨骼，shayu 默认；v2 为 4 primitive / 4 材质）。
- `npm run smoke:predator`：PASS；默认主场景 `predatorModel: "blender"`，500 条鱼，0 浏览器错误；Hero 统计、Chase 真实 FSM、组合 GLB 均通过；主场景观测 `predatorBank ≈ −0.125 rad`、`predatorThrust ≈ 0.60`、`predatorTurn ≈ 0.33`。
- `npm test`：26/26 通过（含 `PredatorAnimation` 3 项）；`npm run build`、`npm run smoke`、`npm run smoke:fish`、`npm run smoke:glb` 通过。
- 本机硬件 GPU：在 Windows 终端运行 `npm run accept:gpu`，脚本会拒绝 SwiftShader（退出码 2），自动测四组场景 × 500/1000/2000 条鱼，结果写入 `test-artifacts/gpu-acceptance/latest.md` 与 `latest.json`。
- 截图：`docs/asset-previews/predator_*.png`（v2 Blender EEVEE）、`docs/asset-previews/shayu_predator_*.png`（shayu）、`test-artifacts/predator-asset-hero.png`、`test-artifacts/predator-chase.png`、`test-artifacts/predator-shayu-{hero,close,chase,main}.png`。

### 7.6 已知限制

- 仍为 **Stylized Realism**：胸鳍、背鳍、牙齿是独立厚度几何，但口颌没有骨骼驱动，张嘴角度固定；鳃裂、侧线和皮肤细纹由贴图表现。
- 2048² 贴图约 50 MB 显存，对低端集显有成本；后续可加 1024² LOD 或 KTX2 压缩。
- 没有 LOD；当前 1 个捕食者，未实现多捕食者或鱼群个体化捕食者。
- 转身倾斜和 C 形弯曲是视觉层近似，不反馈到 `PredatorSystem` 的碰撞/转向物理。
- 硬件 GPU 的 FPS、P95 帧时间和 GPU 时间尚未测量；请运行 `npm run accept:gpu`，结果写入 `test-artifacts/gpu-acceptance/latest.md`。SwiftShader 数据不作为性能结论。

### 7.7 用户 shayu 资产转换（当前默认，2026-11-09）

用户上传 `shayu.blend` / `shayu.glb` 并指定“使用这个作为鲨鱼模型”。原始文件保留在 `assets_src/external/shayu/`，不覆盖用户上传。

**复现**

```bash
python3 assets_src/scripts/generate_shayu_maps.py
# Blender 5.2 + MCP 会话内执行（会先保存当前场景副本）：
# assets_src/scripts/import_shayu_predator.py
python3 assets_src/scripts/verify_predator_glb.py public/models/predator_shayu.glb
# Blender 内预览：PREDATOR_PREVIEW_PREFIX=shayu_ + render_predator_previews.py
npm run smoke:predator        # 默认入口（shayu）
npm run smoke:predator:shayu  # Hero / Close / Chase / Main 专项
```

**转换要点**

1. 输入 GLB 有 3 个 mesh：身体 `shayu`（7,376 面，含 128 口腔面）、牙齿 `ya.001`（2,450 面）、模型外的隐藏单牙 `ya`（70 面）。删除 `ya`，牙齿合并进身体。
2. 材质 `bifu` → `predator_body`，`材质` → `predator_mouth`；新增 `predator_teeth`；身体保留用户 1024² `pifu` 贴图，新增平坦法线与粗糙度贴图。
3. glTF 导入对象默认 `QUATERNION` 旋转模式；直接写 `rotation_euler` 会被忽略。脚本先设 `rotation_mode = "XYZ"`，再绕 Z 旋转 +90°，使头从 Blender −X 转到 −Y（导出 +Z），然后应用变换。
4. 统一缩放 5.280 / 4.898 = 1.07796 并居中包围盒；`_TAILWEIGHT` 从导出后的 `z_gltf = −y_blender` 计算。
5. 导出 `public/models/predator_shayu.glb`（3 primitive / 3 材质 / 3 图 / `_TAILWEIGHT`），并保存 `predator_shayu.blend`。

**实测**

| 项目 | 实测 |
| --- | --- |
| 输入 / 输出 | 428,968 B → 1,600,488 B |
| 三角形 | 9,826（身体 7,248 + 口腔 128 + 牙齿 2,450） |
| Blender / GLB 顶点 | 6,570 / 7,442 |
| 总长 | 5.2800（目标 5.280） |
| 材质 | `predator_body` / `predator_mouth` / `predator_teeth` |
| 属性 | POSITION, NORMAL, TANGENT, TEXCOORD_0, _TAILWEIGHT |
| 尾权重 | 0–1；>0.9 的 967 个顶点平均 z = −1.946 |
| 主场景 | 150 条鱼 + shayu：81 draw calls，0 错误；500 条鱼：81 draw calls |
| 组合 | 150 条 GLB 鱼 + shayu：82 draw calls |
| 浏览器 | `predator-shayu-hero/close/chase/main.png`；0 错误 |

**限制**：静态张口、无下颚动画；眼睛/鳃裂为贴图；身体单面；用户贴图偏浅灰；硬件 GPU 待测。

### 7.8 柔性转身优化（2026-11-09）

**问题**：`group.quaternion` 每帧直接对齐速度方向；Shader 只做 `uTurn * sin(bodyT * π) * 0.24` 的横向位移，尾鳍仍与头部共用刚体朝向，所以强转弯时像一根硬杆。

**实现**：

1. `PredatorRenderer` 维护独立的 `renderQuaternion`，用 `slerp(..., 1 − exp(−dt·9))` 跟随目标朝向；attack 状态响应提高到 12。
2. 用视觉朝向与目标速度方向的 `headingError` 补足转弯信号：turn 增益 2.4、bank 增益 1.8，避免头部尚未转到位时身体先回正。
3. Shader 以 `z = 2.45` 为头部支点、`5.20` 为脊柱长度，按 `bodyT^1.35` 将截面旋转最多 `0.38 rad`；法线同步旋转。
4. 尾部使用 `uTurnLag`：`turn` 以 7.5/s 跟随，尾部以 3.0/s 跟随，并在 `bodyT` 0.18–1.0 之间混入，形成开始转弯的延迟和回正时的惯性。
5. 新增 `predatorSpineBendAngle()` 供单元测试；Shader 缓存键 `v4`；预览增加 `poseTime` 固定姿态和 `view=top` 俯视检查。

**验证**：

- `tests/PredatorAnimation.test.ts` 7/7（含 90° 速度突变不完全对齐、尾部滞后、回正惯性）。
- `npm run smoke:predator` PASS：主场景 `predatorTurn 0.127 / predatorTailTurn 0.139`，组合 GLB 0 错误。
- `npm run smoke:predator:shayu` PASS：Hero / Close / Chase / Main。
- 对照图：`test-artifacts/predator-turn-before.png`、`predator-turn-after.png`、`predator-turn-top-before.png`、`predator-turn-top-after.png`。
- 复现姿态：`/predator-preview.html?mode=hero&predator=shayu&poseTime=2.856&view=top`。

**限制**：顶点 Shader 视觉近似，不改变模拟物理、碰撞或捕获；不是骨骼/IK；程序化回退仍使用尾节点；shayu 无骨骼，不能做分段脊椎或下颌动画。

## 8. 珊瑚资产集交付（2026-11-09）

### 8.1 交付物

| 文件 | 说明 |
| --- | --- |
| `public/models/coral_branching.glb` | 枝状珊瑚，159,176 B，2,624 三角形 |
| `public/models/coral_table.glb` | 桌面珊瑚，72,240 B，2,240 三角形 |
| `public/models/sponge_tube.glb` | 管状海绵，61,872 B，1,872 三角形 |
| `public/models/coral_fan.glb` | 扇形珊瑚，163,512 B，2,932 三角形 |
| `public/models/coral_brain.glb` | 脑珊瑚，83,280 B，2,688 三角形 |
| `public/models/anemone.glb` | 海葵，102,260 B，2,860 三角形 |
| `assets_src/blender/corals.blend` | 六株同文件源资产（均位于原点，贴图已打包） |
| `assets_src/blender/coral_build_stats.json` | 构建实测：三角形、包围盒、尺寸、文件大小 |
| `assets_src/textures/coral_atlas_basecolor.jpg` | 1024² sRGB 图集，265,642 B |
| `assets_src/textures/coral_atlas_normal.png` | 1024² 切线法线，2,035,439 B |
| `assets_src/textures/coral_atlas_roughness.png` | 1024² 粗糙度，330,371 B |
| `assets_src/textures/coral_atlas.json` | 6 个 UV 格的像素/UV 矩形 |
| `assets_src/scripts/generate_coral_textures.py` | 共享图集生成器 |
| `assets_src/scripts/build_corals.py` | Blender 建模、UV、材质、GLB 导出 |
| `assets_src/scripts/render_coral_previews.py` | EEVEE 资产预览渲染 |
| `assets_src/scripts/verify_coral_glbs.py` | 纯 Python GLB 结构验收 |
| `src/rendering/CoralAsset.ts` | 加载、契约校验、共享图集材质 |
| `src/preview/coral-preview.ts` + `coral-preview.html` | 独立实例化预览页 |
| `scripts/coral-glb-smoke.ts` + `npm run smoke:coral` | 浏览器烟雾测试 |
| `docs/asset-previews/coral_*.png` | 六株单体图 + 合影 |

### 8.2 复现流程

```bash
cd Project/BlueCurrent
python3 assets_src/scripts/generate_coral_textures.py
python3 assets_src/scripts/verify_coral_glbs.py

# 在已连接 MCP 的 Blender 5.2 中执行：
# assets_src/scripts/build_corals.py
# assets_src/scripts/render_coral_previews.py

npm run smoke:coral
npm run dev
# http://localhost:5173/coral-preview.html
```

`build_corals.py` 会清空当前场景（不保存预览灯光）、重建 6 株珊瑚、写入图集 UV、保存 `corals.blend`，再逐个选中导出 GLB。GLB 有意不嵌入贴图；运行时由 `CoralAsset.ts` 加载一次共享图集。

### 8.3 实测结果

| 项目 | 实测 |
| --- | --- |
| 三角形范围 | 1,872–2,932（全部落在 1.5k–3.2k） |
| 高度范围 | 0.505–1.220 m（按类型分档，见 ASSET_SPEC 13.2） |
| 原点 | 6/6 `min.y = 0` |
| 材质 / 图集 | 每资产 1 材质、0 内嵌图片；3 张 1024² 共享贴图 |
| 结构验收 | `verify_coral_glbs.py` PASS（6/6） |
| 预览实例 | 6 种 × 4 礁丛 = 40 instances |
| 预览 draw calls | 8（6 种珊瑚 + 海床 + GLB 礁石） |
| 预览三角形 | 116,224 |
| 共享图集映射 | `atlasMaps = 3` |
| 浏览器错误 | 0 |
| 烟雾测试 | `npm run smoke:coral` PASS |
| 单元测试 | `npm test` 16/16 |
| 生产构建 | `npx vite build --outDir dist-check --emptyOutDir` PASS（43 modules） |

沙箱 SwiftShader 下预览页 FPS 约 36，不作为性能结论。`npm run build` 在沙箱内因挂载不允许删除旧 `dist/` 文件而报 EPERM；改用独立 outDir 验证构建成功，Windows 侧重建前清理 `dist/` 即可。

### 8.4 集成路径

1. `loadCoralAssets()` 并行加载 6 个 GLB，`loadCoralAtlas()` 加载共享图集（必须 `flipY = false`）。
2. 每种珊瑚一个 `InstancedMesh`，共享同一个 `MeshStandardMaterial`；按礁丛中心随机缩放、yaw、±0.05 rad 倾斜与 `instanceColor` 明度变化。
3. 当前只在 `coral-preview.html` 接入；主场景仍使用程序化珊瑚。后续在主场景接入时保持独立 flag、失败回退，并补做硬件 GPU 的 draw call/FPS/P95 采样。
4. 若要做近景特写，优先升级到 2048 图集或按类型拆分贴图，再考虑 LOD。

### 8.5 已知限制

- 风格化写实：枝状/扇状为管状骨架，扇面网眼大于参考图；脑珊瑚沟槽为程序化位移 + 法线贴图，不是雕刻级迷宫；桌面表面偏平滑；海葵基座在极近景可见 40 边轮廓。
- 每种仅 1 个基地模，形态变化依赖运行时变换；无烘焙变体、无 LOD。
- 共享 1024 图集限制近景纹理分辨率；单株显存成本低，但特写需要更高分辨率。
- 主场景尚未接入，未测硬件 GPU 性能；SwiftShader FPS 不可作为结论。

## 9. 岩石与海底地形（Phase R，2026-11-09）

### 9.1 交付内容

| 文件 | 说明 |
| --- | --- |
| `public/models/rocks/*.glb` | 13 个资产：3 大礁石、4 中岩石、4 碎石、2 沙丘；合计 7,869 三角形、392 KB |
| `assets_src/blender/rocks.blend` | 13 组 hi/lo 对象同文件源资产 |
| `assets_src/blender/rock_build_stats.json` / `rock_export_stats.json` | 构建与导出实测 |
| `assets_src/textures/rock_atlas_basecolor.jpg` | 2048² sRGB，334,982 B |
| `assets_src/textures/rock_atlas_normal.png` | 2048² 切线法线，2,081,917 B |
| `assets_src/textures/rock_atlas_ao.png` | 2048² 灰度 AO，569,728 B |
| `assets_src/textures/rock_tiles.json` | 4×4 tile 的像素/UV 矩形 |
| `assets_src/textures/_rock_bake/` | 每资产 512² 法线/AO 中间件 |
| `assets_src/scripts/build_rocks.py` | icosphere 多块位移、Decimate、EdgeSplit、UV、保存 |
| `assets_src/scripts/bake_rocks.py` | Cycles 法线/AO 烘焙（按预算分批） |
| `assets_src/scripts/compose_rock_atlas.py` | 程序化 BaseColor + 合成图集 + 复制到 public |
| `assets_src/scripts/finalize_rocks.py` | UV tile 映射、水平居中、GLB 导出 |
| `assets_src/scripts/verify_rocks_glb.py` | 纯 Python GLB 结构验收 |
| `assets_src/scripts/render_rocks_previews.py` | EEVEE 13 张单体图 + 合影 |
| `src/rendering/RockAsset.ts` | 13 GLB + 共享图集加载、契约校验、双材质 |
| `src/rendering/RockScatter.ts` | 每类型一个 InstancedMesh、实例色与变换 |
| `src/rendering/rockPlacement.ts` | 确定性摆放（礁石锚定、沙丘/中岩/碎石散布） |
| `rocks-preview.html` + `src/preview/rocks-preview.ts` | 13 资产独立预览页（阵容 / `?focus=` 近景） |
| `scripts/rock-glb-smoke.ts` + `npm run smoke:rocks` | 主场景浏览器验收 |
| `scripts/rocks-preview-smoke.ts` + `npm run smoke:rocks-preview` | 独立预览页浏览器验收 |
| `docs/asset-previews/rock_*.png` | 13 张单体图 + `rock_lineup.png` |

### 9.2 复现流程

```bash
cd Project/BlueCurrent
# 在已连接 Blender MCP 的 Blender 5.2 中按顺序执行：
# assets_src/scripts/build_rocks.py
# assets_src/scripts/bake_rocks.py
# assets_src/scripts/finalize_rocks.py
python3 assets_src/scripts/compose_rock_atlas.py
python3 assets_src/scripts/verify_rocks_glb.py
npm run smoke:rocks
npm run smoke:rocks-preview
```

`bake_rocks.py` 可设置 `ROCK_BAKE_ONLY=name1,name2`、`ROCK_BAKE_BUDGET=40`、`ROCK_BAKE_FORCE=1` 分批执行。AO 烘焙时脚本会把其余 25 个对象移到 20000 单位外，否则同场景重叠的资产会互相遮挡。

### 9.3 实测结果

| 项目 | 实测 |
| --- | --- |
| 资产数 / 三角形 | 13 / 7,869（1050、1200、1050、520、480、620、560、240、180、200、220、849、700） |
| 文件 | 13 个 GLB，9,080–59,512 B，合计 392 KB |
| 图集 | 3 × 2048²（BaseColor JPEG / Normal PNG / AO PNG），合计 2,986,627 B；mip 后约 67 MB 显存 |
| 结构验收 | `verify_rocks_glb.py` PASS（13/13，含 UV tile、原点、居中、三角形预算） |
| 主场景验收 | `npm run smoke:rocks` PASS；5 大 / 16 中 / 33 碎石 / 5 沙丘，7,869 三角形，0 浏览器错误 |
| 独立预览 | `npm run smoke:rocks-preview` PASS；13 资产 / 7,869 三角形；阵容 14 draw calls、focus 2 draw calls、0 错误 |
| 回归 | `npm run smoke` PASS、`npm run smoke:glb` PASS（legacy `?glbRocks=1`） |
| 单测 / 构建 | `npm test` 26/26、`npx tsc --noEmit`、`npm run build` PASS |
| Draw calls（80 鱼 + GLB 岩石 + GLB 捕食者） | 90；默认程序化基线 80 |

沙箱使用 SwiftShader，FPS 约 1–7，**不作为性能结论**；硬件 GPU 验收待用户在本机完成（见 `docs/PHASE_R_ACCEPTANCE.md`）。

### 9.4 集成路径

1. `loadRockAssets()` 加载 13 个 GLB 与共享图集；材质 `rock_atlas` / `dune_atlas` 各一个，全部实例共享。
2. `generateRockLayout()` 固定种子生成 5 + 16 + 33 + 5 个放置；大型礁石 x/z 与 `ObstacleSystem` 的 5 个碰撞球严格对齐。
3. `RockScatter` 为每种资产建 1 个 `InstancedMesh`（共 13 个 draw call），关闭 frustum culling，按实例写变换与调色。
4. `Environment.loadGlbRockSet()` 仅在 `?glbRocks=2` 时调用；成功后才移除 5 块程序化主礁石。程序化珊瑚与外围腰石保留。
5. 沙丘是地形装饰，不参与模拟碰撞；`Reef obstacles` 开关只隐藏大型/中型/碎石组。
6. 失败回退：任一 GLB 校验失败或图集加载失败，`loadGlbRockSet()` 返回 false 并保留全部程序化几何，页面不白屏。

### 9.5 已知限制

- 保持青绿色低模艺术方向；细节 = 形状 + 烘焙法线/AO，不是照片级岩石。
- 多闭合壳拼接，内部面保留；不是水密流形。
- 沙丘为开放地形壳，下沉 30% 嵌入海床，无底面裙边。
- 无 LOD；13 个 instanced draw call 是当前固定成本。
- 硬件 GPU 的 FPS/P95/GPU time 未测；SwiftShader 数据不作结论。

## 10. 海藻资产集交付（Phase C，2026-11-09）

### 10.1 交付物

| 文件 | 内容 |
| --- | --- |
| `public/models/kelp_a.glb` | 密集卷曲海藻丛；184 三角形、204 顶点、高 3.550、宽 2.285、深 2.586、9,000 B |
| `public/models/kelp_b.glb` | 宽叶海藻扇；168 三角形、174 顶点、高 2.800、宽 1.507、深 1.936、7,944 B |
| `assets_src/blender/kelps.blend` | 两株资产的 Blender 源文件（`kelp_a` / `kelp_b`，单材质 `kelp_runtime`） |
| `assets_src/blender/kelp_build_stats.json` | 导出实测：字节、三角形、顶点、bbox、高宽深 |
| `assets_src/scripts/build_kelp.py` | 参数化叶片 + 固着器建模、`_SWAYWEIGHT` / `_BLADEPHASE` 写入、GLB 导出 |
| `assets_src/scripts/render_kelp_previews.py` | EEVEE 中性棚拍预览 → `docs/asset-previews/kelp_*.png` |
| `assets_src/scripts/verify_kelp_glbs.py` | 纯 Python 结构校验（含自定义属性范围解码） |
| `src/rendering/KelpAsset.ts` | GLB 加载、契约校验、属性重命名、运行时材质 |
| `src/rendering/kelpPlacement.ts` | 固定种子 49 株确定性布局 |
| `src/rendering/KelpScatter.ts` | 每资产 1 个 `InstancedMesh` + 顶点摆动 Shader + 实例属性 |
| `kelp-preview.html` / `src/preview/kelp-preview.ts` | 独立实例化预览页 + `window.__kelpPreview` 诊断 |
| `scripts/kelp-glb-smoke.ts` | `npm run smoke:kelp` 浏览器验收 |

### 10.2 复现流程

```bash
# 在已连接 Blender MCP 的 Blender 5.2 中执行：
# assets_src/scripts/build_kelp.py
# assets_src/scripts/render_kelp_previews.py

python3 assets_src/scripts/verify_kelp_glbs.py
npm run smoke:kelp

# 主场景，默认无海藻
npm run dev
# http://localhost:5173/?kelp=1
# http://localhost:5173/?kelp=1&glbRocks=2
# http://localhost:5173/kelp-preview.html
```

### 10.3 实测结果

| 项目 | 结果 |
| --- | --- |
| 结构校验 | `verify_kelp_glbs.py` PASS 2/2；三角形 184 / 168、底部 y = 0、`_SWAYWEIGHT` 0..1、`_BLADEPHASE` 0..2π、单材质、双面 |
| 独立预览 | `npm run smoke:kelp` PASS；2 资产 / 15 实例 / 3 draw calls / 13,000 三角形 / 0 错误 |
| 摆动验证 | 间隔 1.3 s 的两张 canvas 截图不同，`swayTime` 持续推进；帧对比见 `test-artifacts/kelp-sway-a.png` / `kelp-sway-b.png` |
| 主场景 | `kelpModel = "blender"`，26 + 23 株、8,648 海藻三角形、2 个 instanced mesh、0 错误；截图 `test-artifacts/kelp-main-scene.png` |
| 回归 | `npm run smoke` PASS（默认关闭海藻）、`npm run smoke:rocks` PASS（`?glbRocks=2`） |
| 单测 / 构建 | `npm test` 31/31、`npx tsc --noEmit`、`npm run build` PASS |
| Draw calls | 主场景 500 条程序化鱼 + GLB 捕食者 + 49 株海藻 = 82；默认程序化基线 80–82，不宣称严格增量 |

沙箱使用 SwiftShader，FPS 仅用于证明页面可运行，**不作为性能结论**；硬件 GPU 验收待用户在本机完成（见 `docs/PHASE_C_ACCEPTANCE.md`）。

### 10.4 集成路径

1. `loadKelpAssets()` 加载并校验两个 GLB；GLTFLoader 小写化后的 `_swayweight` / `_bladephase` 统一重命名为 `aSwayWeight` / `aBladePhase`。
2. `generateKelpLayout()` 固定种子生成 49 株：5 个礁石核心各 3 株高海带 + 3 株宽叶，另向半径 24 的开阔沙地散布 26 株；基底下沉到 `floorHeightAt - 0.05`。
3. `KelpScatter` 为每种资产建 1 个 `InstancedMesh`，写入 `instancePhase` / `instanceFrequency` / `instanceAmplitude` 与近白色实例色；材质克隆后注入摆动 Shader。
4. `Environment.loadGlbKelp()` 仅在 `?kelp=1` / `?kelp=blender` 时调用；成功后在 `Environment.update()` 里每帧推进 `uKelpTime`；失败保留无海藻场景并 warning。
5. 海藻是装饰，不参与 `ObstacleSystem`；`Reef obstacles` 开关不影响海藻。
6. 失败回退：任一 GLB 校验失败或加载失败，`loadGlbKelp()` 返回 false，页面不白屏。

### 10.5 已知限制

- 低模风格，形态按用户参考图做成密集宽叶 + 深折 + 卷曲/分叉叶尖，但不是照片级海藻；没有 alpha 镂空叶缘。
- `kelp_a` 的 8 片填充叶为两列平面叶；近景会看到低模段数。
- 无 LOD、无碰撞、无半透明/次表面散射；法线不随摆动重算。
- 2 个 instanced draw call / 8,648 海藻三角形是当前固定成本；硬件 GPU 帧率与视觉验收未完成。

## 11. 细节海菜交付（Detail seaweed，2026-11-09）

### 11.1 交付物

| 文件 | 内容 |
| --- | --- |
| `assets_src/external/seaweed/seaweed.blend` / `.glb` | 用户原始上传，原样归档 |
| `assets_src/blender/seaweed_detail.blend` | 清理后的工作文件（贴图打包，302 组件，摆动属性） |
| `public/models/seaweed_detail.glb` | 1,221,720 B；13,792 三角形；10,246 顶点；高 1.200 / 宽 0.541 / 深 0.517；3 × 2048² PBR 贴图 |
| `assets_src/scripts/build_seaweed_detail.py` | 清除父级、居中、按连通组件写入 `_SWAYWEIGHT` / `_BLADEPHASE`、导出 |
| `assets_src/scripts/render_seaweed_detail_previews.py` | EEVEE 正面/三分之四/近景预览 |
| `assets_src/scripts/verify_seaweed_glb.py` | 结构校验（三角形、高度、原点、单材质、3 贴图、摆动属性） |
| `src/rendering/SeaweedAsset.ts` | 加载、属性重命名、贴图材质与契约校验 |
| `src/rendering/seaweedPlacement.ts` | 固定种子 6 株英雄实例布局 |
| `src/rendering/SeaweedScatter.ts` | 单 `InstancedMesh` + 顶点摆动 + 实例相位/频率/振幅 |
| `seaweed-preview.html` / `src/preview/seaweed-preview.ts` | 独立预览页 + `window.__seaweedPreview` 诊断 |
| `scripts/seaweed-glb-smoke.ts` / `seaweed-main-smoke.ts` / `seaweed-combo-smoke.ts` | 预览、主场景、全环境组合三项烟雾测试 |

### 11.2 复现流程

```bash
# Blender 会话内执行：
# assets_src/scripts/build_seaweed_detail.py
# assets_src/scripts/render_seaweed_detail_previews.py

python3 assets_src/scripts/verify_seaweed_glb.py
npm run smoke:seaweed
npm run smoke:seaweed:main
npm run smoke:seaweed:combo

# 主场景 / 独立预览
# http://localhost:5173/?seaweed=1
# http://localhost:5173/seaweed-preview.html
```

### 11.3 实测结果

| 项目 | 结果 |
| --- | --- |
| 结构校验 | PASS；13,792 三角形、1.2 m、单材质、3 贴图、`_SWAYWEIGHT` 0..1、`_BLADEPHASE` 228 个不同值 |
| 独立预览 | PASS；1 资产 / 5 实例 / 2 draw calls / 77,152 渲染三角形 / 3 maps / 0 错误 |
| 摆动验证 | 间隔 1.3 s 的 canvas 截图不同；帧对比 `test-artifacts/seaweed-sway-a.png` / `seaweed-sway-b.png` |
| 主场景 | PASS；`environment=bare&fishCount=50` 下 6 实例、82,752 海菜三角形、0 错误 |
| 全环境组合 | PASS；岩石 set + 48 珊瑚 + 91 低模海藻 + 6 细节海菜，264,091 渲染三角形、56 draw calls、0 错误 |
| 单测 / 类型 | `tests/SeaweedPlacement.test.ts` 5/5；`npx tsc --noEmit` PASS |
| 沙箱限制 | SwiftShader FPS 仅用于证明可运行；硬件 GPU 帧率/P95 待测 |

> 2026-11-09 后续：默认珊瑚层改为 12 株温带点缀；复现上表 48 珊瑚组合需加 `?coral=full`。

### 11.4 集成路径

1. `loadSeaweedAsset()` 加载 `public/models/seaweed_detail.glb`，校验三角形 10k–20k、高度 1.0–1.5、底部 y≈0、单材质、3 张 PBR 贴图与摆动属性。
2. `generateSeaweedLayout()` 固定种子生成 6 株：3 株在礁石核心的相机朝向侧，3 株在开阔沙地；基底下沉 0.04 m。
3. `SeaweedScatter` 建 1 个 `InstancedMesh`，写入实例相位/频率/振幅；`onBeforeCompile` 注入顶点摆动，贴图与 PBR 材质保持原样。
4. `Environment.loadGlbSeaweed()` 仅在 `?seaweed=1` / `?seaweed=blender` 时调用；成功后每帧推进 `uSeaweedTime`；失败保留无海菜场景并 warning。
5. 细节海菜是装饰层，不参与碰撞；默认关闭，不影响现有 91 株低模海藻。默认珊瑚层为 12 株温带点缀，`?coral=full` 恢复 48 株完整展示层。

### 11.5 已知限制

- 13,792 三角形 / 3 × 2048² 贴图是英雄资产成本，只放 6 株；不能直接当 91 株级散射使用。
- 模型自带岩石底座、海星与根须，实例化会重复这些装饰；它们不参与碰撞。
- 摆动只位移顶点，不重算法线；无 LOD、无半透明/次表面散射。
- 硬件 GPU 视觉/性能验收未完成，因此默认关闭；验收清单见 `docs/PHASE_SEAWEED_ACCEPTANCE.md`。

## 12. 小丑鱼鱼群交付（Clownfish school，2026-11-10）

### 12.1 源文件与归档

用户提供的 `clownfish-light.glb`（8,022,744 B；148,146 顶点 / 258,813 三角形；1 个双面材质、2 张 1024² JPEG；无骨骼/动画）归档到 `assets_src/external/clownfish/`。2026-11-10 再次上传的文件 SHA-256 与归档版本完全一致。源模型只有 GLB、没有 .blend，不影响流程：Blender 导入后即可生成 `.blend`。

### 12.2 关键修复：先焊接，再减面

第一次直接 Decimate 得到 2,399 面，但源网格有 **406 个互不相连的网格岛 / 36,667 条边界边**，每个岛独立塌缩，视口中呈现“面断断续续、不连续”的破碎效果。修复流程：

```python
bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
```

148,146 → 129,514 顶点，406 个岛合并为 1 个连续壳体；UV 为逐 loop 数据，焊接不破坏条纹贴图。随后再 Decimate 到 2,399 三角形，得到 1,269 顶点、1 个连通壳体、382 条边界边。

### 12.3 交付

- `assets_src/blender/clownfish_school.blend`
- `public/models/clownfish_school.glb`：360,120 B；1,269 顶点 / 2,399 三角形；1 材质 / 2 贴图；长度 1.0010；`_TAILWEIGHT` 0–1（尾部平均 0.988）；无动画/骨骼。
- `assets_src/scripts/build_clownfish_school.py`、`verify_clownfish_glb.py`。

### 12.4 集成

- `loadFishAsset(url, CLOWNFISH_CONTRACT)`：1,600–5,000 三角形、长度 1.0 ±5%、≤1 材质。
- `FishRenderer` 选项：0.50–0.60 m、保留贴图条纹的中性 instanceColor、较快尾摆、较低 rim；主鱼群同步降为 0.90–1.10 m，两种鱼比例约 1.9:1。
- `SimulationWorld` 第二鱼群：100 条，独立 Boids/配置/种子；软 home 锚点 `(−2.0, 5.2, −3.0)`、半径 4.2 m；共享捕食者恐惧，但捕食者只捕获主鱼群。
- 默认启用；`?clownfish=0` 关闭、`?clownfish=N` 调整；加载失败时关闭第二鱼群。
- 主鱼群默认切换为 `fish_school.glb`，`?fish=procedural` 回退；默认环境升级为 48 株珊瑚 + 6 处细节海菜。

### 12.5 验收

- `verify_clownfish_glb.py` PASS；`tests/ClownfishSchool.test.ts` 4/4；全量 31 文件 / 202 测试 PASS；`tsc --noEmit` PASS；`vite build` PASS。
- `npm run smoke:rich` PASS：默认 `/` 双鱼群 + 完整环境，58 draw calls、1,225,511 渲染三角形、0 浏览器错误；截图 `test-artifacts/rich-default-clownfish.png`。
- 硬件 GPU FPS/P95 待 Windows 本机 `npm run accept:gpu -- --scenarios=rich-default --counts=500 --channel=chrome`。

## 13. 变更记录

- v1.0（2026-11-08）：School Fish 首次交付；记录生成、建模、导出、集成、验收、性能数据和人工精修路径。
- v1.1（2026-11-08）：新增 Predator（礁鲨）交付；记录 4344 三角形、5.2016 总长、2048² 贴图、`_TAILWEIGHT` 尾摆 Shader、攻击自发光、`?predator=blender` 与 `smoke:predator` 验收。用户验收后修正第一背鳍、第二背鳍与臀鳍根部，使其沿身体表面曲线嵌入（bbox max y 更新为 +1.2406）。
- v1.2（2026-11-09）：新增珊瑚资产集交付；6 个基地模、共享 1024² 图集、`CoralAsset.ts`、`coral-preview.html`、`verify_coral_glbs.py`、`npm run smoke:coral`；记录实测三角形/尺寸/draw call 与已知限制。主场景暂未接入。
- v1.3（2026-11-09）：新增岩石与海底地形交付（Phase R）；13 个资产、7,869 三角形、392 KB GLB、3 × 2048² 图集；`RockAsset.ts` / `RockScatter.ts` / `rockPlacement.ts`；`?glbRocks=2` 替换主礁石并散布 54 个装饰实例；`verify_rocks_glb.py` 与 `smoke:rocks` 验收；记录 AO 烘焙隔离、UV V 轴翻转、EdgeSplit 与法线强度等实现要点。
- v1.4（2026-11-09）：Predator 升级为 v2 大白鲨交付；5990 三角形、5.2778 总长、4 材质 / 4 primitive、35 颗牙、下颚 + U 形口腔、反荫蔽贴图、`_TAILWEIGHT` 尾摆 + C 形弯曲 + 转弯倾斜 + 加速/减速响应；默认启用 GLB、`?predator=procedural` 回退；用户反馈后收小嘴部与第一背鳍；新增 `tests/PredatorAnimation.test.ts` 与 Chase 截图验收。
- v1.5（2026-11-09）：新增海藻资产集交付（Phase C）；`kelp_a` 184 / `kelp_b` 168 三角形，底部原点、双面单材质、`_SWAYWEIGHT` + `_BLADEPHASE` 顶点摆动；`KelpAsset.ts` / `KelpScatter.ts` / `kelpPlacement.ts`；`?kelp=1` 主场景 49 株、8,648 三角形；`verify_kelp_glbs.py`、`smoke:kelp` 与 `tests/KelpPlacement.test.ts` 验收；按用户参考图重做密集宽叶、深折、卷曲与分叉叶尖。
- v1.7（2026-11-09）：Predator 柔性转身；朝向 `slerp` 平滑、脊柱角度弯曲、`uTurnLag` 尾部延迟、法线联动；`predatorSpineBendAngle` 与 7 项转身测试；`smoke:predator` / `smoke:predator:shayu` 通过；新增俯视对照预览参数。
- v1.6（2026-11-09）：用户提供 `shayu.glb` 并指定为鲨鱼模型；新增 `import_shayu_predator.py`，完成牙齿合并、+Z 朝向、5.280 缩放、`_TAILWEIGHT`、3 材质 PBR 与 GLB 导出；`predator_shayu.glb` 9,826 三角形 / 1,600,488 B；默认捕食者切换为 shayu，v2 保留为 `?predator=v2`；新增 `scripts/predator-shayu-check.ts` 与 `npm run smoke:predator:shayu`。
- v1.8（2026-11-09）：新增细节海菜交付；用户上传的 302 组件海菜丛归档并预处理为 `seaweed_detail.glb`（13,792 三角形、1.2 m、3 × 2048² PBR、双面单材质）；按组件写入 `_SWAYWEIGHT` / `_BLADEPHASE`；`SeaweedAsset.ts` / `SeaweedScatter.ts` / `seaweedPlacement.ts`；`?seaweed=1` 主场景 6 株、82,752 三角形；`verify_seaweed_glb.py`、`smoke:seaweed`、`smoke:seaweed:main`、`smoke:seaweed:combo` 验收；默认关闭，待硬件视觉验收。
- v1.9（2026-11-10）：新增小丑鱼鱼群交付；`clownfish-light.glb` 先焊接 406 个网格岛再减面到 2,399 三角形，导出 `clownfish_school.glb`（360,120 B、1 材质、2 贴图、`_TAILWEIGHT`）；`SimulationWorld` 第二鱼群 100 条、软 home 锚定、共享捕食者恐惧；主鱼群默认切换 `fish_school.glb`；默认环境升级 48 株珊瑚 + 6 处细节海菜；新增 `smoke:rich`、`tests/ClownfishSchool.test.ts`。
