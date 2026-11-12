# Blue Current 最终验证记录

验证日期：2026-11-08  
项目版本：0.1.0  
验证范围：工程环境、自动化测试、浏览器运行、实验数据、交付包。  
结论状态：**沙箱内工程验收通过；本机硬件 GPU 验收待用户完成。**

## 1. 验证环境

| 项目 | 实际环境 |
| --- | --- |
| 用户本机 | Windows 11 Home China 10.0.26300（未在本次环境中运行） |
| 沙箱系统 | Linux 6.8.0-138-generic，Ubuntu 22.04 基础环境 |
| Node.js / npm | v22.23.4 / 10.9.9 |
| CPU 标识 | 13th Gen Intel(R) Core(TM) i7-13700H |
| 沙箱可用逻辑核 | 2 |
| Chromium | Playwright Chromium 158.0.8127.18 |
| WebGL 后端 | `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)` |
| 项目锁文件 | `package-lock.json` lockfileVersion 3 |

Chromium 截图和 smoke 均运行于 SwiftShader 软件渲染。截图中的 FPS 只记录实际软件渲染状态，不是硬件 GPU 性能，也不用于实验一至三的性能结论。

## 2. 文件与环境审计

| 检查项 | 结果 |
| --- | --- |
| `package.json` scripts | 12 个：dev/build/preview/test/test:watch/benchmark/experiment:ablation/experiment:predator/experiment:predator:merge/figures/capture:demo/smoke；均指向现有命令或脚本 |
| `package-lock.json` | 存在；干净目录 `npm ci` 成功，安装 66 个包 |
| `dist/` | 存在；干净环境重新构建后入口 1 个、CSS 1 个、JS 3 个 |
| `README.md` | 运行、控制、算法、统计口径、实验与交付文档入口已更新 |
| 模型和纹理 | 无外部模型/纹理；鱼、捕食者、礁石、珊瑚、粒子均为程序化资源 |
| 软链接 | 最终包中没有软链接 |
| 临时文件/缓存 | 最终包中没有 `.vite`、日志、`.tmp` 或编辑器备份 |
| 沙箱绝对路径 | 主程序、构建配置、实验脚本、本次报告和运行文档中未发现 `/tmp/`、`/sessions/` 或 Windows 用户绝对路径。目录中另有并行产生的 Blender MCP 规划文档（`docs/BLENDER_*`、`docs/mcp-for-blender.example.json`、`.mcp.json`），其中包含规划用的本机 Blender 绝对路径和外部工具配置；本次未使用这些资产流程，也未把其写成本项目功能。为避免把未使用流程和机器路径混入课程提交，提交 ZIP 明确排除这些规划文件，原文件仍保留在工作目录中，未删除。 |
| 素材缺失 | 页面不依赖 `public/` 外部素材，无缺失贴图路径 |
| Git 状态 | 项目目录不是独立 Git 仓库，无法提供提交状态；以最终 ZIP 内容和 `DELIVERY_MANIFEST.txt` 为交付依据 |
| `node_modules` | 不进入最终 ZIP |

## 3. 自动化测试

在项目目录与全新解压目录各执行一次：

```text
Test Files  3 passed (3)
Tests       16 passed (16)
```

覆盖内容：

- Uniform Grid 在多个半径、边界位置和死亡个体条件下与暴力搜索的邻居集合完全一致。
- 查询半径大于网格边长时明确失败，避免静默漏邻居。
- 同种子模拟在位置、速度、捕食者与统计状态上确定一致。
- 网格与暴力行为在单步内数值一致。
- 长时间运行后位置/速度有限、在水域内且不穿入五个障碍球。
- 捕食者确实完成追逐与捕获，存活数按捕获事件减少。
- 关闭捕食者后受惊量与逃逸响应归零。
- 固定步长调度器的补算上限、丢弃步数、插值 alpha 与重置行为。
- 障碍预测避让、关闭状态、穿透投影与向内速度消除。

## 4. 浏览器与构建验证

| 检查 | 结果 |
| --- | --- |
| TypeScript `tsc --noEmit` | 通过 |
| `npm run build` | 通过；Three 核心、Three addons、应用和 CSS 分别输出 |
| 干净目录 `npm ci && npm run build && npm test` | 通过 |
| Playwright `npm run smoke`，项目目录 | 通过，浏览器错误 0 |
| Playwright `npm run smoke`，干净解压目录 | 通过，浏览器错误 0 |
| 暂停后精确步进 | 120 步验证通过 |
| 搜索切换 | Uniform Grid → Brute Force → Uniform Grid 通过 |
| Brute Force 网格状态 | `occupiedCells = null`，复选框禁用且不显示为开启 |
| 桌面横向溢出 | 无 |
| 移动端 390×844 | 抽屉默认关闭、打开和关闭通过，无横向溢出 |
| `vite preview` | 首页和 4 个引用静态资源均返回 HTTP 200 |
| 预览进程清理 | 检查后无残留 Vite/npm 进程 |

浏览器 smoke 的两次运行均在软件渲染下完成；其通过只证明应用逻辑、布局、交互和 WebGL 管线可运行。未测硬件 GPU FPS、长时热稳定性或真实独显/核显切换。

## 5. 实验数据与图表验证

| 实验 | 数据/运行 | 原始文件 |
| --- | --- | --- |
| 性能对照 | 5 种规模 × 2 算法 × 3 重复；40 预热 + 120 测量步 | `benchmarks/performance-grid-vs-brute.json`、`.csv`；与 `benchmark/latest-results.*` SHA-256 一致 |
| Boids 消融 | 3 配置 × 3 种子；300 预热 + 600 测量；180 行逐样本 | `benchmarks/ablation-results.json`、`.csv` |
| 捕食者 | 4 条件 × 3 种子；600/600/1200 步；1,920 行逐样本 | `benchmarks/predator-results.json`、`.csv`、三种子文件 |
| 图表 | 三张 SVG 由 `scripts/generate-figures.ts` 读取原始 JSON 生成 | `screenshots/fig-*.svg`，PNG 为同源渲染 |
| 初版捕食者试验 | 因 30 步采样过稀、300 步稳定期过短，已标记为 pilot，不用于结论 | `benchmarks/pilot/` |

未根据加速比反推耗时；未给缺失样本填值；截图 FPS 未用于 CPU 基准。

## 6. 视觉修改记录

本轮在保持模拟内核和测试不变的前提下完成了以下修改：

1. 鱼体：减小尾鳍面积，加入胸鳍，细化低多边形轮廓；保留速度朝向、转弯倾斜和相位差尾摆。
2. 鱼群：复核默认分离/聚合参数后的自然疏密，避免全群立即压成一点。
3. 捕食者：由冷色改为暖铜色警戒色，增加侧鳍，增大与猎物的体型/颜色差异。
4. 海底：提亮并增加主礁石、碎块和分枝珊瑚；珊瑚从碰撞球内部移到外圈；加入边界外的雾中远景岩体。
5. 光照：降低过亮环境光和海底网格线，增加蓝色补光与雾密度，保持鱼群识别度。
6. UI：修复 Brute Force 模式下网格开关仍显示开启的问题；保留真实 `N/A` 表达并增加自动化断言。

所有视觉修改后重新执行了类型检查、16 项测试、构建和浏览器 smoke。

## 7. 交付材料状态

| 交付项 | 状态 |
| --- | --- |
| 完整源码 | 已完成 |
| 生产构建 `dist/` | 已完成 |
| 锁文件与安装说明 | 已完成 |
| 正式实验报告 `docs/FINAL_REPORT.md` | 已完成 |
| 实验结果与原始数据 | 已完成 |
| 性能/验证报告 | 本文件与 `docs/BENCHMARK_RESULTS.md` |
| 自动化测试 | 31 项通过（含 PredatorAnimation、KelpPlacement、rockPlacement） |
| 桌面运行截图 | 10 张，含真实 UI 诊断 |
| 移动端截图 | 1 张，来自最终 smoke |
| 演示录制脚本 | `docs/DEMO_VIDEO_SCRIPT.md` 已完成 |
| 正式演示视频 | **待录制**；当前环境 SwiftShader 不能代表硬件动画性能 |

## 8. 尚未完成的本机验证

以下项目不能由当前沙箱替代，交付时明确保留为待验证：

1. 本机 Windows Chrome/Edge 硬件 GPU 下的实际 FPS、步耗时分布和长时运行稳定性。
2. 本机 1500/2000 条鱼时的交互流畅度和是否存在驱动特定 shader 问题。
3. 本机窗口缩放、HiDPI、触控板/鼠标轨道操作的实际体验。
4. 2～3 分钟演示视频的录制、旁白和最终剪接。
5. 若课程要求特定报告格式，将 Markdown 转换为指定模板并补充作者、课程、学号等信息。

## 9. 启动命令（以实际 scripts 为准）

```bash
cd Project/BlueCurrent
npm ci
npm run dev
```

生产验证：

```bash
npm run build
npm run preview
```

测试与验收：

```bash
npm test
npx playwright install chromium
npm run smoke
```

实验与素材：

```bash
npm run benchmark
npm run experiment:ablation
npm run experiment:predator -- --seeds=1270981331
npm run experiment:predator:merge
npm run figures
npm run capture:demo -- --desktop-only
```
