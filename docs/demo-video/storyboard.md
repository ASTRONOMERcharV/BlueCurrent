# BlueCurrent — 90 Second Storyboard

## 1. 影片规格

| 项目 | 规格 |
| --- | --- |
| 片名 | BlueCurrent |
| 副标题 | Real-time 3D Marine Ecosystem Simulation |
| 时长 | 90 秒 |
| 画幅 | 16:9 |
| 主分辨率 | 1920×1080 |
| 帧率 | 优先 60 FPS；仅在本机实测稳定时使用，否则 30 FPS |
| 主体 | 真实运行的 BlueCurrent 录屏 |
| 包装 | 动态标题、状态标注、算法示意、真实指标 |
| 语言 | 英文屏幕文字；中文旁白可选 |

## 2. 叙事原则

全片不按功能面板顺序介绍，而是沿着一次海底生态过程展开：

> 进入场景 → 观察鱼群 → 捕食者介入 → 群体逃逸与恢复 → 穿越礁区 → 揭示实时计算 → 回到完整生态

技术信息只在观众已经看见行为之后出现。每个技术点都对应一个已经发生的画面，例如：

- 鱼群转向对应局部邻居规则；
- 捕食者接近对应 FSM 与逃逸响应；
- 网格出现对应真实 `UniformGrid3D`；
- Brute Force 切换对应同一模拟的邻居搜索替代路径；
- FPS/step 卡片对应录制现场的真实读数。

## 3. 时间线

| 时间 | 章节 | 画面 | 屏幕文字/图形 | 旁白意图 |
| --- | --- | --- | --- | --- |
| 00:00–00:04 | Enter | 真实 Overview 从黑场淡入；光束、海床、珊瑚与鱼群出现 | 无文字或极短 `LIVE SIMULATION` | 这不是宣传概念片，而是一个正在运行的世界 |
| 00:04–00:08 | Title | 继续保持真实全景，镜头只做轻微稳定/推进 | `BlueCurrent` / `REAL-TIME 3D MARINE ECOSYSTEM SIMULATION` | 建立片名 |
| 00:08–00:14 | Schooling | School 相机跟随鱼群；显示整体转向、聚集和重新展开 | `LOCAL RULES` / `Separation · Alignment · Cohesion` | 没有全局路径，只有局部感知 |
| 00:14–00:18 | Reef context | 宽景展示鱼群、珊瑚、海草和礁石的空间关系 | `ONE LIVE WORLD` | 群体不是孤立动画，而是在环境中运动 |
| 00:18–00:23 | Motion detail | 中近景展示鱼体摆动和转向；仅在硬件审片通过后使用 | `FIXED-STEP MOTION` / `Interpolated rendering` | 个体运动由模拟位置和速度驱动 |
| 00:23–00:30 | Predator enters | Encounter 场景重置；Predator 相机看到捕食者接近 | `PREDATOR ENCOUNTER` / `Patrol → Pursuit` | 新的刺激进入生态系统 |
| 00:30–00:36 | Escape | 鱼群压缩、扩散、转向；字幕对应真实状态和威胁数 | `ESCAPE RESPONSE` / `Distance-aware evasion` | 鱼群行为因真实威胁而改变 |
| 00:36–00:44 | Recovery | 捕食者离开或重新搜索，School 相机观察群体重新组织 | `RECOVERY` / `No scripted paths` | 群体恢复不是瞬间复位 |
| 00:44–00:50 | Navigation | Navigation 场景，宽景展示鱼群穿过五礁空间 | `ENVIRONMENT AWARENESS` / `Predictive collision avoidance` | 个体同时处理邻居与障碍 |
| 00:50–00:53 | Proxy detail | 短暂显示碰撞代理/安全距离示意；默认仍是 Sphere 路径 | `SPHERE BASELINE` / `Optional SDF proxy experiment` | 障碍物理与视觉模型保持对应 |
| 00:53–01:02 | Grid | 真实 Uniform Grid 线框、邻居连线和单鱼行为向量 | `UNIFORM GRID` / `27 neighboring cells` | 只查询邻近单元，再做精确距离筛选 |
| 01:02–01:07 | Brute force | 同一模拟切换到 Brute Force；网格离线 | `BRUTE FORCE` / `Same behavior rules` | 替换的是候选搜索，不是 Boids 语义 |
| 01:07–01:10 | Systems | 左侧真实网格，右侧 Remotion 示意；叠加录制现场的 FPS/step | `REAL-TIME PIPELINE` / `Simulation · Spatial query · Render` | 图与模拟运行在同一帧循环中 |
| 01:10–01:21 | Finale | 回到 Calm / Overview，鱼群与礁群完整出现 | `A SCHOOL. A PREDATOR. ONE LIVE ECOSYSTEM.` | 回到全片主题 |
| 01:21–01:27 | Identity | 画面压暗，真实场景仍保留在背景 | `BlueCurrent` / `Real-time 3D predator–prey simulation` | 项目身份 |
| 01:27–01:30 | End card | 关键实现信息，不使用未完成的未来功能 | `TypeScript · Three.js · CPU Uniform Grid` | 收束技术定位 |

## 4. 章节文案

建议屏幕英文尽量短，中文旁白采用解释而不是功能列表。

### 4.1 开场

> 一片实时生成的海底世界。没有预写好的鱼群路径，每一条鱼只感知附近的邻居。

### 4.2 群体

> 分离让个体保持空间，对齐让方向趋同，聚合让群体重新靠拢。三种局部力量共同塑造整个鱼群。

### 4.3 捕食

> 捕食者通过巡逻、追逐、攻击和搜索改变行为。鱼群会出现逃逸、压缩和分裂，并在威胁离开后重新组织。

### 4.4 环境

> 鱼类不只需要避开彼此，还要预测礁石与海床的空间约束。

### 4.5 技术

> 三维均匀网格把邻居候选限制在相邻的 27 个单元。查询结束后仍然执行精确距离筛选；切换到暴力搜索时，Boids 规则保持不变。

### 4.6 结尾

> BlueCurrent 不展示一条写死的海底动画，而展示一个正在计算、可以观察和交互的生态系统。

## 5. 视觉风格

### 色彩

- 主色：深青、蓝绿、冷白；
- 捕食者事件：暖橙但不过饱和；
- 技术叠加：青蓝线框与低透明度标签；
- 避免整片高对比黑金或游戏 UI 风格。

### 字体

- 标题：等宽或几何无衬线，字重适中；
- 技术标签：短句、全大写、低字距；
- 数字：等宽字体；
- 不使用与项目截图不一致的超细小字作为唯一信息载体。

### 剪辑

- 镜头切换以行为变化为依据，不按固定节拍机械切；
- 每次状态标注至少保留 1.5 秒；
- 技术网格只在需要解释时出现，不让它覆盖整段生态；
- 不硬切到相机目标切换的构图尖峰；
- 结尾保留至少 2 秒稳定全景。

## 6. 声音

建议使用无版权争议的低频水下环境层：

- 20–60 Hz 柔和低频；
- 稀疏颗粒/气泡质感；
- 捕食段落只轻微增加低频张力，不做恐怖片式音效；
- 人声优先于音乐；
- 技术段可加入非常轻的界面音，但不能盖过旁白。

## 7. 技术数据呈现

### 算法卡片

只展示真实存在的机制：

- SoA + double buffer；
- 1/60 s fixed step；
- Separation / Alignment / Cohesion；
- Uniform Grid 27-cell candidate query；
- Sphere collision baseline；
- Predator FSM；
- Predation Event Tracker；
- WebGL render。

### 性能卡片

录制时从现场读取：

- `Frame rate`；
- `Simulation step`；
- `P95 frame time`；
- `draw calls`；
- `Fish alive`；
- `Occupied cells`；
- `Average neighbors`。

必须同时标注：

- 分辨率；
- 浏览器/硬件 renderer；
- 鱼数；
- “Observed during this recording”。

### 禁止借用的数字

- 不把 1280×720 的 91.25 FPS 短测直接当作 1920×1080 成片数据；
- 不使用 SwiftShader 的 1–20 FPS 做性能卡片；
- 不把历史 README 中的网格平均步耗时写成 GPU 帧时间；
- 不把 `renderMs` 写成 GPU timestamp。

## 8. 可选加长版

如果需要 120–150 秒课程答辩版，可增加：

- 10 秒固定种子与可重复性；
- 10 秒性能测试方法；
- 10 秒 Observation / Laboratory 对比；
- 10 秒失败与限制说明。

主片仍保持 90 秒，避免技术细节压过生态叙事。
