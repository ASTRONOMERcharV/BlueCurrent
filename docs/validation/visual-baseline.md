# Validation — Visual Baseline

> 最后核实：2026-11-12。当前没有通过 A/B/C Integration Gate 的统一视觉基线。本文件是截图版本、轮廓、碰撞覆盖和相机实测的唯一维护处；性能数字在 `performance.md`。

## 基线状态

当前可用材料包括 WP3 同版三机位/六时间点/UI、WP2 当前 B1 Overview/近景与 ReefProxy Debug、WP4 硬件 180 s/30 分钟运行记录，以及旧 Experiment A Proxy Debug。WP3 已形成一套同版软件证据，WP4 已补真实 Intel Iris Xe 画面与长时稳定性，用户已签核硬件画面/交互；但 Gate 其他项未关闭，仍**不能称为稳定基线**。2026-11-12 FSM direct-retarget 后，旧 WP0/WP1–WP4 的相机与硬件数据均为 pre-FSM；新浏览器 direct 样本为 SwiftShader，新 WP0 `2026-11-12T14-30-00Z` 已建立，Gate 需在新锁上重验。稳定名称 `reef-camera-integration-v1` 仍未建立。

## 现有图片证据

| 材料 | 路径 | 可证明内容 | 限制 |
| --- | --- | --- | --- |
| B1 Overview + UI | `test-artifacts/reef-hierarchy/b1/overview-full-ui-1920x1080.png` | B1 Hero/D，19.5 s，499+100 alive，Console open，Overview 位姿。 | Sphere；capture API 为 free pose；renderer 未在该 JSON 记录，SwiftShader 来自 B 报告；不是动态三机位或 Proxy 验收。 |
| B1 清洁 Overview | `test-artifacts/reef-hierarchy/b1/overview-scene-800x560.png` | B1 场景构图，无完整 UI。 | 与全 UI 图 aspect 不同，不能互相替代 Console 开/关验收。 |
| B1 Hero / D 近景 | `test-artifacts/reef-hierarchy/b1/hero-closeup.png`、`d-closeup.png` | 当时 B1 几何和表生细节。 | 软件画面；不能证明通道或硬件效果。 |
| WP2 Overview / Hero / D | `test-artifacts/integration-abc/2026-11-12T08-22-20Z/wp2/hierarchy-capture/overview-full-ui-1920x1080.png`、`hero-closeup.png`、`d-closeup.png` | 当前 B1 层级与构图，1920×1080，Console open，视觉时间 17 s（simulationTime 19.5 s 含 150 步预热），SwiftShader。 | Vite dev server、默认 Sphere；不是三机位或 ReefProxy 验收。 |
| WP2 ReefProxy Debug | `test-artifacts/integration-abc/2026-11-12T08-22-20Z/wp2/collision-debug/debug-overview.png` 等 9 张 | 当前五礁 Proxy/margin、Hero top、D 双柱与间隙；`reefProxyActive=true`、5 reefs。 | 诊断降级场景（300 程序化鱼，无小丑鱼/珊瑚/海草/海带），只作 Proxy/GLB 对照。 |
| WP2 俯视通道 | `test-artifacts/integration-abc/2026-11-12T08-22-20Z/wp2/passages/debug-passages-top.png`、`debug-passages-oblique.png` | 五礁 Proxy 与 B–C、C–Hero、Hero–D、B–Hero 的空间关系。 | 诊断降级场景；仅碰撞层，通道计数来自同 run `collision-behavior.json`。 |
| C School / Predator | `test-artifacts/camera-validation/validation-t17.00-school.png`、`validation-t17.00-predator.png` | pre-B1 Experiment C t17 历史对照。 | pre-B1 Hero/D，UI hidden；不是当前 B1 画面。 |
| WP3 三机位 | `test-artifacts/integration-abc/2026-11-12T08-22-20Z/wp3/plates/overview.png`、`school.png`、`predator.png` | 当前 B1+C，encounter t=17，1920×1080，Console open，SwiftShader。 | 全 UI；clean 版 1918×1078，软件画面，不是硬件签核。 |
| WP3 六时间点 School | `wp3/plates/school-t17.png`、`school-t43.png`、`school-t44.15.png`、`school-t52.png`、`school-t60.png`、`school-t63.png` | 当前 School 相机六时间点，1440×900 clean。 | 与 `wp3/camera-regression.json` 同时间/同视口；t44.15 曾截图超时，后续重拍。 |
| WP3 UI / Responsive | `wp3/ui/ui-console-open-1440x900.png`、`ui-console-closed-1440x900.png`、`ui-narrow-open-800x560.png`、`ui-mobile-drawer-390x844.png` 等 6 张 | Console 开/关、800×560、390×844 移动抽屉；checksum 不变。 | 软件画面；不是硬件交互签核。 |
| WP4 硬件 180 s School | `wp4/hardware-180s-start.png`、`wp4/hardware-180s-end.png` | 真实 Intel Iris Xe D3D11、headed Chrome、1280×720、School，189.8 s、412 采样，0 finite/净空/浏览器错误；用户已签核硬件画面/交互。 | 仅起止帧；不是固定六时间点，持续闪烁未 instrument。 |
| WP4 硬件 30 分钟 Overview | `wp4/hardware-30min-start.png`、`wp4/hardware-30min-end.png` | 真实 Intel Iris Xe、Overview，1813.8 s、644 采样，相机位置漂移 0 m、姿态漂移约 1.7e-6°，0 错误；用户已签核硬件画面/交互。 | 仅起止截图；持续闪烁未 instrument；不是 60 FPS 证明。 |
| FSM direct retarget 浏览器 | `test-artifacts/fsm-retarget/2026-11-12T14-05-00Z/browser/browser-target-switch.json` | 0–30 s 捕获 4 次 direct index→index（5.08/12.42/12.78/30.38 s），0 浏览器错误，`passed=true`。 | Vite dev server + SwiftShader；旧 WP3 六点与 WP4 硬件数据均为 pre-FSM。 |
| 旧 A Proxy Overview / D gap | `test-artifacts/reef-collision/debug-overview.png`、`debug-twin-gap.png` | 旧 A Proxy 与 margin 的 Laboratory 诊断。 | 300 鱼，0.267 s，旧图元；当前 B1 D 已是 10 圆角盒。 |

图片快捷链接见 `../visual/reference-images/README.md`。B1 `capture.json` 的 aggregate `renderTriangles` 与 pre-B1 值相同，不宜作为版本证明；版本应结合资产前缀、GLB 时间、近景和具体诊断确认。

## 当前实测快照（唯一维护处）

以下为现存产物；B1 层级、覆盖与碰撞行为行由 WP2（2026-11-12）重新运行，相机与 UI 行由 WP3 重新运行，硬件长跑行由 WP4 补充，其余仍为历史产物。

| 范围 | 当前值 | 原始证据与版本限制 |
| --- | --- | --- |
| B1 Hero/D 轮廓 | 高度比 1.1721；面积比 1.1677；Hero 中心 X=56.54%（1920×1080） | `test-artifacts/integration-abc/2026-11-12T08-22-20Z/wp2/hierarchy/metrics.json`；WP2 复测，达到 Experiment B 数值目标，不是 Integration 人工签核。 |
| B1 构图残余 | Hero 自身面积比 baseline 少 5.5%；礁群顶部位于画面高度约 41.2% | B 报告与同一 metrics；是否加 shelf 或调整空水仍待人工构图决定。 |
| B1 D 表生 | 覆盖 41.28%，43 个实例 | `wp2/collision-debug/capture-results.json`；不是 48 个 CoralScatter 的计数。 |
| B1 Proxy 覆盖 | B 5.20%/0.387 m；C 0.50%/0.118 m；Hero 0.18%/0.234 m；D 13.78%/0.596 m；E 0.91%/0.119 m | `wp2/coverage/proxy-coverage.json`；分别为顶点外露比例/最大外露；与备份的既有 B1 覆盖逐位一致。 |
| B1 碰撞行为与通道 | 63 s ReefProxy 为 0 穿透、0 深穿透、0 假避障、0 卡鱼；D 几何间隙 0.31 m，0 鱼通过；Sphere 假避障保留为高基线（63 s 48615） | `wp2/collision-behavior.json`；`rerunMatches=[true,true]`、两模式 `deterministic=true`，10/10 checksum 与 `test-artifacts/reef-collision/experiment-b.json` 一致。D 是否应通行仍未决定。 |
| School 六点可见率 | post-FSM t17/43/44.15/52/60/63 = 0.8517 / 0.9355 / 0.9254 / 0.9375 / 0.9718 / 0.8528（fit 1.400/1.399/1.400/1.399/1.209/1.400） | `test-artifacts/integration-abc/2026-11-12T14-30-00Z/wp3/camera-regression/camera-regression.json`；t17/t63 约 0.85，已按 D016 接受；上限 1.8 的候选为 0.916/0.982/1.000/0.972/0.976/0.998，未采用。 |
| 相机净空与目标轨迹 | post-FSM：18 次预设切换最大角 0.1848、最大平移 97.324 m/s、最低净空 8.380 m；0–30 s trace 4 次 direct index→index，0–60 s 11 次；总最低净空 1.100 m、0 错误 | 同一 run 的 `wp3/camera-regression/camera-regression.json`、`wp3/target-trace-direct/browser-target-switch.json`、`wp3/target-trace-long-postfsm/browser-target-switch.json`；SwiftShader 软件证据。 |
| 硬件 180 s School 相机 | 586 采样 / 190.0 s；最低净空 1.100 m；最大角变化 0.0296；最低可见率 0.0041（瞬时）；fit 1.000–1.400；0 错误 | `2026-11-12T14-30-00Z/wp4/hardware-180s.json`；Intel Iris Xe D3D11、headed Chrome、1280×720；连续 180 s 含捕食与分裂，非固定六点。 |
| 硬件 30 分钟 Overview 相机 | 798 采样 / 1813.3 s；位置漂移 0 m；姿态漂移约 1.7e-6°；最低可见率 0.9957；0 finite/净空/浏览器错误 | `2026-11-12T14-30-00Z/wp4/hardware-30min.json`、`hardware-30min-analysis.json`、`hardware-30min-power-events.json`；含 02:14 系统息屏造成的 46.5 s 采样空档，不支持“无卡顿”；FPS 与 P95 由 `performance.md` 维护。 |

查询耗时和相机数学基准只在 `performance.md` 记录。复测时先替换本节对应行及原始证据链接，再在 `../CURRENT_STATE.md` 更新状态，不在子系统文档复制这些数字。

## 新统一基线的最低材料

正式运行应输出到 `test-artifacts/integration-abc/<timestamp>/` 或同等独立目录，至少包含下表内容。WP3 已补齐同版三机位、六时间点、Console/响应式、`camera-results.json` 和联系表；WP4 已补真实硬件 180 s/30 分钟运行记录，用户已签核硬件画面/交互；2026-11-12 FSM 后已捕获 4 次 direct index→index。旧 WP0/WP4 数据为 pre-FSM，需在新 run 重验；持续闪烁未 instrument。

| 文件 / 数据 | 必须记录的内容 |
| --- | --- |
| `overview.png`、`school.png`、`predator.png` | 同版 B1+C、同种子、规定时间点、URL、视口、Console、renderer。 |
| Hero/D 与 ReefProxy Debug 对照 | 当前 GLB 前缀、五 ID、Proxy 版本、Sphere/ReefProxy 模式、margin 和近景残差。 |
| School 六时间点与 Predator 轨迹 | visible fraction、fit、留白、垂直追逐、index→index/null、死亡目标和状态切换；当前 FSM 仅 null-mediated，direct 不可达。 |
| Console / Responsive 对照 | 桌面 Console 开/关、窄视口、移动抽屉；模拟 checksum 不因 UI 改变。 |
| `collision-results.json`、`camera-results.json` | 当前 B1 Sphere/ReefProxy、通道、穿透、假避障、卡鱼、双跑 checksum 和轨迹范围。 |
| `results.json`、`summary.md` | 源码/构建/资产 manifest、浏览器、renderer、通过/失败、限制和原始文件索引。 |
| 本机运行记录 | 真实硬件视觉/交互、180 s 相机稳定性和 30 分钟观察；软件图不替代。 |

## 基线更新规则

新运行使用独立目录，不覆盖旧 A/B/C 图片或 JSON。只有矩阵全部通过后才把一组材料标记为稳定基线，并同步 `../CURRENT_STATE.md`、`../ROADMAP.md` 和 `../DEVELOPMENT_ROADMAP.md`。局部视觉迭代则使用新的 before/after 目录，旧基线保持只读。

外部参考图只能用于美术方向，不能进入正式项目验收。任何截图不得通过假遥测、强制生态结果、隐藏默认资产或裁剪关键失败区域来制造通过。
