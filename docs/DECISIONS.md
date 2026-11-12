# Blue Current — Decisions

> 本文件记录已确定的长期工程决策及理由，避免每次任务重新讨论。当前完成状态和未决清单只在 `CURRENT_STATE.md` 维护。

## 决策变更规则

新证据需要推翻决策时，新增 ADR 条目并标明 superseded 关系，同时更新受影响子系统文档和回归证据；若涉及 `AGENTS.md` 第 4 节的最小契约，也必须同步该节。不得 silently 改写默认值后仍保留旧决策描述。未找到原始选型理由时明确写“未记录”，不补写虚构原因。

## D001 — Web + TypeScript + Three.js/WebGL

**状态：已实施。** 当前生产栈是 TypeScript、Vite、Three.js 0.180 和 WebGLRenderer，UI 使用原生 DOM/CSS。选择它而非 WebGPU、Unity 等的原始比较理由未找到独立记录，因此只继承实际技术边界，不继承虚构理由。

后果：渲染遵循 Three.js 色彩管理、ShaderChunk、InstancedMesh 和 GLB Loader 契约；性能结论必须区分浏览器 CPU、软件光栅和真实 GPU。

## D002 — 固定 60 Hz、SoA 双缓冲、最多 8 补步

**状态：接受。** `FlockData` 在当前/next 缓冲间统一交换，`FixedStepScheduler` 用固定步和插值分离模拟与渲染。理由是固定种子复现、同一步邻居读取一致性和防止卡顿后的追帧螺旋。

后果：外部代码不得在步中写位置/速度，不得把 next 当当前状态；模拟行为变更必须有确定性回归。详见 `systems/simulation.md`。

## D003 — Grid 与 Brute Force 必须行为等价

**状态：接受。** Uniform Grid 只替换邻居候选来源，两项搜索共用相同行为计算和精确距离筛选。不得用静默邻居上限、不同排序或不同半径换取表面性能。

后果：网格结构优化必须保留逐鱼邻居集合等价测试；连续 `cellItems` 是当前实现，不是可回退到旧文档 `head/next` 的要求。

## D004 — 一个 SimulationWorld，呈现只读

**状态：接受。** Observation/Laboratory、三机位、鱼体/鲨鱼动画和调试视图共享同一模拟事实。相机、动画和统计不写鱼的位置、速度、存活或捕食者决策；UI 通过显式 actions 修改配置。

后果：不可测数据显示 N/A，不强制捕食成功，不为截图编排假状态。诊断 metrics 不反馈 steering。

## D005 — 五个硬障碍；Sphere 默认，ReefProxy opt-in

**状态：接受，默认切换未决定。** 五个 `REEF_OBSTACLES` 是唯一硬障碍和稳定逻辑 ID。Sphere 保留历史基线；`?obstacleShape=reefProxy` 才启用复合 SDF。只有五个实际 GLB 变换齐全才安装 Proxy，否则回退 Sphere。

后果：视觉变体不能悄悄改变 Sphere 或新增硬障碍；Proxy 的 margin 只在 SDF 外应用一次。默认切换需要单独决策和双路径回归。详见 `systems/collision.md`。

## D006 — 海带是共享布局的软庇护，不是刚体

**状态：接受。** `world.kelpLayout` 是渲染与 `KelpRefugeField` 的唯一布局。海带通过覆盖、视线遮蔽、恐惧和速度修正参与行为，不作为硬碰撞。装饰岩、珊瑚、表生物和海草不自动成为障碍。

后果：不得另建一套视觉或隐形海带布局；启用/禁用渲染时必须核对庇护开关一致。

## D007 — 单一路径线性 UnderwaterMedium

**状态：接受。** 默认水体在内建材质 tonemapping 前完成线性吸收、散射与合成；没有第二条后处理雾链。`lighting=base` 必须真正关闭介质与局部效果。

后果：禁止 tonemap 后再次混雾、重复 `sRGBTransferOETF` 或让不同资产拥有独立全局水参数。局部 Water Effects 开关不是介质总开关。详见 `systems/rendering.md`。

## D008 — 资产坐标、基准和运行时契约

**状态：接受。** 生物资产为 Y-up、+Z forward，礁石底部基准 y=0，GLB Loader 验证尺寸、三角数、材质、属性和骨骼。Reef LOD 与世界缩放由实际资产统计和规格共同决定，不能凭文件名猜尺寸。

后果：替换资产必须走现有校验和回退路径；视觉变换、LOD 和碰撞 Proxy 要同步审查。详见 `systems/assets.md`。

## D009 — 相机是只读稳定参考系管线

**状态：接受。** 三叙事机位共用期望位姿、稳定参考系、阻尼、上向量和世界保护管线。School 使用可靠航向和 P95 拟合，Predator 在目标失效时按 target → velocity → previous → initial 回退。

后果：不得让相机反写模拟，也不得用瞬移隐藏目标切换问题。构图常量与可见率取舍是视觉验收问题，不等于可以破坏稳定性。详见 `systems/camera.md`。

## D010 — 固定种子、集中参数、富默认场景

**状态：接受。** 场景、散布和资产附着使用固定种子；模拟、水体和光照有集中配置。默认展示使用 500+100+1 与完整环境，不以 bare 或删减资产替代正式验收。

后果：纯视觉修改原则上不应改变模拟 checksum；调参需记录来源和影响范围，不能复制第二套相互漂移的配置。

## D011 — 证据分级与 N/A 原则

**状态：接受。** 源码事实、原始产物、文档声明、历史测量和推断分开陈述。SwiftShader 只证明软件功能/画面；真实 GPU、CPU 提交、模拟 CPU 和纯数学基准不能混称。

后果：GPU timestamp 未测就是 N/A；`latest.json` 也必须读取 renderer；截图必须记录版本和限制，参考图不能成为项目验收截图。

## D012 — 无 Git 时备份与 manifest；重任务串行

**状态：接受。** 当前目录无 Git 元数据，修改前备份，稳定基线用不可混淆的 manifest、源码快照和证据归档识别。Vitest、SwiftShader 捕获和 Blender 烘焙串行，避免 CPU 争用制造假超时。

后果：文档中的基线名不等于 Git tag；环境修复不得随意重写依赖锁文件。详见 `validation/test-guide.md`。

## D013 — CoralScatter 与 Reef Epibiont 是两套系统

**状态：接受。** 生产默认由 `main.ts` 显式选择 full，形成 48 个 `CoralScatter` 实例；构造器自身默认 temperate 为 12。它们与礁石表面 Epibiont 使用不同放置、种子、计数和层级规则。不得用一套实例数代替另一套，也不得为调 D 装饰覆盖而误改全局 CoralScatter。

## 未决事项的所有者

当前未决清单只在 `CURRENT_STATE.md` 第 5 节维护，本文件不复制一份可能不同的列表。某项由 Integration Gate 或用户明确决定后，在这里新增 ADR，并更新当前状态、受影响子系统文档和回归证据。
