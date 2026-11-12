# Blue Current 实验报告 PDF 导出说明

本目录保存实验报告的 Markdown 源、排版模板与本机导出脚本。正文变更只需修改
`FINAL_REPORT.md`，然后运行 `build.sh` 重新生成 PDF。

- 产物：`BlueCurrent-实验报告.pdf`（A4，14 页：封面 1 页 + 目录 1 页 + 正文 12 页）
- 源文档：`FINAL_REPORT.md`
- 版式：Eisvogel 3.5.1 模板 + 本目录的定制封面（白底、纯黑文字、居中排版）

## 目录结构

| 路径 | 作用 |
| --- | --- |
| `FINAL_REPORT.md` | 报告正文（唯一内容来源）；文中图片仍写旧路径 `../screenshots/`，由 `build.sh` 改写 |
| `build.sh` | 一键导出脚本：生成 build.md → 转换图片 → pandoc/xelatex 编译 |
| `template/eisvogel-cover.latex` | Eisvogel 3.5.1 的定制副本，只替换了封面块 |
| `template/header.tex` | 中文断行、图表标题名、图片宽度、caption 间距 |
| `template/codebreak.lua` | 让超长行内代码可在 `/ : -` 处断行 |
| `BlueCurrent-实验报告.pdf` | 编译产物 |

## 环境依赖

| 组件 | 要求 | 本机实测 |
| --- | --- | --- |
| pandoc | 2.9 及以上（未用 `--highlight-style` 等新参数） | 2.9.2.1 |
| XeLaTeX | TeX Live（含 fontspec、graphicx、caption、longtable 等） | TeX Live 2021 |
| Python 3 | 生成 build.md、用 Pillow 重存图片 | 3.10 |
| Pillow | `pip install pillow` | 12.3.0 |
| 中文字体 | Linux：Noto Serif/Sans CJK；Windows：宋体/雅黑/Consolas | 两种分支脚本自动选择 |

Eisvogel 模板要求 XeLaTeX，不要换成 pdflatex；LuaLaTeX 未经测试。

## 一键导出

在仓库任意目录执行：

```bash
bash Project/BlueCurrent/docs/report/build.sh
```

脚本依次完成：

1. 读取 `FINAL_REPORT.md`，删掉首个 H1 标题和下方 `项目：/版本：/…/验证记录：` 元信息块；
   把 `###` 降为 `##`、`##` 降为 `#`，使 article 类按节编号。
2. 预置 YAML 元信息（标题、副标题、作者、学号、课程、日期、页眉页脚、目录）。
3. 在 `# 5. 实验与结果` 前插入 `\clearpage`（原因见下节）。
4. 将三张 `../screenshots/fig-*.png` 转成 RGB、220 dpi 副本放进 `assets/`，并改写链接
   （原图是 RGBA，XeLaTeX 会存成带 SMask 的 16 bit 图，部分阅读器偏色）。
5. 用 `template/eisvogel-cover.latex` 编译到 `docs/report/BlueCurrent-实验报告.pdf`。

构建目录在系统临时目录（`/tmp/bluecurrent-report-build`），不在仓库内留临时文件；
仓库挂载盘通常不允许删除文件，因此不要改回项目目录。

## 手动等价命令

若不用脚本，先生成 `build.md`（步骤 1–3，见 `build.sh` 内嵌的 Python 代码），再执行：

```bash
pandoc build.md -o BlueCurrent-实验报告.pdf \
  --from markdown+tex_math_single_backslash \
  --template=template/eisvogel-cover.latex \
  --pdf-engine xelatex \
  --toc --toc-depth=2 \
  --resource-path="." \
  -H template/header.tex \
  --lua-filter template/codebreak.lua \
  -V mainfont="Noto Serif CJK SC" \
  -V sansfont="Noto Sans CJK SC" \
  -V monofont="Noto Sans Mono CJK SC" \
  -V mainfontoptions="AutoFakeSlant=0.2"
```

Windows 自带字体环境把 `-V mainfont` 换成 `Times New Roman`、
`-V sansfont` 换成 `Microsoft YaHei`、`-V monofont` 换成 `Consolas`，
并去掉 `mainfontoptions`。

## 模板定制说明

相对上游 Eisvogel 3.5.1，`template/eisvogel-cover.latex` 只改动了 `$if(titlepage)$` 块：

- 封面改为白底、居中排版：34 pt 粗体标题、15 pt 副标题；
- 封面全部文字使用纯黑 `\color{black}`（上游默认 `5F5F5F` 灰字）；

正文部分与上游模板一致：Access 风格的灰色标题、0.4 pt 页眉线、页眉左侧
“Blue Current 实验报告”与右侧日期、页脚左侧“Blue Current”与右侧“第 N 页”页码，
目录使用两级带点线格式。

### 正文排版要点

- **数学公式**：源文档用 `\[ ... \]`，pandoc 默认只识别 `$$`，因此必须加
  `--from markdown+tex_math_single_backslash`。
- **中文断行**：沙箱 TeX 缺 `xeCJK/ctexhook.sty`，`header.tex` 改用 XeTeX 原生
  `\XeTeXlinebreaklocale "zh"`；在完整 TeX Live（Windows）上可改回模板的
  `-V CJKmainfont` 分支，断行效果相同。
- **长行内代码**：pandoc 把代码中的空格转成不可断行盒子，超长路径会顶出右边距；
  `codebreak.lua` 在 `/ : -` 后插入 `\allowbreak`，保留原字符与等宽字体。
- **图片宽度**：`header.tex` 设置 `\setkeys{Gin}{width=0.95\linewidth,keepaspectratio}`，
  三张实验图按版心 95% 宽显示，题注与图同页。
- **第 5 章强制分页**：正文第 4 章尾部若为浮动图，章标题会被挤到页底，
  其后的表格随图漂到下一页并重复表头；`\clearpage` 让“5. 实验与结果”从新页开始。

## 修改作者信息

编辑 `build.sh` 中的 YAML 段即可，改完重新运行脚本：

```yaml
author: ["孙嘉泽"]
studentid: "3230104713"
course: "计算机动画"
date: "2026 年 11 月 8 日"
```

封面会自动显示课程/作者/学号/日期四行；`title-meta`、`subject`、`keywords` 写入
PDF 元信息（阅读器标题栏显示“Blue Current：三维群体生态模拟实验报告”）。

## 验收检查

导出后可用以下命令快速核对：

```bash
pdfinfo docs/report/BlueCurrent-实验报告.pdf | grep -E "Pages|Title|Author"
pdftotext -enc UTF-8 docs/report/BlueCurrent-实验报告.pdf - | head -20
```

预期结果：

- 页数 14，A4 595×842 pt；
- 封面为纯黑文字、白底，含课程/作者/学号/日期；
- 第 2 页（页脚第 1 页）为目录，条目页码为各节起始页（2–12）；正文末页页脚为第 13 页
  （附录表格续页）；
- 正文从“摘要”开始，开头不再有项目/版本/完成日期等元信息块；
- 三张图按页脚页码位于第 9–11 页（PDF 文件第 10–12 页）：实验一性能图、Boids 消融图、
  捕食者响应图。

## 已知问题

1. **沙箱字体名误报**：`pdffonts` 显示 `NotoSerifCJKjp-Regular`，是 TTC 提取字体时
   CFF 内嵌名未改所致；实际字形按 `Noto Serif CJK SC` 索引（index 2）渲染，简体中文
   字形正确，不影响显示。
2. **不要在脚本里使用 `fc-list | grep -q` 判字体**：`set -o pipefail` 下 grep 提前退出会
   返回非零；脚本已改为先取变量再 grep。
3. **不要加 `--highlight-style`**：Eisvogel 用 `listings` 对代码块着色；md2pdf 的
   `ea.theme` 是给 pandoc 2.10+ 的 JSON 主题，沙箱 pandoc 2.9 传 `idiomatic` 等名称会报
   `Unknown highlight-style`，本流水线不需要该参数。
4. **图片更新**：三张图由 `scripts/generate-figures.ts` 生成到 `screenshots/`；
   `build.sh` 只读取，不会重新生成图表。
