# 稳态规则模板 (Steady State / In-observation Rules)
# 输出物：可复现的“有效稳态（In-observation）”判据（阈值需结合数据分布校准）

meta:
  system_name: "${SYSTEM_NAME}"
  time_col: "${TIME_COL}"
  sampling_minutes: ${SAMPLING_MINUTES}
  continuous_gap_minutes: ${CONTINUOUS_GAP_MINUTES}

in_observation:
  # 有效判据（强制，建议以输入通量/负荷为主）
  running_conditions:
    - id: "RUN001"
      expression: "${LOAD_TAG} > ${LOAD_MIN}"
      reason: "In-observation: input flux/load above minimum threshold"
    - id: "RUN002"
      expression: "${AUX_TAG} > ${AUX_MIN}"
      reason: "Optional supporting evidence (auxiliary resource consumption / operating condition)"
  combine: "AND" # AND / OR（建议：以输入通量为主；辅助证据可 OR 或不启用）

transition_exclusion:
  enabled: true
  window_minutes: ${TRANSITION_WINDOW_MINUTES}
  # 在 in_observation 状态切换点附近剔除过渡段（避免刚启动/刚停止瞬态）
  nan_policy: "${NAN_POLICY}" # off / abnormal / skip

optional_deep_steady_state:
  enabled: false
  # 可选：仅当业务需要“深稳态/波动小”时启用（例如用于机理建模/回归）
  window_minutes: ${DEEP_STEADY_WINDOW_MINUTES}
  criteria:
    - id: "DSS001"
      type: "std_over_mean"
      field: "${KEY_TEMP_TAG}"
      max_cv: ${TEMP_MAX_CV}
      reason: "Optional: key temperature variability filter"
    - id: "DSS002"
      type: "std_over_mean"
      field: "${KEY_PRESS_TAG}"
      max_cv: ${PRESS_MAX_CV}
      reason: "Optional: key pressure variability filter"
