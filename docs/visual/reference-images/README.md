# Reference Images Index

本目录只保存索引，不复制大尺寸图片。源图留在对应 `test-artifacts/`，避免同一截图多份副本和版本漂移。所有图片均为项目实际运行产物，不是外部参考概念图。

## 当前最接近的可用材料

| 角色 | 项目实际图片 | 版本限制 |
| --- | --- | --- |
| B1 Overview / UI | [overview-full-ui-1920x1080.png](../../../test-artifacts/reef-hierarchy/b1/overview-full-ui-1920x1080.png) | 2026-11-12 02:26，B1 Hero/D，19.5 s，Sphere，Console open；不是 ReefProxy 或三机位整合验收。 |
| B1 Hero 近景 | [hero-closeup.png](../../../test-artifacts/reef-hierarchy/b1/hero-closeup.png) | 当前 B1 Hero 资产；软件画面，不能替代硬件视觉签核。 |
| B1 D 近景 | [d-closeup.png](../../../test-artifacts/reef-hierarchy/b1/d-closeup.png) | 当前 B1 D 资产；可用于形状审查，不代表 D 通道已验收。 |
| Experiment C School | [validation-t17.00-school.png](../../../test-artifacts/camera-validation/validation-t17.00-school.png) | t17，pre-B1 Hero/D；仅作相机阶段证据。 |
| Experiment C Predator | [validation-t17.00-predator.png](../../../test-artifacts/camera-validation/validation-t17.00-predator.png) | t17，pre-B1 Hero/D；仅作相机阶段证据。 |
| 旧 A Proxy Overview | [debug-overview.png](../../../test-artifacts/reef-collision/debug-overview.png) | 旧 A Proxy，300 鱼，0.267 s；不是 B1 Proxy。 |
| 旧 A D gap | [debug-twin-gap.png](../../../test-artifacts/reef-collision/debug-twin-gap.png) | 旧 A D Proxy；当前 B1 D 已改为 10 个圆角盒。 |

**当前没有同版 B1+C 三机位套图，也没有当前 B1 ReefProxy Debug 套图。** 不得把上表不同日期的图片拼成 Integration 通过证据。

## 新基线归档规则

新一轮图片放入独立、带时间或版本标识的 `test-artifacts/<run>/`，并在 `../../validation/visual-baseline.md` 记录 manifest。至少记录源码/构建/资产版本、URL、场景、种子、时间点、视口、Console、碰撞模式、浏览器和 renderer。

只有同版且验收通过的材料才标记为 baseline。历史图片保持只读，不用新图覆盖旧文件名；不再需要的历史图仍保留其用途和限制说明。
