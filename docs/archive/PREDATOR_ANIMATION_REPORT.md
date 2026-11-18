# Predator 程序化游动动画 — 实施报告

日期：2026-11-09
范围：Blue Current 捕食者（用户 shayu 模型）从静态 GLB + Shader 剪切升级为骨骼 SkinnedMesh + 程序化游动。
配套分析：`docs/archive/PREDATOR_ANIMATION_ANALYSIS.md`。

## 1. 原动画缺陷（实测）

原始 shayu 是 6,570 顶点 / 9,826 三角形的静态网格，没有骨骼、没有蒙皮、没有动画 clip。视觉运动由三部分组成：

1. `group.quaternion` 每帧对齐速度方向，`slerp` 平滑；
2. 顶点 Shader 给 `position.x` 叠加随 `_TAILWEIGHT` 增大的横向位移；
3. 转弯时 Shader 绕头部 `z = 2.45` 旋转整个后段。

问题与根因：

| 现象 | 根因 |
| --- | --- |
| 身体像棍子 | 尾摆是**剪切**不是弯曲：截面不旋转；头部仍保留 35% 摆幅；法线未随尾摆旋转 |
| 尾鳍不摆动 | 尾鳍只是被横向平移，没有绕尾柄的俯仰/摆动自由度；没有尾柄/尾鳍骨骼 |
| 转弯只有整体旋转 | 单一 `turn` 标量绕一个固定支点形成圆弧，没有头先转、身体跟随、尾部滞后；胸鳍不参与 |
| 上下游突兀 | `setFromUnitVectors` 直接把模型 +Z 对齐瞬时速度，没有俯仰速率限制；yaw/pitch/roll 混在一个最短旋转里；水平速度小时不稳定 |

模型几何检查还发现：网格由 **84 个断开壳**组成，身体左右/上下分片；胸鳍部分与下身壳体融合，但可由 `|x| > 0.55` 唯一识别；尾鳍位于 `y ≈ 1.9–2.64`（Blender）。因此权重必须按**世界位置**计算，不能按连通块；否则弯曲时中线会裂开。

## 2. 骨骼与权重

在 `assets_src/blender/predator_shayu_rigged.blend` 中建立：

```
Predator_Root
└─ Spine_00 → Spine_01 → Spine_02 → Spine_03 → Spine_04 → Spine_05
   → Caudal_Peduncle → Tail_Fin
   ├─ Pectoral_L_Root（父级 Spine_02）
   └─ Pectoral_R_Root（父级 Spine_02）
```

- 脊柱 8 根骨骼沿 Blender −Y → +Y（头 → 尾）布置，关节序列 `−2.55 … 2.62`；
- 头部（`y < −1.9`）固定在 `Spine_00`；身体前 34% 振幅为 0；
- 每个顶点按 y 投影到相邻两根骨骼，关节两侧用 0.32 单位 smoothstep 过渡，权重和 1；
- 胸鳍：`finWeight = smoothstep(0.55, 0.72, |x|)`，在胸鳍包围盒内从身体权重转移到 `Pectoral_L/R_Root`，鳍根保持混合，避免撕裂；
- 尾鳍：`y > 2.25` 平滑过渡到 `Tail_Fin`；
- 每顶点 ≤ 3 影响，无未加权顶点（脚本检查 `unweighted = 0`）。

交付 GLB：`public/models/predator_shayu_rigged.glb`（1,753,144 B，9,826 三角形，7,442 accessor 顶点，3 材质，11 joints，无动画）。结构验证 `verify_predator_rig.py` PASS，关键数据：权重和最大误差 0.000000；`Tail_Fin > 0.5` 的 223 个顶点平均 glTF Z = −2.472；胸鳍 L/R 约 298/289 个顶点。

## 3. 行波模型

`PredatorAnimationController` 对每根脊柱骨骼计算相对父骨骼的旋转：

```
theta_i = A(s_i) * sin(phase - k * s_i) + turn_i(s_i)
A(s) = lerp(0.045, 0.10, speedNorm) * smoothstep(0.34, 1, s)^1.15
k = 3.0
```

- `s` 由骨骼在模型中的实际 Z 位置归一化得到（头 0，尾 1）；
- 每帧从 rest pose 重新计算 `q = q_rest * q_delta(axis, theta)`，**不累加**；
- 相位持续累积 `phase += 2π f dt`，状态切换不重置（单元测试覆盖）；
- 尾鳍额外 `±0.38 rad` 摆动，相位滞后 0.55 rad；
- 前部 `s < 0.34` 振幅为 0，因此头部稳定。

## 4. 频率、幅度与攻击

- 频率随速度在 **0.8–1.9 Hz** 之间平滑变化；攻击 +0.55 Hz，推力 +0.25 Hz；
- 频率本身以 2.5/s 平滑，相位用平滑后的频率积分；
- 攻击包络 6/s 上升、6/s 下降，尾鳍摆幅 ×1.3，身体摆幅 ×1.22；
- 实测：巡游 1.11 Hz；冲刺（t=19.7，attack=0.91）1.97 Hz；恢复 1.12 Hz。

## 5. 转向

- 根 yaw 由临界阻尼弹簧 + 4 rad/s 上限控制，头部先转；
- `turn`（6.5/s）与 `tailTurn`（2.6/s）分离，尾部延迟跟随；
- 后段身体按 `smoothstep(0.12, 0.9, s)^1.15` 施加弯曲，`turnBendMax = 0.13 rad/骨骼`；
- 尾鳍额外 `2.2 × tailTurn`；
- 侧倾 `clamp(−yawRate * 0.11 * speedFactor, ±0.34 rad)`，绕模型局部 +Z；
- 实测左转：`turn 0.53 / tailTurn 0.41`，bank −2.93°，yaw 35.3°（t=5.5）；右转镜像：`turn −0.53 / tailTurn −0.41`，bank +2.93°（t=11.5）。

## 6. 俯仰与胸鳍

- 目标俯仰 `atan2(vy, sqrt(vx² + vz²))`；水平速度 < 0.4 时保持上一目标；
- 5.5 rad/s² 临界阻尼弹簧，最大俯仰速率 0.75 rad/s，俯仰上限 ±1.15 rad；
- **符号修正**：Three.js 右手系中绕 +X 的正旋转使 +Z 机头向下，控制器内部以“抬头为正”，因此根四元数使用 `−pitch`。单元测试检查抬头时 root forward 的 Y 分量为正；
- 胸鳍：垂直速度驱动 ±0.18 rad 对称迎角；侧倾叠加 ±0.45·roll 的非对称分量，总角度限制 ±0.28 rad；不是鸟翼式拍打；
- 实测上升（t=14.5）：pitch +14.48°，左/右胸鳍 +4.96°/−4.95°（镜像骨骼，记录角符号相反，但两鳍实际同向抬起）；下潜（t=18.5）：pitch −14.01°，胸鳍 −4.59°/+4.59°（两鳍同向放下）。

## 7. 控制器与数据流

`PredatorSystem` 只提供位置、速度、状态；`PredatorAnimationController` 只写骨骼和根姿态；`PredatorRenderer` 只负责把根四元数写回 `group`。动画层不修改模拟位置、速度或 FSM。

路径选择：

- 默认 `/` → `predator_shayu_rigged.glb`（`predatorRigged: true`）；
- `?predator=shayu` / `?predator=blender` → 静态 shayu（旧 Shader 路径，保留作回退）；
- `?predator=v2` → v2 大白鲨；`?predator=procedural` → 程序化捕食者；
- rigged 路径**不应用** 11.10 的 swim shader，避免位移被蒙皮两次。

## 8. 测试场景

`predator-animation-preview.html`：

- 25 秒脚本化机动：巡游 → 左转 90° → 回正 → 右转 90° → 上升 → 下潜 → 冲刺/攻击 → 恢复；
- Side / Top / Front / Quarter 视图；骨骼开关；时间轴；
- 固定帧 `?t=12.5&view=top&hud=0`，确定性重放到该时刻；
- 调试 API：`getDiagnostics()`、`getBoneSnapshot()`、`setTime()`、`setView()`、`setSkeletonVisible()`。

验收脚本：

| 命令 | 内容 | 结果（沙箱 SwiftShader） |
| --- | --- | --- |
| `npm run smoke:predator-animation -- --phase=a` | 巡游/连续性/左转/右转 | PASS，0 浏览器错误 |
| `npm run smoke:predator-animation -- --phase=b` | 上升/下潜/冲刺/恢复 | PASS，0 浏览器错误 |
| `npm run smoke:predator-animation:main` | 主场景默认 rigged 路径 | PASS，`predatorModel "blender"`、`predatorRigged true`、9,826 三角形、72 draw calls、0 错误 |
| `npm run capture:predator-animation` | 固定帧截图 | 10 帧，见下 |
| `npm run video:predator-animation` | 26 秒连续序列 | `sequence.webm`，800×500 VP9，36.36 s（含加载） |

连续运动检查：同一页面内 `setTime` 重放后，`phase` 从 2.0 s 到 2.35 s 单调增加；`Tail_Fin` 四元数在两次采样间变化（点积 < 0.9999）；状态切换不重置相位。

## 9. 实测数值

| 测试 | 时间 | 速度 | pitch | bank | 频率 | 关键骨骼角 |
| --- | --- | --- | --- | --- | --- | --- |
| 水平巡游 | 2.5 s | 3.0 | 0° | 0° | 1.11 Hz | spine05 1.8°；tail fin 8.6° |
| 左转 | 5.5 s | 3.0 | 0° | −2.93° | 1.12 Hz | turn 0.53 / tailTurn 0.41；tail fin 12.8° |
| 右转 | 11.5 s | 3.0 | 0° | +2.93° | 1.12 Hz | turn −0.53 / tailTurn −0.41；tail fin 4.9° |
| 上升 | 14.5 s | 3.6 | +14.48° | 0° | 1.25 Hz | 胸鳍 +4.96° / −4.95° |
| 下潜 | 18.5 s | 3.6 | −14.01° | 0° | 1.25 Hz | 胸鳍 −4.59° / +4.59° |
| 冲刺/攻击 | 19.7 s | 7.05 | −15.70° | 0° | 1.97 Hz | attack 0.91；tail fin 28.7° |
| 恢复 | 23.5 s | 3.0 | −0.0° | 0° | 1.12 Hz | attack ≈ 0；tail fin −15.8° |

说明：表中“骨骼角”是相对 rest pose 的带符号角度；胸鳍的左右符号因镜像骨架相反，实际两鳍同向；冲刺时仍保留下潜后的俯仰惯性（−15.7°），这是平滑过渡的结果，不是新突变。

## 10. 证据文件

截图（`test-artifacts/predator-animation/`）：

- `01-cruise-side.jpg`、`02-cruise-top.jpg`、`03-cruise-front.jpg`
- `04-left-turn-top.jpg`、`05-right-turn-top.jpg`
- `06-ascend-quarter.jpg`、`07-descend-quarter.jpg`、`08-burst-quarter.jpg`、`09-recover-side.jpg`
- `10-cruise-skeleton.jpg`
- `09-main-scene-rigged.png`（主场景默认 rigged）

其他：

- `results-a.json`、`results-b.json`、`main-results.json`
- `sequence.webm`（26 s 连续机动，800×500 VP9）
- 旧静态 HUD 对照：`05-ascend-side.png`、`06-descend-side.png`、`07-burst-side.png`、`08-recover-side.png`

## 11. 回归与验证

在沙箱（Linux + SwiftShader）通过：

- `verify_predator_rig.py`：PASS（11 joints、权重和、尾端权重、胸鳍、9,826 三角形、长度 5.2800、无动画）；
- `vitest run tests/PredatorAnimation.test.ts tests/PredatorAnimationController.test.ts`：18/18；
- 全套 Vitest `vitest run --isolate=false --maxWorkers=2`：**24 文件 / 167 测试 PASS**（默认并行模式在慢速沙箱中曾出现一次 `SimulationWorld` 计时抖动，单独运行该文件 7/7 通过）；
- `vite build`（输出 `dist/`）：PASS，包含 `predator-animation-preview.html`；
- 完整 `tsc --noEmit`：PASS；
- `smoke:predator-animation`（a/b）、`smoke:predator-animation:main`：PASS，0 浏览器错误；
- 静态 shayu 回归 `STAGE=preview npm run smoke:predator:shayu`：PASS（9,826 三角形、3 材质、长度 5.28、`_TAILWEIGHT`、0 浏览器错误）。完整 `smoke:predator` 的多页面截图链在 SwiftShader 下超出沙箱单命令时限，建议在硬件机补跑。

## 12. 限制与后续

1. **P0/P1 已完成，P2 未完成**：下颌仍未绑定（shayu 源模型是静态张口，上下牙/口腔没有干净的下颚分割）；胸鳍是刚性鳍面骨骼，没有鳍条弯曲；没有攻击时的口部动画。
2. 骨骼动画只影响表现，不影响 `PredatorSystem` 的转向、避障、捕获判定。
3. 硬件 GPU 的 FPS/P95/GPU 时间仍需在 Windows 主机运行 `npm run accept:gpu`；SwiftShader 的 10–44 fps 不是性能数据。
4. 建议下一轮先在本机交互观察 `predator-animation-preview.html` 的连续序列，再决定是否：
   - 增大 `turnBendMax`（当前 0.13 rad/骨骼）以强化转弯弧线；
   - 为胸鳍增加第二段鳍条骨骼；
   - 为下颚建立独立骨骼（需要先在 Blender 中分割下颚与下牙）。
