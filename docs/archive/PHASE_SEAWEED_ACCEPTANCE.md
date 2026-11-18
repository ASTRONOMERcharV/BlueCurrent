# Phase Seaweed 本机验收清单（细节海菜 GLB）

目的：在真实硬件 GPU 浏览器里确认 `?seaweed=1` 的贴图观感、叶片摆动和与完整环境的空间关系，并决定是否把它加入默认环境层。沙箱 Playwright 使用 SwiftShader，只能证明“能加载、无错误、Shader 生效”，不能作为帧率结论。

## 1. 准备

```powershell
cd "C:\Users\86159\Desktop\CA-ComputerAnimation\Project\BlueCurrent"
if (Test-Path .\node_modules) { Remove-Item .\node_modules -Recurse -Force }
npm ci
npm run dev
```

打开终端打印的地址（默认 `http://localhost:5173/`）。

## 2. 程序化基线

1. 打开 `http://localhost:5173/?fishCount=500`（完整默认环境，不带 `seaweed`）。
2. 等待 10 秒稳定，记录 `Frame rate`、`Simulation step`、`drawCalls`（控制台 `__blueCurrent.getDiagnostics()`）。
3. 截图保存为 `seaweed-baseline.png`。

## 3. 细节海菜层

1. 打开 `http://localhost:5173/?seaweed=1&fishCount=500`。
2. 控制台确认：

```js
const d = window.__blueCurrent.getDiagnostics();
d.seaweedModel      // "blender"
d.seaweedInstances  // 6
d.seaweedTriangles  // 82752
d.drawCalls         // 比基线约 +1
```

3. 检查：
   - 6 株海菜：3 株在前三个礁石核心的相机朝向侧，3 株在开阔沙地；岩石底座贴地，没有明显悬空或穿进礁石；
   - 贴图颜色与水体、珊瑚、低模海藻协调；BaseColor / Normal / Roughness 三张贴图都生效，没有紫色/黑块；
   - 每株叶片缓慢摆动，叶尖位移最大；岩石底座、根须、海星完全静止；
   - 同一株内不同叶片相位不同，相邻两株也不同步；
   - 没有叶片被拉断、穿插到岩石内部或突然跳变；
   - 控制台 0 个 404、CORS、GLTF 解析、纹理或 WebGL 错误。
4. 截图保存为 `seaweed-glb.png`；录一段 5–10 秒屏幕视频，便于判断叶片摆动。

## 4. 独立预览与组合

- 打开 `http://localhost:5173/seaweed-preview.html`：确认 1 资产 / 5 实例 / 3 maps / 2 draw calls（海床 + 海菜），摆动时间持续推进；拖拽轨道观察近景。
- 打开 `http://localhost:5173/?seaweed=1&environment=bare&fishCount=100` 隔离检查海菜本身。
- 打开 `http://localhost:5173/?seaweed=1&glbRocks=2&fishCount=500` 检查与完整岩石/沙丘组合。
- 打开 `http://localhost:5173/?seaweed=1&coral=full` 检查与 48 珊瑚、91 低模海藻的组合；默认 `?seaweed=1` 使用 12 株温带珊瑚。确认没有大面积重叠或遮挡鱼群主视角。

## 5. 性能

- 记录 500 / 1000 / 2000 条鱼下 `?seaweed=1` 与基线的 FPS、P95、draw calls、渲染三角形。
- 细节海菜固定成本：6 实例、82,752 海藻三角形、1 个 instanced draw call、3 × 2048² 贴图。
- 若 500 条鱼帧率下降超出测量噪声，先尝试减少到 4 株或把贴图降到 1024²，再决定是否默认启用。
- 1000 / 2000 条鱼的 CPU 模拟瓶颈已存在，不要把这段差异归因于海菜渲染。

## 6. 通过标准

- `seaweedModel = "blender"`，实例 6，海菜三角形 82,752，0 浏览器错误。
- 岩石底座贴地且静止；叶片从各自基部摆动，相位不同；贴图正确；无明显穿插。
- 500 条鱼下帧率下降在测量噪声内，或记录到可解释的 draw call/三角形增量。
- 任何一项不通过：保持默认关闭 `?seaweed=1` 即可回退；把现象、截图、视频和诊断 JSON 发回来。

## 7. 回报内容

- 基线与 GLB 各一张同视角截图，外加 5–10 秒摆动视频。
- 500 / 1000 / 2000 条鱼下的 FPS、P95（若 GPU harness 可用）、draw calls、渲染三角形。
- 控制台错误原文（如果有）。
- 视觉问题：颜色、贴图、底座、穿插、摆动幅度/频率、叶片断裂、与低模海藻的风格差异。
- 硬件信息：GPU 型号、浏览器版本。

## 8. 已知非目标

- 细节海菜不参与模拟碰撞，也不影响鱼群避障。
- 模型自带岩石底座、海星与根须；实例化会重复这些装饰，这是有意的“完整小景”设计。
- 无 LOD、无半透明/次表面散射、无焦散；摆动不重算法线。
- 13,792 三角形与 3 × 2048² 贴图是英雄资产成本，不适合直接扩大到几十株；扩容前需要减面或 LOD。
