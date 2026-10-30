# 原型约定

office-model.js 为浏览器/服务器共用规则引擎。格式 adaptive-office-v2，gridSize=4。每块有 id、userId、program、lane、rank、footprint=4x4。每条链先室内再花园，连续垂直核心筒。初始8层、228块仅为演示，已有保存方案优先。

/api/office/chat 由 office-server.cjs 接收，office-ai.cjs 调用 Responses API。每次读取 SKILL.md 和 ai-contract.md，复用本地 GPT 配置，不加载住宅 skill。最多一次语义校验修复，不自动重试认证、配额或网络错误。

aiContext 提供原始权重与数量；GPT 返回单份 feedback。proposeFeedback 按 100 份基准和倍率逐用户计算小数增量，仅改所选范围；先保留符合新配额的模块，只转换必要的剩余模块。预览权重表为范围内用户平均值，模块表默认折叠。旧 proposeWeights/proposeTransfers 只保留兼容测试，聊天不再调用。

office-ai-chat.js 提供独立办公对话。office-view.js 分开保管正式 state 与 pending 候选；候选只用于渲染，确认前不保存。确认重新检查完整模型快照，应用走原 commit/撤销流程。模型、范围、楼层改变或取消、刷新、重开聊天均使候选失效。异步返回也核对请求快照。

测试覆盖技能加载、接口格式、范围、零库存、重复消费、不修改输入、错误与取消、预览确认撤销、过期保护、几何和住宅独立性。真实 GPT 测试用当前配置，不能把模拟响应当成实测成功。临时应用测试后撤销恢复用户布局。
