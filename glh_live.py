#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""抓取格隆汇 7x24 快讯（https://www.gelonghui.com/live/）。

原理：该页是 Nuxt SSR，快讯数据直接以 JSON 形式注入在 window.__NUXT__ 里，
无需跑 JS，直接正则拆分 title/content 即可。

用法：
    python3 glh_live.py                # 默认打印最新 15 条
    python3 glh_live.py --limit 5      # 只看前 5 条
    python3 glh_live.py --filter 黄金    # 只保留标题/正文包含「黄金」的
    python3 glh_live.py --json         # 输出原始 JSON（便于下游处理）

依赖：仅标准库 urllib。
"""
import re
import sys
import json
import urllib.request

URL = "https://www.gelonghui.com/live/"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"


def unesc(s):
    """还原 JSON 字符串里的转义（/ /、\" 引号等）。"""
    return (s.replace("\\u002F", "/").replace("\\/", "/")
             .replace('\\"', '"').replace("\\n", " "))


def fetch_live():
    req = urllib.request.Request(URL, headers={"User-Agent": UA})
    html = urllib.request.urlopen(req, timeout=25).read().decode("utf-8", "ignore")
    idx = html.find("window.__NUXT__=")
    if idx < 0:
        raise RuntimeError("未找到 __NUXT__ 载荷，页面结构可能变化")
    payload = html[idx:]  # 只在 NUXT 内匹配，避开 <style> 里 iconfont 的 content:"\e664"

    items = []
    for tm in re.finditer(r'title:"((?:\\.|[^"\\])*)"', payload):
        after = payload[tm.end():tm.end() + 600]
        cm = re.search(r'content:"((?:\\.|[^"\\])*)"', after)
        if not cm:
            continue
        title = unesc(tm.group(1))
        content = unesc(cm.group(1))
        if len(content) < 15:  # 跳过 CSS 字形等噪声
            continue
        items.append({"title": title, "content": content})
    return items


def main():
    limit = 15
    keyword = None
    as_json = False
    args = sys.argv[1:]
    for i, a in enumerate(args):
        if a in ("--limit", "-l"):
            limit = int(args[i + 1])
        elif a in ("--filter", "-f"):
            keyword = args[i + 1]
        elif a in ("--json", "-j"):
            as_json = True

    items = fetch_live()
    if keyword:
        items = [it for it in items if keyword in it["title"] or keyword in it["content"]]
    items = items[:limit]

    if as_json:
        json.dump(items, ensure_ascii=False, indent=2)
        return

    for it in items:
        body = it["content"].replace("｜", " | ")
        print(f"◆ {it['title']}\n  {body[:300]}\n")


if __name__ == "__main__":
    main()
