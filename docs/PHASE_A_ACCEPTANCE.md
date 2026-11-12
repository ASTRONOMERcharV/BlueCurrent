# Phase A 本机验收清单（GLB 礁石）

目的：在真实硬件 GPU 浏览器里确认 `reef_rock_a.glb` 的观感、回退和性能，再决定是否进入 Phase B/C。
沙箱里的 Playwright 使用 SwiftShader，只能证明“能加载、无错误”，不能作为帧率结论。

## 1. 准备

```powershell
cd "C:\Users\86159\Desktop\CA-ComputerAnimation\Project\BlueCurrent"
```

如果 `node_modules` 是之前沙箱留下的符号链接（打不开或指向 `/tmp`），先删除再重装：

```powershell
if (Test-Path .\node_modules) { Remove-Item .\node_modules -Recurse -Force }
npm ci
npm run dev
```

打开终端打印的本地地址，默认是 `http://localhost:5173/`。

## 2. 程序化基线

1. 打开 `http://localhost:5173/`（不带参数）。
2. 保持默认 500 条鱼，等待 10 秒稳定。
3. 记录底部统计面板的 `Frame rate` 与 `Simulation step` 旁的渲染耗时。
4. 截图保存为 `baseline.png`。

## 3. GLB 礁石

1. 打开 `http://localhost:5173/?glbRocks=1`。
2. 在控制台确认：

```js
window.__blueCurrent.getDiagnostics().glbRocks
// 应为 true
```

3. 对比 5 块主礁石的位置是否与基线一致，轮廓是否自然，颜色是否与其他礁石/珊瑚协调。
4. 打开控制台确认没有 404、CORS、GLTF 解析或 WebGL 错误。
5. 记录同样位置的 `Frame rate` 与渲染耗时，截图保存为 `glb-rocks.png`。

## 4. 压力与边界

- 把 `Initial fish count` 调到 2000，分别在 `Uniform grid` 与 `Brute force` 下各跑 10 秒，记录帧率。
- 关闭再打开 `Reef obstacles`，确认礁石没有消失、重复或错位。
- 切换 `Orbit / Follow school / Follow predator`，确认相机不会穿进礁石。

## 5. 通过标准

- `glbRocks` 为 `true`，控制台无错误。
- 5 块主礁石全部替换，位置与基线一致，无黑块、破面、明显悬空。
- 与基线相比，帧率下降在测量噪声范围内；如果有明显下降，记录数值再决定是否优化。
- 任何一项不通过：保持默认 `?glbRocks` 关闭即可回退，把现象和截图发回来。

## 6. 回报内容

- 基线与 GLB 各一张截图（同视角、同鱼数）。
- 500 与 2000 条鱼下的帧率/渲染耗时（注明搜索模式）。
- 控制台错误原文（如果有）。
- 视觉问题：颜色、比例、位置、遮挡、法线/黑面等。
