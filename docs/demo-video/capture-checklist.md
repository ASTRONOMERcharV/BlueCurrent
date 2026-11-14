# BlueCurrent — Capture Checklist

## 1. 录制前闸门

以下项目全部通过后再开始正式录制：

- [ ] 已确认当前源码与要展示的功能一致。
- [ ] Phase E 的鱼体/捕食事件改动已由用户完成软件评审。
- [ ] 近景镜头已有本机 1080p 硬件画面审片。
- [ ] 没有尚未实现的功能进入分镜。
- [ ] 已运行 `npx tsc --noEmit`。
- [ ] 已运行新增 Demo Director 测试：`npx vitest run tests/DemoDirector.test.ts`。
- [ ] 已运行 `npm test`，记录实际文件数与测试数。
- [ ] 已运行 `npm run build`。
- [ ] 已运行 `npm run smoke:demo`，0 浏览器错误。
- [ ] 已检查 `test-artifacts/demo-mode/results.json`。

## 2. 机器与浏览器

- [ ] 接电源，关闭省电模式。
- [ ] 关闭其他 GPU/CPU 重负载程序。
- [ ] 关闭系统通知、聊天通知、自动更新弹窗。
- [ ] 使用 Chrome 或 Edge，确认硬件加速开启。
- [ ] 浏览器窗口为 1920×1080 可见区域，缩放 100%，DPR 1。
- [ ] 使用全屏或浏览器 App 窗口，确保没有标签栏、地址栏和书签栏。
- [ ] 鼠标移出画面；Demo Mode 会隐藏页面内光标，但系统录制仍可能显示外部指针。
- [ ] 显示器刷新率、OS 缩放与 OBS 输出一致。

## 3. 运行生产构建

```bash
cd C:\Users\86159\Desktop\CA-ComputerAnimation\Project\BlueCurrent
npm ci
npm run build
npm run preview
```

打开终端给出的地址。默认预览端口通常是 `4173`。

正式录制 URL：

```text
http://127.0.0.1:4173/?demo=cinematic
```

预期行为：

- 页面加载完成后直接进入 90 秒时间线；
- 标题栏、控制台、底部传输栏、指标卡和鼠标光标隐藏；
- 3D 画布填满 1920×1080；
- 53–70 秒自动进入 Laboratory 网格/暴力搜索对照；
- 90 秒结束时模拟暂停。

## 4. 录制前诊断

在浏览器控制台确认：

```js
const d = window.__blueCurrent.getDiagnostics()
({
  rendererWidth: d.canvasWidth,
  rendererHeight: d.canvasHeight,
  fps: d.fps,
  fish: d.fishCount,
  search: d.searchMode,
  predator: d.predatorState,
  demo: window.__blueCurrent.getDemoState()
})
```

必须确认：

- [ ] `canvasWidth/canvasHeight` 与实际 1080p 录制口径一致；
- [ ] Fish alive 是预期值；
- [ ] 不是 SwiftShader；
- [ ] 当前搜索模式与阶段字幕一致；
- [ ] Demo 状态处于 `opening` 或准备重新开始。

检查真实 renderer：

```js
const canvas = document.querySelector('#viewport canvas')
const gl = canvas.getContext('webgl2')
const ext = gl.getExtension('WEBGL_debug_renderer_info')
gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
```

如果显示 `SwiftShader` 或 `llvmpipe`：

- 可以检查构图；
- 不可录制“实时性能”主母版；
- 不可把该 FPS 放进性能卡。

## 5. OBS 设置

| 参数 | 建议 |
| --- | --- |
| 基础/输出分辨率 | 1920×1080 |
| 帧率 | 60 FPS；不稳定则改为 30 FPS |
| 格式 | MKV |
| 视频编码 | NVENC/AV1/H.264 硬件编码器，按可用性选 |
| 质量 | High Quality 或更高 |
| 音频 | 48 kHz，预留旁白/环境音轨 |
| 录制源 | BlueCurrent 浏览器窗口 |
| 裁切 | 只保留 1920×1080 画布，不包含浏览器 UI |

建议两套 OBS 场景：

### Cinematic Capture

- 只录完整 3D 画面；
- 不录控制台、鼠标、系统通知；
- 使用 Demo Mode 自动时间线。

### Technical Capture

- 录制同一 90 秒母版中的 53–70 秒；
- 需要时另录 Label/Legend 画面；
- 不在录制过程中打开 Debug 控制台。

## 6. 录制流程

1. 预热一次页面，让 GLB、纹理和 shader 完成缓存。
2. 关闭控制台，刷新录制页。
3. 在页面进入开篇画面后开始正式 OBS 录制；若录制从刷新前开始，后期裁掉加载段。
4. 保持窗口前台，不对浏览器做任何操作。
5. 采集完整 90 秒。
6. 停录后先保留 MKV。
7. 用 OBS Remux 转为 MP4，保留原始 MKV 作为母版。
8. 回看首帧、23 秒捕食切换、44 秒 Navigation、53 秒技术切换、70 秒 Finale 和末帧。

注意：这些场景切换会执行固定预热，可能产生短暂停顿。将 23/44/53 秒的切换放在黑场或硬切上；如单次连续录制仍明显卡顿，则按章节分别录制后剪辑。不得把预热暂停帧当作实时动作。

至少拍两条：

- `A001`：完整叙事版；
- `A002`：备用完整版，避免一次通知/掉帧毁掉素材。

## 7. 技术 B-roll

### 网格与暴力搜索静帧

```bash
npm run smoke:demo
```

输出：

```text
test-artifacts/demo-mode/cinematic-opening.png
test-artifacts/demo-mode/technical-grid.png
test-artifacts/demo-mode/technical-brute-force.png
test-artifacts/demo-mode/cinematic-finale.png
test-artifacts/demo-mode/results.json
```

SwiftShader 产物可用于布局和图层检查。若要作为正式技术近景，应在硬件录制会话中重新截取，或直接从 A001 母版抽帧。

### 捕食事件

当前 Phase E 证据：

```text
test-artifacts/phase-e/2026-11-14t00-13-00z/predation-r3/
test-artifacts/phase-e/2026-11-14t00-13-00z/review-e3-events.png
test-artifacts/phase-e/2026-11-14t00-13-00z/review-e3-ui.png
```

只能用于核对事件呈现，不能替代硬件主母版。

## 8. Remotion 包装前置条件

本仓库当前没有可运行的 Remotion 工程。开始剪辑包装前：

- [ ] 确认 Node 版本满足 Remotion 要求；
- [ ] 在独立 `demo-production/remotion/` 中创建工程，不污染模拟源码；
- [ ] 使用本地字体和本地音频；
- [ ] 所有标题在 1920×1080 安全区内；
- [ ] 数据卡绑定真实录制数据；
- [ ] 生成新版预告 GIF/MP4 后人工检查中文字体与动态模糊；
- [ ] Remotion 渲染结果与 OBS 母版帧率、色彩空间一致。

建议先做 40 秒动态样片，再扩展完整 90 秒。

## 9. DaVinci Resolve 剪辑检查

- [ ] 工程时基与母版帧率一致；
- [ ] 剪辑前保留 OBS 原始 MKV；
- [ ] 色彩不做会破坏水下层次的过度对比；
- [ ] 字幕与主体避开；
- [ ] 23 秒和 53 秒场景切换无黑帧；
- [ ] 性能数值与录制数据一致；
- [ ] 音乐/音效授权明确；
- [ ] 中文字幕无缺字；
- [ ] H.264/H.265 导出一版，音量标准化；
- [ ] 导出文件能在另一台机器播放。

## 10. 最终 QA

### 内容

- [ ] 观众能说出：这是实时群体生态模拟。
- [ ] 观众能看到：鱼群、捕食者、环境、空间网格。
- [ ] 每个技术点都至少对应一个真实画面或明确标注的示意。
- [ ] 没有未实现功能进入主叙事。

### 画面

- [ ] 全片无浏览器 UI、鼠标、加载页。
- [ ] 无异常闪烁、贴图缺失或黑帧。
- [ ] 镜头切换没有目标切换尖峰。
- [ ] 鱼群近景自然到可接受；否则替换成中景。
- [ ] 水体不过亮、不过黑、不过饱和。

### 数据

- [ ] 性能卡由录制现场读出。
- [ ] 分辨率和 renderer 与数据卡不矛盾。
- [ ] SwiftShader 数字未进入正式成片。
- [ ] 1920×1080 未测的性能没有被默认写成稳定值。

### 声音

- [ ] 中文旁白清晰。
- [ ] 音乐不压过人声。
- [ ] 低频没有轰头或削波。
- [ ] 末帧后没有爆音。

## 11. 建议交付

```text
demo-production/exports/
├── BlueCurrent_Demo_90s_1080p.mp4
├── BlueCurrent_Demo_90s_1080p_prores.mov
└── BlueCurrent_Demo_90s_1080p_thumbnail.png
```

同时保留：

- 90 秒无 UI 真实母版；
- 技术静帧；
- 录制的 renderer/FPS 证据；
- Remotion 工程；
- 最终分镜与字幕稿。
