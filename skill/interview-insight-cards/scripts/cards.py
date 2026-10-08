#!/usr/bin/env python3
"""Validate source-linked insight cards and export Feishu Bitable CSV snapshots."""

import argparse
import csv
import json
import sys
from pathlib import Path


EVIDENCE_TYPES = {
    "现场观察到的行为",
    "用户自述过去的行为",
    "用户表达的偏好／目标／感受",
    "其他人转述的行为",
}
STATUSES = {"待审", "采纳", "修改后采纳", "驳回"}


def required(value, label, errors):
    if value is None or value == "" or value == []:
        errors.append(f"{label} 缺失")


def ids(rows, field, errors):
    found = set()
    for row in rows:
        value = row.get(field)
        required(value, field, errors)
        if value in found:
            errors.append(f"{field} 重复：{value}")
        found.add(value)
    return found


def load_and_validate(path):
    data = json.loads(path.read_text(encoding="utf-8"))
    errors = []
    version = data.get("schema_version")
    if version not in {"0.1", "0.2"}:
        errors.append("schema_version 应为 0.1 或 0.2")
    project = data.get("project", {})
    for key in ("project_id", "research_question", "question_version"):
        required(project.get(key), f"project.{key}", errors)

    sessions = data.get("sessions", [])
    excerpts = data.get("excerpts", [])
    observations = data.get("observations", [])
    insights = data.get("insights", [])
    themes = data.get("themes", [])
    session_ids = ids(sessions, "session_id", errors)
    excerpt_ids = ids(excerpts, "excerpt_id", errors)
    observation_ids = ids(observations, "observation_id", errors)
    ids(insights, "insight_id", errors)
    theme_ids = ids(themes, "theme_id", errors) if themes else set()
    if version == "0.2" and not themes:
        errors.append("v0.2 bundle 缺少 themes")
    for theme in themes:
        tid = theme.get("theme_id")
        required(theme.get("label"), f"{tid}.label", errors)
        required(theme.get("definition"), f"{tid}.definition", errors)

    session_map = {}
    source_lines = {}
    for session in sessions:
        sid = session.get("session_id")
        session_map[sid] = session
        for key in ("participant_code", "date", "method", "source_file", "transcript_version", "use_scope"):
            required(session.get(key), f"{sid}.{key}", errors)
        source = path.parent / str(session.get("source_file", ""))
        if source.is_file():
            source_lines[sid] = source.read_text(encoding="utf-8").splitlines()
        else:
            errors.append(f"{sid} 找不到原文件：{source}")

    for excerpt in excerpts:
        eid = excerpt.get("excerpt_id")
        sid = excerpt.get("session_id")
        if sid not in session_ids:
            errors.append(f"{eid} 引用了不存在的 session_id：{sid}")
            continue
        start, end = excerpt.get("line_start"), excerpt.get("line_end")
        lines = source_lines.get(sid, [])
        if not isinstance(start, int) or not isinstance(end, int) or start < 1 or end < start or end > len(lines):
            errors.append(f"{eid} 行号无效：{start}-{end}")
            continue
        span = "\n".join(lines[start - 1:end])
        quote = excerpt.get("quote", "")
        if not quote or quote not in span:
            errors.append(f"{eid} 原话不是第 {start}-{end} 行中的连续文字")
        question = excerpt.get("preceding_question", "")
        if question and (start == 1 or question not in lines[start - 2]):
            errors.append(f"{eid} 相邻提问未出现在引文的前一行")
        required(excerpt.get("speaker"), f"{eid}.speaker", errors)

    for observation in observations:
        oid = observation.get("observation_id")
        refs = observation.get("excerpt_ids", [])
        required(refs, f"{oid}.excerpt_ids", errors)
        for ref in refs:
            if ref not in excerpt_ids:
                errors.append(f"{oid} 引用了不存在的 excerpt_id：{ref}")
        if observation.get("evidence_type") not in EVIDENCE_TYPES:
            errors.append(f"{oid} 证据类型无效")
        required(observation.get("action"), f"{oid}.action", errors)
        if not isinstance(observation.get("unknown"), list):
            errors.append(f"{oid}.unknown 应为列表")

    for insight in insights:
        iid = insight.get("insight_id")
        if version == "0.2" and insight.get("theme_id") not in theme_ids:
            errors.append(f"{iid} 引用了不存在的 theme_id：{insight.get('theme_id')}")
        required(insight.get("statement"), f"{iid}.statement", errors)
        support = insight.get("support_observation_ids", [])
        required(support, f"{iid}.support_observation_ids", errors)
        for ref in support + insight.get("limiting_observation_ids", []):
            if ref not in observation_ids:
                errors.append(f"{iid} 引用了不存在的 observation_id：{ref}")
        if insight.get("status") not in STATUSES:
            errors.append(f"{iid} 审议状态无效")
        if insight.get("status") != "待审" and not insight.get("reviewer"):
            errors.append(f"{iid} 已审议但缺少审议人")
        if insight.get("status") != "待审" and not insight.get("review_reason"):
            errors.append(f"{iid} 已审议但缺少审议理由")
        if not isinstance(insight.get("alternative_explanations"), list):
            errors.append(f"{iid}.alternative_explanations 应为列表")
        if not isinstance(insight.get("open_questions"), list):
            errors.append(f"{iid}.open_questions 应为列表")
    return data, errors


def joined(value):
    return "；".join(value) if isinstance(value, list) else (value or "")


def write_csv(path, columns, rows):
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def export(data, output):
    output.mkdir(parents=True, exist_ok=True)
    project = data["project"]
    sessions = data["sessions"]
    session_map = {row["session_id"]: row for row in sessions}
    files = []

    rows = [{"项目ID": project["project_id"], "研究问题": project["research_question"],
             "问题版本": project["question_version"], "访谈ID": s["session_id"],
             "受访者匿名编号": s["participant_code"], "日期": s["date"], "方法": s["method"],
             "情境": s.get("context", ""), "原文件": s["source_file"], "原文件URL": s.get("source_url", ""),
             "转录版本": s["transcript_version"], "使用范围": s["use_scope"]} for s in sessions]
    files.append(("01_访谈.csv", list(rows[0]) if rows else [], rows))

    rows = []
    for e in data["excerpts"]:
        s = session_map[e["session_id"]]
        rows.append({"片段ID": e["excerpt_id"], "项目ID": project["project_id"], "访谈ID": e["session_id"], "受访者匿名编号": s["participant_code"],
                     "说话人": e["speaker"], "原话": e["quote"], "相邻提问": e.get("preceding_question", ""),
                     "起始行": e["line_start"], "结束行": e["line_end"],
                     "来源定位": f'{s["source_file"]}#L{e["line_start"]}-L{e["line_end"]}',
                     "原文件URL": s.get("source_url", "")})
    files.append(("02_原始片段.csv", list(rows[0]) if rows else [], rows))

    rows = [{"观察ID": o["observation_id"], "项目ID": project["project_id"], "片段ID": joined(o["excerpt_ids"]),
             "证据类型": o["evidence_type"], "任务": o.get("task", ""), "动作": o["action"],
             "对象": o.get("object", ""), "情境": o.get("context", ""), "阻碍": o.get("obstacle", ""),
             "直接后果": o.get("consequence", ""), "应对办法": o.get("workaround", ""),
             "未知信息": joined(o.get("unknown", []))} for o in data["observations"]]
    files.append(("03_原子观察.csv", list(rows[0]) if rows else [], rows))

    theme_map = {row["theme_id"]: row for row in data.get("themes", [])}
    rows = [{"洞察ID": i["insight_id"], "项目ID": project["project_id"],
             "主题ID": i.get("theme_id", ""), "主题": theme_map.get(i.get("theme_id"), {}).get("label", "未分组"),
             "候选问题陈述": i["statement"], "适用用户与场景": i.get("applies_to", ""),
             "支持观察ID": joined(i["support_observation_ids"]),
             "相反或限定观察ID": joined(i.get("limiting_observation_ids", [])),
             "其他可能解释": joined(i.get("alternative_explanations", [])),
             "待验证问题": joined(i.get("open_questions", [])), "审议状态": i["status"],
             "审议人": i.get("reviewer", ""), "审议理由": i.get("review_reason", "")} for i in data["insights"]]
    files.append(("04_候选洞察.csv", list(rows[0]) if rows else [], rows))

    observation_map = {o["observation_id"]: o for o in data["observations"]}
    excerpt_map = {e["excerpt_id"]: e for e in data["excerpts"]}
    review_rows = []
    for insight in data["insights"]:
        support = insight["support_observation_ids"]
        limiting = insight.get("limiting_observation_ids", [])

        def evidence_lines(refs):
            lines = []
            for oid in refs:
                observation = observation_map[oid]
                for eid in observation["excerpt_ids"]:
                    excerpt = excerpt_map[eid]
                    lines.append(f'{oid} / {eid} / {excerpt["session_id"]} L{excerpt["line_start"]}: {excerpt["quote"]}')
            return "\n".join(lines)

        review_rows.append({
            "洞察ID": insight["insight_id"],
            "项目ID": project["project_id"],
            "主题ID": insight.get("theme_id", ""),
            "主题": theme_map.get(insight.get("theme_id"), {}).get("label", "未分组"),
            "候选问题陈述": insight["statement"],
            "适用用户与场景": insight.get("applies_to", ""),
            "支持原话与定位": evidence_lines(support),
            "限定原话与定位": evidence_lines(limiting),
            "支持观察摘要": "\n".join(f'{oid}: {observation_map[oid]["action"]}' for oid in support),
            "其他可能解释": joined(insight.get("alternative_explanations", [])),
            "待验证问题": joined(insight.get("open_questions", [])),
            "审议状态": insight["status"],
            "审议人": insight.get("reviewer", ""),
            "审议理由": insight.get("review_reason", ""),
        })
    files.append(("05_审阅卡片_快速导入.csv", list(review_rows[0]) if review_rows else [], review_rows))

    for filename, columns, rows in files:
        write_csv(output / filename, columns, rows)
        print(f"{output / filename}: {len(rows)} 行")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("index").add_argument("transcript", type=Path)
    sub.add_parser("validate").add_argument("bundle", type=Path)
    exp = sub.add_parser("export")
    exp.add_argument("bundle", type=Path)
    exp.add_argument("output", type=Path)
    args = parser.parse_args()
    if args.command == "index":
        for number, line in enumerate(args.transcript.read_text(encoding="utf-8").splitlines(), 1):
            print(f"{number:04d} | {line}")
        return 0
    data, errors = load_and_validate(args.bundle)
    if errors:
        for error in errors:
            print(f"错误：{error}", file=sys.stderr)
        return 1
    print("校验通过")
    if args.command == "export":
        export(data, args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
