#!/usr/bin/env python3
"""Append validated interview evidence to an existing four-table Feishu Base.

Existing (project ID, stable ID) records are left untouched, including reviews.
This intentionally does not synchronize edits or create the Base schema.
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

from cards import joined, load_and_validate


TABLES = {
    "sessions": ("访谈来源", "访谈ID"),
    "excerpts": ("原始片段", "片段ID"),
    "observations": ("原子观察", "观察ID"),
    "insights": ("候选洞察", "洞察ID"),
}
REQUIRED_FIELDS = {
    "sessions": {**dict.fromkeys(("访谈ID", "项目ID", "研究问题", "问题版本", "受访者匿名编号",
                                    "日期", "方法", "情境", "原文件", "原文件URL", "转录版本", "使用范围"), "text"),
                 "资料性质": "select"},
    "excerpts": {**dict.fromkeys(("片段ID", "项目ID", "访谈ID", "受访者匿名编号", "说话人",
                                    "原话", "相邻提问", "来源定位", "原文件URL"), "text"),
                 "起始行": "number", "结束行": "number", "关联访谈": "link"},
    "observations": {**dict.fromkeys(("观察ID", "项目ID", "片段ID", "任务", "动作", "对象",
                                        "情境", "阻碍", "直接后果", "应对办法", "未知信息"), "text"),
                     "证据类型": "select", "关联片段": "link"},
    "insights": {**dict.fromkeys(("洞察ID", "项目ID", "候选问题陈述", "适用用户与场景",
                                    "支持观察ID", "相反或限定观察ID", "支持原话与定位", "限定原话与定位",
                                    "其他可能解释", "待验证问题", "审议人", "审议理由"), "text"),
                 "关联支持观察": "link", "关联限定观察": "link", "审议状态": "select"},
}


def cli(*args):
    result = subprocess.run(["lark-cli", *args], capture_output=True, text=True)
    try:
        response = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"飞书 CLI 没有返回 JSON：{result.stderr[-300:]}") from exc
    if result.returncode or not response.get("ok"):
        raise RuntimeError(json.dumps(response.get("error", response), ensure_ascii=False))
    return response["data"]


def table_ids(base, identity):
    data = cli("base", "+table-list", "--base-token", base, "--as", identity, "--json")
    by_name = {row["name"]: row["id"] for row in data["tables"]}
    missing = [name for name, _ in TABLES.values() if name not in by_name]
    if missing:
        raise RuntimeError(f"Base 缺少数据表：{', '.join(missing)}")
    return {key: by_name[name] for key, (name, _) in TABLES.items()}


def check_fields(base, tables, identity):
    for key, table_id in tables.items():
        data = cli("base", "+field-list", "--base-token", base,
                   "--table-id", table_id, "--as", identity, "--json")
        fields = {row["name"]: row["type"] for row in data["fields"]}
        for name, expected in REQUIRED_FIELDS[key].items():
            if fields.get(name) != expected:
                raise RuntimeError(f"{TABLES[key][0]}.{name} 应为 {expected} 字段")


def existing_ids(base, table_id, id_field, project_id, identity):
    """Read only the two stable-key columns, handling the CLI's paginated matrix."""
    found = {}
    offset = 0
    while True:
        data = cli("base", "+record-list", "--base-token", base,
                   "--table-id", table_id, "--field-id", "项目ID",
                   "--field-id", id_field, "--offset", str(offset),
                   "--limit", "200", "--as", identity, "--json")
        names = data["fields"]
        rows = data.get("data", [])
        record_ids = data.get("record_id_list", [])
        for values, record_id in zip(rows, record_ids):
            row = dict(zip(names, values))
            if row.get("项目ID") != project_id:
                continue
            stable_id = row.get(id_field)
            if stable_id in found:
                raise RuntimeError(f"{TABLES_BY_ID[id_field]} 出现重复的 {project_id}/{stable_id}")
            if stable_id:
                found[stable_id] = record_id
        if not data.get("has_more"):
            break
        offset += len(rows)
        if not rows:
            raise RuntimeError("飞书分页没有前进，已停止以避免死循环")
    return found


TABLES_BY_ID = {id_field: name for name, id_field in TABLES.values()}


def create_missing(base, table_id, stable_field, planned, existing, identity):
    new = [(stable_id, fields) for stable_id, fields in planned if stable_id not in existing]
    for start in range(0, len(new), 200):
        batch = new[start:start + 200]
        data = cli("base", "+record-batch-create", "--base-token", base,
                   "--table-id", table_id,
                   "--json", json.dumps({"create_records": [fields for _, fields in batch]}, ensure_ascii=False),
                   "--as", identity)
        returned = data.get("record_id_list", [])
        if len(returned) != len(batch):
            raise RuntimeError(f"{stable_field} 写入数与返回的记录 ID 数不符，请检查飞书表格后再重试")
        existing.update(zip((stable_id for stable_id, _ in batch), returned))
    return len(new), len(planned) - len(new)


def optional_fields(row):
    return {key: value for key, value in row.items() if value not in (None, "", [])}


def link(ids):
    return [{"id": record_id} for record_id in ids]


def evidence_lines(observation_ids, observation_map, excerpt_map):
    lines = []
    for observation_id in observation_ids:
        for excerpt_id in observation_map[observation_id]["excerpt_ids"]:
            excerpt = excerpt_map[excerpt_id]
            lines.append(f'{observation_id} / {excerpt_id} / {excerpt["session_id"]} '
                         f'L{excerpt["line_start"]}: {excerpt["quote"]}')
    return "\n".join(lines)


def publish(bundle_path, base, identity, demo, source_docs):
    bundle, errors = load_and_validate(bundle_path)
    if errors:
        raise RuntimeError("资料校验失败：\n" + "\n".join(errors))
    if any(row["status"] != "待审" for row in bundle["insights"]):
        raise RuntimeError("发布文件中的候选洞察必须全部为“待审”；人工审议结果只在飞书维护")
    project = bundle["project"]
    project_id = project["project_id"]
    if demo and not project_id.startswith("DEMO-"):
        raise RuntimeError("--demo 只允许项目 ID 以 DEMO- 开头的材料")
    tables = table_ids(base, identity)
    check_fields(base, tables, identity)
    known = {key: existing_ids(base, tables[key], id_field, project_id, identity)
             for key, (_, id_field) in TABLES.items()}
    counts = {}

    sessions = []
    for session in bundle["sessions"]:
        source_url = source_docs.get(session["session_id"]) or session.get("source_url", "")
        fields = optional_fields({
            "访谈ID": session["session_id"], "项目ID": project_id,
            "研究问题": project["research_question"], "问题版本": project["question_version"],
            "受访者匿名编号": session["participant_code"], "日期": session["date"],
            "方法": session["method"], "情境": session.get("context", ""),
            "原文件": session["source_file"], "原文件URL": source_url,
            "转录版本": session["transcript_version"], "使用范围": session["use_scope"],
            "资料性质": ["模拟" if demo else "真实"],
        })
        sessions.append((session["session_id"], fields))
    counts["访谈来源"] = create_missing(base, tables["sessions"], "访谈ID", sessions,
                                   known["sessions"], identity)

    session_map = {row["session_id"]: row for row in bundle["sessions"]}
    excerpts = []
    for excerpt in bundle["excerpts"]:
        session = session_map[excerpt["session_id"]]
        source_url = source_docs.get(excerpt["session_id"]) or session.get("source_url", "")
        fields = optional_fields({
            "片段ID": excerpt["excerpt_id"], "项目ID": project_id,
            "访谈ID": excerpt["session_id"], "关联访谈": link([known["sessions"][excerpt["session_id"]]]),
            "受访者匿名编号": session["participant_code"], "说话人": excerpt["speaker"],
            "原话": excerpt["quote"], "相邻提问": excerpt.get("preceding_question", ""),
            "起始行": excerpt["line_start"], "结束行": excerpt["line_end"],
            "来源定位": f'{session["source_file"]}#L{excerpt["line_start"]}-L{excerpt["line_end"]}',
            "原文件URL": source_url,
        })
        excerpts.append((excerpt["excerpt_id"], fields))
    counts["原始片段"] = create_missing(base, tables["excerpts"], "片段ID", excerpts,
                                   known["excerpts"], identity)

    observations = []
    for observation in bundle["observations"]:
        fields = optional_fields({
            "观察ID": observation["observation_id"], "项目ID": project_id,
            "片段ID": joined(observation["excerpt_ids"]),
            "关联片段": link(known["excerpts"][eid] for eid in observation["excerpt_ids"]),
            "证据类型": [observation["evidence_type"]], "任务": observation.get("task", ""),
            "动作": observation["action"], "对象": observation.get("object", ""),
            "情境": observation.get("context", ""), "阻碍": observation.get("obstacle", ""),
            "直接后果": observation.get("consequence", ""),
            "应对办法": observation.get("workaround", ""),
            "未知信息": joined(observation.get("unknown", [])),
        })
        observations.append((observation["observation_id"], fields))
    counts["原子观察"] = create_missing(base, tables["observations"], "观察ID", observations,
                                   known["observations"], identity)

    observation_map = {row["observation_id"]: row for row in bundle["observations"]}
    excerpt_map = {row["excerpt_id"]: row for row in bundle["excerpts"]}
    insights = []
    for insight in bundle["insights"]:
        support = insight["support_observation_ids"]
        limiting = insight.get("limiting_observation_ids", [])
        fields = optional_fields({
            "洞察ID": insight["insight_id"], "项目ID": project_id,
            "候选问题陈述": insight["statement"],
            "适用用户与场景": insight.get("applies_to", ""),
            "支持观察ID": joined(support),
            "关联支持观察": link(known["observations"][oid] for oid in support),
            "相反或限定观察ID": joined(limiting),
            "关联限定观察": link(known["observations"][oid] for oid in limiting),
            "支持原话与定位": evidence_lines(support, observation_map, excerpt_map),
            "限定原话与定位": evidence_lines(limiting, observation_map, excerpt_map),
            "其他可能解释": joined(insight.get("alternative_explanations", [])),
            "待验证问题": joined(insight.get("open_questions", [])),
            "审议状态": ["待审"],
        })
        insights.append((insight["insight_id"], fields))
    counts["候选洞察"] = create_missing(base, tables["insights"], "洞察ID", insights,
                                   known["insights"], identity)
    return counts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle", type=Path)
    parser.add_argument("--base-token", required=True)
    parser.add_argument("--as", dest="identity", choices=("user", "bot"), default="user")
    parser.add_argument("--demo", action="store_true", help="将来源标成模拟资料")
    parser.add_argument("--source-doc-map", type=Path, help="访谈 ID → 飞书逐字稿 URL 的 JSON；也接受飞书试跑状态.json")
    args = parser.parse_args()
    docs = {}
    if args.source_doc_map:
        docs = json.loads(args.source_doc_map.read_text(encoding="utf-8"))
        docs = docs.get("source_docs", docs)
    try:
        counts = publish(args.bundle, args.base_token, args.identity, args.demo, docs)
    except (RuntimeError, OSError, KeyError, ValueError) as exc:
        print(f"发布失败：{exc}", file=sys.stderr)
        return 1
    for name, (created, skipped) in counts.items():
        print(f"{name}：新增 {created}，已有跳过 {skipped}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
