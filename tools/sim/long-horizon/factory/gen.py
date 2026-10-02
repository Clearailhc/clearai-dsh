"""任务三的工厂数据:两个月的报工记录,真因与干扰项事先写死(答案见 answer-key.md)。

    python3 gen.py <输出目录>   → month-08.csv、month-09.csv、README.md(数据字典,给模型看)

八月:供应商 S-B 的批次 B0723(8 月 10 日起投用)在相对湿度 > 65% 时缺陷率高;
     夜班湿度更高、而且 B0723 多排在夜班,所以「夜班」与良率相关但只是混杂。
九月:B0723 在 9 月 5 日停用;但二号线 3 号工位的压合机从 9 月 10 日起磨损,缺陷率逐日上升,
     良率没有恢复。另外九月起「良率」口径改为返工后合格率(会话二由人告知)。
"""
import csv
import math
import os
import random
import sys
from datetime import date, timedelta

OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
os.makedirs(OUT, exist_ok=True)
rng = random.Random(20261002)

LINES = {'L1': ['ST1', 'ST2', 'ST3', 'ST4'], 'L2': ['ST1', 'ST2', 'ST3', 'ST4']}
OPERATORS = {('L1', 'day'): ['OP11', 'OP12', 'OP13'], ('L1', 'night'): ['OP14', 'OP15'], ('L2', 'day'): ['OP21', 'OP22', 'OP23'], ('L2', 'night'): ['OP24', 'OP25']}
SUPPLIER_LOTS = {
    'S-A': ['A0701', 'A0715', 'A0729', 'A0812', 'A0826', 'A0909', 'A0923'],
    'S-B': ['B0708', 'B0723', 'B0806', 'B0820', 'B0903', 'B0917'],
}


def lot_available(lot, day):
    """批次按编号里的月日到货,一个批次用约 3 周;B0723 特殊:8/10 起才投用、9/5 停用。"""
    if lot == 'B0723':
        return date(2026, 8, 10) <= day < date(2026, 9, 5)
    month, dd = int(lot[1:3]), int(lot[3:5])
    start = date(2026, month, dd)
    return start <= day < start + timedelta(days=21)


def humidity(day, shift):
    base = 58 + 8 * math.sin((day.toordinal() % 17) / 17 * 2 * math.pi)
    return round(base + (7 if shift == 'night' else 0) + rng.gauss(0, 3), 1)


def defect_prob(row, day):
    p = 0.025
    if row['lot'] == 'B0723' and row['humidity_pct'] > 65:
        p += 0.16
    elif row['lot'] == 'B0723':
        p += 0.01
    if row['line'] == 'L2' and row['station'] == 'ST3' and day >= date(2026, 9, 10):
        p += 0.01 * (day - date(2026, 9, 10)).days
    if row['operator'] == 'OP15':
        p += 0.004  # 一点点真实但很小的人员差异,不是主因
    return min(p, 0.6)


def month_rows(first, last):
    rows = []
    day = first
    while day <= last:
        for line, stations in LINES.items():
            for shift in ('day', 'night'):
                rh = humidity(day, shift)
                lots = [lot for sup in SUPPLIER_LOTS.values() for lot in sup if lot_available(lot, day)]
                for station in stations:
                    for _ in range(rng.randint(3, 5)):  # 每班每工位几个工单
                        # B0723 有货时,夜班 70% 用它,白班 25%
                        if 'B0723' in lots and rng.random() < (0.7 if shift == 'night' else 0.25):
                            lot = 'B0723'
                        else:
                            lot = rng.choice([l for l in lots if l != 'B0723'] or lots)
                        row = {
                            'date': day.isoformat(), 'line': line, 'station': station, 'shift': shift,
                            'operator': rng.choice(OPERATORS[(line, shift)]),
                            'supplier': 'S-B' if lot.startswith('B') else 'S-A', 'lot': lot,
                            'humidity_pct': round(rh + rng.gauss(0, 1), 1), 'temp_c': round(24 + rng.gauss(0, 1.2) + (-1.5 if shift == 'night' else 0), 1),
                            'units': rng.randint(40, 60),
                        }
                        p = defect_prob(row, day)
                        bad = sum(1 for _ in range(row['units']) if rng.random() < p)
                        # 返工能救回约 60% 的缺陷;压合机磨损造成的缺陷救不回(结构损伤)
                        wear = row['line'] == 'L2' and row['station'] == 'ST3' and day >= date(2026, 9, 10)
                        rescued = sum(1 for _ in range(bad) if rng.random() < (0.15 if wear else 0.6))
                        row['first_pass_ok'] = row['units'] - bad
                        row['final_ok'] = row['units'] - bad + rescued
                        rows.append(row)
        day += timedelta(days=1)
    return rows


FIELDS = ['date', 'line', 'station', 'shift', 'operator', 'supplier', 'lot', 'humidity_pct', 'temp_c', 'units', 'first_pass_ok', 'final_ok']
for name, first, last in (('month-08.csv', date(2026, 8, 1), date(2026, 8, 31)), ('month-09.csv', date(2026, 9, 1), date(2026, 9, 30))):
    with open(os.path.join(OUT, name), 'w', newline='') as fh:
        writer = csv.DictWriter(fh, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(month_rows(first, last))

with open(os.path.join(OUT, 'README.md'), 'w') as fh:
    fh.write('''# 报工数据字典

每行是一个工单在一个工位上的一班生产。

| 列 | 含义 |
|---|---|
| date | 生产日期 |
| line / station | 产线(L1、L2)与工位(ST1–ST4) |
| shift | 班次:day 08–20 点,night 20–08 点 |
| operator | 操作工编号 |
| supplier / lot | 主材供应商与来料批次 |
| humidity_pct / temp_c | 车间相对湿度与温度(班次平均) |
| units | 投入数量 |
| first_pass_ok | 一次检验合格数 |
| final_ok | 返工后最终合格数 |

公司一直按「一次检验合格数 / 投入数量」计算良率。
''')
print('ok')
