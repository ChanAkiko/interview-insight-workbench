# 访谈证据台与 Interview Insight Cards Skill

这套工具把访谈逐字稿整理成可追溯的证据、原子观察和候选洞察，由设计师逐条审阅，再让 Codex 基于人工确认结果生成设计机会、HMW 和创意方案种子，最终导出可直接用于小组讨论的简报。

## 包含内容

- `skill/interview-insight-cards/`：Codex Skill 本体、字段规范和校验脚本。
- `website/`：访谈证据台的完整静态网页文件。
- `examples/`：两份模拟访谈逐字稿和对应的示例 bundle。

在线访谈证据台：<https://interview-evidence-workbench.chanakiko04.chatgpt.site/>

## 安装 Skill

### macOS / Linux

在本文件夹打开终端并运行：

```bash
mkdir -p ~/.codex/skills
cp -R skill/interview-insight-cards ~/.codex/skills/
```

### Windows PowerShell

在本文件夹打开 PowerShell 并运行：

```powershell
New-Item -ItemType Directory -Force "$HOME/.codex/skills" | Out-Null
Copy-Item -Recurse -Force "skill/interview-insight-cards" "$HOME/.codex/skills/"
```

安装后重新打开 Codex。新对话中输入 `$interview-insight-cards` 即可调用。

## 使用流程

1. 在 Codex 内置浏览器打开[访谈证据台](https://interview-evidence-workbench.chanakiko04.chatgpt.site/)。
2. 选择“开始新访谈项目”，填写唯一的项目 ID 和面向方案构思的设计问题。
3. 复制网页生成的任务说明，在 Codex 对话中粘贴，并附上匿名化的 UTF-8 TXT 逐字稿。
4. Codex 调用 `$interview-insight-cards`，提取带行号的原话、原子观察、候选洞察和主题，并校验结构化 bundle。
5. Codex 通过网页的 `set_cards` 工具把 bundle 和逐字稿写入当前看板。
6. 在网页逐条核对支持证据与限定证据，选择采纳、修改后采纳或驳回；需要修改时可调整结论、适用情境和主题。
7. 全部审阅完成后，在 Codex 中要求基于当前看板完成第二次 AI 综合。Codex 读取人工确认结果，生成主题级设计机会、HMW、创意方案种子和待验证问题，并写回网页。
8. 生成讨论简报，复制正文或下载 Markdown、HTML、PDF。
9. 从首页“查看历史项目”切换已保存项目，继续审阅或打开已生成简报。

## 本地打开网页

进入 `website` 文件夹并运行：

```bash
python3 -m http.server 8766
```

浏览器访问 <http://localhost:8766/>。

## 示例试跑

`examples/` 中的两份 TXT 是虚构访谈材料，`模拟数据_bundle.json` 是对应的结构化结果。可以把 TXT 附到 Codex 对话中测试完整流程，也可以在网页的备用导入入口同时选择 bundle 与 TXT，直接进入审阅。

## 数据结构

Skill 使用 schema v0.2，核心链路为：

```text
访谈会话 → 可定位原话 → 原子观察 → 候选洞察 → 主题
        → 人工审阅 → 设计机会与 HMW → 创意方案种子 → 讨论简报
```

每条候选洞察包含适用情境、支持观察、限定观察、其他解释和待验证问题。每条创意方案种子包含详细构想、2—4 步使用过程、预期改善和最先验证事项。

## 文件结构

```text
.
├── README.md
├── skill/
│   └── interview-insight-cards/
│       ├── SKILL.md
│       ├── agents/openai.yaml
│       ├── references/
│       └── scripts/
├── website/
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   └── demo-data.js
└── examples/
    ├── S01_模拟访谈.txt
    ├── S02_模拟访谈.txt
    └── 模拟数据_bundle.json
```

## 更新日志

### v13

- 精简首页和顶部导航，主入口统一为继续项目、新建项目和历史项目。
- 将模拟案例与已审简报调整为轻量演示入口。

### v12

- 新增多项目本地历史库。
- 新增项目切换、审阅恢复和简报恢复。
- 新增旧版当前项目自动迁移。

### v11

- 扩展创意方案为详细构想、使用过程、预期改善和验证事项。
- 在人类可读简报中隐藏方案与 HMW 的内部关联字段。
- 新增 Markdown 下载，统一正文、Markdown、HTML 和 PDF 导出入口。

### v10

- 移除审议人字段。
- 将审议说明调整为选填，并在填写后带入讨论简报。

### v9

- 同步线上构建资源与网页源码版本。

### v8

- 允许在“修改后采纳”时切换 AI 主题或新增自定义主题。
- 新增“下一个待审”操作。
- 将第二次 AI 综合扩展到创意方案种子。

### v7

- 将候选洞察改为顶部横向导航，证据区与审议区改为并列布局。
- 新增带 `review_revision` 校验的第二次 AI 综合。
- 新增主题级设计机会和 HMW 写回。

### v6

- 升级 schema v0.2，新增主题及洞察主题关联。
- 新增按主题生成 HMW 的 AI 辅助流程。

### v5

- 新增 WebMCP `set_cards`，支持 Codex 直接把分析结果写入网页。
- 新增 IndexedDB 项目保存和刷新恢复。
- 新增原始逐字稿上下文写入。

### v4

- 新增逐卡人工审阅。
- 新增面向小组讨论的人类可读简报、正文复制、HTML 下载和 PDF 打印。

### v3

- 将证据观察改为可折叠卡片。
- 优化支持证据、限定证据和来源定位的阅读层级。

### v2

- 新增首页引导、项目 ID 与设计问题输入。
- 新增手动导入 bundle 和逐字稿。
- 扩展模拟案例至 8 份访谈和 9 张候选洞察卡。

### v1

- 建立访谈证据台基础界面。
- 实现原话、观察、候选洞察、证据追溯、搜索和状态筛选。
