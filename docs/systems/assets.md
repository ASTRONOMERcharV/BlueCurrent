# System — Assets and Placement

> 核实日期：2026-11-12。替换 GLB、修改 Blender 管线、尺寸、LOD 或散布前阅读。规范详表仍以 `../ASSET_SPEC.md`、`../ASSET_PIPELINE.md` 为准。

## 目录与加载入口

运行时模型在 `public/models/`，纹理在 `public/textures/`，Blender 源和自动化在 `assets_src/`。生产加载由 `src/main.ts` 和 `SceneManager/Environment` 完成；独立 `src/preview/` 用于资产验收，不是第二套生产场景。

默认主鱼为 `fish_school.glb`，小丑鱼为 `clownfish_school.glb`，捕食者为 `predator_shayu_rigged.glb`，静态 shayu 是回退。Hero/D 当前前缀分别为 `reef_hero_b1`、`reef_twin_d_b1`，文件位于 `public/models/reef/`。

所有 Loader 失败都有既定回退；小丑鱼资产失败时第二鱼群关闭，不用普通鱼冒充。替换资产必须保留校验，不要为了加载成功而删除契约。

## 坐标与契约

统一 Y-up，生物 +Z forward，礁石/植物底部基准约为 y=0。Reef 使用实际 near-LOD 尺寸和非均匀世界缩放；不要根据目标尺寸手算一个碰撞盒后跳过真实 transform。

| 资产 | Loader 重点检查 |
| --- | --- |
| School fish | 长度、三角预算、+Z、尾权重、UV/法线、材质数、无动画。 |
| Clownfish | 独立尺寸和三角预算、尾权重、单材质契约。 |
| Predator static | 长度、三角预算、尾权重、可选 jaw weight、PBR 材质。 |
| Predator rig | 11 根指定骨骼、层级、权重和、最多 4 influences、无动画。 |
| Reef | near/mid/far 三角预算、底部 y=0、纹理 flipY、AO/roughness 通道。 |
| Rocks / Corals / Kelp / Seaweed | 各资产的尺寸、三角预算、共享图集或 sway 属性。 |

具体数值以 `FishAsset.ts`、`PredatorAsset.ts`、`PredatorRigAsset.ts`、`ReefSampleAsset.ts` 等当前 Loader 为准；文档不能替代运行时检查。

## 放置系统的不同职责

| 系统 | 唯一职责 / 共享关系 |
| --- | --- |
| `reefVariantSpecs.ts` | 五礁石视觉资产、目标尺寸、旋转、LOD、表生种子。 |
| `ReefSample.ts` | Reef GLB 实例、实际世界变换和 collisionTransform。 |
| `reefCollisionProxySpecs.ts` | 同一五 ID 的局部碰撞图元；更换视觉资产后同步拟合。 |
| `CoralScatter.ts` | 生产默认由 `main.ts` 显式选择 `full`，为 48 实例；构造器自身默认仍是 `temperate` 12 实例。与 Reef Epibiont 分开计数。 |
| `reefEpibiontPlacement.ts` / `EpibiontScatter.ts` | 礁石表面附着、覆盖和 decorationScale。 |
| `kelpPlacement.ts` | 生成 `world.kelpLayout`，渲染与庇护共用；当前诊断 51 kelp_a + 40 kelp_b。 |
| `rockPlacement.ts` / `terrain.ts` | 地形高度和岩石放置；近区 `floorHeightAt` 与 `terrainHeightAt` 保持一致。 |
| `RockScatter.ts` / `terrainDecor.ts` | 装饰岩与远景；不自动加入硬碰撞。 |

`RockScatter.hideAnchoredLarge` 只隐藏被 Reef 替换的旧视觉大石，不改变 Sphere。固定种子必须保留，不能在每次加载或帧更新时重新随机布局。

## 生产加载与 URL 注意事项

`environment=bare` 关闭完整 rocks/kelp/coral，但当前代码不会因此关闭 detail seaweed；后者需要 `seaweed=0/off`。`reef=sample/off` 会造成 Proxy 变换不完整，因此 ReefProxy 回退 Sphere。`glbRocks=1` 是 legacy 单岩入口，默认完整 rock set 后再加载 Reef set。

`fishCount` 在场景 apply 后处理并触发 reset，可能丢失预热；这不是资产加载错误，修改场景组装时应专门验证。

`preview/reef-sample-preview.html` 与 `preview/reef-variants-preview.html` 已和其余资产预览、`preview/index.html` 总览页一起列入 `vite.config.ts` 的生产多页 input。独立预览入口统一为 `/preview/<name>.html`；根目录只保留主应用 `index.html`。

## 验证入口

```bash
npm run smoke:fish
npm run smoke:predator
npm run smoke:predator-animation
npm run smoke:rocks
npm run smoke:coral
npm run smoke:kelp
npm run smoke:seaweed
npm run smoke:rich
```

Blender 资产的 build → bake → finalize/install → verify 顺序见 `../ASSET_PIPELINE.md` 和实际 `assets_src/scripts/`。不要凭旧报告执行不存在的脚本或输出目录。烘焙、捕获与测试串行。

## 修改完成条件

保留 Loader 契约、坐标/尺寸、固定种子和回退；记录资产前缀、GLB/纹理版本、三角数、LOD 和世界变换。Reef 变化同时审查碰撞 Proxy，布局变化同时审查模拟共享关系，并将长期规则更新到本文件与资产规范。
