#!/usr/bin/env python3
import json
import re
import subprocess
from pathlib import Path

MONTHS = {
  'JANUARY': '01','FEBRUARY':'02','MARCH':'03','APRIL':'04','MAY':'05','JUNE':'06',
  'JULY':'07','AUGUST':'08','SEPTEMBER':'09','OCTOBER':'10','NOVEMBER':'11','DECEMBER':'12'
}

TIME_HEIGHT_RE = re.compile(r'(\d{4})\s+(\d\.\d{2})')
DAY_RE = re.compile(r'^\s*(\d{1,2})\b')  # used only when 1-31


def pdftotext_layout(pdf_path: Path, page: int) -> str:
    # 1-indexed pages
    cmd = ['pdftotext', '-layout', '-f', str(page), '-l', str(page), str(pdf_path), '-']
    return subprocess.check_output(cmd, text=True, errors='ignore')


def get_month_columns(header_line: str, max_len: int):
    # find month name occurrences and their start indices
    hits = []
    for m in MONTHS.keys():
        i = header_line.find(m)
        if i != -1:
            hits.append((i, m))
    hits.sort()
    if len(hits) < 1:
        return []
    cols = []
    for idx, (start, name) in enumerate(hits):
        end = hits[idx+1][0] if idx+1 < len(hits) else max_len
        cols.append((name, start, end))
    return cols


def classify_events(events):
    # Expect 3-4 events; classify highs/lows by relative height
    if not events:
        return events
    hs = [e['height'] for e in events if e.get('height') is not None]
    if not hs:
        return events
    # threshold = median
    hs_sorted = sorted(hs)
    mid = hs_sorted[len(hs_sorted)//2]
    for e in events:
        e['type'] = 'high' if e['height'] >= mid else 'low'
    return events


def parse_station(pdf_path: Path, station_id: str, year: int = 2026, strict_day: bool = False):
    # pdf seems 4 pages, each page has 4 months columns
    days = {}

    # detect pages count with pdfinfo if available
    pages = 4
    try:
        out = subprocess.check_output(['pdfinfo', str(pdf_path)], text=True, errors='ignore')
        m = re.search(r'^Pages:\s+(\d+)', out, re.M)
        if m:
            pages = int(m.group(1))
    except Exception:
        pass

    for p in range(1, pages+1):
        txt = pdftotext_layout(pdf_path, p)
        lines = txt.splitlines()

        # find the first line that contains multiple month headers (or a single month)
        header_idx = None
        for i, line in enumerate(lines[:80]):
            if any(mon in line for mon in MONTHS.keys()):
                header_idx = i
                break
        if header_idx is None:
            continue

        header_line = lines[header_idx]
        max_len = max(len(x) for x in lines) if lines else len(header_line)
        cols = get_month_columns(header_line, max_len)
        if not cols:
            continue

        # parse subsequent lines; each month is a fixed-width slice
        cur_day = {m: None for (m, _, _) in cols}
        for line in lines[header_idx+1:]:
            if not line.strip():
                continue
            for mon_name, start, end in cols:
                chunk = line[start:end]

                mday = DAY_RE.match(chunk)
                day = None
                if mday:
                    dnum = int(mday.group(1))
                    if 1 <= dnum <= 31:
                        day = dnum
                        cur_day[mon_name] = dnum

                if not strict_day:
                    day = day or cur_day.get(mon_name)

                if not day:
                    continue

                pairs = TIME_HEIGHT_RE.findall(chunk)
                if not pairs:
                    continue

                date = f"{year}-{MONTHS[mon_name]}-{day:02d}"
                evs = days.get(date, [])
                for t, h in pairs:
                    evs.append({
                        'time': f"{t[:2]}:{t[2:]}",
                        'height': float(h),
                    })
                days[date] = evs

    # de-dup and sort events by time
    for d, evs in list(days.items()):
        # unique by (time,height)
        seen = set()
        uniq = []
        for e in evs:
            k = (e['time'], e['height'])
            if k in seen:
                continue
            seen.add(k)
            uniq.append(e)
        uniq.sort(key=lambda x: x['time'])
        days[d] = classify_events(uniq)

    return {
        'stationId': station_id,
        'year': year,
        'timezone': 'Australia/Adelaide',
        'days': days,
        'bomDisclaimer': "The Bureau of Meteorology gives no warranty of any kind whether express, implied, statutory or otherwise in respect to the availability, accuracy, currency, completeness, quality or reliability of the information... The Bureau's liability for any loss, damage, cost or expense resulting from use of, or reliance on, the information is entirely excluded.",
        'bomAttribution': '© Commonwealth of Australia 2025, Bureau of Meteorology',
    }


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('--port-adelaide', required=True)
    ap.add_argument('--victor-harbor', required=True)
    ap.add_argument('--out', required=True)
    args = ap.parse_args()

    pa = parse_station(Path(args.port_adelaide), 'bom_port_adelaide_outer_harbor', strict_day=False)
    vh = parse_station(Path(args.victor_harbor), 'bom_victor_harbor', strict_day=True)

    out = {
        'generatedAtUtc': __import__('datetime').datetime.utcnow().isoformat(timespec='seconds') + 'Z',
        'stations': {
            pa['stationId']: pa,
            vh['stationId']: vh,
        }
    }

    Path(args.out).write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
