{
  "candidates": [
    {
      "name": "cooling_rate",
      "description": "冷却速率 (dT/dt)",
      "formula": "diff(temperature) / diff(timestamp)",
      "physical_meaning": "反映热交换效率，关联系统状态变化速度",
      "required_fields": ["temperature", "timestamp"],
      "priority": "High"
    },
    {
      "name": "accumulated_energy",
      "description": "累计能量消耗",
      "formula": "cumsum(power * delta_time)",
      "physical_meaning": "反映累计能量投入",
      "required_fields": ["power", "timestamp"],
      "priority": "Medium"
    }
  ]
}
