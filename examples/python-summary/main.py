import json
import sys
from collections import Counter

value = json.load(sys.stdin)
items = value.get("items", [])
if not isinstance(items, list) or len(items) > 100:
    raise ValueError("items 必须为不超过 100 条的数组")
counts = Counter(str(item.get("status", "待确认"))[:80] for item in items)
lines = ["# 需求状态汇总", "", f"共 {len(items)} 条需求", ""]
lines += [f"- {status.replace(chr(10), ' ')}：{count}" for status, count in counts.items()]
with open("summary.md", "w", encoding="utf-8") as output:
    output.write("\n".join(lines) + "\n")
print("已生成 summary.md，请查看本次结果目录。")
