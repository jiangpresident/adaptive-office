# 宿主接口约定

愿居已实现 openai-model.cjs 的 Responses API 适配器。服务器默认使用 GPT，实际在线调用需本机配置有效 API Key。现有接口采用结构化提案，尚未实现模型主动调用几何工具的多轮 function calling。

## 当前可复用代码

- local-model.cjs 的 prepareInput(rawInput) 清洗输入。
- modelMessages(preparedInput) 生成规则、历史与当前设计上下文；其中第一条是现有系统说明，其余包含会话和最新数据。迁移后应避免重复加载同一套规则。
- OUTPUT_SCHEMA 是当前输出契约，对应 references/output-schema.json 的快照。采用 OpenAI strict schema 前还需核对受支持的 schema 子集及每个对象的 required/additionalProperties。
- cleanFunctionSketches(input, output) 清洗功能草图，mergeOutput(input, output, sketches) 合并并校验提案。结构符合 JSON schema 不代表设计语义正确，仍须通过原有业务校验。
- dist/module-edits.js、engine.js、interior.js、accessibility.js 等继续负责实际操作与几何计算。

## API 方式

网页通过本地 server.cjs 调用 GPT。服务器读取技能说明并提供真实画布和已确认需求，接收结构化输出，调用原有校验和提案流程。凭证只放服务器配置，不进入网页、方案 JSON 或本技能。

可以先使用 Responses API 的结构化输出适配现有提案格式；如需模型主动查询或模拟布局，再由宿主实现并注册工具。函数调用需要宿主执行函数并返回结果；给函数起名字或写进技能不等于实现了它。

聊天文本和所选设计上下文会发送到 API 服务。实际费用、可选模型和账户可用性应在接入时确认。

## Codex/其他技能宿主方式

宿主显式加载本技能及所需参考文件，以用户提供的方案数据辅助讨论。控制正在运行的愿居需要另外提供可调用接口或使用已授权浏览器工具；本技能不自动获得网页状态或修改权限。

## 验收场景

- “两个人住”：询问分房意愿，不直接判定夫妻。
- “独居，先聊办公，不生成”：讨论，不能修改平面或凭空提到历史户外需求。
- “父母短住”：常住与两位来客分开统计，未执行提案不算现有床位。
- “大客厅换小客厅”：针对真实实例替换并提示厨房功能影响，不删除其他房间。
- 回复格式错误、拒绝、网络失败：给出明确状态，保持原方案。

官方文档：
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.openai.com/api/docs/guides/function-calling
- https://learn.chatgpt.com/docs/build-skills
