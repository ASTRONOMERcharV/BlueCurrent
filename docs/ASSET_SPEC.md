# Blue Current 资产规格（ASSET_SPEC）

版本：v2.0（2026-11-10，双鱼群 + 最丰富默认环境）
状态：本文件取代 `BLENDER_ASSET_CONTRACT.md` v0.1 中与 School Fish 相关的条款，成为 Blender 资产的唯一验收依据。第 1–10 节为 School Fish；第 11–12 节为 Predator（v2 大白鲨 + 用户 shayu，见 11.9–11.11）；第 13 节为珊瑚资产集；第 14 节为岩石与海底地形；第 15–16 节为海藻与细节海菜；第 17 节为小丑鱼鱼群。v0.1 中尚未被本文件覆盖的静态资产条款继续有效，直到它们各自升级到本规格。

所有尺寸、朝向和 Shader 区间均从当前代码实测，不是估计值。

## 0. 结论先行

School Fish 必须是：

- 局部 **+Z 朝前**（头在 +Z，尾在 −Z），局部 **+Y 向上**，原点在躯干几何中心附近；
- 包围盒总长 **1.650 ± 5%**，头端 z ≈ **+0.590**，尾尖 z ≈ **−1.060**；
- 三角面 **500–1500**，单条鱼 1 个几何体、2 个材质（身体 + 眼睛）；交付实测 **1448 三角形 / 821 顶点 / 2 primitives**；
- 尾部权重通过自定义顶点属性 **`_TAILWEIGHT`**（float, point domain）导出；GLTFLoader 会把未知属性名转成小写 `_tailweight`，运行时统一改名为 **`aTailWeight`**；缺失时退化为按 z 计算的 smoothstep；
- 材质为 Metallic-Roughness PBR：Base Color + Normal + Roughness，1024 贴图，无透明、无内置动画、无骨骼；
- 继续使用一个 `InstancedMesh` 渲染全部同种鱼，禁止每鱼一个 Mesh。

**2026-11-09 捕食者变更：** 用户提供的 `shayu.glb` 已转换为 `predator_shayu.glb` 并成为默认捕食者；v2 大白鲨保留为 `?predator=v2`。shayu 为 9,826 三角形 / 3 材质 / 静态张口，详见 11.9。

## 1. 当前实现实测基线

`src/rendering/FishRenderer.ts` 与 `src/rendering/Environment.ts:createFishGeometry()` 的当前值：

| 项目 | 实测值 |
| --- | --- |
| 局部前向 | `FORWARD = (0, 0, 1)` |
| 包围盒 min | (−0.435, −0.290, −1.060) |
| 包围盒 max | (+0.435, +0.390, +0.5897) |
| 总长（z） | 1.6497 |
| 三角形 | 124 / 条 |
| 几何 | 压扁 UV 球 + 尾锥 + 背鳍 + 左右胸鳍，`mergeGeometries` |
| 材质 | `MeshStandardMaterial`，`flatShading: true`，roughness 0.52，metalness 0.12 |
| 尾摆 | `onBeforeCompile` 顶点位移：`tailWeight = 1.0 − smoothstep(−0.95, 0.12, position.z)`，`transformed.x += sin(...) * tailWeight * 0.16` |
| 实例化 | `InstancedMesh(capacity)`、`instanceMatrix` 动态更新、`instancePhase` / `instanceSpeed` 实例属性、`setColorAt` |
| 朝向 | 速度方向与 `FORWARD` 求最短旋转四元数，再乘绕局部 +Z 的 bank 旋转 |
| 缩放 | 每条鱼 0.55–0.67（世界长度约 0.90–1.10 m） |

新模型必须兼容以上所有接口。允许在渲染层新增资产加载分支，但不得改变模拟层（位置、速度、角速度、fear、variant、bank）的任何数据契约。

## 2. 坐标与导出坐标转换

- Three.js：右手系、+Y 向上、局部 +Z 为前向。
- Blender：Z 向上。glTF 导出器默认做 Y-up 转换，映射关系为 `glTF(x, y, z) = Blender(x, z, −y)`。
- 因此 **在 Blender 中鱼头必须指向 −Y，尾指向 +Y**，导出后才是 +Z 朝前。禁止先把鱼做成 Blender +Y 朝前再靠导出旋转"碰运气"。
- 原点：位于主体几何中心附近（当前约为 z = −0.235，即头 +0.59 与尾 −1.06 的中点偏头侧）。允许模型原点落在身体体积内；不得把原点放到嘴尖或尾尖，否则实例旋转中心错误。
- 导出单位：米制、缩放 1.0、应用全部变换。

## 3. School Fish 几何规格

### 3.1 尺寸（导出后 Three.js 局部坐标）

| 项目 | 目标 | 容差 |
| --- | --- | --- |
| 头端 z | +0.590 | ±0.03 |
| 尾尖 z | −1.060 | ±0.05（即总长 1.650 ±5%） |
| 最大体高（含背鳍/臀鳍） | ≤ 1.05 | 不硬性 |
| 最大体宽 | ≤ 0.42 | 不硬性 |
| 躯干最大半高 | ≈ 0.30–0.32 | 造型目标 |
| 躯干最大半宽 | ≈ 0.17–0.19 | 造型目标 |
| 眼中心 z | ≈ +0.40 | 造型目标 |

鱼体剖面必须沿 z 变化：吻端窄、眼区加高、肩部最深、向后收窄到尾柄。禁止用一个椭球代替。

### 3.2 必须包含的结构

1. 躯干：闭合网格，四边形为主，24 段环向、17 个纵向截面（另加吻端与尾柄封口）。
2. 尾鳍（caudal）：分叉，覆盖 z ≈ −0.58 到 −1.060；尾尖是全模型最靠后的点。
3. 背鳍（dorsal）：位于 z ≈ +0.10 至 −0.30，顶端 y ≈ +0.52。
4. 臀鳍（anal）：位于 z ≈ −0.27 至 −0.48，底端 y ≈ −0.32。
5. 腹鳍（pelvic）×2：z ≈ −0.08 至 −0.22，向斜下方展开。
6. 胸鳍（pectoral）×2：鳃后 z ≈ +0.24 至 +0.34，沿体侧向斜后下方展开。
7. 眼 ×2：独立小球，中心 y ≈ +0.06，x ≈ ±0.145，半径 ≈ 0.05；使用独立高光材质。
8. 鳃盖轮廓：在 Base Color 与 Normal 贴图中绘制弧线，不单独建几何体。

鱼鳍是有厚度的薄片或双面材质薄片；不得用实心圆锥冒充。鳍条与鳞片由法线贴图表现，不逐片建模。

### 3.3 拓扑与预算

| 部件 | 三角形（目标） | 交付实测 |
| --- | --- | --- |
| 躯干 + 鱼鳍 ×7 | 800–1250 | 1160 |
| 眼睛 ×2 | 250–320 | 288 |
| 合计 | 900–1450（硬上限 1500） | **1448** |

- 全部法线朝外，平滑着色；不导出 flat shading。
- 不得有非流形边、孤立顶点、零面积三角面。
- 不导出骨骼、形态键、动画、约束、相机、灯光、Empty。

## 4. 尾部权重 `_TAILWEIGHT`

### 4.1 定义

每个顶点一个 float ∈ [0, 1]，point domain：

- `0.0`：完全静止（头部、躯干前部、胸鳍）。
- `1.0`：全幅摆动（尾鳍主体与尾尖）。
- 中间值：随 z 平滑过渡。

权重按与现行 Shader 完全一致的公式烘焙，保证新旧几何切换时摆动外观连续：

```text
tailWeight = 1.0 − smoothstep(−0.95, 0.12, z_local)
```

其中 `z_local` 为导出后的 Three.js 局部 z。背鳍、臀鳍、腹鳍的顶点跟随所在位置的躯干权重；尾鳍从基部 ≈0.7 过渡到尖端 ≈1.0。

### 4.2 导出与运行时

- Blender 自定义属性名：`_TAILWEIGHT`，类型 FLOAT，domain POINT。
- 导出时开启 `export_attributes=True`。
- 运行时优先级：`aTailWeight` 属性 > uniform 化的 z 公式回退。回退阈值使用 `uTailStart = −0.95`、`uTailEnd = 0.12` 两个 uniform，禁止再硬编码第二组数值。
- GLTFLoader 会把 `_TAILWEIGHT` 加载为 `_tailweight`；`FishAsset.ts` 在合并 primitive 后统一改名为 `aTailWeight`，Shader 只引用该规范名。
- 属性缺失或校验不合格时资产加载失败，回退程序化几何并输出警告。

## 5. 材质规格

### 5.1 身体材质（`fish_school_body`）

Metallic-Roughness PBR，供 `MeshStandardMaterial` / glTF 使用：

| 通道 | 数值 / 来源 |
| --- | --- |
| Base Color | 1024 BaseColor 贴图；背部深蓝绿、侧线银灰、腹部近白（无顶点色） |
| Metalness | 0（生物表面） |
| Roughness | 0.35–0.60，来自 Roughness 贴图；鳞片区域略低 |
| Normal | 切线空间法线贴图；鳞片覆盖躯干，鳍条覆盖鱼鳍 |
| AO | 不单独使用；由法线和顶点色暗部代替 |
| Emissive | 不使用 |
| Transparent | 不使用；鱼鳍用双面（doubleSided） |
| 顶点色 | 不使用（不导出 `COLOR_0`） |

### 5.2 眼睛材质（`fish_school_eye`）

| 通道 | 数值 |
| --- | --- |
| Base Color | 近黑 (0.01, 0.01, 0.012) |
| Roughness | 0.05–0.12 |
| Metalness | 0 |
| 贴图 | 无 |

眼睛材质是唯一允许的第二材质；每个 InstancedMesh 因此最多 2 个 draw call（全体实例共享，不是每鱼 2 次）。

### 5.3 贴图规范

- 单张 ≤ 1024×1024；身体材质最多 3 张（BaseColor / Normal / Roughness）。
- 格式：BaseColor 用 JPEG，Normal / Roughness 用 PNG（避免法线压缩伪影）。
- 色彩空间：BaseColor = sRGB；Normal / Roughness = Non-Color。
- 所有贴图嵌入 GLB，无外部纹理依赖；源 PNG/JPEG 保留在 `assets_src/textures/`。
- 贴图布局采用单图集：躯干占左侧约 2/3（x 20–660），鱼鳍射线区域占右上（x 700–1012, y 12–500），其余区域填充底色并留边距，防止采样串色。
- 交付贴图：BaseColor JPEG 111,565 B；Normal PNG 426,072 B；Roughness 在 GLB 内为 PNG 294,555 B。三张均为 1024×1024。

### 5.4 与 `instanceColor` 的关系

- 鱼体本身携带颜色（BaseColor 贴图），`instanceColor` 只负责个体差异：低饱和冷色调、明度 0.92–0.99。
- 受惊时仍按现有行为向橙色 lerp，以保留"惊扰改变颜色"的模拟可视化。
- 程序化回退几何没有顶点色/贴图，继续使用当前的鲜艳 HSL 调色逻辑，不被新模型调色影响。

## 6. GLB 导出规格

| 项目 | 要求 |
| --- | --- |
| 路径 | `public/models/fish_school.glb` |
| 源文件 | `assets_src/blender/fish_school.blend` |
| 贴图源 | `assets_src/textures/fish_school_*.{jpg,png}` |
| 格式 | glTF 2.0 Binary |
| 坐标系 | +Y up，米制，缩放 1.0 |
| 三角面 | ≤ 1500 |
| 材质 | 2 个（body / eye），doubleSided |
| 动画 | 0 |
| 骨骼 | 0 |
| 文件大小 | 目标 ≤ 1.5 MB（含贴图）；交付实测 886,872 B（866 KB） |

导出后必须用独立脚本解析 GLB JSON，核查：节点数、mesh primitive、accessor 数量、`_TAILWEIGHT`、`TEXCOORD_0`、`TANGENT`、材质、图片、无 animations/skins。脚本：`assets_src/scripts/verify_fish_glb.py`。

## 7. Three.js 集成规范

1. 新增 `GLTFLoader` 资产加载路径和校验层；校验失败回退程序化几何并输出警告，页面不得白屏。
2. 资产默认启用：主鱼群默认 `fish_school.glb`，`?fish=procedural` 回退；小丑鱼群默认 `clownfish_school.glb`，`?clownfish=0` 关闭。预览页可单独加载任一资产。
3. `FishRenderer` 保持：
   - 单个 `InstancedMesh`；
   - `instanceMatrix` / `instanceColor` 每帧更新；
   - `instancePhase` / `instanceSpeed` 实例属性；
   - 顶点 Shader 尾摆 + bank 旋转。
4. 加载后保留 glTF 材质参数（贴图、doubleSided、roughness），设置 `flatShading = false`；不得每帧重建材质或几何体。GLTFLoader 的多 primitive 会被合并为带 groups 的单个几何体，InstancedMesh 用 2 个材质绘制，全体鱼共享 2 个 draw call。
5. 所有资产先进入独立测试场景 `preview/fish-preview.html`，通过视觉和性能检查后才在主场景启用。当前主场景默认 `/` 即为 Blender 鱼；`?fish=procedural` 为回退入口。
6. 主场景与测试场景都必须保留程序化几何回退；任何校验失败不得白屏。
7. 为满足 PBR 镜面响应，`SceneManager` 新增程序化水下 PMREM 环境贴图（`UnderwaterEnvironment.ts`），环境强度 0.55；该贴图同时影响鱼、礁石和珊瑚。

## 8. 性能预算与验收

以当前 124 三角形程序化鱼为性能基线：

| 项目 | 目标 |
| --- | --- |
| 单鱼三角形 | ≤ 1500（实测 1448） |
| 2000 条鱼三角形总量 | ≤ 3.0 M（实测 2.896 M） |
| 每条鱼 draw call | 0（身体 + 眼睛共 2 个实例化 draw call；主场景总 draw calls 82 → 83） |
| 新增贴图显存 | ≤ 16 MB（3×1024² RGBA + mipmaps ≈ 16.8 MB 估算） |
| CPU 模拟 | 与改造前一致（500/1000/2000 实测 8.34/24.24/67.41 ms，与基线差异在噪声内） |
| 浏览器控制台 | 0 错误、0 Shader 编译失败 |

验收必须包含：

- `npm run build`、`npm test`、`npm run smoke` 全部通过；
- 预览页截图与主场景 A/B 截图；
- 500 / 1000 / 2000 条鱼的真实帧时间对比，明确区分 SwiftShader 软件渲染与本机硬件 GPU 结果；
- 尾摆、朝向、bank、受惊变色、死亡隐藏均无回归。

硬件 GPU 浏览器验收在沙箱内无法完成，必须由用户在本机 Chrome/Edge 补做，不得用 SwiftShader 数据替代。沙箱只验证了结构、加载、着色器编译、draw calls 和 CPU 模拟；软件渲染 FPS 不作为性能结论。

## 9. 命名与目录

```text
Project/BlueCurrent/
├── public/
│   └── models/
│       └── fish_school.glb
├── assets_src/
│   ├── blender/
│   │   └── fish_school.blend
│   └── textures/
│       ├── fish_school_basecolor.jpg
│       ├── fish_school_normal.png
│       └── fish_school_roughness.png
└── docs/
    ├── ASSET_SPEC.md
    ├── ASSET_PIPELINE.md
    └── asset-previews/
        └── fish_school_*.png
```

## 10. 交付实测（2026-11-08）

| 项目 | 实测 |
| --- | --- |
| GLB | `public/models/fish_school.glb`，886,872 B |
| 三角形 / 顶点 | 1448 / 821 |
| 包围盒 | min (−0.218, −0.314, −1.051)，max (+0.218, +0.475, +0.590) |
| 总长 Z | 1.641（目标 1.650，误差 −0.5%） |
| 属性 | POSITION, NORMAL, TANGENT, TEXCOORD_0, _TAILWEIGHT |
| 材质 | `fish_school_body`（3 贴图，doubleSided）、`fish_school_eye`（无贴图） |
| 动画 / 骨骼 | 0 / 0 |
| 浏览器加载 | `?fish=blender` 成功，`fishModel: "blender"`，500 条鱼；标准主场景截图 draw calls 82 → 83，0 错误 |
| 资产烟雾测试 | `npm run smoke:fish` 通过 |
| 主场景回归 | `npm test`、`npm run build`、`npm run smoke` 通过（沙箱 SwiftShader） |

## 11. Predator（大白鲨，v2）资产规格

### 11.1 结论先行

Predator（大白鲨）必须是：

- 局部 **+Z 朝前**（头在 +Z，尾在 −Z），局部 **+Y 向上**，原点在躯干几何中心附近；
- 包围盒总长 **5.280 ± 5%**，头端 z ≈ **+2.320**，尾尖 z ≈ **−2.958**；
- 三角面 **3000–20000**；交付实测 **5990 三角形 / 3134 Blender 顶点 / 3394 GLB accessor 顶点**；
- 单 mesh、**4 材质**（身体 / 眼睛 / 牙齿 / 口腔），身体使用 2048² BaseColor / Normal 与 1024² Roughness；
- 与普通鱼明显不同：更大的头与嘴、更粗的躯干、独立眼球、下颚与口腔、35 颗独立牙齿、大胸鳍/背鳍/尾鳍、鲨鱼式反荫蔽；
- 尾部权重通过自定义顶点属性 **`_TAILWEIGHT`** 导出；GLTFLoader 会转成小写 `_tailweight`，运行时统一改名为 **`aTailWeight`**；
- 不导出骨骼、形态键、动画、相机、灯光、Empty。

### 11.2 坐标、尺寸与朝向

- Blender 中鲨鱼头指向 **−Y**，尾指向 +Y；导出器按 `glTF(x, y, z) = Blender(x, z, −y)` 转换后得到 +Z 朝前。
- 导出单位：米制、缩放 1.0、应用全部变换。
- 交付实测：

| 项目 | 实测 |
| --- | --- |
| 包围盒 min | (−1.2681, −0.8601, −2.9578) |
| 包围盒 max | (+1.2681, +1.1331, +2.3200) |
| 总长（z） | 5.2778（目标 5.280，误差 −0.04%） |
| 宽度（x） | 2.5362 |
| 高度（y） | 1.9932 |
| 原点 | (0, 0, 0)，位于躯干体积中心附近 |

### 11.3 几何规格

1. **躯干**：30 个纵向截面 × 40 段环向超椭圆放样；厚实鱼雷形，最大半高 0.620、半宽 0.540；吻端为圆锥形，头部更宽、更扁；禁止用单一椭球替代。
2. **头部与嘴部**：短下颚（z 1.700–2.220，6 个截面 × 20 段闭合管）、U 形口腔内壁（9 排）、上下颌共 **35 颗独立锥形牙**（上颌 19、下颌 16）；不再是“整块深色矩形”。
3. **鱼鳍**：第一背鳍、第二背鳍、臀鳍、腹鳍 ×2、胸鳍 ×2、尾鳍，共 7 组；全部为有厚度的闭合薄片（0.050–0.065）。第一背鳍已按反馈收小：根部 z 0.65…−0.42，峰高 0.56；胸鳍展向长度 1.05；尾鳍异尾形，上叶长、下叶短。
4. **眼睛 ×2**：独立球体，20 × 12 段，半径 **0.043**，中心 (±0.348, +0.170, +1.950)，使用独立高光材质。
5. **鳃裂、侧线、口裂、鼻孔**：由 BaseColor 与 Normal 贴图表现；鳃裂边缘做羽化，避免出现矩形色块。
6. **拓扑与预算**（按 GLB primitive / 材质统计）：

| 部件 | 三角形（目标） | 交付实测 |
| --- | --- | --- |
| 身体 + 鱼鳍 + 下颚外壁 | 2800–12000 | 4564 |
| 眼睛 ×2 | 300–1000 | 880 |
| 牙齿 ×35 | 200–800 | 350 |
| 口腔内壁 | 50–400 | 196 |
| 合计 | 3000–20000（硬上限 20000） | **5990** |

- 全部法线朝外、平滑着色；不导出 flat shading。
- 无孤立顶点；零面积面只出现在鳍根/鳍尖/牙根的隐藏退化边，渲染不可见。
- 不导出骨骼、形态键、动画、约束、相机、灯光、Empty。

### 11.4 尾部权重 `_TAILWEIGHT`

每个顶点一个 float ∈ [0, 1]，point domain：

```text
tailWeight = 1.0 − smoothstep(−1.95, 1.30, z_local)
```

- `0.0`：头部、躯干前部、眼、牙、口腔前部。
- `1.0`：尾柄与尾鳍主体。
- 第一背鳍、第二背鳍、臀鳍、腹鳍的顶点按所在 z 取权重，随躯干弯曲。
- Blender 属性名 `_TAILWEIGHT`，FLOAT，POINT；导出时开启 `export_attributes=True`。
- 运行时优先级：`aTailWeight` > uniform 化的 z 公式回退；回退阈值使用 `uTailStart = −1.95`、`uTailEnd = 1.30`。
- 属性缺失或超出 [0,1] 时资产加载失败，回退程序化捕食者。
- v2 实测：权重 >0.9 的 **666** 个顶点平均 z = −2.053（范围 −2.958…−1.321）；权重为 0 的 1600 个顶点全部位于 z ≥ +1.265。

### 11.5 材质与贴图

#### 身体材质（`predator_body`）

| 通道 | 数值 / 来源 |
| --- | --- |
| Base Color | 2048² JPEG 图集；深灰蓝背、灰色侧腹、近白腹，交界为不规则锯齿（大白鲨反荫蔽） |
| Metalness | 0（生物表面） |
| Roughness | 0.36–0.68，来自 1024² Roughness 贴图 |
| Normal | 2048² 切线空间法线；皮肤颗粒、鳃裂、侧线、口裂、眼窝 |
| AO / Emissive | 不烘焙；攻击状态的自发光由运行时 `emissiveIntensity` 控制 |
| Transparent | 不使用；doubleSided |
| 顶点色 | 不使用（不导出 `COLOR_0`） |

#### 眼睛材质（`predator_eye`）

| 通道 | 数值 |
| --- | --- |
| Base Color | 近黑 (0.006, 0.006, 0.009) |
| Roughness | 0.12 |
| Metalness | 0 |
| 贴图 | 无 |

#### 牙齿材质（`predator_teeth`）

| 通道 | 数值 |
| --- | --- |
| Base Color | (0.93, 0.91, 0.85) |
| Roughness | 0.34 |
| Metalness | 0 |
| 贴图 | 无 |

#### 口腔材质（`predator_mouth`）

| 通道 | 数值 |
| --- | --- |
| Base Color | (0.07, 0.015, 0.014) |
| Roughness | 0.65 |
| Metalness | 0 |
| 贴图 | 无；doubleSided（从口腔内侧可见） |

#### 贴图规范

- 单张 ≤ 2048×2048；身体材质最多 3 张。
- BaseColor 为 sRGB JPEG；Normal / Roughness 为 Non-Color PNG。
- 所有贴图嵌入 GLB，无外部纹理依赖；源文件保留在 `assets_src/textures/`。
- 图集布局：躯干占左侧约 59%（x 16–1232），鱼鳍占右上（x 1272–2032, y 16–1232），其余区域填充底色并留边距。
- 交付大小：BaseColor 236,237 B；Normal 626,609 B；Roughness 121,786 B。
- 显存估算：2 × 2048² RGBA + 1024² RGBA + mipmaps ≈ **50 MB**；这是本轮资产的已知成本。

### 11.6 GLB 导出规格

| 项目 | 要求 |
| --- | --- |
| 路径 | 默认 `public/models/predator_shayu.glb`；v2 备选 `predator_reef_shark.glb` |
| 源文件 | `assets_src/blender/predator_shayu.blend` / `predator_reef_shark.blend` |
| 贴图源 | `assets_src/textures/shayu_*.png` / `predator_*.{jpg,png}` |
| 格式 | glTF 2.0 Binary |
| 坐标系 | +Y up，米制，缩放 1.0 |
| 三角面 | 3000–20000（shayu 9826；v2 5990） |
| 材质 / primitive | 3–4（shayu 3；v2 4） |
| 属性 | POSITION, NORMAL, TANGENT, TEXCOORD_0, _TAILWEIGHT |
| 图片 | 3（basecolor / normal / roughness） |
| 动画 / 骨骼 | 0 / 0 |
| 文件大小 | ≤ 4 MB；shayu 1,600,488 B；v2 1,347,140 B |

导出后必须用独立脚本 `assets_src/scripts/verify_predator_glb.py` 解析 GLB JSON，核查节点、3–4 个 primitive 的材质顺序、三角形、包围盒、朝向、`_TAILWEIGHT`、UV、法线、切线、材质、贴图、动画和骨骼。

### 11.7 Three.js 集成规范

1. `src/rendering/PredatorAsset.ts` 使用 GLTFLoader 加载 GLB，合并多 primitive、改名 `aTailWeight`、校验契约（3–4 材质、`predator_body` 存在、长度 5.280 ±5%）；失败回退程序化捕食者并输出警告。
2. `src/rendering/PredatorRenderer.ts` 保持单 mesh、3–4 材质；**所有材质都注入** `onBeforeCompile` 尾摆 Shader，使口腔、牙齿与身体弯曲保持一致：
   ```glsl
   float tailWeight = aTailWeight;
   float bodyT = clamp((2.32 - position.z) / 5.28, 0.0, 1.0);
   float bend = uTurn * sin(bodyT * 3.14159265) * 0.24;
   float swimWave = sin(uSwimPhase + position.z * 1.05);
   float secondaryWave = sin(uSwimPhase * 0.52 + position.z * 0.58 + 1.7);
   float swimAmplitude = (0.15 + 0.035 * uSwimSpeed) * (0.35 + 0.65 * tailWeight);
   swimAmplitude *= (1.0 + 0.20 * uAttack) * (1.0 + 0.35 * uThrust);
   transformed.x += bend + (swimWave + secondaryWave * 0.28) * tailWeight * swimAmplitude;
   ```
3. **默认启用 shayu GLB**；`?predator=v2` 切换到 v2 大白鲨，`?predator=procedural` 显式回退程序化版本。任何加载或校验失败不得白屏。
4. **转弯倾斜**：`PredatorRenderer` 用航向角差分得到 yaw rate，目标 roll = `clamp(−yawRate × 0.22, −0.6, 0.6)`，绕局部 +Z 平滑施加；预览页也展示该 roll。
5. **加速/减速**：用速度差分 / 参考加速度（9）得到平滑 `uThrust ∈ [−1, 1]`，驱动摆尾幅度与频率；捕食追击加速时摆动更宽，转入搜索减速时收窄。
6. **转弯 C 形弯曲**：yaw rate 归一化为 `uTurn ∈ [−1, 1]`，在顶点 Shader 中沿身体中线加入正弦权重弯曲。
7. 攻击状态的可视化仍为 **自发光脉冲**：`emissive = 0xff5a24`；v2 的 `emissiveIntensity` 0–0.55，shayu（3 材质）为 0–0.30，避免浅色贴图整体变橙；不对贴图整体染色。程序化回退保留原有橙色 lerp。
8. 独立预览页 `preview/predator-preview.html` 提供 Hero / Close-up / Chase 三种模式；Hero 转台自动演示 turn/thrust/bank，Chase 使用真实 `SimulationWorld`、`PredatorSystem` 和 `SceneManager`。
9. 所有资产必须在独立预览页通过视觉和性能检查后，才在主场景启用。

### 11.8 性能预算与验收

| 项目 | 目标 / 实测 |
| --- | --- |
| Predator 三角形 | ≤ 20000（shayu 9826；v2 5990） |
| Predator draw call | shayu 3（body / mouth / teeth）；v2 4；程序化版本 6 |
| 主场景 draw calls（500 条 procedural 鱼 + GLB Predator） | shayu 实测 **81**；v2 历史实测 80–82 |
| 主场景 draw calls（150 条 GLB 鱼 + GLB Predator） | shayu 实测 **82**；v2 历史实测 83 |
| 新增贴图显存 | shayu ≈ 16 MB（3 × 1024² + mips）；v2 ≈ 50 MB |
| 浏览器控制台 | 0 错误、0 Shader 编译失败 |

验收必须包含：

- `python3 assets_src/scripts/verify_predator_glb.py` 通过；
- `npm run smoke:predator` 通过（默认主场景 `predatorModel: "blender"`、Hero 资产统计、Chase 真实 FSM、组合 GLB、bank/thrust/turn 范围）；
- `npm test`（含 `tests/PredatorAnimation.test.ts` 的转弯倾斜符号/钳制测试）、`npm run build`、`npm run smoke`、`npm run smoke:fish`、`npm run smoke:glb` 不回归；
- 预览页截图与主场景截图；
- 明确区分 SwiftShader 软件渲染与本机硬件 GPU 结果。

硬件 GPU 下的 Predator FPS、P95 帧时间和 GPU 时间尚未测量；沙箱 SwiftShader 数据不作为性能结论。本机验收运行 `npm run accept:gpu`（Windows，四组场景 × 500/1000/2000 条鱼）；脚本检测到 SwiftShader 时以退出码 2 失败，结果写入 `test-artifacts/gpu-acceptance/latest.md`。

### 11.9 用户 shayu 资产（当前默认，2026-11-09）

用户提供的 `shayu.glb` 经转换后成为当前默认捕食者；v2 保留为 `?predator=v2` 对照。该资产是 stylized 造型，不是 v2 的程序化大白鲨。

**输入与转换**

- 输入：`assets_src/external/shayu/shayu.glb`（428,968 B；3 mesh / 3 primitive；7,248 身体 + 128 口腔 + 2,450 牙齿三角形；无骨骼、无动画、无 `_TAILWEIGHT`；1,024² `pifu` BaseColor；材质 `bifu` / `材质`）。
- 隐藏的 `ya`（70 三角形，位于模型外）删除；牙齿 `ya.001` 合并进身体网格，保留 UV 和自定义法线。
- 旋转 +90°（Blender Z），头从 −X 转到 Blender −Y，导出为 glTF +Z 前向；按 5.280 / 4.898 = 1.07796 统一缩放，包围盒居中。
- `_TAILWEIGHT = 1 − smoothstep(−1.95, 1.30, z_gltf)`；9,826 三角形中权重 >0.9 的 967 个顶点平均 z = −1.946。
- 材质：`predator_body`（用户 BaseColor + 1024² 平坦法线 + 1024² 粗糙度；单面）、`predator_mouth`（暗红、doubleSided）、`predator_teeth`（象牙白）。眼睛由贴图绘制，没有独立眼网格；没有下颚铰链或 `_JAW`。
- 源文件 `assets_src/blender/predator_shayu.blend`；转换脚本 `assets_src/scripts/import_shayu_predator.py`；贴图 `assets_src/textures/shayu_{basecolor,normal,roughness}.png`。

**交付实测**

| 项目 | 实测 |
| --- | --- |
| GLB | `public/models/predator_shayu.glb`，1,600,488 B |
| 三角形 / 顶点 | 9,826 / 6,570（Blender）；GLB accessor 顶点 7,442 |
| 包围盒 | min (−1.3213, −1.0140, −2.6400)，max (+1.3213, +1.0140, +2.6400) |
| 总长 Z | 5.2800（目标 5.280，0%） |
| 属性 | POSITION, NORMAL, TANGENT, TEXCOORD_0, _TAILWEIGHT |
| 材质 / primitive / 图片 | 3 / 3 / 3（body, mouth, teeth） |
| 动画 / 骨骼 | 0 / 0；尾摆、C 形弯曲、转弯倾斜、加速/减速在运行时完成；无下颚动画 |
| 尾权重 | 0–1；>0.9 的 967 个顶点平均 z = −1.946 |
| 贴图 | BaseColor 153,654 B + Normal 96,264 B + 导出的 metallicRoughness 900,081 B；源图 1024² |
| 浏览器 | Hero / Close / Chase 通过；主场景 150 条鱼 draw calls **81**；组合 GLB 82；0 错误 |
| 结构校验 | `verify_predator_glb.py public/models/predator_shayu.glb` PASS |
| 资产烟雾 | `npm run smoke:predator` 通过（默认 shayu，500 条鱼，draw calls 81，bank/thrust/turn 有效） |
| 专项烟雾 | `npm run smoke:predator:shayu` 通过（Hero / Close / Chase / Main；沙箱 SwiftShader） |
| 截图 | `docs/asset-previews/shayu_predator_{side,three_quarter,closeup,front,top,underside}.png`；`test-artifacts/predator-shayu-{hero,close,chase,main}.png` |

**与 v2 的差异与限制**

- 3 材质而非 4；没有独立眼几何，也没有下颚铰链 / `_JAW`，嘴巴保持建模时的张开姿态，攻击开口动画不可用。
- 背鳍更高、更尖，体型更圆润，属于用户提供的 stylized 造型；没有按 v2 的 #344C55 / #71888B / #D6D9D3 反荫蔽重新绘制。
- 身体单面渲染（闭合网格），口腔双面；眼睛、鳃裂、侧线由用户贴图表现。
- 用户贴图偏浅灰，Three.js 水下光照下呈灰白/蓝灰；未强制套用 v2 的三层配色。
- 攻击自发光对 3 材质资产降为 `emissiveIntensity ≤ 0.30`，避免浅色贴图整体变橙；v2 仍为 0.55。
- 硬件 GPU 的 FPS、P95 帧时间和 GPU 时间仍未测量；SwiftShader 数据不作为性能结论。

### 11.10 柔性转身（2026-11-09）

原来的转身由两个独立部分组成：`group.quaternion` 每帧直接对齐速度方向；Shader 只给身体增加 `uTurn * sin(bodyT * π) * 0.24` 的横向位移。结果是整个模型先刚性转到新朝向，身体再做一点剪切，尾鳍仍跟随同一刚体朝向，因此看起来“很硬”。

现在的转身分为三层：

| 层 | 参数 | 作用 |
| --- | --- | --- |
| 视觉朝向 | `HEADING_RESPONSE = 9.0`（attack +3.0） | `renderQuaternion.slerp(targetQuaternion, 1 − exp(−dt·response))`，90° 速度突变不会在一帧完成 |
| 脊柱弯曲 | pivot `z = 2.45`，length `5.20`，最大 `0.38 rad`，曲线 `bodyT^1.35` | 头部作为旋转支点，截面和鳍随局部切线旋转；法线同步旋转 |
| 尾部延迟 | `TURN_RESPONSE = 7.5`，`TAIL_TURN_RESPONSE = 3.0`，延迟混合 `smoothstep(0.18, 1, bodyT)` | 尾柄/尾鳍使用更慢的 `uTurnLag`；回正时保留旧转向惯性 |

朝向误差还会直接参与目标弯曲：`headingError` 分别以 `2.4`（turn）和 `1.8`（bank）的增益加入 `predatorTurnForYawRate` / `predatorBankForYawRate`，这样视觉朝向追上速度方向之前，身体不会先恢复成直线。新增 `uTurnLag` uniform，Shader 缓存键升级为 `v4`。

验证：

- `tests/PredatorAnimation.test.ts` 7/7：保留原有 bank/C-bend 测试，新增头部固定、尾部延迟、回正惯性、90° 速度突变不瞬时对齐、尾部滞后于 `turnFactor` 的测试。
- `npm run smoke:predator`：PASS，默认 shayu 与组合 GLB 均 0 浏览器错误；主场景观测到 `predatorTurn = 0.127`、`predatorTailTurn = 0.139`（尾部仍在跟随）。
- `npm run smoke:predator:shayu`：PASS（Hero / Close / Chase / Main）。
- 对照图：`test-artifacts/predator-turn-before.png` / `predator-turn-after.png`；俯视 `predator-turn-top-before.png` / `predator-turn-top-after.png`。
- 预览调试参数：`?mode=hero&poseTime=2.856&view=top` 固定强转弯姿态，便于复现对照。

限制：这是顶点 Shader 的视觉柔性，不是骨骼/IK；不会反馈到 `PredatorSystem` 的转向、碰撞或捕获判定；尾部弯曲依赖 `_TAILWEIGHT`，程序化回退仍使用原有尾节点旋转；shayu 没有骨骼，因此不能做脊椎分段控制或下颌动画。

### 11.11 骨骼化程序游动（2026-11-09）

11.10 的 Shader 柔性仍属于视觉剪切：身体截面不旋转、尾鳍不绕尾柄俯仰、胸鳍不参与机动。本轮把 shayu 升级为真正的 `SkinnedMesh`，由 `PredatorAnimationController` 逐帧驱动骨骼；运动轨迹仍完全由 `PredatorSystem` 决定。

| 项目 | 实测 / 约定 |
| --- | --- |
| GLB | `public/models/predator_shayu_rigged.glb`，1,753,144 B |
| 三角形 / 顶点 | 9,826 三角形；7,442 GLB accessor 顶点（与静态 shayu 相同网格） |
| 材质 / primitive | 3 / 3（`predator_body`、`predator_mouth`、`predator_teeth`） |
| 包围盒 | min (−1.3213, −1.0140, −2.6400)，max (+1.3213, +1.0140, +2.6400)，长度 Z 5.2800 |
| 骨骼 | 11 joints：`Predator_Root`、`Spine_00..05`、`Caudal_Peduncle`、`Tail_Fin`、`Pectoral_L/R_Root`；无动画 clip |
| 权重 | 每顶点 ≤ 3 影响（glTF 上限 4），权重和 1.000000；`Tail_Fin > 0.5` 的 223 个顶点平均 Z −2.472；左右胸鳍各约 290 个顶点 |
| 层级 | `Pectoral_L/R_Root` 的父级必须是 `Spine_02`；`Tail_Fin` 的父级必须是 `Caudal_Peduncle` |
| 头部稳定 | 身体前 34% 权重固定在 `Spine_00`，振幅包络从 `s = 0.34` 开始增长 |
| 源文件 | `assets_src/blender/predator_shayu_rigged.blend`（贴图已打包） |
| 绑定脚本 | `assets_src/scripts/rig_predator_shayu.py`（Blender 5.2，MCP 执行） |
| 结构校验 | `python3 assets_src/scripts/verify_predator_rig.py` PASS |
| 运行时加载 | `src/rendering/PredatorRigAsset.ts`（骨骼名/层级/权重/长度/材质校验） |
| 运行时动画 | `src/rendering/PredatorAnimationController.ts`（行波、频率、转弯、俯仰、胸鳍、攻击） |

动画模型：

- 行波：`theta(s,t) = A(s) · sin(phase − k·s) + turn(s)`，`A(s) = lerp(0.045, 0.10, speedNorm) · smoothstep(0.34, 1, s)^1.15`；`k = 3.0`；每根脊柱骨骼相对于父骨骼旋转，逐帧从 rest pose 重新计算，不累加。
- 频率：随速度在 0.8–1.9 Hz 之间平滑变化，攻击 +0.55 Hz、推力 +0.25 Hz；`phase += 2π·f·dt` 持续累积，不因状态切换重置。
- 尾鳍：额外 ±0.38 rad 摆幅，相位滞后 0.55 rad，尾柄/尾鳍的转向使用更慢的 `tailTurn`。
- 转向：yaw 由临界阻尼弹簧和 4 rad/s 上限控制；`turn` / `tailTurn` 分别以 6.5/s 和 2.6/s 平滑；后段身体按 `smoothstep(0.12, 0.9, s)` 弯曲，尾鳍额外 2.2 倍转向量。
- 俯仰：目标 `atan2(vy, sqrt(vx² + vz²))`，水平速度 < 0.4 时保持上一目标；5.5 rad/s² 临界阻尼弹簧 + 0.75 rad/s 限速；Three.js 右手系中 `+X` 正旋转使机头向下，因此根四元数使用 `−pitch`。
- 侧倾：`clamp(−yawRate · 0.11 · speedFactor, ±0.34 rad)`。
- 胸鳍：垂直速度驱动 ±0.18 rad 的对称迎角，侧倾叠加 ±0.45·roll 的非对称分量，最大 ±0.28 rad。
- 攻击：`attack` 包络提高频率与摆幅，衰减后自然回到巡游。

接入方式：默认 `/` 加载 rigged GLB（`predatorRigged: true`）；`?predator=shayu` / `?predator=blender` 回到静态 shayu，`?predator=v2` 切 v2，`?predator=procedural` 回退程序化。rigged 路径不叠加 11.10 的 swim shader，避免顶点位移被蒙皮两次。

测试场景：`preview/predator-animation-preview.html`（Side / Top / Front / Quarter，骨骼开关，固定时间 `?t=`，`?hud=0` 干净截图）；脚本 `npm run smoke:predator-animation`、`npm run smoke:predator-animation:main`、`npm run capture:predator-animation`、`npm run video:predator-animation`。

验证（沙箱 SwiftShader）：`verify_predator_rig.py` PASS；`PredatorAnimationController.test.ts` 11/11；`PredatorAnimation.test.ts` 7/7；全套 Vitest `--isolate=false --maxWorkers=2` 24 文件 / 167 测试 PASS；`vite build` PASS；动画 smoke 与主场景 smoke 0 浏览器错误。截图与 `sequence.webm` 位于 `test-artifacts/predator-animation/`。

限制：下颚仍未绑定（源模型为静态张口，P2）；胸鳍是刚性鳍面骨骼，没有鳍条弯曲；没有 LOD；硬件 GPU 的 FPS/P95 仍需在 Windows 主机上用 `npm run accept:gpu` 复测。

## 12. Predator v2 交付实测（2026-11-09）

| 项目 | 实测 |
| --- | --- |
| GLB | `public/models/predator_reef_shark.glb`，1,347,140 B |
| 三角形 / 顶点 | 5990 / 3134（Blender）；GLB accessor 顶点 3394 |
| 包围盒 | min (−1.2681, −0.8601, −2.9578)，max (+1.2681, +1.1331, +2.3200) |
| 总长 Z | 5.2778（目标 5.280，误差 −0.04%） |
| 属性 | POSITION, NORMAL, TANGENT, TEXCOORD_0, _TAILWEIGHT |
| 材质 | `predator_body`（3 贴图，doubleSided）、`predator_eye`、`predator_teeth`、`predator_mouth`（doubleSided） |
| 动画 / 骨骼 | 0 / 0；尾摆、C 形弯曲、转弯倾斜和加速/减速响应全部在运行时完成 |
| 尾权重 | 0.0–1.0；>0.9 的 666 个顶点平均 z = −2.053（−2.958…−1.321）；0 权重的 1600 个顶点 z ≥ +1.265 |
| 浏览器加载 | 默认 `/` 即加载 GLB，`predatorModel: "blender"`，500 条 Blender 主鱼 + 100 条小丑鱼；`?predator=procedural` 回退；`?fish=procedural` 组合成功 |
| 动画观测 | smoke 主场景捕获 `predatorBank ≈ −0.125 rad`、`predatorThrust ≈ 0.60`、`predatorTurn ≈ 0.33`，均在 [−1, 1] / [−0.6, 0.6] 范围内 |
| 资产烟雾测试 | `npm run smoke:predator` 通过，0 浏览器错误；生成 `predator-asset-hero.png` 与 `predator-chase.png` |
| 主场景回归 | `npm test`（26/26，含 PredatorAnimation 3 项）、`npm run build`、`npm run smoke`、`npm run smoke:fish`、`npm run smoke:glb` 通过（沙箱 SwiftShader） |
| 预览页 | `preview/predator-preview.html?mode=hero` / `?mode=close` / `?mode=chase` 均可用；Hero 自动演示转台、C 形弯曲与倾斜 |
| 用户反馈修正 | 2026-11-09：收小嘴部（下颚缩短至 z 1.700–2.220、宽度收窄、张口改为楔形），第一背鳍峰高 0.88 → 0.56、根部弦长 1.30 → 1.07 |

## 13. 珊瑚资产集（Coral set v1，2026-11-09）

### 13.1 结论先行

珊瑚集包含 6 个可独立实例化的基础资产：

`coral_branching`（枝状）、`coral_table`（桌面）、`sponge_tube`（管状海绵）、`coral_fan`（扇形）、`coral_brain`（脑珊瑚）、`anemone`（海葵）。

硬性契约：

- **+Y up，底部中心为原点**：GLB 包围盒 `min.y = 0`，误差 ≤ 0.012；X/Z 包围盒中心偏离原点 ≤ 0.30。
- 单株 **1500–3200 三角形**；单 mesh、单 primitive、单材质。
- 材质为 Metallic-Roughness PBR，金属度 0；**GLB 内不嵌入图片**。六种资产共用 `public/textures/coral_atlas_{basecolor.jpg,normal.png,roughness.png}`，由运行时加载一次并在 `MeshStandardMaterial` 上共享。
- 必须包含 `POSITION / NORMAL / TANGENT / TEXCOORD_0`；无动画、骨骼、形态键、相机、灯光。
- 高度按类型分档（见 13.2）；运行时通过 `InstancedMesh` 的缩放、水平旋转、轻微倾斜与成簇摆放生成多种形态，**不烘焙变体 GLB**。
- 不改变模拟层契约；本阶段只在独立预览页接入，主场景默认与 fallback 均未改动。

### 13.2 交付实测

| 资产 | GLB 字节 | 三角形 | Blender 顶点 | 高度 | 宽度 | 深度 |
| --- | --- | --- | --- | --- | --- | --- |
| `coral_branching.glb` | 159,176 | 2,624 | 2,460 | 1.197 | 2.235 | 2.213 |
| `coral_table.glb` | 72,240 | 2,240 | 1,155 | 0.505 | 1.617 | 1.597 |
| `sponge_tube.glb` | 61,872 | 1,872 | 1,026 | 1.089 | 0.748 | 0.658 |
| `coral_fan.glb` | 163,512 | 2,932 | 2,418 | 1.220 | 0.909 | 0.078 |
| `coral_brain.glb` | 83,280 | 2,688 | 1,370 | 0.608 | 1.159 | 1.146 |
| `anemone.glb` | 102,260 | 2,860 | 1,744 | 0.794 | 0.815 | 0.823 |

全部 6 个 GLB 的 `min.y = 0`；包围盒中心 X/Z 均在 ±0.30 内。源文件 `assets_src/blender/corals.blend`（六株同文件，均位于原点）；构建统计写入 `assets_src/blender/coral_build_stats.json`。

高度分档：枝状 1.05–1.60；桌面 0.40–0.70；管状海绵 0.85–1.30；扇状 0.90–1.45；脑珊瑚 0.50–0.75；海葵 0.65–1.00。桌面、脑珊瑚、海葵按真实礁体比例做成低矮型，不再套用旧静态契约的统一 1.0–1.5 m。

### 13.3 造型与拓扑

| 资产 | 制作方法 | 拓扑 |
| --- | --- | --- |
| 枝状 | Curve + Bevel，递归分叉；7 条主枝、2 级分叉，末端封口 | 单 mesh，曲线转网格，平面 UV |
| 桌面 | 极坐标参数曲面，上下表面 + 边缘 + 底座；平滑着色 | 12 环 × 40 段，厚 0.05 |
| 管状海绵 | 7 根不规则圆柱管，管口外翻、内壁下探，共用基座 | 每管 12 边，独立管壁/管口/内壁 |
| 扇状 | 曲线分支骨架：9 条主肋 + 次级分叉 + 不规则横向连接，无边框 | 平面网架，厚度约 0.08 |
| 脑珊瑚 | 经纬穹顶网格 + 径向沟槽位移，底部裙边落地 | 56 × 22 网格 |
| 海葵 | 40 边花瓶基座 + 34 条弯曲触手，触手末端膨大 | 5 边管状触手，独立 UV |

桌面珊瑚未使用 Subdivision Surface 修改器：参数曲面本身已由 40 段环向保证轮廓平滑，再细分会超出 3.2k 预算。所有资产使用平滑着色与 `bmesh.ops.recalc_face_normals`；曲线资产在转换后删除 Blender 自动生成的 UV 层，再写入图集 UV（否则材质会读到旧 UV 而串色，这是本轮实际踩到的坑）。

### 13.4 共享图集

- 尺寸 1024×1024；2 列 × 3 行；每格 512×341（底行 342），格间 8 px gutter；UV 再向内缩 8 px，避免 mipmap 跨格采样。
- 布局：上排 `coral_branching | coral_table`；中排 `sponge_tube | coral_fan`；下排 `coral_brain | anemone`。海葵格内左侧 58% 为紫色基座、右侧 42% 为乳白触手。
- 文件：BaseColor 265,642 B（sRGB JPEG）；Normal 2,035,439 B（Non-Color PNG）；Roughness 330,371 B（Non-Color PNG）。生成器 `assets_src/scripts/generate_coral_textures.py`，UV 矩形写入 `assets_src/textures/coral_atlas.json`。
- GLB 不嵌入图片是有意设计：六份 GLB 各嵌一套图集会重复约 2.6 MB 磁盘与数倍显存。运行时用 `TextureLoader` 加载一次，**必须设置 `flipY = false`**，与 GLTFLoader 处理内嵌贴图的行为一致；否则 V 轴翻转会采到相邻格。
- 显存估算：3 张 1024² RGBA + mipmaps ≈ **16 MB**（六种资产共享）。

### 13.5 运行时接口

`src/rendering/CoralAsset.ts`：

- `CORAL_SPECS`：6 个资产的 URL 与高度区间；
- `loadCoralAsset()` / `loadCoralAssets()`：GLTFLoader 加载、合并到单 geometry、校验三角形、高度、`min.y`、UV/NORMAL/TANGENT、单材质、0 动画；
- `loadCoralAtlas()`：加载三张贴图，设置 `flipY = false`、ClampToEdge、BaseColor 为 sRGB；
- `createCoralMaterial()`：`MeshStandardMaterial`，`map + normalMap + roughnessMap`，metalness 0，roughness 1.0，normalScale 0.85。

`src/preview/coral-preview.ts`：

- 每种资产一个 `InstancedMesh`，共享同一材质；4 个礁丛中心，每丛 10 株，共 **40 个实例**；
- 缩放区间按类型 0.62–1.12，随机 yaw 与 ±0.05 rad 倾斜，`instanceColor` 做 0.88–1.06 的明度变化；
- 预览场景总 draw calls **8**（6 种珊瑚 + 海床 + GLB 礁石），三角形 **116,224**；
- 暴露 `window.__coralPreview` 供烟雾测试读取资产统计与诊断。

本阶段主场景未接入珊瑚；`Environment` 的程序化珊瑚仍是默认路径。后续接入时应保持独立 flag、失败自动回退，并补做硬件 GPU 性能采样。

### 13.6 验收

- `python3 assets_src/scripts/verify_coral_glbs.py`：**PASS**（6/6）。
- `npm run smoke:coral`：**PASS**；`assetCount = 6`、`instanceCount = 40`、`drawCalls = 8`、`triangles = 116,224`、`atlasMaps = 3`、0 浏览器错误；截图 `test-artifacts/coral-preview.png`，结果 `test-artifacts/coral-asset-results.json`。
- `npm test`：16/16 通过。
- `npx tsc --noEmit` 通过；`npx vite build --outDir dist-check --emptyOutDir` 通过（43 modules；`coralPreview` chunk 7.37 kB）。沙箱挂载不允许 `npm run build` 删除旧 `dist/` 文件（EPERM），这是环境权限问题，不是构建错误；Windows 侧重建前删除/重命名 `dist/` 即可。
- 预览图：`docs/asset-previews/coral_branching.png`、`coral_table.png`、`coral_sponge_tube.png`、`coral_fan.png`、`coral_brain.png`、`coral_anemone.png`、`coral_lineup.png`（EEVEE，AgX）。
- SwiftShader 下预览页 FPS 约 36（软件渲染），**不作为性能结论**；硬件 GPU 的 FPS/P95 尚未测量。

### 13.7 已知限制

- 仍为 **Stylized Realism**：枝状/扇状是管状骨架，未做实体珊瑚组织；扇状网眼比参考图更大；脑珊瑚沟槽由程序化位移 + 法线贴图表现，不是雕刻级迷宫；桌面表面偏平滑；海葵基座 40 边在极近景仍可见轮廓分段。
- 每种只有 1 个基地模，形态差异依赖运行时缩放/旋转/成簇；没有烘焙变体，也没有 LOD。
- 共用 1024 图集意味着单株近景纹理分辨率有限；近景特写需要后续 2048 图集或每类独立贴图。
- 未接入主场景，未测硬件 GPU 性能；实例化后的 draw call、遮挡与 LOD 策略需在接入阶段验证。

### 13.8 2026-11-10 主场景珊瑚尺度与色调修订

用户反馈“珊瑚太小了”以及“海草和其他的海底植被等不协调”。修订不改变 GLB，只改 `CoralScatter` 的运行时缩放与实例色调：

| 层 | 原缩放 | 新缩放 | 实际高度（含最高物种） |
| --- | --- | --- | --- |
| full 礁石基部 | 0.64–0.98 | **2.30–4.12**（分物种 ×3.6–4.2） | 约 1.2–5.0 m |
| full 远景 | 1.15–1.70 | **2.40–4.14**（×0.58 带因子） | 约 1.2–5.0 m |
| full 前景 | 1.08–1.46 | **2.26–3.56**（×0.58 带因子） | 约 1.1–4.3 m |
| temperate 礁石基部 | 0.55–0.85 | **0.94–1.45**（×1.7） | 约 0.5–1.7 m |
| temperate 前景 | 0.58–0.85 | **0.75–1.11**（×1.3） | 约 0.9–1.3 m |

分物种倍率：枝状 4.2、桌面 3.6、管状海绵 4.0、扇状 4.2、脑珊瑚 3.8、海葵 4.0。实例明度从 0.80–1.00（远景 0.43–0.53）降到 **0.62–0.80**（远景 0.40–0.48），并加入轻微的逐物种色调（桌面/脑珊瑚偏暖、海绵偏紫、扇珊瑚偏绿），避免浅色珊瑚在青色水体里像混凝土板。海藻前景/中景同步缩小约 18%（1.15–2.1 / 0.9–1.75），91 株总数不变，当前物种分布为 48 `kelp_a` + 43 `kelp_b`。`tests/CoralScatter.test.ts` 与 `tests/HabitatZoneSystem.test.ts` 的快照值已同步更新。

## 14. 岩石与海底地形资产集（Rock & seabed set v1，2026-11-09）

### 14.1 结论先行

本资产集包含 13 个资产：

- 3 个大型礁石：`reef_large_a`（层叠桌状）、`reef_large_b`（尖塔簇）、`reef_large_c`（宽礁台）；
- 4 个中型岩石：`reef_medium_a`（卵石）、`reef_medium_b`（板岩）、`reef_medium_c`（双石）、`reef_medium_d`（石柱）；
- 4 个小型碎石：`reef_debris_a`–`reef_debris_d`；
- 2 种海底沙丘：`seabed_dune_a`（长脊）、`seabed_dune_b`（圆丘）。

采用作业要求的 sculpt 类流程，但用可复现的脚本实现：

1. 每个岩石由 1–3 个 icosphere 块拼接（大型礁石为 3 块），分别做各向异性拉伸、多倍频噪声位移、朝内凹槽（cleft）与平面切削（facet）；
2. 顶部按比例压平（`flat_top`），底部压缩后垂直归一化到目标高度；
3. Decimate（collapse）到预算三角形，应用 EdgeSplit（岩石 38°、沙丘 55°）形成低模硬边；
4. 高模源对象保留用于 Cycles 切线法线烘焙；低模自身用 Cycles 烘焙 AO；
5. 512² 法线 / AO tile 合成到 2048² 共享图集，UV 映射到对应 tile。

每个资产：

- 原点在底部中心，`min.y = 0`，水平包围盒居中，缩放 1.0；
- 单材质、无内嵌贴图，带 `POSITION` / `NORMAL` / `TANGENT` / `TEXCOORD_0`；
- 不导出骨骼、动画、形态键、相机、灯光、Empty；
- 13 个 GLB 合计 **7,869 三角形、392 KB**。

运行时默认启用：5 块主礁石替换为 3 种大型礁石（与 5 个碰撞球位置对齐），16 个中型岩石、33 个碎石、5 个沙丘按固定种子随机摆放；`?glbRocks=0` 关闭，`?glbRocks=1` 保留 legacy 单礁石入口。加载或校验失败自动回退程序化几何。

### 14.2 生成管线

| 脚本 | 作用 |
| --- | --- |
| `assets_src/scripts/build_rocks.py` | 13 个资产几何、UV 展开、hi/lo 对象、保存 `rocks.blend` |
| `assets_src/scripts/bake_rocks.py` | 逐资产烘焙 512² 切线法线与 AO（AO 时隔离其余资产） |
| `assets_src/scripts/compose_rock_atlas.py` | 生成程序化 BaseColor，合成 2048² 图集并复制到 `public/textures/` |
| `assets_src/scripts/finalize_rocks.py` | UV 映射到 tile、水平居中、导出 13 个 GLB |
| `assets_src/scripts/verify_rocks_glb.py` | 纯 Python 结构验收（含 UV tile 检查） |
| `assets_src/scripts/render_rocks_previews.py` | EEVEE 单体预览 + 合影 |

tile 布局固定在 `assets_src/textures/rock_tiles.json`（2048² / 4×4 / 8 px padding），构建与合成共用该文件。

复现顺序（Blender 5.2，MCP `execute_blender_code`）：

```text
build_rocks.py → bake_rocks.py → finalize_rocks.py
python3 assets_src/scripts/compose_rock_atlas.py
python3 assets_src/scripts/verify_rocks_glb.py
```

注意：`finalize_rocks.py` 必须在 build/bake 的同一 Blender 会话内执行；它会把 UV 写入图集 tile，之后再烘焙需要重新 build。`bake_rocks.py` 支持 `ROCK_BAKE_ONLY`、`ROCK_BAKE_BUDGET`、`ROCK_BAKE_FORCE` 环境变量分批执行。

### 14.3 交付实测

| 资产 | 三角形 | 文件大小 | 高 × 宽 × 深 |
| --- | --- | --- | --- |
| reef_large_a | 1,050 | 46,652 B | 1.041 × 1.518 × 1.270 |
| reef_large_b | 1,200 | 59,512 B | 1.279 × 1.128 × 0.984 |
| reef_large_c | 1,050 | 47,856 B | 0.712 × 1.791 × 1.220 |
| reef_medium_a | 520 | 24,416 B | 0.620 × 0.737 × 0.793 |
| reef_medium_b | 480 | 21,152 B | 0.380 × 1.342 × 1.019 |
| reef_medium_c | 620 | 30,920 B | 0.653 × 1.856 × 1.350 |
| reef_medium_d | 560 | 26,816 B | 1.077 × 0.838 × 0.802 |
| reef_debris_a | 240 | 15,972 B | 0.341 × 0.425 × 0.370 |
| reef_debris_b | 180 | 9,080 B | 0.199 × 0.498 × 0.371 |
| reef_debris_c | 200 | 12,848 B | 0.140 × 0.528 × 0.353 |
| reef_debris_d | 220 | 17,388 B | 0.260 × 0.341 × 0.288 |
| seabed_dune_a | 849 | 35,796 B | 0.565 × 7.000 × 2.823 |
| seabed_dune_b | 700 | 27,128 B | 0.489 × 6.200 × 5.200 |

hi-poly 源三角形：大型 7,680、中型 1,280–2,560、碎石 320、沙丘 10,124 / 13,044。全部资产 `min.y = 0.000`。

### 14.4 共享图集与材质

- 图集：2048²，4 × 4 网格，每 tile 512²，含 8 px 边缘扩展；13 个 tile 使用前 13 格，其余留空。
- `assets_src/textures/rock_atlas_basecolor.jpg`：sRGB JPEG，334,982 B；中性灰绿岩石 + 藻斑/暗坑；沙丘 tile 为暖沙色与细波纹。
- `assets_src/textures/rock_atlas_normal.png`：切线空间法线，2,081,917 B。
- `assets_src/textures/rock_atlas_ao.png`：灰度 AO，569,728 B；AO bake 背景为白色，避免 mipmap 黑边。
- `rock_tiles.json`：每个资产的 `pixel_rect` 与 `uv_rect`（Blender V 轴；glTF 导出时翻转 V，校验器按翻转后的范围检查）。
- 运行时 `RockAsset.ts` 加载三张图集一次，创建两个 `MeshStandardMaterial`：
  - 手动 `TextureLoader` 必须设置 `flipY = false`：glTF UV 以左上为原点，默认 `flipY = true` 会让整张图集上下颠倒、每个资产采样到错误的 tile。
  - `rock_atlas`：roughness 0.93，metalness 0，`normalScale = 0.55`，`aoMapIntensity = 0.72`；
  - `dune_atlas`：roughness 0.97，`normalScale = 0.32`，`aoMapIntensity = 0.40`（沙丘法线过强会产生暗斑）。
- 显存估算：3 × 2048² RGBA + mipmaps ≈ **67 MB**。

### 14.5 运行时接口与摆放

`src/rendering/rockPlacement.ts`：

- `floorHeightAt(x, z)` 与 `Environment` 的海床几何使用同一波浪公式；
- `generateRockLayout(obstacles, seed = 0x9e3779b9)`：mulberry32 确定性 PRNG；
  - 5 个大型礁石锚定在碰撞体 x/z，`scale = radius × 1.4`；
  - 5 个沙丘（3 × `seabed_dune_a` + 2 × `seabed_dune_b`）避开礁石 ≥ 4.5 m；
  - 16 个中型岩石：避开礁石 ≥ 1.4 m、沙丘、彼此 ≥ 1.8 m 足迹；
  - 33 个碎石：15 个礁缘环带 + 18 个散落；
  - 每个实例带 yaw、±4°–20° 倾斜、0.7–1.7 缩放、下沉比例（按高度的 8%–30%）。
- `src/rendering/RockAsset.ts`：加载 13 个 GLB + 图集；校验三角形预算、`min.y`、高度误差 ≤ 10%、动画为 0；失败抛错由 `Environment` 回退。
- `src/rendering/RockScatter.ts`：每种资产一个 `InstancedMesh`，共 13 个 draw call；`frustumCulled = false`；`instanceColor` 提供 3 种岩石色 / 2 种沙丘色。
- `Environment.loadGlbRockSet()`：替换 5 块程序化主礁石；大型/中型/碎石加入 `reefGroup`（随 `Reef obstacles` 开关隐藏），沙丘加入场景根（始终可见）。
- 独立预览页 `preview/rocks-preview.html`：13 个资产按 4 行摆放，HUD 显示名称/三角形/高度；`?focus=<name>` 进入单体近景；暴露 `window.__rocksPreview` 供烟雾测试。
- 诊断：`getDiagnostics()` 新增 `glbRockMode`（`off`/`legacy`/`set`）、`glbRockInstances`、`glbRockTriangles`。
- Flag：`?glbRocks=2`；`?glbRocks=1` 保留旧的单一 `reef_rock_a.glb` 试验。

### 14.6 验收

- `python3 assets_src/scripts/verify_rocks_glb.py`：**PASS（13/13）**，含 UV 位于对应 tile、三角形预算、底部原点、水平居中、材质与无贴图检查。
- `npm run smoke:rocks`：**PASS**；`glbRockMode = "set"`、5 大 / 16 中 / 33 碎石 / 5 沙丘、7,869 三角形、0 浏览器错误；截图 `test-artifacts/glb-rock-set-desktop.png`，结果 `test-artifacts/glb-rock-set-results.json`。
- `npm run smoke:rocks-preview`：**PASS**；13 资产、7,869 三角形、阵容页 14 draw calls、`?focus=reef_large_a` 2 draw calls、0 浏览器错误；截图 `test-artifacts/rocks-preview-lineup.png` / `rocks-preview-focus.png`。
- `npm run smoke`（默认程序化）与 `npm run smoke:glb`（`?glbRocks=1` legacy）**PASS**，0 浏览器错误。
- `npm test`：**26/26**；`npx tsc --noEmit` 与 `npm run build` 通过。
- 预览图：`docs/asset-previews/rock_reef_large_a.png` 等 13 张单体图 + `rock_lineup.png`（EEVEE，AgX）。
- SwiftShader 软件渲染 FPS（约 1–7）**不作为性能结论**；硬件 GPU 的 FPS/P95/GPU time 尚未测量，需在本机运行 `npm run accept:gpu` 或手动对比。

### 14.7 已知限制

- 保持项目既有的 **Stylized / 青绿色低模** 方向，不是参考包的照片级写实；表面细节主要来自烘焙法线与 AO。
- 岩石由多个闭合壳拼接，相交处保留内部面；视觉不可见，但三角形不是单一水密流形。
- 沙丘为单面开放式地形壳，底部下沉 30% 嵌入海床；没有底面裙边，极端低角度能看到壳边。
- 每种资产只有 1 个基地模，变化依赖运行时缩放/旋转/实例色；没有 LOD。
- 沙丘与碎石按设计不参与模拟碰撞；只有 5 个大型礁石对应 `ObstacleSystem` 碰撞球。
- 未测硬件 GPU 帧率；共享 2048 图集约 67 MB 显存是已知成本。

## 15. 海藻资产集（Kelp set v1，2026-11-09）

### 15.1 结论先行

- 两个基地模：`kelp_a` 为参考图风格的密集卷曲丛（12 片叶），`kelp_b` 为宽叶扇（10 片叶）。
- `kelp_a`：184 三角形、204 个 GLB 顶点、高 3.550、宽 2.285、深 2.586；bbox min `(-0.8002, 0, -1.4850)`、max `(1.4849, 3.5500, 1.1013)`；GLB 9,000 B。
- `kelp_b`：168 三角形、174 个 GLB 顶点、高 2.800、宽 1.507、深 1.936；bbox min `(-0.4635, 0, -1.3505)`、max `(1.0431, 2.8000, 0.5852)`；GLB 7,944 B。
- 两者均为 Y-up、底部在 `y = 0`、单材质、双面渲染（`doubleSided = true`）、无贴图/动画/骨骼/相机/灯光；属性包含 `POSITION`、`NORMAL`、`_SWAYWEIGHT`、`_BLADEPHASE`。
- 运动完全由 Three.js 顶点 Shader 完成，不使用骨骼或烘焙动画；GLB 本身保持静态。

### 15.2 几何与自定义属性

- 每株由少量竖向叶片 + 8 边低矮固着器组成。`kelp_a`：4 片三列折叶主体（6 段）+ 8 片二列填充叶（5 段）；`kelp_b`：10 片三列宽叶（4 段）。
- 静止姿态包含顺流倾斜、径向展开、S 形波动和叶尖卷曲；叶缘有双频波动；`kelp_a` 的 4 片主体叶和 `kelp_b` 的 4 片宽叶在顶端带 V 形分叉（用中心列顶点下压实现，不增加三角形）。
- `_SWAYWEIGHT`：`t^1.35`，`t = 顶点高度 / 株高`；底部严格为 0，顶部为 1。
- `_BLADEPHASE`：每片叶一个 `0..2π` 随机相位；即使同一株内，叶片也不会同步摆动。
- Blender 导出坐标：`glTF(x, y, z) = Blender(x, z, -y)`；GLB 的 Y-up 高度对应 Blender 的 Z 轴。

### 15.3 摆动 Shader 契约

运行时在 `MeshStandardMaterial.onBeforeCompile` 中注入：

```text
w = pow(clamp(aSwayWeight, 0, 1), 1.35)
phase = uKelpTime * uKelpFrequency * instanceFrequency
      + uKelpPhaseGradient * position.y
      + instancePhase + aBladePhase
dx = uKelpAmplitude * instanceAmplitude * w * sin(phase)
dz = 0.38 * uKelpAmplitude * instanceAmplitude * w * cos(phase * 0.81 + 1.7)
```

| 参数 | kelp_a | kelp_b |
| --- | --- | --- |
| `uKelpAmplitude` | 0.38 | 0.30 |
| `uKelpFrequency` | 1.35 | 1.55 |
| `uKelpPhaseGradient` | 1.45 rad/m | 1.45 rad/m |
| 每实例相位 / 频率 / 振幅 | `0..2π` / `0.82–1.18` / `0.82–1.18` | 同左 |

- `instancePhase`、`instanceFrequency`、`instanceAmplitude` 是 `InstancedBufferAttribute`，每帧只更新一个 `uKelpTime`，不上传几何。
- 摆动在实例局部空间计算；实例随机 yaw 会把倾斜/摆动方向一起旋转，因此不同株的方向天然不同，而不是全场统一剪切。
- 法线不随顶点位移重算；低模风格接受这一点。

### 15.4 运行时接口与集成

- `src/rendering/KelpAsset.ts`：加载两个 GLB，校验三角形 100–200、高度 2–4、底部 `y ≈ 0`（容差 0.02）、单材质、法线与两个自定义属性齐全；GLTFLoader 会把自定义属性转成小写，加载后统一重命名为 `aSwayWeight` / `aBladePhase`。
- `src/rendering/kelpPlacement.ts`：固定种子生成 91 株（48 `kelp_a` + 43 `kelp_b`；2026-11-10 调整实例缩放后重新洗牌），按左右海藻林带与前景/中景/背景分层散布，并避开中央游泳走廊；`y = floorHeightAt(x, z) - 0.05`。
- `src/rendering/KelpScatter.ts`：每种资产 1 个 `InstancedMesh`（共 2 个 draw call），每实例写相位/频率/振幅与近白色调色，`frustumCulled = false`。
- 主场景默认启用；`?kelp=0` 关闭。加载或校验失败时保留无海藻的海床并输出 warning，页面不白屏。与完整岩石集/珊瑚/细节海菜默认组合。
- 独立预览：`preview/kelp-preview.html`；浏览器烟雾测试：`npm run smoke:kelp`。

### 15.5 验收（2026-11-09，沙箱 SwiftShader）

- `python3 assets_src/scripts/verify_kelp_glbs.py`：PASS 2/2，三角形/高度/底部原点/属性范围/单材质/双面均符合。
- `npm run smoke:kelp`：Phase C 交付时 PASS（预览 2 资产 / 15 实例 / 3 draw calls / 13,000 三角形；两张间隔 1.3 s 的 canvas 截图不同，证明摆动 Shader 生效）。后续海藻林布局扩展为 91 株后，由 `smoke:seaweed:combo` 覆盖组合加载。
- 主场景 `/?kelp=1`：Phase C 交付时为 26 + 23 实例、8,648 海藻三角形、0 浏览器错误；当前生态布局为 48 + 43 实例、16,056 三角形，`smoke:seaweed:combo` 组合加载 0 错误。
- 沙箱 FPS 来自 SwiftShader，**不能作为性能结论**；硬件 GPU 的帧率/P95/GPU time 与视觉验收待用户在本机完成（见 `docs/PHASE_C_ACCEPTANCE.md`）。

### 15.6 已知限制

- 保持项目低模艺术方向，形态参考用户提供的海藻图，但不是照片级写实；叶缘分叉是几何 V 形缺口，不是 alpha 贴图镂空。
- 8 片 `kelp_a` 填充叶为两列平面叶，没有横向折面；近景特写会看出低模段数。
- 无 LOD、无碰撞、无半透明/焦散/次表面散射；海藻不参与 `ObstacleSystem`。
- 共有 2 个 instanced draw call 与 16,104 个海藻三角形（91 株）；实例色只做轻微亮度/色相变化。
- 硬件 GPU 验收未完成，`accept:gpu` 尚未把海藻场景纳入正式数据。

## 16. 细节海菜资产（Detail seaweed v1，2026-11-09）

### 16.1 结论先行

- 用户上传的风格化海菜丛：带岩石底座、根须、球芽、海星和 302 个独立叶片组件；已归档到 `assets_src/external/seaweed/`。
- `public/models/seaweed_detail.glb`：1,221,720 B；13,792 三角形；10,246 个 GLB 顶点；高 1.200、宽 0.541、深 0.517；bbox min `(-0.2703, 0, -0.2587)`、max `(0.2703, 1.2000, 0.2587)`。
- 单材质 `seaweed_detail_pbr`，双面；内嵌 3 张 2048² JPEG（BaseColor / Normal / Metallic-Roughness）；无动画、骨骼、相机或灯光。
- 属性：`POSITION`、`NORMAL`、`TANGENT`、`TEXCOORD_0`、`_SWAYWEIGHT`、`_BLADEPHASE`。
- 与低模 `kelp_a/kelp_b` 是两种层级：本资产是 **近景细节/英雄资产**，只放 6 株；低模海藻仍负责 91 株大范围植被。

### 16.2 预处理与摆动属性

- `build_seaweed_detail.py` 打开归档源文件，清除 Empty 父级、应用变换、水平居中、底部贴到 `z = 0`，重命名 `seaweed_detail`。
- 通过 bmesh 连通分量分析得到 302 个叶片/底座组件；`z < 0.18` 的底座组件（岩石、根须、海星）`_SWAYWEIGHT = 0`、`_BLADEPHASE = 0`。
- 其余每个组件分配一个 `0..2π` 随机相位；顶点权重按组件自身高度从基部 0 到叶尖 1（`t^1.25`）。因此每片叶从自己的附着点弯曲，底座完全静止。
- 导出时保留内嵌贴图，并额外导出 `TANGENT` 以支持法线贴图。

### 16.3 摆动 Shader 契约

```text
w = pow(clamp(aSwayWeight, 0, 1), 1.1)
phase = uSeaweedTime * uSeaweedFrequency * instanceFrequency
      + 1.7 * position.y + instancePhase + aBladePhase
dx = 0.15 * instanceAmplitude * w * sin(phase)
dz = 0.15 * 0.35 * instanceAmplitude * w * cos(phase * 0.83 + 1.2)
```

- `uSeaweedAmplitude = 0.15`、`uSeaweedFrequency = 1.05`、`uSeaweedPhaseGradient = 1.7`。
- 每实例相位 `0..2π`、频率/振幅 `0.85–1.15`；实例 yaw 会旋转局部摆动方向。
- 纹理材质只通过 `onBeforeCompile` 注入顶点位移，不替换 PBR/贴图链；每帧只更新 `uSeaweedTime`。

### 16.4 运行时与集成

- `src/rendering/SeaweedAsset.ts`：加载、校验 10k–20k 三角形、高度 1.0–1.5、底部 `y ≈ 0`、单材质、3 张 PBR 贴图、`NORMAL/TANGENT/_SWAYWEIGHT/_BLADEPHASE`；GLTFLoader 小写属性后重命名为 `aSwayWeight` / `aBladePhase`。
- `src/rendering/seaweedPlacement.ts`：固定种子生成 6 株：3 株位于前三个礁石核心的相机朝向侧，3 株散布在半径 6–15 m 的开阔沙地；基底下沉 0.04 m。
- `src/rendering/SeaweedScatter.ts`：单资产 1 个 `InstancedMesh`（1 draw call），实例缩放 1.70–2.05（世界高约 2.04–2.46 m），近白 `instanceColor` 只做轻微明度变化。
- 主场景默认启用（6 株），`?seaweed=0` 关闭；默认与 48 株完整珊瑚、91 株低模海藻、完整岩石集组合。`?coral=temperate` 可降为 12 株温带珊瑚。
- 独立预览：`preview/seaweed-preview.html`；烟雾测试：`npm run smoke:seaweed`、`npm run smoke:seaweed:main`、`npm run smoke:seaweed:combo`。

### 16.5 验收（2026-11-09，沙箱 SwiftShader）

- `python3 assets_src/scripts/verify_seaweed_glb.py`：PASS；13,792 三角形、1.2 m、单材质、3 贴图、`_SWAYWEIGHT` 0..1（2,754 个 0 权重底座顶点、452 个满权重叶尖）、`_BLADEPHASE` 0..2π 且 228 个不同值。
- `smoke:seaweed`：PASS；预览 5 实例、77,152 渲染三角形、2 draw calls（海床 + 海菜）、3 maps；间隔 1.3 s 的 canvas 截图不同。
- `smoke:seaweed:main`：PASS；`environment=bare&fishCount=50` 下 `seaweedModel = "blender"`、6 实例、82,752 海菜三角形、0 浏览器错误。
- `smoke:seaweed:combo`：PASS；完整环境组合（`?coral=full`）`glbRockMode = "set"`、48 珊瑚、91 低模海藻、6 细节海菜，渲染 264,091 三角形、56 draw calls、0 错误。默认珊瑚层现为 48 株完整展示层（`?coral=temperate` 恢复 12 株）。
- 沙箱 FPS 来自 SwiftShader，**不是性能结论**；硬件 GPU 视觉/性能验收见 `docs/PHASE_SEAWEED_ACCEPTANCE.md`。

### 16.6 已知限制

- 13,792 三角形约为单株低模海藻预算（200）的 69 倍；当前只允许 6 株英雄实例，不参与大规模散布。若扩大数量，需要先减面或做 LOD。
- 3 张 2048² 贴图解码后约 48 MB 显存（不含 mipmap），与 Predator 贴图同一量级；6 个实例共享同一材质。
- 模型自带岩石底座、海星和根须，实例化会重复这些装饰；它们不参与碰撞。
- 摆动只位移顶点，不重算法线；近景强光下叶片法线保持静止。
- 无 LOD、无半透明/次表面散射、无碰撞；默认未启用，需硬件验收后再决定是否加入完整环境默认层。

## 17. 小丑鱼鱼群资产（Clownfish school v1，2026-11-10）

### 17.1 源资产

用户提供的 `clownfish-light.glb`（另存于 `Project/source/clownfish-light.glb`）归档到 `assets_src/external/clownfish/`：

| 项目 | 源值 |
| --- | --- |
| 字节数 | 8,022,744 |
| 顶点 / 三角形 | 148,146 / 258,813 |
| 材质 | 1 个双面 `Material_0`，BaseColor + MetallicRoughness 两张 1024² JPEG |
| 朝向 | glTF +Z 朝前、+Y 向上；包围盒 0.065 × 0.11 × 0.064 m |
| 动画 / 骨骼 | 0 / 0 |
| 拓扑 | 406 个互不相连的网格岛、36,667 条边界边；直接减面会逐岛塌缩，产生破碎面 |

### 17.2 处理流程（`assets_src/scripts/build_clownfish_school.py`）

1. 导入 GLB，应用导入变换；
2. **先焊接顶点**：`bmesh.ops.remove_doubles(dist=1e-5)`，148,146 → 129,514 顶点，406 个岛合并为 1 个连续壳体；逐 loop UV 保留，因此条纹贴图不受影响；
3. 归一化：包围盒居中，长度沿 glTF Z 缩放到 1.000；
4. Decimate Collapse（`use_collapse_triangulate=True`）到约 2,400 三角形；
5. 写入 `_TAILWEIGHT`（float, point）：`1 − smoothstep(−0.45, 0.12, z_gltf)`，头 0、尾 1；
6. 重算法线、平滑着色；材质设为双面、Metallic 0、Roughness 0.42；
7. 保存 `assets_src/blender/clownfish_school.blend`，导出 `public/models/clownfish_school.glb`。

### 17.3 交付实测

| 项目 | 交付值 | 契约 |
| --- | --- | --- |
| 字节数 | 360,120 | ≤ 1,500,000 |
| 顶点 / 三角形 | 1,269 / 2,399 | 1,600–5,000 三角形 |
| 材质 / 贴图 | 1 / 2 JPEG | 1–1 材质、2 贴图 |
| 包围盒 | min (−0.2987, −0.2886, −0.4992)，max (0.2988, 0.2876, 0.5019) | ±0.30 以内居中 |
| 长度 Z | 1.0010 | 1.000 ±5% |
| 朝向 | 头 +Z，尾 −Z | +Z 前向 |
| 属性 | POSITION / NORMAL / TANGENT / TEXCOORD_0 / `_TAILWEIGHT` | 同上 |
| 尾权重 | 0.000–1.000，z < −0.35 的平均值 0.988 | 0–1，集中在 −Z |
| 连通性 | 1 个壳体、382 条边界边 | 连续表面 |
| 动画 / 骨骼 | 0 / 0 | 0 / 0 |

`python3 assets_src/scripts/verify_clownfish_glb.py` PASS。

### 17.4 运行时集成

- `loadFishAsset(url, CLOWNFISH_CONTRACT)` 复用 School Fish 加载器；契约参数为 1,600–5,000 三角形、长度 1.0 ±5%、最多 1 材质。GLTFLoader 将 `_TAILWEIGHT` 小写为 `_tailweight`，加载器统一改名为 `aTailWeight`。
- `FishRenderer` 新增渲染选项：`scaleBase 0.50` / `scaleVariation 0.10`（世界长度 0.50–0.60 m）、`tintMode 'texture'`（保留橙白条纹，仅做中性明度变化）、`alertStrength 0.32`、`rimStrength 0.07`、更快的胸鳍式摆动（`swimRateBase 6.2`、`swimPhasePerZ 3.0`、`swimAmplitude 0.14`）。主鱼群缩放同步从 0.72–0.92 降到 0.55–0.67（世界 0.90–1.10 m），两种鱼比例约 1.9:1。
- `SimulationWorld` 增加独立的 `clownfishFlock` / `clownfishBoids` / `clownfishConfig`：默认 100 条，礁石 0 上方 `homeCenter = (−2.0, 5.2, −3.0)`、`homeRadius 4.2`、`homeWeight 0.55`；分离 0.55 m、对齐 1.6 m、聚合 2.2 m，巡航 0.8–2.6 m/s，边界余量 1.2 m。捕食者恐惧响应对两群同时生效，但捕食者只捕获主鱼群。
- 默认启用；`?clownfish=0` 关闭，`?clownfish=N` 调整数量（0–400）。加载/契约失败时第二鱼群关闭，不以普通鱼替代。观测台 Ecology 面板增加 0–300 的 Clownfish school 滑杆与存活数读数。
- 诊断字段：`clownfishModel` / `clownfishCount` / `clownfishTriangles` / `clownfishCenter`。

### 17.5 验收（2026-11-10）

- `verify_clownfish_glb.py` PASS；`tests/ClownfishSchool.test.ts` 4/4（生成位置、礁区驻留、确定性、开关不影响主鱼群）；全量 `vitest` 31 文件 / 202 测试 PASS；`tsc --noEmit` PASS；Vite 生产构建 PASS。
- `npm run smoke:rich` PASS（640×400、SwiftShader）：默认 `/` 下 `fishModel = "blender"`、`clownfishModel = "blender"`、500 + 100 条、主鱼世界长度 0.90–1.10 m、小丑鱼 0.50–0.60 m（比例 1.82:1）、`coralModel = "full"`（48 株）、`seaweedModel = "blender"`（6 株）、`kelpModel = "blender"`（91 株）、`glbRockMode = "set"`、58 draw calls、1,225,511 渲染三角形、0 浏览器错误；截图 `test-artifacts/rich-default-clownfish.png`。
- 沙箱为 SwiftShader；硬件 GPU 的 FPS / P95 仍需在 Windows 本机执行 `npm run accept:gpu`。

### 17.6 已知限制

- 2,399 面保留了轮廓、橙白条纹和主要鳍，但细小鳍缘与鳃部细节由贴图和法线承担；近景不如源模型精细。
- 无 LOD、无骨骼、无个体鳍部动画；尾摆由共享 shader 的 `_TAILWEIGHT` 完成。
- 两个鱼群各自独立群游，不做跨物种对齐/聚合；捕食者只把主鱼群作为可捕获猎物。
- 无小丑鱼专属海葵吸附/碰撞；home 力只提供软性礁区锚定。

## 18. 变更记录

- v1.0（2026-11-08）：建立 School Fish 资产规格；确认 +Z 前向、1.650 总长、`_TAILWEIGHT` 契约、PBR 贴图与集成 flag；取代 v0.1 中"≤300 三角形、单材质、无贴图、flatShading"的鱼条款。旧条款保留于 `BLENDER_ASSET_CONTRACT.md` 仅作历史记录，不再作为验收标准。
- v1.1（2026-11-08）：交付 School Fish；修正为无顶点色（颜色画入 BaseColor）、GLTFLoader 属性小写后的 `aTailWeight` 规范名、24 段环向、实际 1448 三角形与 866 KB GLB；补充水下 PMREM 环境贴图与实测数据。
- v1.2（2026-11-08）：新增 Predator（礁鲨）规格与交付实测；4344 三角形、5.2016 总长、2 材质、2048² 贴图、`_TAILWEIGHT` 尾摆 Shader；`?predator=blender` 接入；攻击状态改为自发光脉冲。用户验收后修正第一背鳍、第二背鳍与臀鳍根部，使其沿身体表面曲线嵌入（bbox max y 更新为 +1.2406）。
- v1.3（2026-11-09）：新增珊瑚资产集规格与交付实测；6 个基地模（枝状、桌面、管状海绵、扇状、脑珊瑚、海葵），单株 1.5k–3.2k 三角形、底部原点、单材质、无内嵌贴图；1024² 共享图集；`CoralAsset.ts` 加载校验、`preview/coral-preview.html` 实例化预览、`verify_coral_glbs.py` 与 `smoke:coral` 验收。主场景暂未接入。
- v1.4（2026-11-09）：新增岩石与海底地形资产集规格与交付实测；13 个资产（3 大礁石 / 4 中岩石 / 4 碎石 / 2 沙丘），icosphere 多块位移 + Decimate + EdgeSplit，Cycles 烘焙切线法线 / AO，2048² 共享图集；`RockAsset.ts` / `RockScatter.ts` / `rockPlacement.ts` 确定性摆放；`?glbRocks=2` 替换主礁石并散布 54 个装饰实例；`verify_rocks_glb.py` 与 `smoke:rocks` 验收，主场景 0 错误。
- v1.5（2026-11-09）：Predator v2 大白鲨交付；5990 三角形、5.2778 总长、4 材质（body / eye / teeth / mouth）、35 颗牙、下颚 + U 形口腔、2048² 反荫蔽贴图、`_TAILWEIGHT` 尾摆 + C 形弯曲 + 转弯倾斜 + 加速/减速响应；GLB 默认启用、`?predator=procedural` 回退；用户反馈后收小嘴部与第一背鳍（背鳍峰高 0.88→0.56），新增 `tests/PredatorAnimation.test.ts` 与 `predator-chase.png` 验收截图。
- v1.6（2026-11-09）：新增海藻资产集（Phase C）规格与交付实测；`kelp_a` 184 三角形 / `kelp_b` 168 三角形，底部原点、双面单材质、`_SWAYWEIGHT` + `_BLADEPHASE` 顶点摆动；`KelpAsset.ts` / `KelpScatter.ts` / `kelpPlacement.ts`；`?kelp=1` 主场景接入 49 株（26 + 23）、8,648 三角形；`verify_kelp_glbs.py` 与 `smoke:kelp` 验收。形态按用户提供的海藻参考图重做：12/10 片宽叶、深折、叶缘波动、部分分叉叶尖。
- v1.8（2026-11-09）：Predator 转身从“整体四元数 + 横向剪切”改为“朝向平滑 + 脊柱角度弯曲 + 尾部延迟跟随”；新增 `uTurnLag`、`predatorSpineBendAngle`、法线随弯曲旋转和 `poseTime/view=top` 对照预览；`PredatorAnimation` 7/7，`smoke:predator` 与 `smoke:predator:shayu` 通过。
- v1.7（2026-11-09）：用户提供 `shayu.glb` 并指定为鲨鱼模型；转换脚本合并牙齿、旋转 +Z、缩放 5.280、居中、写入 `_TAILWEIGHT` 和 3 枚 PBR 贴图；`predator_shayu.glb` 9,826 三角形 / 3 材质 / 1,600,488 B；默认捕食者切换为 shayu，v2 保留为 `?predator=v2`，新增 `scripts/predator-shayu-check.ts` / `npm run smoke:predator:shayu`。
- v1.9（2026-11-09）：新增细节海菜资产（Detail seaweed v1）；用户上传的 302 组件海菜丛归档到 `assets_src/external/seaweed/`，预处理为 `seaweed_detail.glb`（13,792 三角形、1.2 m、3 × 2048² PBR 贴图、单双面材质）；按连通组件写入 `_SWAYWEIGHT` / `_BLADEPHASE`，岩石/海星底座静止；`SeaweedAsset.ts` / `SeaweedScatter.ts` / `seaweedPlacement.ts`；`?seaweed=1` 主场景 6 株英雄实例、82,752 三角形；`verify_seaweed_glb.py`、`smoke:seaweed`、`smoke:seaweed:main`、`smoke:seaweed:combo` 验收。
- v2.0（2026-11-10）：新增小丑鱼鱼群资产（Clownfish school v1）。用户提供的 `clownfish-light.glb`（148,146 顶点 / 258,813 三角形）经“先焊接 406 个网格岛 → 归一化 → Decimate 到 2,399 三角形 → `_TAILWEIGHT`”导出 `clownfish_school.glb`（360,120 B、1 材质、2 贴图、长度 1.001）；默认 100 条独立礁区鱼群（0.50–0.60 m、软 home 锚定、共享捕食者恐惧）；主鱼群默认切换为 `fish_school.glb` 并缩放到 0.90–1.10 m（`?fish=procedural` 回退）；默认环境升级为 48 株珊瑚 + 6 处细节海菜（`?coral=temperate`、`?seaweed=0` 回退）；新增 `smoke:rich`。
