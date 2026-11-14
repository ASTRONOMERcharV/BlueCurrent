# Validation — Visual Baseline

> 最后核实：2026-11-14。A/B/C Integration Gate 已通过（带限制），Phase D 第一轮（D1+D4）与第二轮（D2+D3）均已建立同版 Base/Final 固定机位对照并完成硬件签核；Phase E 第一轮（E1+E3）与第二轮（E2+E4）也已完成软件同版对照与硬件签核。后续轮次若继续调整，仍需独立评审。本文件是截图版本、轮廓、碰撞覆盖、相机、鱼群结构与 Phase D/E 画面实测的唯一维护处；性能数字在 `performance.md`。

## 基线状态

当前可用材料包括 WP3 同版三机位/六时间点/UI、WP2 当前 B1 Overview/近景与 ReefProxy Debug、WP4 硬件 180 s/30 分钟运行记录、Phase D 第一轮与第二轮的 Base/Final 固定机位对照、Phase E 第一轮 E1/E3 与第二轮 E2/E4 对照，以及旧 Experiment A Proxy Debug。WP3 已形成一套同版软件证据，WP4 已补真实 Intel Iris Xe 画面与长时稳定性，用户已签核硬件画面/交互；Gate 已通过（带限制，2026-11-13），`reef-camera-integration-v1` 标签已在收尾提交建立。Phase D 第一轮完成 D4 全局光照与 D1 水体（D023）；第二轮完成 D2 海床程序化材质与 D3 海草受流摆动/成簇分布，软件对照与硬件签核见 `test-artifacts/phase-d/2026-11-13t12-16-00z/`。Phase E 第二轮完成 E2 鱼群结构与 E4 栖息/沙尘（D026），证据见 `test-artifacts/phase-e/2026-11-14t08-31-46z/`。D2 的碎石/附着细节未做，是否继续由后续轮次决定，因此**视觉基线仍按轮次增量维护，不合并为单一稳定版本**。

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
| Phase D D4/D1 对照（软件） | `test-artifacts/phase-d/2026-11-13t10-45-43z/review-d4-final.png`、`review-d4-base.png`、`review-d1-final.png`、`review-cumulative-final.png` | encounter t=17 s、1440×900、SwiftShader；D4 前后与 D1 增量的 10 机位 base/fog/final 对照。 | 软件画面；鱼/鲨鱼位置有截帧插值差；不是硬件或性能证据。 |
| Phase D 硬件签核 | `test-artifacts/phase-d/2026-11-13t10-45-43z/hardware/`（30 张 PNG + JSON）、`review-hardware-final.png`、`review-hardware-base.png` | headed Chrome 真实 Intel Iris Xe D3D11（`rendererInfo` 逐模式记录），10 机位 × 3 模式，0 错误；用户于 2026-11-13 签核通过，见 `human-signoff.md`。 | 视觉签核，无 GPU timestamp；不覆盖持续闪烁与长时运行。 |
| Phase D D2/D3 对照（软件） | `test-artifacts/phase-d/2026-11-13t12-16-00z/review-d2d3-final.png`、`review-d2d3-base.png`、`review-d2d3-crop.png`、`review-d3-sway.png`、`motion-t17/`、`motion-t17p5/` | D1+D4 → D2+D3 的 10 机位 base/fog/final 对照；海床原生像素裁切；reef-0 t=17.0/17.5 s 摆动两帧。 | SwiftShader；鱼/鲨鱼位置有截帧插值差；不是硬件或性能证据。 |
| Phase D R2 硬件签核 | `phase-d/2026-11-13t12-16-00z/hardware/`（30 张 PNG + JSON）、`review-hardware-final.png`、`review-hardware-base.png` | headed Chrome 真实 Intel Iris Xe D3D11，10 机位 × 3 模式，0 错误；用户于 2026-11-13 签核通过，见同 run `human-signoff.md`。 | 视觉签核，无 GPU timestamp；海草 +110k 三角形未做帧时间评估。 |
| FSM direct retarget 浏览器 | `test-artifacts/fsm-retarget/2026-11-12T14-05-00Z/browser/browser-target-switch.json` | 0–30 s 捕获 4 次 direct index→index（5.08/12.42/12.78/30.38 s），0 浏览器错误，`passed=true`。 | Vite dev server + SwiftShader；post-FSM WP3/WP4 已在 `2026-11-12T14-30-00Z` 重跑。 |
| 旧 A Proxy Overview / D gap | `test-artifacts/reef-collision/debug-overview.png`、`debug-twin-gap.png` | 旧 A Proxy 与 margin 的 Laboratory 诊断。 | 300 鱼，0.267 s，旧图元；当前 B1 D 已是 10 圆角盒。 |

图片快捷链接见 `../visual/reference-images/README.md`。B1 `capture.json` 的 aggregate `renderTriangles` 与 pre-B1 值相同，不宜作为版本证明；版本应结合资产前缀、GLB 时间、近景和具体诊断确认。

## 当前实测快照（唯一维护处）

以下为现存产物；B1 层级、覆盖与碰撞行为行由 WP2（2026-11-12）重新运行，相机与 UI 行由 WP3 重新运行，硬件长跑行由 WP4 补充，Phase D 两轮行来自 2026-11-13 的 `phase-d/2026-11-13t10-45-43z/` 与 `phase-d/2026-11-13t12-16-00z/`，Phase E 第一轮行来自 `phase-e/2026-11-14t00-13-00z/`，第二轮行来自 `phase-e/2026-11-14t08-31-46z/`，其余仍为历史产物。

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
| Phase D D4 光照 | final 礁石 P50：reef-0 27.9→31.1、reef-1 30.5→33.8、reef-2 22.9→26.1、reef-3 24.0→27.3、overview 44.4→46.0、reef-4 43.6→45.2、school 61.4→63.9；base 俯视海床 56.9→68.8；水面 patch ≤0.23（多数 0.00）；色相 ≤0.91°；裁剪 0.000% | `phase-d/2026-11-13t10-45-43z/metrics-after-d4-r3.json`、`compare-d4-r3.json`；SwiftShader，1440×900，encounter t=17 s；岩石在宽景中提升 3.5–4.0%，近景 10.8–14.0%。 |
| Phase D D1 水体 | 岩石对比度 +0.72…+3.58%；frame P1 −3.79…+0.06；水面 patch ≤0.07；色相 ≤0.24°；裁剪 0.000%；`lighting=base` 像素差仅 0.03–2.42% 且集中于运动物体边缘 | `phase-d/2026-11-13t10-45-43z/metrics-after-d1-r2.json`、`compare-d1-r2.json`；同一 run 的 base/fog/final 对照；不是性能证据。 |
| Phase D 硬件一致性 | Intel Iris Xe D3D11 headed Chrome；硬件 vs 软件同机位 frame P50 最大差 0.52/255、色相 ≤0.24°、岩石 P50 差 ≤0.28、裁剪差 0.000%；checksum `535bf8835258bcf1b2e9e696` | `phase-d/2026-11-13t10-45-43z/metrics-hardware.json`、`hardware/hardware-*.json`；视觉签核见同 run `human-signoff.md`。 |
| Phase D D2 海床 | 海床亮度分布（frame P95−P5）：base overview +4.8、reef-0 +7.9、top +3.6；final overview +6.9、reef-0 +8.3、top +2.1；frame P50 最大漂移 1.77/255；裁剪 0.000%；俯视海床色相约 −4.5° | `phase-d/2026-11-13t12-16-00z/metrics-after-d2d3.json`、`compare-d2d3.json`；SwiftShader，1440×900，encounter t=17 s。 |
| Phase D D3 海草 | 14 株 / 6 簇；海草与海带共用 `OceanCurrentField` 方向+速度；t=17.0/17.5 s 叶片姿态变化、根部固定；三角形 1,263,679→1,374,015（+110,336），draw calls 不变 | `phase-d/2026-11-13t12-16-00z/motion-t17*/`、`metrics-after-d2d3.json`、`metrics.json`；不是性能证据。 |
| Phase D R2 硬件一致性 | Intel Iris Xe D3D11 headed Chrome；硬件 vs 软件 frame P50 最大差 0.46/255、色相 ≤0.14°；checksum `535bf8835258bcf1b2e9e696` | `phase-d/2026-11-13t12-16-00z/metrics-hardware.json`、`hardware/hardware-*.json`；视觉签核见同 run `human-signoff.md`。 |
| Phase E E1 鱼体运动（软件同版对照） | `test-artifacts/phase-e/2026-11-14t00-13-00z/review-e1-focus.png`、`review-e1-context.png`、`metrics-e1.json`、`motion-smooth-r4/`、`motion-legacy-r4/` | SwiftShader 960×540，encounter seed 2658255070，4 时刻 × 3 机位共 12 对；checksum/相机/三角形逐对一致；smooth max\|pitch\| 0.900 vs legacy 1.408–1.517，max\|turn\| 0.259–0.264 vs 0。 | 软件画面对照；鲨鱼动画相位受暂停前历史影响，近景机位避开鲨鱼主体；不是硬件或性能证据。 |
| Phase E E3 捕食事件与 UI（软件） | `predation-r3/`、`predation-ui-r2/`、`review-e3-events.png`、`review-e3-ui.png`、`metrics-e3.json` | 70 s 时间线 111 事件、5 次真实捕获（13.72/33.68/39.13/42.55/63.47 s，#443/#51/#340/#213/#319），`values.captures` 1–5 与 final `captures=5` 一致；UI 单行桌面可见、390×844 隐藏。 | 0.1 s 轮询，短于该粒度的状态可能被压缩；canvas 取帧不含 DOM；SwiftShader。 |
| Phase E 慢动作片段 | `phase-e/2026-11-14t00-13-00z/video/fish-motion-smooth.webm`、`review-e1-video-frames.png` | 250 帧逐帧 canvas 回读，774×352、25 fps、10.0 s；仿真 16.50→20.67 s（约 0.42× 实时）。 | 逐帧慢动作，不是实时录屏；SwiftShader；实时录屏失败物在 `video/failed-realtime-attempt/`。 |
| Phase E 硬件签核 | `phase-e/2026-11-14t00-13-00z/hardware/`（E1 12 对 + E3/E3-UI 截图与 JSON）、`hardware/review-e1-focus.png`、`review-e1-context.png`、`review-e3-events.png`、`review-e3-ui.png` | headed Chrome 真实 Intel Iris Xe D3D11，1440×900；E1 12 对 checksum/相机/三角形一致（`535bf883…`）；E3 108 事件、5 次捕获与 `captures=5` 一致、0 错误；用户 2026-11-14 签核通过，见同 run `human-signoff.md`。 | 视觉签核；硬件与软件 E3 事件数 108 vs 111、捕获时刻差 ≤0.09 s；无 GPU timestamp，不覆盖帧率、闪烁与长时运行。 |
| Phase E R2 E2 结构 A/B | 70 s：dynamic split 8 / merge 11 / emerged 3 / dissolved 2，最终 schools 2 / median 43 / largest 443；legacy 12/12/2/3，median 55 / largest 438；五时间点 checksum 全不同、相机一致 | `phase-e/2026-11-14t08-31-46z/e2/metrics-e2.json`、`metrics-e2-hardware.json`；SwiftShader 与 Intel Iris Xe 结果逐项一致；结构每 30 步更新。 |
| Phase E R2 E4 栖息 | calm 17/43/52 s：质心距 3.668/3.558/3.598 m，spread 1.557/1.308/1.732 m；legacy 无锚点；checksum 仅小丑鱼段变化；900 步测试距离 ≤4.5 m、速度 >0.4 m/s | `phase-e/2026-11-14t08-31-46z/e4/metrics-e4.json`、`metrics-e4-hardware.json`、`tests/AnemoneHabitat.test.ts`；SwiftShader/硬件一致。 |
| Phase E R2 E4 沙尘 | 63 s 151 粒（on）vs 0（off）、66 s 29 vs 0；on/off checksum 完全相同；单 Points draw（同机位 71 vs 70 draw calls）、320 池、8 m 影响高度 | 同 run `metrics-e4.json`、`drawcalls.json`、`tests/SedimentField.test.ts`；沙尘机位部分被海草遮挡，画面仍可见。 |
| Phase E R2 E2 碰撞 | Sphere/ReefProxy 五时间点：ReefProxy 0 穿入、最小净空 0.280 m；Sphere 17 s 单次 −0.018 m 瞬态（旧基线同类 −0.062 m）；D 双柱 0.311 m/0 鱼通过 | 同 run `e2/collision-behavior-e2.json`；与 pre-E2 `test-artifacts/reef-collision/experiment-b.json` 同类瞬态对比，不是逐位回归。 |
| Phase E R2 硬件一致性 | Intel Iris Xe D3D11 headed Chrome 1440×900；E2 事件数/结构/checksum 与软件逐项一致；E4 距离/spread/粒子数/checksum 与软件一致；UI school 行桌面可见、390×844 隐藏 | 同 run `hardware/metrics`、`hardware/e2-ui/e2-ui-capture.json`；用户 2026-11-14 签核通过（`human-signoff.md`）。 |
| Phase E R2 E2 对照（软件） | `phase-e/2026-11-14t08-31-46z/e2/e2-fixed-pairs.png`、`e2-events-dynamic.png`、`e2-events-legacy.png`、`capture-dynamic/`、`capture-legacy/` | 固定机位 `[16,14,16]→[0,8,0]`、1440×900、encounter seed 2658255070；dynamic/legacy 各 16 事件帧 + 5 固定帧；五时间点相机一致、checksum 不同。 | SwiftShader；结构事件粒度为 30 步；不是硬件或性能证据。 |
| Phase E R2 E4 对照（软件） | `phase-e/2026-11-14t08-31-46z/e4/habitat-pairs.png`、`sediment-pairs.png`、`capture-habitat-*/`、`capture-sediment-*/` | habitat=anemone/legacy 三时间点、sediment=on/off 两时间点；同机位、同 seed；habitat 距离 3.56–3.67 m，sediment 63 s 151 粒 vs 0。 | SwiftShader；沙尘机位部分被海草遮挡；不是性能证据。 |
| Phase E R2 硬件签核 | `phase-e/2026-11-14t08-31-46z/hardware/`（E2 两模式、E4 四组、E2 UI 4 状态与 JSON）、`review-phase-e-r2-hardware.png`、`e2-fixed-pairs-hardware.png` | headed Chrome 真实 Intel Iris Xe D3D11，1440×900；E2 事件数/checksum 与软件逐项一致；E4 habitat/sediment 指标与软件一致、0 错误；用户 2026-11-14 签核通过，见同 run `human-signoff.md`。 | 视觉签核；无 GPU timestamp；不覆盖帧率、闪烁与长时运行。 |

查询耗时和相机数学基准只在 `performance.md` 记录。复测时先替换本节对应行及原始证据链接，再在 `../CURRENT_STATE.md` 更新状态，不在子系统文档复制这些数字。

## 新统一基线的最低材料

正式运行应输出到 `test-artifacts/integration-abc/<timestamp>/` 或同等独立目录，至少包含下表内容。WP3 已补齐同版三机位、六时间点、Console/响应式、`camera-results.json` 和联系表；WP4 已补真实硬件 180 s/30 分钟运行记录，用户已签核硬件画面/交互；2026-11-12 FSM 后已捕获 4 次 direct index→index；WP1–WP4 已在 post-FSM 锁 `2026-11-12T14-30-00Z` 重跑完成，Phase D 两轮 Base/Final 对照与硬件签核也已归档（`phase-d/2026-11-13t10-45-43z/`、`phase-d/2026-11-13t12-16-00z/`）。持续闪烁未 instrument。

| 文件 / 数据 | 必须记录的内容 |
| --- | --- |
| `overview.png`、`school.png`、`predator.png` | 同版 B1+C、同种子、规定时间点、URL、视口、Console、renderer。 |
| Hero/D 与 ReefProxy Debug 对照 | 当前 GLB 前缀、五 ID、Proxy 版本、Sphere/ReefProxy 模式、margin 和近景残差。 |
| School 六时间点与 Predator 轨迹 | visible fraction、fit、留白、垂直追逐、index→index/null、死亡目标和状态切换；direct index→index 已由 D015 实现，浏览器 0–30 s 4 次、0–60 s 11 次。 |
| Console / Responsive 对照 | 桌面 Console 开/关、窄视口、移动抽屉；模拟 checksum 不因 UI 改变。 |
| `collision-results.json`、`camera-results.json` | 当前 B1 Sphere/ReefProxy、通道、穿透、假避障、卡鱼、双跑 checksum 和轨迹范围。 |
| `results.json`、`summary.md` | 源码/构建/资产 manifest、浏览器、renderer、通过/失败、限制和原始文件索引。 |
| 本机运行记录 | 真实硬件视觉/交互、180 s 相机稳定性和 30 分钟观察；软件图不替代。 |

## 基线更新规则

新运行使用独立目录，不覆盖旧 A/B/C 图片或 JSON。只有矩阵全部通过后才把一组材料标记为稳定基线，并同步 `../CURRENT_STATE.md`、`../ROADMAP.md` 和 `../DEVELOPMENT_ROADMAP.md`。局部视觉迭代则使用新的 before/after 目录，旧基线保持只读。

外部参考图只能用于美术方向，不能进入正式项目验收。任何截图不得通过假遥测、强制生态结果、隐藏默认资产或裁剪关键失败区域来制造通过。
