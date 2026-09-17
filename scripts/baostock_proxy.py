#!/usr/bin/env python3
"""Baostock sidecar for FanliQuant.

真实抓取 Baostock 日线数据并以 JSON 输出，供 Node 主进程调用。
环境要求：pip install baostock
用法：python scripts/baostock_proxy.py --code sh.600519 --start 2020-01-01 --end 2026-09-16
"""
import argparse
import json
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--code", required=True)
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", required=True)
    parser.add_argument("--adjustflag", default="3")
    args = parser.parse_args()

    try:
        import baostock as bs
    except ImportError:
        print(json.dumps({"error": "baostock not installed"}))
        return 1

    lg = bs.login()
    if lg.error_code != "0":
        print(json.dumps({"error": lg.error_msg}))
        return 1

    fields = "date,code,open,high,low,close,preclose,volume,amount,adjustflag,turn,tradestatus,pctChg,isST"
    rs = bs.query_history_k_data_plus(
        args.code, fields, start_date=args.start, end_date=args.end,
        frequency="d", adjustflag=args.adjustflag
    )
    rows = []
    while rs.error_code == "0" and rs.next():
        rows.append(rs.get_row_data())

    bs.logout()

    # 转成对象数组，字段与 Node 端 BAOSTOCK_FIELDS 对齐
    cols = fields.split(",")
    data = [dict(zip(cols, r)) for r in rows]
    print(json.dumps({"rows": data}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
