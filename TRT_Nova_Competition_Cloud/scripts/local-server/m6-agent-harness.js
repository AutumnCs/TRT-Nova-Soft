/**
 * M6 NOVA 工作流验收 harness。
 *
 * 目标不是模拟一个自主 Agent，而是通过真实本地 HTTP 链路逐场景验证当前
 * “确定性门禁 + RAG/记忆 + 单次模型调用 + 待确认动作”的产品契约。
 */

const fs = require('fs');
const http = require('http');
const path = require('path');

const host = '127.0.0.1';
const port = Number(process.env.LOCAL_PORT || 3000);
const evidenceDir = process.env.M6_AGENT_HARNESS_EVIDENCE_DIR
  || 'D:\\植宠项目\\验收记录\\M6_2026-08-29\\m6-final';
const reportPath = path.join(evidenceDir, 'm6-agent-workflow-harness.json');

const report = {
  contractVersion: 'm6.v0.1',
  classification: 'bounded_llm_workflow',
  runtime: 'single_request_response',
  runtimeHarness: false,
  evaluationHarness: true,
  startedAt: new Date().toISOString(),
  scenarios: []
};

function request(method, requestPath, { token, body, timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const startedAt = Date.now();
    const req = http.request({
      host,
      port,
      path: requestPath,
      method,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        ...(token ? { 'x-access-token': token } : {})
      },
      timeout
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch (err) { /* 由场景断言报告 */ }
        resolve({ status: res.statusCode, json, durationMs: Date.now() - startedAt });
      });
    });
    req.on('timeout', () => req.destroy(new Error(`${requestPath} timeout`)));
    req.on('error', reject);
    req.end(payload);
  });
}

function summarizeEvidence(input = {}) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  );
}

async function scenario(id, layer, expectation, run) {
  const startedAt = Date.now();
  try {
    const evidence = summarizeEvidence(await run());
    report.scenarios.push({
      id,
      layer,
      expectation,
      status: 'PASS',
      durationMs: Date.now() - startedAt,
      evidence
    });
    console.log(`[PASS] ${id} ${expectation}`);
    return evidence;
  } catch (error) {
    report.scenarios.push({
      id,
      layer,
      expectation,
      status: 'FAIL',
      durationMs: Date.now() - startedAt,
      error: error.message,
      evidence: error.evidence || null
    });
    throw error;
  }
}

function ensure(condition, message, evidence) {
  if (condition) return;
  const error = new Error(message);
  error.evidence = evidence;
  throw error;
}

function responseText(response = {}) {
  return [response.summary, response.diagnosis].filter(Boolean).join('\n');
}

function sourceLabel(source = {}) {
  return [source.title, source.sourceTitle, source.sourcePublisher, source.sourceId]
    .filter(Boolean)
    .join(' ');
}

(async () => {
  fs.mkdirSync(evidenceDir, { recursive: true });
  let ownerToken = '';
  let otherToken = '';
  let roseId = 0;
  let monsteraId = 0;
  let ownerOriginalProfile = null;
  let ownerProfileModified = false;

  try {
    const ownerLogin = await scenario(
      'AUTH-01',
      'identity',
      '客户端通过 /auth/login 获取 JWT 身份，未认证请求不能读取会话',
      async () => {
        const login = await request('POST', '/auth/login', { body: { code: 'm6-agent-harness-owner' } });
        ownerToken = login.json?.accessToken || '';
        ensure(login.status === 200 && login.json?.success && ownerToken, '本地登录契约失败', login);
        const unauthorized = await request('POST', '/agent/session', { body: { sessionId: 'assistant_global' } });
        ensure(unauthorized.status === 401, '未认证会话读取没有被拒绝', unauthorized);
        return {
          authenticatedStatus: login.status,
          unauthenticatedStatus: unauthorized.status,
          openidPresent: Boolean(login.json?.openid)
        };
      }
    );
    ensure(ownerLogin.openidPresent, '登录结果缺少 openid');

    await scenario(
      'AUTH-02',
      'identity',
      '真实本地登录身份与隔离测试身份之间的 PlantPet、会话和记忆严格隔离',
      async () => {
        // LC-02 会把所有非空 wx code 映射为同一个 LOCAL_DEV_OPENID；
        // 仅隔离回归使用 LC-03 的本机 /dev/token 创建第二测试身份。
        const otherLogin = await request('GET', '/dev/token?openid=m6_agent_harness_other');
        otherToken = otherLogin.json?.token || '';
        ensure(otherLogin.status === 200 && otherLogin.json?.success && otherToken, '第二测试身份签发失败', otherLogin);
        const created = await request('POST', '/plant/pet-create', {
          token: ownerToken,
          body: {
            nickname: `Harness 月季 ${Date.now()}`,
            speciesName: '月季',
            enteredAt: '2026-08-28',
            location: 'Harness 南窗台',
            careNotes: 'M6 架构验收，结束后清理'
          }
        });
        roseId = Number(created.json?.pet?.id) || 0;
        ensure(roseId > 0, 'PlantPet 创建失败', created);
        const crossRead = await request('POST', '/agent/session', {
          token: otherToken,
          body: { sessionId: `assistant_plant_${roseId}`, plantPetId: roseId }
        });
        ensure(crossRead.status === 404, '另一身份读取到了不属于自己的 PlantPet 会话', crossRead);
        return {
          ownerPlantPetId: roseId,
          crossIdentityStatus: crossRead.status,
          identityTestMechanism: 'local_dev_token_lc03'
        };
      }
    );

    await scenario(
      'INTENT-01',
      'intent_scope',
      '数学等域外请求在 RAG 和模型之前进入职责边界回复，不生成来源、任务或摘要记忆',
      async () => {
        const before = await request('POST', '/ai/memories', {
          token: ownerToken,
          body: { plantPetId: roseId }
        });
        const summaryCountBefore = (before.json?.memories || []).filter((item) => item.type === 'ai_summary').length;
        const answer = await request('POST', '/agent/chat', {
          token: ownerToken,
          body: {
            sessionId: `assistant_harness_scope_${roseId}`,
            plantPetId: roseId,
            message: '请你证明哥德巴赫猜想',
            options: { allowActions: false }
          }
        });
        const after = await request('POST', '/ai/memories', {
          token: ownerToken,
          body: { plantPetId: roseId }
        });
        const summaryCountAfter = (after.json?.memories || []).filter((item) => item.type === 'ai_summary').length;
        const text = responseText(answer.json);
        ensure(answer.json?.intent?.type === 'out_of_scope', '域外请求没有进入 out_of_scope', answer);
        ensure(answer.json?.scope?.status === 'out_of_scope', '职责域状态缺失', answer);
        ensure(/哥德巴赫猜想.*植宠养护职责/.test(text), '职责边界回复没有明确说明范围', answer);
        ensure((answer.json?.sources || []).length === 0, '域外请求仍然触发或展示了知识/模型来源', answer);
        ensure((answer.json?.taskSuggestions || []).length === 0, '域外请求生成了任务候选', answer);
        ensure(answer.json?.memoryUpdated === false && summaryCountAfter === summaryCountBefore, '域外请求写入了 AI 摘要记忆', { before, answer, after });
        ensure(!/Monstera|龟背竹|Rosa|月季/.test(text), '职责边界回复混入了无关植物资料', answer);
        return {
          durationMs: answer.durationMs,
          intent: answer.json.intent.type,
          scope: answer.json.scope.status,
          knowledgeSources: 0,
          modelSourcePresent: false,
          taskCandidateCount: 0,
          memorySummaryWritten: false
        };
      }
    );

    await scenario(
      'SOCIAL-01',
      'intent_social',
      '简单问候忽略尾部问号并走同一条轻量社交路由，裸连续问句进入无权限语义回退而不继承植物话题',
      async () => {
        const sessionId = `assistant_harness_scope_${roseId}`;
        const plain = await request('POST', '/agent/chat', {
          token: ownerToken,
          body: { sessionId, plantPetId: roseId, message: '你好', options: { allowActions: false } }
        });
        const punctuated = await request('POST', '/agent/chat', {
          token: ownerToken,
          body: { sessionId, plantPetId: roseId, message: '你好?', options: { allowActions: false } }
        });
        const plainText = responseText(plain.json);
        const punctuatedText = responseText(punctuated.json);
        ensure(plain.json?.intent?.type === 'social' && punctuated.json?.intent?.type === 'social', '问候没有进入 social 路由', { plain, punctuated });
        ensure(plainText === punctuatedText && /你好呀，我在呢/.test(plainText), '带问号和不带问号的问候回复不一致', { plain, punctuated });
        ensure((plain.json?.sources || []).length === 0 && (punctuated.json?.sources || []).length === 0, '简单问候触发了 RAG 或模型来源', { plain, punctuated });
        ensure(plain.json?.memoryUpdated === false && punctuated.json?.memoryUpdated === false, '简单问候写入了 AI 摘要记忆', { plain, punctuated });
        ensure(!/哥德巴赫|数学题|Monstera|龟背竹|Rosa|月季/.test(`${plainText}\n${punctuatedText}`), '简单问候继承了域外历史或当前植物资料', { plain, punctuated });
        const unanchoredFollowUp = await request('POST', '/agent/chat', {
          token: ownerToken,
          body: { sessionId, plantPetId: roseId, message: '为什么？', options: { allowActions: false } }
        });
        ensure(unanchoredFollowUp.json?.scope?.status === 'deferred', '社交后的裸追问没有进入语义回退', unanchoredFollowUp);
        ensure(
          (unanchoredFollowUp.json?.sources || []).every((item) => item.type === 'llm_chat') &&
            unanchoredFollowUp.json?.memoryUpdated === false &&
            (unanchoredFollowUp.json?.taskSuggestions || []).length === 0,
          '社交后的裸追问读取了 RAG/私有上下文或产生副作用',
          unanchoredFollowUp
        );
        return {
          intent: plain.json.intent.type,
          sameReplyWithQuestionMark: true,
          unanchoredFollowUpScope: unanchoredFollowUp.json.scope.status,
          knowledgeSources: 0,
          modelSourcePresent: true,
          memorySummaryWritten: false
        };
      }
    );

    await scenario(
      'INTENT-02',
      'intent_adversarial',
      '夹带植物名、通用记忆词或观察任务词的域外请求不会误触发 RAG、模型、任务或摘要记忆',
      async () => {
        const before = await request('POST', '/ai/memories', {
          token: ownerToken,
          body: { plantPetId: roseId }
        });
        const summaryCountBefore = (before.json?.memories || []).filter((item) => item.type === 'ai_summary').length;
        const messages = [
          '1+2是多少个月季啊？',
          '1+2是多少朵玫瑰花呢',
          '帮我记住密码',
          '给服务器安排观察任务'
        ];
        const results = [];
        for (const message of messages) {
          const answer = await request('POST', '/agent/chat', {
            token: ownerToken,
            body: {
              sessionId: `assistant_harness_adversarial_${roseId}`,
              plantPetId: roseId,
              message,
              options: { allowActions: false }
            }
          });
          ensure(answer.json?.intent?.type === 'out_of_scope', `对抗样本被误判为域内：${message}`, answer);
          ensure((answer.json?.sources || []).length === 0, `对抗样本触发了知识或模型来源：${message}`, answer);
          ensure((answer.json?.taskSuggestions || []).length === 0, `对抗样本生成了任务候选：${message}`, answer);
          ensure(answer.json?.memoryUpdated === false, `对抗样本写入了摘要记忆：${message}`, answer);
          ensure(!/North Carolina|Rose - Rosa|Monstera deliciosa/.test(responseText(answer.json)), `对抗样本混入了 RAG 内容：${message}`, answer);
          results.push({ message, reason: answer.json?.scope?.reason || '', durationMs: answer.durationMs });
        }
        const after = await request('POST', '/ai/memories', {
          token: ownerToken,
          body: { plantPetId: roseId }
        });
        const summaryCountAfter = (after.json?.memories || []).filter((item) => item.type === 'ai_summary').length;
        ensure(summaryCountAfter === summaryCountBefore, '对抗样本批次改变了 AI 摘要记忆数量', { before, results, after });
        return {
          samples: results,
          knowledgeSources: 0,
          modelSourcePresent: false,
          taskCandidateCount: 0,
          memorySummaryWritten: false
        };
      }
    );

    await scenario(
      'INTENT-03',
      'profile_identity',
      '一般植物定义正常进入知识回答，账号称呼只读当前资料且不调用模型、RAG 或写入记忆',
      async () => {
        const originalProfileResponse = await request('GET', '/user/profile', { token: ownerToken });
        ensure(originalProfileResponse.status === 200 && originalProfileResponse.json?.success, '读取原始账号资料失败', originalProfileResponse);
        ownerOriginalProfile = originalProfileResponse.json?.profile || {};
        const profileUpdate = await request('POST', '/user/profile', {
          token: ownerToken,
          body: { ...ownerOriginalProfile, nickName: 'M6 Harness 用户' }
        });
        ensure(profileUpdate.status === 200 && profileUpdate.json?.success, '设置身份验收昵称失败', profileUpdate);
        ownerProfileModified = true;

        const before = await request('POST', '/ai/memories', {
          token: ownerToken,
          body: { plantPetId: roseId }
        });
        const summaryCountBefore = (before.json?.memories || []).filter((item) => item.type === 'ai_summary').length;
        const identity = await request('POST', '/agent/chat', {
          token: ownerToken,
          body: {
            sessionId: `assistant_harness_identity_${roseId}`,
            plantPetId: roseId,
            message: '我是谁？',
            options: { allowActions: false }
          }
        });
        const identityText = responseText(identity.json);
        ensure(identity.json?.scope?.status === 'in_scope' && identity.json?.scope?.reason === 'personal_identity', '个人身份问句没有进入账号资料分支', identity);
        ensure((identity.json?.sources || []).length === 0, '个人身份问句调用了模型或读取了 RAG 来源', identity);
        ensure((identity.json?.taskSuggestions || []).length === 0 && identity.json?.memoryUpdated === false, '个人身份问句产生了任务或记忆副作用', identity);
        ensure(!/Harness 月季|Rosa/.test(identityText), '个人身份问句泄露了植宠私有上下文', identity);
        ensure(/M6 Harness 用户/.test(identityText) && /账号.*昵称|昵称.*账号/.test(identityText), '个人身份问句没有读取当前账号昵称', identity);
        ensure(/真实身份/.test(identityText) && /手机号|证件/.test(identityText), '个人身份问句没有说明昵称边界与隐私提醒', identity);
        ensure(!/已经记住|会一直记住|以后都会记得|长期记住/.test(identityText), '个人身份问句错误声称已经保存或会长期记住称呼', identity);

        const preference = await request('POST', '/agent/chat', {
          token: ownerToken,
          body: {
            sessionId: `assistant_harness_identity_${roseId}`,
            plantPetId: roseId,
            message: '以后叫我小芽',
            options: { allowActions: false }
          }
        });
        ensure(preference.json?.scope?.reason === 'nickname_preference', '聊天内称呼请求没有进入确定性资料治理分支', preference);
        ensure((preference.json?.sources || []).length === 0 && preference.json?.memoryUpdated === false, '聊天内称呼请求调用了模型、RAG 或写入记忆', preference);
        ensure(/不会自动修改账号资料/.test(responseText(preference.json)) && /我的 → 个人资料/.test(responseText(preference.json)), '聊天内称呼请求没有说明显式保存路径', preference);
        const profileAfterPreference = await request('GET', '/user/profile', { token: ownerToken });
        ensure(profileAfterPreference.json?.profile?.nickName === 'M6 Harness 用户', '聊天内称呼请求静默修改了账号资料', profileAfterPreference);

        const afterIdentity = await request('POST', '/ai/memories', {
          token: ownerToken,
          body: { plantPetId: roseId }
        });
        const summaryCountAfterIdentity = (afterIdentity.json?.memories || []).filter((item) => item.type === 'ai_summary').length;
        ensure(summaryCountAfterIdentity === summaryCountBefore, '个人身份问句改变了 AI 摘要记忆', { before, identity, afterIdentity });

        const definition = await request('POST', '/agent/chat', {
          token: ownerToken,
          body: {
            sessionId: `assistant_harness_definition_${roseId}`,
            plantPetId: roseId,
            message: '月季是什么？',
            options: { allowActions: false }
          }
        });
        ensure(definition.json?.scope?.status === 'in_scope', '一般植物定义仍被规则拒绝', definition);
        ensure(/月季/.test(responseText(definition.json)), '一般植物定义没有直接回答植物', definition);
        ensure(definition.json?.sources?.some((item) => item.type === 'plant_library'), '一般植物定义没有使用已发布植物资料', definition);
        ensure((definition.json?.taskSuggestions || []).length === 0, '一般植物定义错误生成任务候选', definition);
        return {
          identityScope: identity.json.scope.status,
          identitySourceTypes: [],
          accountNicknameRead: true,
          llmCallsForIdentity: 0,
          profileChangedByChat: false,
          identityMemorySummaryWritten: false,
          definitionScope: definition.json.scope.status,
          definitionSourceTypes: definition.json.sources.map((item) => item.type),
          definitionTaskCandidateCount: 0
        };
      }
    );

    await scenario(
      'MEMORY-01',
      'memory',
      '用户确认的结构化记忆可跨会话读取，并保留来源类型',
      async () => {
        const created = await request('POST', '/ai/memory-create', {
          token: ownerToken,
          body: { plantPetId: roseId, content: '我习惯周六检查月季', confirmed: true }
        });
        ensure(created.json?.success && created.json?.memoryId, '确认式记忆写入失败', created);
        const recall = await request('POST', '/agent/chat', {
          token: ownerToken,
          body: {
            sessionId: `assistant_harness_memory_${roseId}`,
            plantPetId: roseId,
            message: '你记得这盆植物什么？',
            options: { allowActions: false }
          }
        });
        ensure(recall.json?.success && /周六检查月季/.test(responseText(recall.json)), '跨会话记忆没有被召回', recall);
        ensure(recall.json?.sources?.some((item) => item.type === 'structured_memory'), '记忆回答缺少结构化来源', recall);
        return {
          intent: recall.json.intent?.type,
          sourceTypes: (recall.json.sources || []).map((item) => item.type),
          taskCandidateCount: (recall.json.taskSuggestions || []).length
        };
      }
    );

    await scenario(
      'RAG-01',
      'retrieval',
      '月季问题只返回已发布且可读的知识来源',
      async () => {
        const answer = await request('POST', '/agent/chat', {
          token: ownerToken,
          body: {
            sessionId: `assistant_harness_rag_${roseId}`,
            plantPetId: roseId,
            message: '月季平时应该怎么浇水？',
            options: { allowActions: false }
          }
        });
        const sources = (answer.json?.sources || [])
          .filter((item) => ['knowledge_article', 'plant_library'].includes(item.type));
        ensure(answer.json?.success && responseText(answer.json).trim(), '月季问题没有得到回答', answer);
        ensure(sources.length > 0, '回答没有已发布知识来源', answer);
        ensure(sources.every((item) => item.title && (item.sourceUrl || item.sourceId)), '来源缺少可读标题或定位信息', sources);
        ensure(!/知识库|RAG|已复核并发布|任务绑定/.test(responseText(answer.json)), '回答暴露了内部治理术语', answer.json);
        return {
          durationMs: answer.durationMs,
          intent: answer.json.intent?.type,
          sourceTypes: sources.map((item) => item.type),
          sourceLabels: sources.map(sourceLabel),
          modelSourcePresent: (answer.json.sources || []).some((item) => item.type === 'llm_chat')
        };
      }
    );

    await scenario(
      'ROUTE-01',
      'orchestration',
      '显式月季主题覆盖当前龟背竹上下文，且错配时阻断任务和摘要记忆',
      async () => {
        const created = await request('POST', '/plant/pet-create', {
          token: ownerToken,
          body: {
            nickname: `Harness 龟背竹 ${Date.now()}`,
            speciesName: '龟背竹',
            enteredAt: '2026-08-28',
            location: 'Harness 客厅',
            careNotes: 'M6 主题路由验收，结束后清理'
          }
        });
        monsteraId = Number(created.json?.pet?.id) || 0;
        ensure(monsteraId > 0, '龟背竹 PlantPet 创建失败', created);
        const answer = await request('POST', '/agent/chat', {
          token: ownerToken,
          body: {
            sessionId: `assistant_harness_route_${monsteraId}`,
            plantPetId: monsteraId,
            message: '月季怎么浇水，并帮我安排一个观察任务？',
            options: { allowActions: false }
          }
        });
        const text = responseText(answer.json);
        const sources = (answer.json?.sources || [])
          .filter((item) => ['knowledge_article', 'plant_library'].includes(item.type));
        const sourceText = sources.map(sourceLabel).join(' ');
        ensure(answer.json?.topicMismatch?.taskBindingBlocked === true, '植物主题错配门禁没有触发', answer);
        ensure(/龟背竹.*月季/.test(text), '错配回答没有自然说明当前与提问植物两个主题', answer);
        ensure(!/知识库|RAG|任务绑定|门禁|已复核发布/.test(text), '错配回答暴露了内部实现或治理措辞', answer);
        ensure((answer.json?.taskSuggestions || []).length === 0, '错配时仍生成了任务候选', answer);
        ensure(/月季|Rose|Rosa/.test(sourceText) && !/龟背竹|Monstera/.test(sourceText), '错配来源混入了当前龟背竹', sources);
        const memories = await request('POST', '/ai/memories', { token: ownerToken, body: { plantPetId: monsteraId } });
        ensure(!(memories.json?.memories || []).some((item) => item.type === 'ai_summary'), '错配回答写入了龟背竹 AI 摘要', memories);
        return {
          durationMs: answer.durationMs,
          route: 'explicit_plant_topic',
          taskBindingBlocked: true,
          memorySummaryWritten: false,
          sourceLabels: sources.map(sourceLabel)
        };
      }
    );

    await scenario(
      'ACTION-01',
      'side_effects',
      'Agent 只返回待确认任务候选；未经 confirmed=true 不能写入业务对象',
      async () => {
        const answer = await request('POST', '/agent/chat', {
          token: ownerToken,
          body: {
            sessionId: `assistant_harness_action_${roseId}`,
            plantPetId: roseId,
            message: '帮我安排一个观察任务',
            options: { allowActions: false }
          }
        });
        const candidate = answer.json?.taskSuggestions?.[0];
        ensure(candidate?.source === 'ai' && candidate?.plantPetId === roseId, '没有得到只读任务候选', answer);
        const rejected = await request('POST', '/care/task-create', { token: ownerToken, body: candidate });
        ensure(rejected.json?.success === false && /确认/.test(rejected.json?.msg || ''), '未经确认的任务候选被写入', rejected);
        ensure(!answer.json?.toolCalls && !answer.json?.handoffs, '当前工作流意外暴露自主工具或交接循环', answer.json);
        return {
          candidateSource: candidate.source,
          candidatePlantPetId: candidate.plantPetId,
          unconfirmedWriteAccepted: false,
          dynamicToolCalls: 0,
          handoffs: 0
        };
      }
    );
  } finally {
    if (ownerProfileModified && ownerToken) {
      await request('POST', '/user/profile', {
        token: ownerToken,
        body: ownerOriginalProfile || {}
      }).catch(() => {});
    }
    if (monsteraId && ownerToken) {
      await request('POST', '/plant/pet-delete', { token: ownerToken, body: { plantPetId: monsteraId } }).catch(() => {});
    }
    if (roseId && ownerToken) {
      await request('POST', '/plant/pet-delete', { token: ownerToken, body: { plantPetId: roseId } }).catch(() => {});
    }
    report.finishedAt = new Date().toISOString();
    report.summary = {
      total: report.scenarios.length,
      passed: report.scenarios.filter((item) => item.status === 'PASS').length,
      failed: report.scenarios.filter((item) => item.status === 'FAIL').length
    };
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`[EVIDENCE] ${reportPath}`);
  }

  ensure(report.summary.failed === 0, 'M6 Agent 工作流验收 harness 存在失败场景', report.summary);
  console.log(`M6 Agent 工作流验收 harness：${report.summary.passed}/${report.summary.total} PASS`);
})().catch((error) => {
  console.error(`[m6-agent-harness] ${error.message}`);
  process.exit(1);
});
