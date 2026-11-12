# Phase C 本机验收清单（海藻 GLB 集）

目的：在真实硬件 GPU 浏览器里确认 `?kelp=1` 的观感、摆动和三株之间的相位差异，并记录性能。沙箱里的 Playwright 使用 SwiftShader，只能证明“能加载、Shader 生效、无错误”，不能作为帧率结论。

## 1. 准备

```powershell
cd "C:\Users\86159\Desktop\CA-ComputerAnimation\Project\BlueCurrent"
if (Test-Path .\node_modules) { Remove-Item .\node_modules -Recurse -Force }
npm ci
npm run dev
```

打开终端打印的地址（默认 `http://localhost:5173/`）。

## 2. 程序化基线

1. 打开 `http://localhost:5173/?fishCount=500`（不带 `kelp`）。
2. 等待 10 秒稳定，记录 `Frame rate`、`Simulation step`、`drawCalls`（控制台 `__blueCurrent.getDiagnostics()`）。
3. 截图保存为 `kelp-baseline.png`。

## 3. GLB 海藻

1. 打开 `http://localhost:5173/?kelp=1&fishCount=500`。
2. 控制台确认：

```js
const d = window.__blueCurrent.getDiagnostics();
d.kelpModel        // "blender"
d.kelpInstances    // {kelp_a: 26, kelp_b: 23}
d.kelpTriangles    // 8648
d.drawCalls        // 约 82（500 条程序化鱼 + GLB 捕食者）
```

3. 检查：
   - 5 个礁石核心周围有成丛海藻，开阔沙地也有散布；没有悬空、穿进礁石或明显浮在沙面上的株；
   - 海藻基部贴地，颜色与水体、鱼群、珊瑚协调；
   - 每株都在缓慢摆动；相邻两株的相位不同，不会像统一旋转的模型；
   - 同一株内不同叶片也有轻微相位差（`_BLADEPHASE`），叶尖位移最大、基部不动；
   - 摆动幅度不穿帮：叶尖最大位移约 0.3–0.5 m，无高频抖动或突然跳变；
   - 控制台 0 个 404、CORS、GLTF 解析或 WebGL 错误。
4. 截图保存为 `kelp-glb.png`；录一段 5–10 秒屏幕视频，便于判断运动。

## 4. 组合与边界

- 打开 `?kelp=1&glbRocks=2`，确认海藻与完整岩石/沙丘集同时存在，海藻不穿插大型礁石，沙丘边缘自然。
- 切换 `Orbit / Follow school / Follow predator`，确认相机不会穿进海藻丛；海藻不遮挡鱼群主视角。
- 把鱼数调到 2000，Uniform grid / Brute force 各跑 10 秒，记录帧率与 draw calls。
- 断网或重命名 `public/models/kelp_a.glb`，刷新 `?kelp=1`：应保留无海藻场景、控制台有 warning、页面不白屏；恢复文件。
- 打开 `http://localhost:5173/kelp-preview.html`，确认两株资产独立预览、HUD 显示 2 资产 / 15 实例 / 3 draw calls，摆动时间持续推进。

## 5. 通过标准

- `kelpModel = "blender"`，实例数 26 + 23，海藻三角形 8,648，0 浏览器错误。
- 海藻基部贴地、无明显穿插/悬空；摆动自然、个体相位不同；近景可接受低模段数。
- 与基线相比帧率下降在测量噪声范围内；若明显下降，记录数值与 draw calls 再决定优化（优先 LOD 或减少实例数）。
- 任何一项不通过：保持默认关闭 `?kelp=1` 即可回退，把现象、截图和诊断 JSON 发回来。

## 6. 回报内容

- 基线与 GLB 各一张同视角截图，外加一段 5–10 秒摆动视频。
- 500 / 2000 条鱼下的帧率、P95（若 GPU harness 可用）、draw calls、搜索模式。
- 控制台错误原文（如果有）。
- 视觉问题：位置、比例、悬空、穿插、摆动幅度/频率、颜色协调、低模段数。
- 硬件信息：GPU 型号、浏览器版本。

## 7. 已知非目标

- 海藻不参与模拟碰撞，也不影响鱼群避障。
- 无 LOD、无半透明/次表面散射/焦散；叶缘是几何波动与 V 形缺口，不是 alpha 贴图镂空。
- 近景会看到 `kelp_a` 填充叶的两列平面结构；这是 200 三角形预算下的取舍。
