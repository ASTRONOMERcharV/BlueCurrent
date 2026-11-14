# BlueCurrent — Shot List

## 1. 拍摄母版

| 项目 | 设定 |
| --- | --- |
| URL | `http://127.0.0.1:4173/?demo=cinematic` |
| 画布 | 1920×1080，DPR 1，100% 浏览器缩放 |
| 母版时长 | 90 秒 Demo Mode |
| 建议录制 | OBS，独立 MKV，30 或 60 FPS |
| 帧率选择 | 只有录制期间稳定且不掉步时使用 60 FPS |
| 画面状态 | 控制台、标题栏、鼠标、调试弹窗全部隐藏 |

`?demo=cinematic` 会自动进入 90 秒展示时间线。完整时间线应从页面就绪后的开篇画面开始，不在加载页上计时。

场景固定在 23、44、53 秒发生确定预热。若连续录制在这些点出现短暂停顿，应使用黑场硬切或按章节分别录制；不要把停顿帧保留在成片动作段落中。

## 2. 镜头清单

| ID | 时间 | 素材来源 | 真实场景/相机 | 画面任务 | Remotion 叠加 | 验收要点 |
| --- | --- | --- | --- | --- | --- | --- |
| S01 | 00:00–00:04 | A001 母版 | Calm / Overview | 黑场淡入，展示光束、海床和鱼群 | 极简 `LIVE SIMULATION` | 首帧无浏览器边框、无鼠标 |
| S02 | 00:04–00:08 | A001 | Calm / Overview | 场景缓慢建立 | `BlueCurrent` 主标题 | 标题不遮挡主体 |
| S03 | 00:08–00:14 | A001 | Calm / School | 鱼群整体转向并保持队形 | 三个局部规则状态标签 | 鱼群主体占画面 35–55% |
| S04 | 00:14–00:18 | A001 或 A002 宽景 | Calm / Overview | 展示鱼群与礁群/海草关系 | `ONE LIVE WORLD` | 珊瑚和鱼群均可辨认 |
| S05 | 00:18–00:23 | B-roll | 当前 School 或经验证的固定机位 | 中近景观察尾摆、身体弯曲和转向 | `FIXED-STEP MOTION` | 仅在 1080p 硬件审片通过后使用；否则换成中景 |
| S06 | 00:23–00:30 | A001 | Encounter / Predator | 捕食者从远处进入，状态转为 Pursuit | `Patrol → Pursuit` | 字幕必须来自真实状态 |
| S07 | 00:30–00:36 | A001 | Encounter / Predator | 鱼群压缩/分裂，威胁数变化 | `Distance-aware evasion` | 不强制目标或捕获 |
| S08 | 00:36–00:44 | A001 | Encounter / School | 捕食者离开后群体重新组织 | `Recovery in progress` | 不用“瞬间恢复”措辞 |
| S09 | 00:44–00:50 | A001 | Navigation / Overview | 穿越五礁环境的宽景 | `Environment-aware steering` | 鱼群与礁石空间关系清楚 |
| S10 | 00:50–00:53 | A001 或 C001 | Navigation / Laboratory 可选 | 短暂展示障碍代理、安全距离或碰撞读数 | `Sphere baseline` | 若开 ReefProxy，必须标注实验路径 |
| S11 | 00:53–01:02 | A001 | Calm / School / Laboratory | 真实占用网格、27 单元邻居候选、单鱼向量 | `Uniform grid` / `27 cells` | 网格来自当前空间结构 |
| S12 | 01:02–01:07 | A001 | Encounter 延续 / Laboratory / Brute Force | 同一群体切换搜索模式，网格离线 | `Brute force` / `Same Boids rules` | 不在此时重置群体 |
| S13 | 01:07–01:10 | A001 + 录制截图 | Laboratory | 左真画面、右结构示意；性能卡 | 实时指标与管线图 | 每项数字均可追溯到本机录制 |
| S14 | 01:10–01:21 | A001 | Calm / Overview | 回归完整生态，稳定全景 | `A SCHOOL. A PREDATOR. ONE LIVE ECOSYSTEM.` | 无明显跳切或构图抖动 |
| S15 | 01:21–01:27 | A001 + C001 | Calm / Overview | 背景压暗，保留真场景 | 项目名称与一句话定位 | 不使用未完成功能 |
| S16 | 01:27–01:30 | End card | C001 | 片尾锁定 | `TypeScript · Three.js · CPU Uniform Grid` | 最后一帧停留足够 |

## 3. B-roll 与静帧

### 必须拍摄

| 素材 | 用途 | 获取方式 |
| --- | --- | --- |
| 1920×1080 完整 90 秒母版 | 主片剪辑 | OBS 窗口录制 |
| 同一次录制前的浏览器诊断 | 证明 renderer、FPS、鱼数 | 浏览器控制台或录制截图 |
| Technical Grid 静帧 | 片尾/技术说明 | `npm run smoke:demo` 产物或硬件重拍 |
| Brute Force 静帧 | 对照说明 | 同上 |
| 3–5 秒实际鱼群近景 | 个体运动切镜 | 硬件运行时另拍 |
| 3–5 秒捕食者侧后方追踪 | 捕食段落 | 硬件运行时另拍 |

### 可选拍摄

- 固定 Collision Proxy 近景；
- Observation / Laboratory 分屏；
- 控制器 UI 特写；
- 移动端布局，仅用于项目完整性，不进入 90 秒主片。

## 4. 技术示意素材

Remotion 只制作以下非模拟内容：

- 标题与章节字；
- 27 单元邻域示意；
- Uniform Grid 与 Brute Force 的候选来源对比；
- 固定步长/插值流程；
- 来自实际运行的指标卡；
- 事件状态时间线；
- 片尾 Logo/文字。

不要把 Remotion 生成的鱼群示意放进需要“真实生态画面”的镜头。示意必须标为 `SCHEMATIC` 或通过构图明确区分。

## 5. 数据卡片优先级

### P0

- Fish alive；
- Actual FPS；
- Simulation step；
- Occupied cells；
- Neighbor search mode；
- Predator state。

### P1

- P95 frame time；
- Average neighbors；
- Draw calls；
- Capture event count。

### P2

- Threat count；
- Group dispersion；
- Direction agreement；
- Fixed steps / dropped steps。

P2 数据只在能清楚阅读且不遮挡主体的镜头使用。

## 6. 禁用镜头

- 用外部写实鲨鱼或珊瑚素材冒充项目资产；
- 用 AI 视频片段补出尚未实现的捕食或多捕食者行为；
- 用手动拖动镜头时带出鼠标或控制面板；
- 使用录制期间掉帧但仍标注“60 FPS”；
- 把软件渲染下的模糊/低帧画面后期加速后称实时；
- 将 Proxy Debug 的碰撞线框森林作为全片主力视觉；
- 在没有硬件签核时用过近的鱼头/鲨鱼头部特写作为主海报。

## 7. 交付目录建议

```text
demo-production/
├── storyboard/
│   └── storyboard.md
├── recordings/
│   ├── cinematic/
│   │   └── A001_1920x1080_60p.mkv
│   └── technical/
├── assets/
│   ├── logo/
│   ├── audio/
│   └── fonts/
├── remotion/
├── exports/
│   └── BlueCurrent_Demo.mp4
└── evidence/
    ├── renderer.txt
    └── recording-diagnostics.json
```
