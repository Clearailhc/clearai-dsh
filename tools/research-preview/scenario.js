// Deterministic examples only. Never imported by the published package.
export const scenario = [
  { title: '提出假设', status: '待验证', summary: '客户流失差异可能来自试用客户占比。按试用与付费两组比较，并检查样本量。', objects: ['假设 H1', '分组比较'], detail: '示例命题 H1；验证办法：比较各组流失率与样本覆盖。尚未取得支持证据。' },
  { title: '构建知识结构', status: '结构定义', summary: '定义客户、订阅类型、流失事件，以及客户属于订阅类型的关系。新增 3 个概念、1 种关系。', objects: ['客户', '订阅类型', '流失事件'], detail: '概念和关系只是结构定义，不代表事实经过验证。' },
  { title: '登记实体与断言', status: '待核验', summary: '登记客户样本与分组断言。来源为示例客户记录；组别和流失口径仍需核验。', objects: ['客户 C01', '客户 C02', '样本记录'], detail: '示例来源：fixture/customers.csv；未接触真实客户数据或知识库。' },
  { title: '用户调整范围', status: '已收到 · 等待处理', summary: '示例用户补充：“只比较最近 90 天的客户。”收到要求尚不代表调整已生效。', objects: ['当前任务 T1'], detail: '此条是确定性回放中的用户意图示例，不会发送给模型，也不会替换研究目标。' },
  { title: '修订假设的适用范围', status: '已生效 · 待验证', summary: 'H1-r2 取代 H1 的时间范围：仅比较最近 90 天客户，继续按订阅类型分组。', objects: ['H1-r2', '取代 H1'], detail: '关联提出假设记录；原记录保留。调整只在这一提交之后生效。' },
  { title: '验证结果', status: '证据不足', summary: '付费组样本不足以支持稳定比较。数据口径检查通过；这不代表流失假设成立。', objects: ['H1-r2', '付费组'], detail: '限制：付费组覆盖不足，暂不能排除时间窗口与样本选择的影响。证据不足与验证失败分别呈现。' },
  { title: '独立评估交接', status: '交接示例 · 未启动子任务', summary: '将分组差异及样本限制交给独立评估。真实运行时由宿主子任务界面显示活动与控制。', objects: ['H1-r2', '样本限制'], detail: '这是无模型调用的示例，没有运行中的评估者，不伪造子任务入口、时长或预计完成时间。' },
  { title: '裁决与阶段成果', status: '示例裁决 · 尚未证实', summary: '目前只能描述样本内差异，不能推广到总体；样本选择解释尚未排除，需要补充付费客户证据。', objects: ['样本内差异', '未解决：样本覆盖'], detail: '示例收束：成果是分组口径和限制；依据是示例记录；不确定性是覆盖不足。不是实际研究结论。' },
]

export const kernelExamples = [
  [{ t: 'goal/set', id: 'example-goal', revision: 1, claim: '比较客户流失差异', done_criteria: '明确分组差异与证据限制', promote_at_level: 'L3', hypotheses: [{ id: 'example-h1', name: '试用客户占比', claim: '客户流失差异可能来自试用客户占比。', refute_when: '按订阅类型分组后差异仍存在' }] }],
  [{ t: 'ontology/term_added', id: 'example-customer', label: '客户', gloss: '示例客户类型' }, { t: 'ontology/term_added', id: 'example-subscription', label: '订阅类型', gloss: '示例订阅类型' }, { t: 'ontology/predicate_added', id: 'example-belongs', label: '属于订阅类型', domain: 'example-customer', range: { term: 'example-subscription' } }],
  [{ t: 'entity/registered', id: 'example-c01', type: 'example-customer', label: '客户 C01', basis: '示例记录，未核验', provenance: { kind: 'artifact', ref: 'fixture/customers.csv' } }],
  [],
  [{ t: 'hypothesis/superseded', goal: 'example-goal', id: 'example-h1', claim: '客户流失差异可能来自试用客户占比。', by: 'rev2' }, { t: 'goal/set', id: 'example-goal', revision: 2, claim: '比较最近 90 天客户流失差异', done_criteria: '明确分组差异与证据限制', promote_at_level: 'L3', reason: '用户要求只比较最近 90 天客户', hypotheses: [{ id: 'example-h1r2', name: '最近 90 天的分组差异', claim: '最近 90 天的客户流失差异可能来自试用客户占比。', refute_when: '分组后差异仍存在' }] }],
  [{ t: 'evidence/recorded', id: 'example-e1', hypothesis: 'example-h1r2', verdict: 'unknown', level: 'L2', evaluator: 'self', refs: [], basis: '付费组样本不足；数据口径通过不代表假设成立。' }],
  [{ t: 'audit/dispatched', id: 'example-a1', goal_id: 'example-goal', kind: 'evidence_audit', criteria: ['复核样本覆盖限制；仅为交接示例，未运行评估者'] }],
  [{ t: 'audit/settled', id: 'example-a1', verdict: 'fail', basis: '示例裁决：证据不足，不能推广到总体。', shortfalls: [{ criterion: '样本覆盖', what: '样本选择解释尚未排除', missing: '需补充付费客户样本' }] }, { t: 'goal/closed', id: 'example-goal', status: 'abandoned', answers: [{ conclusion: '样本内描述保留，总体推断未成立。', basis: ['示例客户分组记录'], open: [{ effect: '需补充付费客户样本' }] }] }],
]
