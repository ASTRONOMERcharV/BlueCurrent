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

## D014 — Integration 帧率优化留到 Phase F

**状态：接受（2026-11-12，用户决定）。** WP4 在 Intel Iris Xe 记录 40.66 FPS 短测（P95 66.20 ms）和 30 分钟中位 63.6 FPS（min 16.9 FPS、P95 frame 145.5 ms）。用户决定不把 60 FPS 作为 Integration Gate 门槛，帧率优化、压力矩阵和 1000/2000 目标留到 Phase F。

后果：Integration 只记录实测与限制，不声称满帧；不得为帧率验收降低默认鱼数、资产或画质；Phase F 仍需真实 GPU 分项、压力测试和明确优化目标。

## D015 — Predator 允许 pursuit 中 direct index→index 重选

**状态：接受（2026-11-12，用户决定修改 FSM）。** 旧 FSM 只在 `patrol/search` 获取目标，所有切换都经过 `null`。新行为在 `pursuit` 的 0.35 s retarget 窗口内，若另一条存活鱼的距离小于当前目标距离 × `predatorRetargetAdvantage`（默认 0.85），且当前目标在 attack radius 外，则直接替换 `targetIndex` 并重置 `stateTime`；`attack` 阶段不换目标。

后果：direct index→index 成为受支持路径；captures、存活数和 checksum 改变，旧 WP0 源码锁及 WP1–WP4 证据均失效。新 WP0 run `2026-11-12T14-30-00Z` 已建立，WP1–WP4 待在该锁上重跑。阈值和增加的捕获率仍需视觉与产品确认。证据见 `validation/fsm-retarget.md` 与 `test-artifacts/fsm-retarget/2026-11-12T14-05-00Z/summary.md`。

## D016 — School 构图保留 fit 上限 1.4

**状态：接受（2026-11-13，用户决定）。** post-FSM WP3 六个时间点的 School 可见率为 0.8517/0.9355/0.9254/0.9375/0.9718/0.8528，t17/t63 低于 90%。精确透视重投影探针显示 t17/t63 要达到 90% 需要 fit≈1.8；把 `SCHOOL_FIT_MAX_SCALE` 提到 1.8 可得到 0.916/0.982/1.000/0.972/0.976/0.998，但相机整体后移抬高 12–29%、主体明显变小。用户选择保留 1.4，优先主体尺寸与近距离构图。

后果：t17/t63 约 0.85 的可见率是已接受的构图结果，不再作为回归失败；也不把“超过 95%”自动判为满足 90–95% 目标。今后若要提高上限或改 side/up 偏移，必须重新做同版、同种子、同时间点、同视口的六点对比并单独决策。试验测量与前后对比见 `test-artifacts/integration-abc/2026-11-12T14-30-00Z/optimization-composition/summary.md`（`test-artifacts/` 被 Git 忽略）。

## D017 — D 双柱通道保持封闭

**状态：接受（2026-11-13，用户决定）。** B1 D 双柱几何间隙约 0.31 m，当前 margin 下 0 鱼通过；ReefProxy 0 穿透、0 深穿透、0 假避障、0 卡鱼。用户选择保持封闭，不改柱体、margin 或代理。

后果：D 通道封闭是当前已验证的刻意设计；若将来要允许通行，必须作为独立变更，局部标定 margin/代理并重跑 WP1/WP2 的覆盖、穿透与通道证据。

## D018 — Hero 不加低前 shelf

**状态：接受（2026-11-13，用户决定）。** B1 高度比 1.1721、面积比 1.1677、Hero 横向中心 56.54% 已达 Experiment B 数值目标。用户决定不在 Gate 阶段新增低前 shelf。

后果：Hero 自身轮廓面积比 baseline 少 5.5% 作为已知差异保留；视觉打磨留到 Phase F，届时需重拍层级证据。

## D019 — 默认碰撞保持 Sphere

**状态：接受（2026-11-13，用户决定）。** `reefProxy` 已作为 opt-in 通过覆盖、穿透、假避障、卡鱼与双跑确定性验收。用户决定 Gate 内不切换默认碰撞。

后果：默认仍为 `sphere`；切换默认会改变所有用户的碰撞行为与 checksum，必须作为独立变更并重跑全部碰撞证据后才可考虑。

## D020 — B 基座力与 Proxy 成本留到 Phase F

**状态：接受（2026-11-13，用户决定）。** 实验 A 记录的 B 基座避障力偏强与代理 CPU 查询成本不在 Gate 内标定。

后果：与 D014 一致，性能与参数标定留到 Phase F；Gate 内不改相关模拟参数。

## D021 — 1000/2000 与多捕食者不作为 Gate 目标

**状态：接受（2026-11-13，用户决定）。** 1000/2000 鱼压力矩阵与多捕食者场景只作为 Phase F 的性能场景，不是 Gate 硬验收目标，也不进入当前生态需求。

后果：Gate 只对当前富默认 500+100+1 负责；扩展性结论必须在 Phase F 用压力矩阵单独建立。

## D022 — 接受 Predator retarget 0.85 阈值

**状态：接受（2026-11-13，用户决定）。** D015 的 `predatorRetargetAdvantage=0.85` 与 0.35 s 窗口继续生效；300 s CPU captures 从 18 增至 25、浏览器 0–30 s 4 次 direct / 0–60 s 11 次 direct 视为可接受。

后果：阈值不再作为 Gate 未决项；若后续生态观感或捕获率成为问题，再作为独立变更调整阈值/冷却并重跑受影响的 WP1/WP3/WP4。

## D023 — Phase D 第一轮 D4/D1 定稿并保持当前风格

**状态：接受（2026-11-13，用户决定）。** 第一轮只做 D4 全局光照与 D1 水体，保持现有低饱和青蓝风格。D4 定稿 `environmentIntensity 0.75`、`sun.intensity 2.10`、`hemisphere.intensity 0.82`、`hemisphere.groundColor 0x2a6570`、`materials.floorColor 0x456c74`；D1 定稿 `scatteringStrength 0.80`、`attenuationRgb [1.24,0.99,0.74]`、`surfaceScatterStrength 0.24`、`scatterColorDistance 34`。用户先后通过 D4、D1 两个评审检查点，并于同日签核 Intel Iris Xe 硬件画面。

**后果：** 礁石近景 P50 提升 10.8–14.0%、宽景 3.5–4.0%，俯视海床 +20.9%，D1 岩石对比度 +0.7–3.6%，背景水色与色相基本不变；这些数值不是后续轮次的自动目标，D2/D3 必须独立评审。D2 海床材质、D3 海草动画与剩余礁石接触细节留到下一轮，开工前需确认范围与验收指标。证据见 `test-artifacts/phase-d/2026-11-13t10-45-43z/summary.md`（Git 忽略）。

## D024 — Phase D 第二轮 D2/D3 定稿

**状态：接受（2026-11-13，用户决定）。** 第二轮完成 D2 海床程序化材质与 D3 海草动画/分布。D2 用顶点色宏斑 + 片元世界空间噪声（无贴图、无新 draw call，55 m 外归零），海床亮度分布 +2.1…+8.3、P50 漂移 ≤1.77/255、俯视海床色相约 −4.5°；D3 把海草从 6 株扩到 6 簇 14 株，并与海带共用 `OceanCurrentField` 方向+速度摆动（根部固定、相位逐株/逐叶不同），三角形增加 110,336（+8.7%）、draw calls 不变。用户先后通过软件评审与 Intel Iris Xe 硬件签核。

**后果：** 海草逐帧采样 14 株（约 840 次/秒）与 +110k 三角形进入富默认场景；帧时间影响留到 Phase F 评估，如硬件帧时间明显恶化可回退到 12 株或旧摆动。D2 剩余碎石/附着细节未做，是否补做与是否进入 Phase E 需单独确认。证据见 `test-artifacts/phase-d/2026-11-13t12-16-00z/summary.md`（Git 忽略）。

## D025 — Phase E 第一轮 E1/E3 定稿

**状态：接受（2026-11-14，用户决定）。** Phase E 第一轮只做 E1 鱼体运动与 E3 捕食事件呈现，保持呈现/只读遥测边界。E1 在渲染层用逐实例指数趋近 + 速率限制 + 0.9 rad 俯仰限幅，并由模拟 bank 派生 `instanceTurn` 叠加尾波弯曲；E3 用 `PredationEventTracker` 从真实快照派生事件，`capture` 只按 `captureSerial` 增量产生，UI 在 `predator-watch` 单行显示最新事件。`?fishMotion=legacy` 保留 E1 前呈现的同版对照通道。用户先后通过软件评审与 Intel Iris Xe 硬件视觉签核。

**后果：** 默认场景急变俯仰限制在 51.6°（0.900 rad），legacy 对照仍为 80.7–86.9°（1.408–1.517 rad），均值几乎不变；转弯帧可见身体弯曲（max|turn| 0.259–0.264，legacy 为 0）。固定种子 checksum 不变（`535bf8835258bcf1b2e9e696`），事件流不改变 FSM/目标/捕获，也不强制生态结果。E2 鱼群动态结构与 E4 环境/生物交互未做；D2 剩余碎石/附着细节仍未做，下一轮范围需用户确认。证据见 `test-artifacts/phase-e/2026-11-14t00-13-00z/summary.md`（Git 忽略）。

## D026 — Phase E 第二轮 E2/E4 定稿

**状态：接受（2026-11-14，用户决定并签核硬件画面）。** Phase E 第二轮完成 E2 鱼群动态结构与 E4 环境/生物交互，目标是由局部规则产生可复现的结构变化，并让环境互动读取真实位置/速度/海流。E2 加入一致度加权对齐（`alignmentAgreementBlend 0.35`）、密度自适应分离（`separationDensityBoost 0.4`，上限 1.75）、群体流地形预判（`obstacleAnticipationBlend 0.35`）、阈值门控惊扰传播（`startlePropagationThreshold 0.02`）与恐惧缩放边缘逃逸（`edgeEscapeBoost 0.6`）；结构遥测每 30 步由并查集产生 schools/median/largest/polarization/startle/edge pressure，`SchoolStructureTracker` 从真实分量变化派生 split/merge/subgroup 事件并在 `predator-watch` 第二行显示。E4 用 `AnemoneHabitat` 单点拥有海葵放置公式，把小丑鱼软栖息中心迁到最近海葵 `anemone-b` 上方（3.4 m 吸引 / 1.1 m 核心 / 中间死区，恐惧可压制，无传送或硬约束）；`SedimentField` 由真实近底位置、速度与共享 `OceanCurrentField` 驱动 320 粒池，`SedimentPlume` 用单个 `Points` draw 呈现，不写任何模拟状态。

**后果：** 建立新 checksum 基线：encounter 17/43/52/60/63 s dynamic 为 `8a4ebd8073cc884fa5621e60`、`69d993ea1f7a467566b1e394`、`251d7c0f66ffc470ef667eab`、`937cdfef29cd2a9c2b21ac48`、`42e406513e0b960cd0c4c5e5`；旧 `535bf8835258bcf1b2e9e696` 只由 `?schoolDynamics=legacy` + `?habitat=legacy` 逐位复现。E2 只改主鱼群（`fishChecksum` 在 E4 前后完全相同），E4 只改小丑鱼段；`?sediment=0` 与开启时模拟 checksum 完全相同，沙尘只增加 1 个 draw call。3600 步压力无 NaN/越界且两次运行一致；Sphere/ReefProxy 五时间点 ReefProxy 0 穿入、Sphere 仅一次 −0.018 m 瞬态（旧基线同类 −0.062 m）。49 文件 365 tests、tsc、构建、rich smoke、observatory 与 `accept:gpu` 通过；Intel Iris Xe 硬件画面已签核，证据见 `test-artifacts/phase-e/2026-11-14t08-31-46z/summary.md`（Git 忽略）。回滚通道 `?schoolDynamics=legacy`、`?habitat=legacy`、`?sediment=0` 保留。SwiftShader 不是性能结论；沙尘使用 8 m 距离衰减影响高度（字面近底阈值不可达）；D2 剩余碎石/附着细节仍未做。

当前未决清单只在 `CURRENT_STATE.md` 第 5 节维护，本文件不复制一份可能不同的列表。某项由 Integration Gate 或用户明确决定后，在这里新增 ADR，并更新当前状态、受影响子系统文档和回归证据。

## D027 — Phase F 第一轮只做测量与瓶颈审计，压力档先用单捕食者代理

**状态：接受（2026-11-14，用户决定）。** Phase F 第一轮（F1）只建立当前硬件的 CPU/GPU 分项基线、四档压力矩阵与瓶颈排序，不修改模拟行为、渲染质量、默认鱼数/资产或任何优化参数。压力档（1000+200）与极限档（2000+300）按路线要求保留 3/5 捕食者目标数量，但本轮实际只放 1 个捕食者作为代理；intended-vs-measured 缺口写入 `results.json`、`summary.md` 与 `docs/validation/performance.md`，不得把代理写成已支持多捕食者生态。性能验收目标（例如标准档 P50/P95 阈值）在基线完成并由用户签核后另行确定。

**后果：** 本轮交付 `scripts/phase-f-baseline.ts`、`PhaseEmaRecorder` CPU 相位遥测、真实 `EXT_disjoint_timer_query_webgl2` GPU 计时与 `getRendererStats()`；遥测默认关闭，`?perfTelemetry=1` 才启用，且开关不改变固定种子模拟结果。压力/极限档的 3/5 捕食者完整测量是后续独立工作包，不能以 1 捕食者代理代替完整矩阵签核。基线受共享桌面负载、电源方案与热状态影响时，必须记录实测条件与波动范围，不能用单次最好值代表硬件能力。证据见 `test-artifacts/phase-f/2026-11-14T11-26-00Z/`（Git 忽略）。

## D028 — Phase F 验收目标：标准档 60 FPS

**状态：接受（2026-11-14，用户决定）。** 标准档（500 主鱼 / 100 小丑鱼 / 1 捕食者、1280×720、Iris Xe D3D11、telemetry-off 对照）的验收目标为 P50 ≤ 16.7 ms、P95 ≤ 33 ms、0 dropped steps，并在 3 repeats 中稳定复现；pressure/extreme 只作扩展性诊断，不要求实时。该目标必须在关闭动态壁纸与并发负载、固定电源/热状态的同一台机器上用同一 harness 复测确认。

**后果：** 2026-11-14 的 `rows/` 矩阵不满足干净验证条件（动态壁纸/并发负载），因此目标不由该矩阵判定。同日 21:38 在暂停 Wallpaper Engine、关闭用户 Chrome、AC/Balanced、页面 visible/focused 的条件下，用同一 harness 复测 standard telemetry-off 3 repeats，3/3 达到 P50 ≤ 16.7 ms、P95 ≤ 33 ms、0 dropped，D028 目标在本机干净会话通过；更早的污染矩阵只作诊断。telemetry-on 对照显示测量开销显著，不作为产品路径性能。证据见 `test-artifacts/phase-f/2026-11-14T13-38-06Z-clean/acceptance.md`，数值只在 `docs/validation/performance.md` 维护。

## D029 — Phase F 优化第一轮：位相同 CPU 热路径优化

**状态：接受（2026-11-15，用户决定进入优化）。** 第一轮只做保持模拟逐位相同的 CPU 热路径优化，不改模拟参数、邻居半径/顺序、默认鱼数/资产、渲染、相机、固定步长语义或检查点格式。改动集中在 `BoidSystem`、`UniformGrid3D`、`ObstacleSystem`、`EnvironmentForces`：提升每步常量、减少重复邻居读取、内联 cell 坐标与对齐权重、predator 关闭时跳过未使用的 fear 读取、每步预计算鱼速以复用加权对齐。`scripts/benchmark.ts` 增加 `--modes` 过滤与逐 step CPU 时间；`scripts/phase-f-baseline.ts` 修复 telemetry-off 样本被聚合过滤的问题（只影响报告）。

**后果：** 在同电源方案、交替 baseline/optimized、各状态先丢弃预热的 CPU 基准中，500/1000/2000 主鱼的 wall mean 从 3.146/7.945/20.462 ms 降到 3.043/7.673/19.868 ms（约 −2.9…−3.4%），CPU 时间 −2.9…−8.2%，P95 改善 1.8–5.1%。收益有限，因为 `UniformGrid3D.collect` 仍约占 2000 鱼 profile 的 49%，`BoidSystem.update` 约占 40%；它不足以改变 pressure/extreme 的实时性。标准档 telemetry-off 优化后复核在干净会话中一次 3/3 达 D028（P50 12.0/12.1/12.1、P95 18.2/18.2/18.3、0 dropped），另一次 r3 热漂移到 P50 18.2 但 P95 仍 30.2、0 dropped；未做同会话 baseline/optimized 浏览器 A/B。完整 tests（50 文件/370）、tsc、构建与 `sim:regression` 通过，checksums 与 Phase E 基线逐位相同。被否决的邻居几何缓存（慢 12–15%）、cell 位置缓存（噪声内）与 Float32 距离缓存（改变 checksum）不进入代码。后续若要 Worker/WASM、改变邻居求和顺序、降低默认质量或做其他非位相同优化，必须另立决定并重新建立 checksum/性能证据。证据见 `test-artifacts/phase-f/optimization/2026-11-14T20-21-09Z-baseline-vs-opt/`、`2026-11-14T20-26-07Z-browser-standard/`、`2026-11-14T20-32-36Z-browser-standard/`（Git 忽略）。

## D030 — Phase F 第二轮：F2-2R 位相同 prune、checksum fixture 与 1440×900 gate

**状态：接受（2026-11-15，用户批准按推荐默认执行）。** F2 第二轮采用 measurement-first 的位相同路线，目标不是改变已通过的 D028，而是关闭 F2 的“位相同优化”线并取得 pressure/extreme 诊断余量：

1. 先提交 encounter checksum fixture 与未排序的 grid 参考序列测试；fixture 覆盖五个 D026 动态 checksum（`8a4ebd80…`、`69d993ea…`、`251d7c0f…`、`937cdfef…`、`42e40651…`）和 PRE_E2 的 `535bf883` / `535bf8835258bcf1b2e9e696` 对。fixture 只能在显式 `--new-baseline` 且两次运行一致时重写；任何漂移是硬停止，不得为了通过而 rebless。
2. 在 Balanced 电源方案下跑一次干净的 1440×900 design-viewport gate，并以 1280×720 standard telemetry-off 作为对照；gate 的预登记规则为 `PASS_1440` / `ONE_TIER` / `TWO_TIER` / `INVALID` / `INCONCLUSIVE`。1280×720 仍是唯一 D028 验收视口；1440×900 是先诊断、后决定，不自动成为验收目标。
3. 只有在用户已资助 pressure/extreme 诊断余量，或 gate 显示 1440 成本确实由 CPU 归因时，才落地 `UniformGrid3D.collect` 的保守 cell-AABB 跳过；必须保持 27-cell `dz/dy/dx` 遍历、精确距离过滤、邻居顺序、半径和浮点求和不变。`candidatesExamined` 保持历史语义，新增 `candidatesSkipped`/`skippedCells`/`candidatesTested` 作为诊断，不改 StatisticsPanel 或 F1 固定负载候选表。
4. BoidSystem 只允许两个可证明安全的 trim：用预计算的 `speeds[i]` 替代每鱼重复 `sqrt`；当 `cohesionRadius` 是最大邻居半径且 FOV=360 时跳过恒真的 cohesion 比较。两项独立 commit、可独立回滚。
5. CPU A/B 使用 D029 的交替、固定电源方案、丢弃预热协议；prune 的预登记 keep/revert 规则是：2000 鱼 wall 中位改善至少 2%、1000 鱼为正、500 鱼回退不超过 2%，否则回滚 prune 并保留 fixture/ordered tests 及负结果记录。标准档只在 optimized build 上复核 3/3 D028，不声称 D028 改善或 pressure/extreme 实时。
6. 本轮不做 fused grid/Boid 跟随项、Worker/WASM/SIMD/SAB、更小 cell/125-cell 遍历、pair-symmetric 力、空间排序、跨步邻居复用、渲染质量调整或非位相同优化；这些需要新 ADR、新 checksum 基线和独立预算。gate 若为 `ONE_TIER`/`TWO_TIER`，后续另开 render/GPU 调查，不自动资助 fused CPU pass。

**后果：** 验收证据写入新的 `test-artifacts/phase-f/optimization/<UTC>-f2-2r-gate/`，包含 fixture/、regression/、tests/、gate/、cpu-ab/、browser/standard-off/ 与 `artifact.sha256`；性能数字只在 `docs/validation/performance.md` 维护。回滚以单 commit revert 为主；由于 state checksums 必须逐位相同，不需要迁移 checksum 基线。标准档已经满足 D028，本轮的 4–9% CPU 预期仅是诊断余量和 F2 收口，不是帧时间修复；如果 A/B 未能复现收益，prune 回滚，fixture/gate 仍然保留。
