# 数据字典 (Data Dictionary)

| 字段名称 (Field) | 物理含义 (Meaning) | 单位 (Unit) | 数据类型 (Type) | 精度 (Precision) | 采样频率 (Hz) | 来源地址 (Source) | 备注 (Remarks) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `timestamp` | 采样时间戳 | `ISO8601` | `datetime` | `ms` | - | - | 必须单调递增 |
| `batch_no` | 批次/轮次号 (Business Key) | - | `string` | - | - | `runs.batch_no` | 关联主键 |
| `temp_sample` | 样品温度 | `°C` | `float` | `0.1` | `1` | `sensor_A.ch4` | 正常范围 20-80 |
| `pressure_inlet` | 进口压力 | `MPa` | `float` | `0.01` | `10` | `sensor_A.ch8` | - |

## 补充说明
- **缺失值代码**: `-9999` (采集故障), `0` (停止采集/无信号)
- **时间对齐**: 所有观测通道数据已对齐至 `timestamp`
