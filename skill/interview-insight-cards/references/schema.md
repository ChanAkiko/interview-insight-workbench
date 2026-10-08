# 字段与判断规则（v0.2）

这套结构把不可变的原始材料与可修改的解释分开。`id` 在同一项目内唯一，后续增量导入沿用原 ID；不要因为修改措辞而换 ID。`null` 或空串代表材料未提供，不代表“不存在”。

## JSON bundle

```json
{
  "schema_version": "0.2",
  "project": {"project_id": "P01", "research_question": "...", "question_version": "1"},
  "themes": [{"theme_id": "T01", "label": "看见与辨认", "definition": "与识别内容、日期和优先级有关，不预设显示或提醒方案"}],
  "sessions": [{"session_id": "S01", "participant_code": "U01", "date": "2026-09-28", "method": "访谈", "context": "...", "source_file": "transcript.txt", "source_url": "", "transcript_version": "1", "use_scope": "演示数据"}],
  "excerpts": [{"excerpt_id": "E01", "session_id": "S01", "line_start": 3, "line_end": 3, "speaker": "受访者", "quote": "原文中的连续文字", "preceding_question": "紧邻的采访者提问原文或空串"}],
  "observations": [{"observation_id": "O01", "excerpt_ids": ["E01"], "evidence_type": "用户自述过去的行为", "task": "...", "action": "...", "object": "...", "context": "...", "obstacle": "...", "consequence": "...", "workaround": "...", "unknown": ["尚不清楚的具体事项"]}],
  "insights": [{"insight_id": "I01", "theme_id": "T01", "statement": "可能的用户问题，而非方案", "applies_to": "用户与场景", "support_observation_ids": ["O01"], "limiting_observation_ids": [], "alternative_explanations": ["..."], "open_questions": ["..."], "status": "待审", "reviewer": "", "review_reason": ""}]
}
```

主题是对候选洞察的导航和后续综合层。先生成全部候选洞察，再横向比较并建立 3—7 个主题；每条洞察只指定一个主要 `theme_id`，避免同一内容在讨论简报里重复出现。主题名称概括用户任务、障碍机制或体验结果，例如“共同归位”“容器与空间适配”，不能使用“智能抽屉”“提醒灯”这类方案名称。`definition` 写清纳入边界。网页逐卡审阅时，“采纳”沿用 AI 主题；“修改后采纳”可改选其他 AI 主题或新增自定义主题。第二次 AI 综合按人工最终确认的主题重新分组，因此修改主题后必须重新综合。

v0.1 bundle 仍可读取，但会进入“未分组”；新的处理结果使用 v0.2。

`source_file` 相对 bundle 所在目录；`source_url` 可在把原始材料存进团队有权访问的协作空间后补上。`line_start/end` 使用原文件物理行号，从 1 开始。`quote` 必须是指定行范围中连续出现的原文，不能概括或拼接。若要引用不连续的句子，拆成多个 `excerpt`。`preceding_question` 可为空；非空时应出现在引文前一行。

## 四种证据类型

- `现场观察到的行为`：研究者在使用情境中亲见或视频记录到的行为。
- `用户自述过去的行为`：受访者称自己以前怎样做；不能改称现场观察。
- `用户表达的偏好／目标／感受`：想法与感受，不自动代表真实行为。
- `其他人转述的行为`：关于另一人的叙述，要保留转述关系。

照片只支持照片中可见的事实，仍需单独的来源记录；v0.1 暂不自动接收图片。

## 审议、设计机会与 HMW

`status` 可为 `待审`、`采纳`、`修改后采纳`、`驳回`。AI 生成时一律为 `待审`，`reviewer` 和 `review_reason` 留空。`reviewer` 是旧版 bundle 的兼容字段，网页不采集审议人；`review_reason` 在网页中显示为可选的“审议说明”。

网页逐卡审议层保存 `final_statement`、`final_applies_to` 和 `final_theme_id`，以及审议状态和可选的审议说明。逐卡阶段不填写用户结果、HMW 或方案，因为这些内容需要在同一主题下比较多条人工确认洞察后形成。

全部审议完成后，第二次 AI 综合为每个主题生成一条 `opportunity_statement`。它是设计机会方向：说明希望改善到什么用户状态，用于以后判断方案是否回应问题，不规定产品形式。HMW 是围绕该机会打开方案探索的问句，同一机会可有 1—2 条不同侧重点的 HMW。两者不按单张洞察机械生成。

网页工具 `get_synthesis_context` 返回设计问题、人工确认结果和 `review_revision`。写回 `set_design_synthesis` 时必须提交相同版本，并为每个含已采纳洞察的主题提供：`theme_id`、`source_insight_ids`、`opportunity_statement`、`open_questions`、1—2 条 `hmw_candidates`，以及 2—4 个 `concept_candidates`。每个方案种子包含唯一 `concept_id`、标题、详细 `summary`、2—4 条 `interaction_steps`、`expected_effect`、`validation_focus` 和供系统校验的 `responds_to_hmw_ids`。HMW 关联不进入面向人的简报。人工再修改采纳状态、最终结论、适用情境或主题时，旧综合结果失效，导出保持锁定，直到基于新版本重新生成。

后续设计需求应另建表，至少含需求 ID、所依据洞察 ID／HMW ID、期望改善的用户结果、约束、验证任务、版本；不要把“加抽屉”这类解决方案伪装成需求。

## 飞书多维表格

导出四张规范化 CSV：`01_访谈.csv`、`02_原始片段.csv`、`03_原子观察.csv`、`04_候选洞察.csv`；另有 `05_审阅卡片_快速导入.csv`，把原话与定位汇总进一张便于初次审阅的表。单表演示只导入第 5 张；长期使用时导入前四张，不能把第 5 张再当第五类实体。多值引用字段用 `；` 分隔稳定 ID；CSV 初版作为文本列使用。飞书关联记录须在记录创建后根据 `record_id` 建立，参见 [飞书落地规则](feishu.md)。

当前 CSV 是一次性导入快照。若协作库中已经有人工修改，不能简单全表覆盖；先按 ID 比对并保留审议字段。真正双向同步属于后续版本。

飞书旧表中的 `reviewer`、`review_reason` 与审议状态仍由设计师维护；AI 再次运行时不得重置。独立网页不再采集 `reviewer`。真正双向同步仍属于后续版本。

## 面向方案构思的交接简报

独立网页在浏览器审议层额外保存 `final_statement`（人工确认的最终洞察结论）和 `final_applies_to`（适用人群与情境）。它们不属于 AI 初始 bundle，也不回写源 JSON。采纳或修改后采纳时两项均需由审议者确认；驳回只保留在审议记录中。

简报必须等所有候选洞察完成审议且第二次 AI 综合版本与当前审阅版本一致后生成。正文按人工最终确认的主题分组，收录人工确认的最终表述、适用情境、可选审议说明，以及第二次综合得到的设计机会方向、HMW、详细创意方案和待验证问题；不用内部稳定 ID 充当面向人的标题，也不显示方案与 HMW 的内部关联或 AI 的内部综合过程。审议说明若填写，以对应洞察下方的小字显示。当前网页提供复制正文、Markdown 与 HTML 下载，并通过浏览器打印功能下载 PDF；浏览器审议记录尚未双向同步到飞书。
