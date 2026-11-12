# Blue Current 演示视频录制脚本

## 当前状态

**正式视频未录制。** 当前沙箱浏览器使用 SwiftShader 软件渲染，实测截图中的帧率为 2–20 FPS，不能作为真实硬件动画质量的展示。按最终交付要求，视频必须由用户在本机启用硬件加速的 Chrome/Edge 中录制；当前交付提供录制脚本、真实运行截图和镜头顺序，不提供伪造视频、概念动画或外部素材替代。

已准备的真实运行素材位于 `screenshots/final-01` 至 `final-09`，每张都有 `screenshots/capture-results.json` 中的运行诊断。它们可用于剪辑封面、片头和核对操作，不应直接拼成“实时 2–3 分钟演示”冒充完整运行录像。

## 录制前准备

1. 在项目根目录执行 `npm ci`、`npm run build`、`npm run preview`，用打印的本地地址打开生产构建。
2. 使用本机 Chrome 或 Edge，关闭开发者工具、系统通知和其他占用 GPU 的程序。
3. 建议窗口 1600×1000 或 1920×1200，浏览器缩放 100%。
4. 开始前刷新页面，确认 `Fish alive` 为 500、默认搜索为 `Uniform grid`、`Predator active` 为开启。
5. 先确认本机帧率来自实际硬件。录制时不得把截图中的 SwiftShader FPS 贴入视频。

建议 OBS：1920×1080、60 FPS、H.264/MP4、浏览器采集或窗口采集，关闭鼠标点击高亮效果。最终时长目标 2 分 30 秒至 2 分 50 秒。

## 推荐镜头顺序与操作

| 时间 | 画面与操作 | 旁白要点 |
| --- | --- | --- |
| 0:00–0:18 | 默认全景。拖动鼠标缓慢环绕，展示海床、礁石、珊瑚、500 条鱼和暖色捕食者。 | 这是实时三维捕食者—猎物群体，不是预设轨迹。 |
| 0:18–0:45 | 暂停 → 关闭 `Predator active` → `Reset` → 恢复运行。等待约 8–10 s，再点 `Follow school`。 | 鱼只根据局部邻居的分离、对齐和聚合运动；群体中心没有被直接控制。 |
| 0:45–1:03 | 打开 `Perception radii` 保持默认，再在 `Separation` 滑杆从 2.40 调低到 0.35。观察鱼群收缩/拥挤趋势，随后恢复 2.40 并 `Reset`。 | 只改变一个参数，说明局部规则与全局形态的对应关系。 |
| 1:03–1:30 | 开启 `Predator active`，点击 `Release near school`，点 `Follow predator`，鼠标滚轮适度拉近。展示巡逻→检测→追逐。 | 捕食者根据状态机和预测位置追逐最近猎物，不是朝群体中心绕圈。 |
| 1:30–1:55 | 保持追逐，记录一次捕食事件和 `Fish alive` 从 500 降到 499。点击 `Let school regroup` 并关闭捕食者，保持或切回 `Orbit`。 | 捕获是模拟事件；威胁离开后，分离、对齐、聚合重新作用，但恢复不是瞬间完成。 |
| 1:55–2:15 | 点击 `Reset`，打开 `Occupied grid cells`，切换 `Orbit`。降低视角观察网格线框和礁石；可短暂切换 `Reef obstacles` 对比实际障碍开关。 | 线框来自当前实际占用的网格单元；网格搜索只改变邻居候选来源，不替换行为规则。 |
| 2:15–2:32 | 把 `Initial fish count` 改为 1500，松开后等待重建；再用 2× 观察。展示底部 `Fish alive` 和面板 `Fixed steps`。 | 1500 条鱼仍由同一套 CPU 更新；规模增加会改变性能预算。 |
| 2:32–2:47 | 回到 500 条（滑块与 `Reset`），在 `Uniform grid / Brute force` 间切换。打开 `Live measurements`，展示真实 FPS、步耗时、邻居数、群体数；Brute force 时指出网格占用为 `N/A`。 | 模式可切换用于对照；具体帧率和步耗时以录制机器为准。 |
| 2:47–2:55 | 切回 `Uniform grid`，恢复捕食者，缓慢环绕收尾。 | 局部规则、空间查询、捕食行为和实时可视化组成同一可操作实验平台。 |

## 完整旁白参考稿

> Blue Current 是一个实时三维群体生态模拟。画面中的 500 条鱼没有各自的完整路径，它们只感知局部邻居，分别执行分离、对齐和聚合；三种力量共同产生群体运动。
>
> 三维均匀网格把邻居查询限制在相邻的 27 个单元。右下方面板展示的是当前模拟的真实状态，不是预录动画。
>
> 捕食者通过巡逻、检测、预测追逐、攻击和搜索改变行为。鱼在威胁靠近时产生逃逸响应，颜色和运动方向会随受惊程度变化。捕食者离开后，局部规则会让群体重新组织，但恢复需要时间。
>
> 这里可以切换暴力搜索和网格搜索、改变鱼群规模并观察统计。详细算法和实测数据在项目报告中；所有数值都来自程序运行。

## 截图对应关系

| 脚本片段 | 已有真实截图 |
| --- | --- |
| 深海全景与自然群游 | `screenshots/final-01-deepwater-schooling.png` |
| 群体跟随与姿态 | `screenshots/final-02-follow-school.png` |
| 参数改变后的群体 | `screenshots/final-03-low-separation.png` |
| 捕食者接触 | `screenshots/final-04-predator-encounter.png`、`final-04b-predator-close.png` |
| 捕获后状态 | `screenshots/final-05-post-capture.png` |
| 捕食者离开后的恢复 | `screenshots/final-06-school-recovery.png` |
| 网格线框 | `screenshots/final-07-occupied-grid.png` |
| 1500 条鱼 | `screenshots/final-08-fish-1500.png` |
| Brute Force 与 N/A 网格占用 | `screenshots/final-09-brute-force.png` |
| 移动端布局 | `screenshots/final-10-mobile.png` |

## 录制限制与诚实标记

- 本文件是**录制脚本**，不是视频成品。
- 当前沙箱只能证明应用能启动、渲染、响应控件和通过自动化验收；不能证明本机硬件 GPU 的帧率。
- 若录制机器性能不足，可降低鱼数，但不得篡改 FPS 文本、删除性能面板或把后期加速的画面标成实时。
- 如以后录制完成，建议输出 `demo/blue-current-demo.mp4`，并在 README 中将视频状态从“待录制”更新为实际文件与时长。
