# Validation — Visual Baseline

> 最后核实：2026-11-12。当前没有通过 A/B/C Integration Gate 的统一视觉基线。本文件是截图版本、轮廓、碰撞覆盖和相机实测的唯一维护处；性能数字在 `performance.md`。

## 基线状态

当前可用材料分为 B1 Overview/近景、pre-B1 的 Experiment C 三机位，以及旧 Experiment A Proxy Debug。它们各有用途，但**不能合并称为同版 B1+C 验收套图**。稳定名称 `reef-camera-integration-v1` 尚未建立。

## 现有图片证据

| 材料 | 路径 | 可证明内容 | 限制 |
| --- | --- | --- | --- |
| B1 Overview + UI | `test-artifacts/reef-hierarchy/b1/overview-full-ui-1920x1080.png` | B1 Hero/D，19.5 s，499+100 alive，Console open，Overview 位姿。 | Sphere；capture API 为 free pose；renderer 未在该 JSON 记录，SwiftShader 来自 B 报告；不是动态三机位或 Proxy 验收。 |
| B1 清洁 Overview | `test-artifacts/reef-hierarchy/b1/overview-scene-800x560.png` | B1 场景构图，无完整 UI。 | 与全 UI 图 aspect 不同，不能互相替代 Console 开/关验收。 |
| B1 Hero / D 近景 | `test-artifacts/reef-hierarchy/b1/hero-closeup.png`、`d-closeup.png` | 当前 B1 几何和表生细节。 | 软件画面；不能证明通道或硬件效果。 |
| C School / Predator | `test-artifacts/camera-validation/validation-t17.00-school.png`、`validation-t17.00-predator.png` | Experiment C t17 机位，同组 JSON 明确 SwiftShader。 | pre-B1 Hero/D，UI hidden；不是当前 B1 画面。 |
| 旧 A Proxy Overview / D gap | `test-artifacts/reef-collision/debug-overview.png`、`debug-twin-gap.png` | 旧 A Proxy 与 margin 的 Laboratory 诊断。 | 300 鱼，0.267 s，旧图元；当前 B1 D 已是 10 圆角盒。 |

图片快捷链接见 `../visual/reference-images/README.md`。B1 `capture.json` 的 aggregate `renderTriangles` 与 pre-B1 值相同，不宜作为版本证明；版本应结合资产前缀、GLB 时间、近景和具体诊断确认。

## 当前实测快照（唯一维护处）

以下均为现存产物，不是本次知识库整理重新运行的结果。

| 范围 | 当前值 | 原始证据与版本限制 |
| --- | --- | --- |
| B1 Hero/D 轮廓 | 高度比 1.172；面积比 1.168；Hero 中心 X=56.94% | `test-artifacts/reef-hierarchy/b1/metrics.json`；达到 Experiment B 目标，不是 Integration 人工签核。 |
| B1 构图残余 | Hero 自身面积比 baseline 少 5.5%；礁群顶部位于画面高度约 41.2% | B 报告与同一 metrics；是否加 shelf 或调整空水仍待人工构图决定。 |
| B1 D 表生 | 覆盖 41.28%，43 个实例 | B1 capture / B 报告；不是 48 个 CoralScatter 的计数。 |
| B1 Proxy 覆盖 | B 5.20%/0.387 m；C 0.50%/0.118 m；Hero 0.18%/0.234 m；D 13.78%/0.596 m；E 0.91%/0.119 m | `test-artifacts/reef-collision/proxy-coverage.json`；分别为顶点外露比例/最大外露，同名文件已覆盖旧 A 内容。 |
| B1 碰撞行为与通道 | 63 s ReefProxy 为 0 穿透、0 深穿透、0 假避障、0 卡鱼；D 几何间隙约 0.311 m，0 鱼通过 | `test-artifacts/reef-collision/experiment-b.json`；`rerunMatches=null`、两模式 `deterministic=null`，D 是否应通行未决定。 |
| School 六点可见率 | t17/43/44.15/52/60/63 = 0.906 / 0.972 / 0.988 / 0.996 / 0.986 / 0.940 | `test-artifacts/camera-regression-final/camera-regression.json`；B1 Hero + 旧 D 混合版本，4/6 点高于 95%。 |
| 相机净空与目标轨迹 | 预设切换最低净空 1.879 m；含 traces 总最低 1.100 m；独立轨迹只有 371→null | 同一 regression JSON 与 `camera-target-switch/camera-target-switch.json`；缺 index→index 和完整 B1+C 重跑。 |

查询耗时和相机数学基准只在 `performance.md` 记录。复测时先替换本节对应行及原始证据链接，再在 `../CURRENT_STATE.md` 更新状态，不在子系统文档复制这些数字。

## 新统一基线的最低材料

正式运行应输出到 `test-artifacts/integration-abc/<timestamp>/` 或同等独立目录，至少包含：

| 文件 / 数据 | 必须记录的内容 |
| --- | --- |
| `overview.png`、`school.png`、`predator.png` | 同版 B1+C、同种子、规定时间点、URL、视口、Console、renderer。 |
| Hero/D 与 ReefProxy Debug 对照 | 当前 GLB 前缀、五 ID、Proxy 版本、Sphere/ReefProxy 模式、margin 和近景残差。 |
| School 六时间点与 Predator 轨迹 | visible fraction、fit、留白、垂直追逐、index→index/null、死亡目标和状态切换。 |
| Console / Responsive 对照 | 桌面 Console 开/关、窄视口、移动抽屉；模拟 checksum 不因 UI 改变。 |
| `collision-results.json`、`camera-results.json` | 当前 B1 Sphere/ReefProxy、通道、穿透、假避障、卡鱼、双跑 checksum 和轨迹范围。 |
| `results.json`、`summary.md` | 源码/构建/资产 manifest、浏览器、renderer、通过/失败、限制和原始文件索引。 |
| 本机运行记录 | 真实硬件视觉/交互、180 s 相机稳定性和 30 分钟观察；软件图不替代。 |

## 基线更新规则

新运行使用独立目录，不覆盖旧 A/B/C 图片或 JSON。只有矩阵全部通过后才把一组材料标记为稳定基线，并同步 `../CURRENT_STATE.md`、`../ROADMAP.md` 和 `../DEVELOPMENT_ROADMAP.md`。局部视觉迭代则使用新的 before/after 目录，旧基线保持只读。

外部参考图只能用于美术方向，不能进入正式项目验收。任何截图不得通过假遥测、强制生态结果、隐藏默认资产或裁剪关键失败区域来制造通过。
