# 双鱼群与小丑鱼资产验收（2026-11-10）

## 目标

- 主鱼群默认使用 Blender `fish_school.glb`，`?fish=procedural` 仅作回退。
- 新增第二个独立鱼群：100 条小丑鱼，默认使用 Blender `clownfish_school.glb`，0.50–0.60 m，围绕第一礁石上方的海葵区活动。
- 主鱼群世界长度由 1.18–1.51 m 调整为 0.90–1.10 m，两种鱼比例约 1.9:1，避免小丑鱼看起来像漂浮的橙色斑点。
- 海底世界默认使用最丰富配置：48 株完整珊瑚、91 株低模海藻、6 处细节海菜、完整 13 资产岩石/沙丘集、完整水下光照。

## 资产处理

源文件 `assets_src/external/clownfish/clownfish-light.glb` 与用户 2026-11-10 上传版本 SHA-256 一致（`bb5de0dc…036fed6`，8,022,744 B）。源模型 148,146 顶点 / 258,813 三角形、1 个双面材质、2 张 1024² JPEG，无骨骼/动画。

处理脚本 `assets_src/scripts/build_clownfish_school.py`：

1. 导入并应用变换；
2. **先焊接顶点**：`remove_doubles(dist=1e-5)`，148,146 → 129,514 顶点，406 个网格岛合并为 1 个连续壳体。直接减面会逐岛塌缩，产生用户看到的“断断续续/不连续”破碎面；
3. 居中并归一化长度到 1.000；
4. Decimate Collapse 到 2,399 三角形；
5. 写入 `_TAILWEIGHT`（头 0 → 尾 1）；
6. 双面材质、Metallic 0、Roughness 0.42；保存 `.blend` 并导出 GLB。

交付 `public/models/clownfish_school.glb`：360,120 B、1,269 顶点、2,399 三角形、1 材质、2 贴图、长度 1.0010、1 个连通壳体、`POSITION/NORMAL/TANGENT/TEXCOORD_0/_TAILWEIGHT`、无动画/骨骼。

## 运行时

- `CLOWNFISH_CONTRACT`：1,600–5,000 三角形、长度 1.0 ±5%、最多 1 材质；由 `loadFishAsset` 校验。
- `FishRenderer` 新选项：0.50–0.60 m、`tintMode: 'texture'` 保留橙白条纹、较低 rim/alert、较快尾摆；主鱼群默认缩放同步降到 0.55–0.67（0.90–1.10 m）。
- `SimulationWorld`：独立 `clownfishFlock` / `clownfishBoids` / `clownfishConfig`；100 条；分离 0.55 m、对齐 1.6 m、聚合 2.2 m；巡航 0.8–2.6 m/s；软 home 锚点 `(−2.0, 5.2, −3.0)`，半径 4.2 m。
- 捕食者对两群都产生恐惧响应；捕获仍只作用于主鱼群。
- `?clownfish=0` 关闭，`?clownfish=N` 调整（0–400）；资产失败时第二鱼群关闭。
- Ecology 面板新增 Clownfish school 滑杆与存活数；顶部 Fish population 显示两群总数。

## 默认配置

| 层 | 默认 | 回退参数 |
| --- | --- | --- |
| 主鱼群 | `fish_school.glb` 500 条 | `?fish=procedural` |
| 小丑鱼群 | `clownfish_school.glb` 100 条 | `?clownfish=0` |
| 珊瑚 | 48 株 / 6 物种 / 121,728 三角形 | `?coral=temperate`、`?coral=0` |
| 海藻 | 91 株 / 16,104 三角形 | `?kelp=0` |
| 细节海菜 | 6 株 / 82,752 三角形 | `?seaweed=0` |
| 岩石 | 13 资产 / 59 实例 / 7,869 三角形 | `?glbRocks=0` |
| 光照 | full（焦散、光束、体积散射、海雪） | `?lighting=base` |

## 验证

- `python3 assets_src/scripts/verify_clownfish_glb.py`：PASS。
- `tests/ClownfishSchool.test.ts`：4/4；全量 Vitest 31 文件 / 202 测试 PASS。
- `npx tsc --noEmit`：PASS。
- `vite build`：PASS（`dist/` 已更新，包含 `models/clownfish_school.glb`）。
- `npm run smoke:rich`（SwiftShader，640×400）：PASS；`fishModel=blender`、`clownfishModel=blender`、500 + 100 条、主鱼世界长度 0.90–1.10 m、小丑鱼 0.50–0.60 m（比例 1.82:1）、`coralModel=full` 48 株、`seaweedModel=blender` 6 株、`kelpModel=blender` 91 株、`glbRockMode=set`、58 draw calls、1,225,511 渲染三角形、0 浏览器错误；截图 `test-artifacts/rich-default-clownfish.png`。
- 默认基线 `npm run smoke` 的轻量 URL 已改为 `?fish=procedural&clownfish=0&coral=temperate&seaweed=0`，保留原布局/移动端检查用途。

## 待办

- 硬件 GPU（Windows 本机 Chrome/Edge）的 FPS / P95 / 显存与视觉验收：`npm run accept:gpu -- --scenarios=rich-default --counts=500 --warmup-ms=3000 --sample-ms=10000 --channel=chrome`。SwiftShader 数据不作为性能结论。
- 小丑鱼近景的鳍缘/鳃部细节仍依赖贴图；如需更高质量，可提高减面预算到 4k–5k 或制作 LOD。
