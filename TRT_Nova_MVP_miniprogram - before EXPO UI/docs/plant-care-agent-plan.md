# 植物养护 Agent 规划

> 更新日期：2026-05-17

## 当前口径

当前实现不再按“重型情绪对话机器人”方向推进，而是进入更适合本项目的轻量植物 Agent 路线：

- Phase 1：设备状态、趋势、风险解释
- Phase 2：轻量普通对话
- Phase 3：轻量知识增强

当前已落地到：

- 规则型设备问答
- 普通对话 API 接入
- 基于 `plant_library` 和字段协议片段的轻量知识增强

当前未落地：

- 复杂长期记忆
- 向量库
- 重型 planner
- 自动设备控制

## 1. 目标

为 TRT Nova 小程序增加一个面向植物养护场景的 Agent，核心定位不是“泛陪聊机器人”，而是：

- 能理解当前设备状态
- 能解释历史趋势和风险
- 能结合植物知识给出养护建议
- 能在安全边界内调用现有系统能力；当前阶段先做只读解释和建议
- 能逐步形成“植物管家”式的交互体验

当前项目已具备以下基础：

- 设备最新状态读取：`/device/latest`
- 设备历史趋势读取：`/device/history`
- 设备控制：`/device/cmd`
- 待办管理：`/todo/*`
- 植物资料：`/plant/library`
- 用户资料与设备绑定体系：`users` / `device_acl` / `devices`

因此 Agent 更适合在现有链路上做“解释、建议、规划、受限执行”，而不是重做一套硬件控制系统。

## 2. 参考仓库

本规划参考仓库：

- `https://github.com/congde/emotional_chat`

该仓库值得借鉴的不是“心理陪伴”业务本身，而是其整体思路：

- Agent 作为核心调度层
- RAG 作为知识增强层
- 长短期记忆作为个性化层
- 意图识别作为任务分流层
- 工具调用作为外部能力连接层

对当前项目的启发是：

- 我们也可以让 Agent 不只负责聊天，而是能读取设备状态、解释异常、生成任务、调用控制接口
- 我们也需要知识库，但知识内容应替换为植物养护、硬件字段协议、业务规则
- 我们也可以做记忆，但记忆对象应改为“用户养护习惯”和“植物个体历史”

## 3. 不建议直接照搬的部分

`emotional_chat` 中有些能力不适合当前阶段直接搬入本项目：

- 心理危机检测
- 多模态情绪识别
- 重型独立 Web 前端
- 过早引入完整监控、缓存、向量存储全家桶

原因：

- 当前主应用是微信小程序，不是长对话型 Web SaaS
- 当前最有价值的是“设备状态理解 + 养护建议”，不是开放式情感陪伴
- 现有后端是 SCF + MySQL，先做轻量可落地方案更合适

结论：

- 借鉴架构方法
- 不照搬原业务模型

## 4. Agent 在本项目中的角色

植物养护 Agent 建议定义为一个“带工具能力的解释与决策层”，位于小程序与现有业务接口之间。

建议职责：

- 解读设备 latest / history
- 检索植物知识与字段协议
- 生成结构化建议
- 生成待办
- 在白名单范围内发起设备控制建议；执行动作放到后续阶段并要求用户确认
- 记住用户和植物的长期偏好

不建议职责：

- 替代硬件端算法
- 直接判断底层控制协议细节
- 自由生成任意下行命令
- 在没有数据依据的情况下“臆测设备状态”

## 5. 与当前项目的关系

当前项目中，大部分“真实状态”应仍以硬件上报和数据库 latest 为准：

- 小程序 -> `api-scf /device/cmd`
- OneNET -> 设备
- 设备执行后重新上报
- `ingest-scf` 写入 `device_latest`
- Agent 读取 `device_latest` / `device_history_*`

因此 Agent 的原则应为：

- 以数据库 latest 作为事实来源
- 以 history 作为趋势依据
- 以植物知识库作为建议依据
- 以业务规则作为执行边界

## 6. 可做的功能

### 6.1 设备状态问答

用户示例：

- “我的花盆现在状态怎么样？”
- “这台设备正常吗？”

实现方式：

- 调用 `/device/latest`
- 读取 `soil_percent`、`dht_temp`、`dht_humi`、`light_val`、`run_state`、`fan_switch/test`
- 使用规则层先整理状态摘要
- 再由 Agent 转成自然语言

### 6.2 历史趋势解读

用户示例：

- “最近两天是不是越来越干？”
- “温度最近稳定吗？”

实现方式：

- 调用 `/device/history`
- 后端先做基本统计：
  - 上升/下降
  - 波动程度
  - 最近极值
- Agent 根据统计结果生成解释

### 6.3 植物养护知识问答

用户示例：

- “绿萝黄叶怎么办？”
- “龟背竹喜欢什么光照？”

实现方式：

- 引入 RAG
- 数据源优先级建议：
  - `plant_library`
  - `data/plants.js`
  - `docs/` 中的业务文档
  - 后续整理的植物养护手册

### 6.4 字段解释与协议问答

用户示例：

- “土壤湿度 18% 是什么意思？”
- “run_state 和 ir_status 是什么？”

实现方式：

- 维护一份“设备字段协议文档”
- Agent 检索该文档后回答
- 避免模型凭空猜字段含义

### 6.5 当前风险诊断

用户示例：

- “现在最需要处理的问题是什么？”

实现方式：

- 基于 `latest` 和阈值规则先生成结构化风险标签
- 例如：
  - 缺水
  - 过湿
  - 光照不足
  - 温度异常
  - 设备离线
- Agent 将风险标签转为建议

### 6.6 多因素综合建议

用户示例：

- “我现在该做什么？”

实现方式：

- 综合：
  - 最近传感器状态
  - 历史趋势
  - 植物类型
  - 用户偏好
- 生成具体动作建议
- 例如：
  - 补水
  - 移到散射光位置
  - 检查通风
  - 观察叶片状态

### 6.7 自动生成待办

用户示例：

- “帮我记一下今晚浇水”
- “把这个异常变成提醒”

实现方式：

- Agent 输出待办建议
- 用户确认后调用 `/todo/add`
- 与 `logicalKey` 关联

### 6.8 安全设备控制建议

用户示例：

- “现在要不要开风扇？”

实现方式：

- 先给出解释和建议
- 第一阶段只返回建议，不直接下发命令
- 如后续允许执行，则只通过白名单工具下发，并要求用户二次确认
- 例如仅开放：
  - 开风扇
  - 关风扇

### 6.9 受限自动执行

> 该能力不属于第一阶段。需要动作白名单、二次确认、审计日志和失败回查后再开放。

用户示例：

- “如果温度太高就帮我开风扇”

实现方式：

- 规则层判断是否满足条件
- 工具层做参数白名单校验
- 调用 `/device/cmd`
- 严禁模型直接拼接底层协议

### 6.10 长期记忆

可记录：

- 用户是否经常忘记浇水
- 某设备是否经常离线
- 某植物是否经常在下午出现缺水
- 用户偏好“简短提醒”还是“详细解释”

实现方式：

- 初期可以直接放 MySQL
- 分为：
  - 用户记忆
  - 设备记忆
  - 植物个体记忆

## 7. 建议架构

建议增加一个独立的 Agent 服务层，例如：

- `dist/scf/agent-scf`

推荐调用路径：

- 小程序页面 -> `agent-scf /agent/chat`
- `agent-scf` -> 工具层
- 工具层 -> `api-scf` / 直接读 MySQL / 植物知识库

推荐的内部模块：

- `intent`：识别问答、诊断、规划、执行意图
- `tools`：封装现有系统能力
- `rag`：植物知识检索、字段协议检索、业务规则检索
- `memory`：用户/设备/植物长期记忆
- `planner`：决定本轮该调用什么工具
- `formatter`：输出适合小程序渲染的结构化结果

## 8. 推荐工具清单

### 8.1 `get_device_snapshot(logicalKey)`

用途：

- 获取设备最新状态

来源：

- `/device/latest`

### 8.2 `get_device_history(logicalKey, metric, range)`

用途：

- 获取历史趋势

来源：

- `/device/history`

### 8.3 `get_plant_profile(plantLibraryId, plantType)`

用途：

- 获取植物养护知识

来源：

- `/plant/library`
- 本地或服务端知识库文档

### 8.4 `create_care_todo(logicalKey, title, urgency)`

用途：

- 创建养护任务

来源：

- `/todo/add`

### 8.5 `send_safe_device_command(logicalKey, action)`

用途：

- 执行白名单设备控制

来源：

- `/device/cmd`

限制：

- 仅允许映射后的安全动作
- 不允许模型直接写任意 `params`

## 9. 输出格式建议

Agent 不应只返回一段长文本，建议返回结构化 JSON，便于小程序做卡片展示。

建议字段：

- `summary`：一句话总结
- `riskLevel`：`low` / `medium` / `high`
- `facts`：当前依据的数据点
- `diagnosis`：问题解释
- `suggestions`：建议动作列表
- `todoSuggestions`：建议创建的待办
- `actions`：第二阶段才返回的可执行动作卡片；第一阶段保持空数组
- `followUpQuestions`：推荐追问

示例：

```json
{
  "summary": "土壤湿度偏低，建议今晚补水一次",
  "riskLevel": "medium",
  "facts": [
    "土壤湿度 18%",
    "环境温度 29℃",
    "过去 24 小时土壤湿度持续下降"
  ],
  "diagnosis": "当前最主要问题是缺水，且白天蒸发偏快。",
  "suggestions": [
    "今晚 20:00 前补水一次",
    "明天上午复查土壤湿度",
    "短期内避免长时间强光直晒"
  ],
  "todoSuggestions": [
    "今晚补水",
    "明早复查湿度"
  ],
  "actions": [],
  "actionPolicy": {
    "allowActions": false,
    "allowControlSuggestions": true,
    "requiresUserConfirmation": true
  }
}
```

## 10. MVP 建议

第一阶段建议只做以下 6 项：

1. 设备状态问答
2. 历史趋势解读
3. 当前风险诊断
4. 植物知识问答
5. 自动生成待办
6. 安全设备控制建议

原因：

- 完全贴合当前项目已有数据链路
- 不需要大改硬件端
- 不需要一开始就上复杂记忆系统
- 可以先做出明显可感知的“植物管家”体验

## 11. 分阶段路线

### Phase 1：只读解释型 Agent

能力：

- 读 latest
- 读 history
- 查植物知识
- 输出建议
- 不执行待办创建或设备控制

目标：

- 先让 Agent 会“看”和“说”

### Phase 2：轻量普通对话

能力：

- 普通聊天
- 常识性植物问答
- 不涉及设备事实时可走 LLM
- 仍不执行待办创建或设备控制

目标：

- 让 Agent 不再像只会固定模板回答

### Phase 3：轻量知识增强

能力：

- 从 `plant_library` 检索结构化植物资料
- 从字段协议知识片段检索设备字段含义
- 将知识结果作为上下文增强 LLM 回答
- 在未配置 LLM 时提供本地知识回退

目标：

- 让 Agent 更像植物助手，而不是通用闲聊入口

### Phase 4：工具执行型 Agent

能力：

- 创建待办
- 推荐控制动作
- 受限执行风扇控制
- 所有动作都必须由用户确认后执行

目标：

- 让 Agent 会“帮你做点事”

### Phase 5：长期记忆型 Agent

能力：

- 记住用户习惯
- 记住单植物长期模式
- 做个性化提醒

目标：

- 从问答工具进化为长期陪伴式植物管家

## 12. 风险与边界

### 12.1 不让 Agent 替代硬件真实状态

当前项目中硬件端是主要状态来源，因此：

- Agent 不能假装设备已经执行成功
- 必须以 `device_latest` 为真实状态依据

### 12.2 不让 Agent 自由拼命令

必须通过白名单工具执行控制动作，避免误控设备。

### 12.3 不让 Agent 胡乱解释字段

字段含义必须通过协议文档或后端映射提供，不能完全依赖模型猜测。

### 12.4 不过早引入过重基础设施

前期可优先使用：

- SCF
- MySQL
- 文档型知识库

后续再评估：

- 向量库
- Redis
- 更复杂的记忆层

## 13. 建议后续文档

为推进落地，建议后续补四份文档：

1. `agent-api-design.md`
   - 定义 `/agent/chat` 请求与响应格式

2. `device-field-protocol.md`
   - 定义设备字段含义、单位、正常范围、前端展示说明

3. `plant-rag-knowledge-plan.md`
   - 定义植物知识库来源、清洗方式、分块与检索策略

4. `plant-library-enhancement-plan.md`
   - 定义植物库增强字段、内容分层和 Agent 消费方式

当前已整理完成：

- [agent-api-design.md](/g:/TRT-Nova-Soft/TRT_Nova_MVP_miniprogram/docs/agent-api-design.md)
- [device-field-protocol.md](/g:/TRT-Nova-Soft/TRT_Nova_MVP_miniprogram/docs/device-field-protocol.md)
- [plant-rag-knowledge-plan.md](/g:/TRT-Nova-Soft/TRT_Nova_MVP_miniprogram/docs/plant-rag-knowledge-plan.md)
- [plant-library-enhancement-plan.md](/g:/TRT-Nova-Soft/TRT_Nova_MVP_miniprogram/docs/plant-library-enhancement-plan.md)
