# Phase R 本机验收清单（岩石与海底地形 GLB 集）

目的：在真实硬件 GPU 浏览器里确认 `?glbRocks=2` 的观感、回退与性能，再决定是否把岩石集设为默认。沙箱里的 Playwright 使用 SwiftShader，只能证明“能加载、无错误”，不能作为帧率结论。

## 1. 准备

```powershell
cd "C:\Users\86159\Desktop\CA-ComputerAnimation\Project\BlueCurrent"
if (Test-Path .\node_modules) { Remove-Item .\node_modules -Recurse -Force }
npm ci
npm run dev
```

打开终端打印的地址（默认 `http://localhost:5173/`）。

## 2. 程序化基线

1. 打开 `http://localhost:5173/?fishCount=500`（不带 `glbRocks`）。
2. 等待 10 秒稳定，记录 `Frame rate`、`Simulation step`、`drawCalls`（控制台 `__blueCurrent.getDiagnostics()`）。
3. 截图保存为 `rocks-baseline.png`。

## 3. GLB 岩石集

1. 打开 `http://localhost:5173/?glbRocks=2&fishCount=500`。
2. 控制台确认：

```js
window.__blueCurrent.getDiagnostics().glbRockMode      // "set"
window.__blueCurrent.getDiagnostics().glbRockInstances // {large:5, medium:16, debris:33, dune:5}
window.__blueCurrent.getDiagnostics().glbRockTriangles // 7869
```

3. 检查：
   - 5 块主礁石换成 3 种轮廓（叠石、尖塔簇、宽礁台），位置与原来的 5 个碰撞球一致；
   - 16 个中型岩石、33 个碎石、5 个沙丘没有明显悬空、相互穿插或埋没；
   - 沙丘至少 3 个位于开阔沙地，边缘自然，不呈矩形；
   - 颜色与水体、鱼群、珊瑚协调；近景法线/AO 不出现黑白斑块；
   - 控制台 0 个 404、CORS、GLTF 解析或 WebGL 错误。
4. 截图保存为 `rocks-glb.png`。

## 4. 边界与交互

- 关闭再打开 `Reef obstacles`：大型/中型/碎石应一起隐藏/显示，沙丘保持可见。
- 切换 `Orbit / Follow school / Follow predator`，确认相机不会穿进大型礁石。
- 把鱼数调到 2000，Uniform grid / Brute force 各跑 10 秒，记录帧率与 draw calls。
- 直接访问 `?glbRocks=1`，确认旧的单一 `reef_rock_a.glb` 试验仍可用（`glbRockMode: "legacy"`）。
- 断网或重命名 `public/models/rocks/reef_large_a.glb`，刷新 `?glbRocks=2`：应回退程序化礁石、控制台有 warning，页面不白屏；恢复文件。

## 5. 通过标准

- `glbRockMode = "set"`，实例数 5 / 16 / 33 / 5，三角形 7,869，0 浏览器错误。
- 5 块大型礁石位置与碰撞体一致；无明显悬空、穿插、黑面或比例失衡。
- 与基线相比帧率下降在测量噪声范围内；若明显下降，记录数值与 draw calls 再决定优化（优先做 LOD 或减少碎石数量）。
- 任何一项不通过：保持默认关闭 `?glbRocks=2` 即可回退，把现象、截图和诊断 JSON 发回来。

## 6. 回报内容

- 基线与 GLB 各一张同视角截图。
- 500 / 2000 条鱼下的帧率、P95（若 GPU harness 可用）、draw calls、搜索模式。
- 控制台错误原文（如果有）。
- 视觉问题：位置、比例、悬空、穿插、法线/AO 黑斑、颜色协调。
- 硬件信息：GPU 型号、浏览器版本。

## 7. 已知非目标

- 沙丘与碎石不参与模拟碰撞；只有 5 个大型礁石对应碰撞球。
- 本阶段无 LOD、无地形高度碰撞；极端低角度可能看到沙丘开放壳边。
- 2048 图集约 67 MB 显存是既定成本；近景特写不是本阶段目标。
