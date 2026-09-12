# 清洗规则草案 (Cleaning Rules Draft)
# Purpose: 观测/实验母表的质量门槛与可复现清洗契约

rules:
  - id: "R001"
    target_field: "${TIME_COL}"
    action: "drop_invalid_time"
    condition: "time_parse_failed == true"
    reason: "Invalid timestamp"

  - id: "R002"
    target_field: "${TIME_COL}"
    action: "drop_duplicates"
    params:
      subset: ["${TIME_COL}"]
      keep: "first"
    reason: "Duplicate timestamps"

  - id: "R003"
    target_field: "${TAG_FIELD}"
    action: "normalize_tag"
    params:
      replace:
        "-": "_"
      strip_suffix: [".PV", ".MV", ".OUT", ".VALUE", ".SP", ".OP"]
      upper: true
    reason: "Normalize tag naming for matching (do not erase PV/MV semantics in final schema)"

  - id: "R004"
    target_field: "${SENSOR_FIELD}"
    action: "set_null"
    condition: "value < ${PHYS_MIN} or value > ${PHYS_MAX}"
    reason: "Physical limits exceeded (sensor failure)"

  - id: "R005"
    target_field: "${SENSOR_FIELD}"
    action: "detect_freeze"
    params:
      window_points: ${FREEZE_WINDOW_POINTS}
      tolerance: ${FREEZE_TOL}
    reason: "Sensor freeze / stuck value"

  - id: "R006"
    target_field: "all_sensors"
    action: "ffill"
    params:
      limit: ${FFILL_LIMIT}
    reason: "Short communication gaps (only if domain-approved)"

  - id: "R007"
    target_field: "${STEADY_STATE_FLAG}"
    action: "pre_filter_transient"
    params:
      window_minutes: ${WINDOW_MINUTES}
      policy: "${TRANSIENT_POLICY}"
    reason: "Pre-filter startup/shutdown/calibration transient segments before KPI analysis"
