/** Labels are computed here, never accepted from a prompt or an upstream answer. */
export function toolResult(tool: 'health_check' | 'ask_deepseek', value: Record<string, unknown>) {
  let kind = 'error';
  let label = '【DeepSeek 工具失败｜未取得可展示的回答】';
  let provider: string | null = null;
  // An error may follow dispatch: never imply that a timeout made no paid call.
  let inferenceStatus = 'unknown';
  if (tool === 'ask_deepseek' && value.ok === false && value.answer_status === 'no_final_answer' && value.mode === 'live') {
    kind = 'no_final_answer'; label = '【DeepSeek 已调用｜未产生最终回答】'; provider = 'deepseek';
    inferenceStatus = value.truncated === true ? 'truncated_without_answer' : 'completed_without_answer';
  } else if (tool === 'ask_deepseek' && value.ok === false && value.answer_status === 'no_final_answer' && value.mode === 'mock') {
    kind = 'mock_no_final_answer'; label = '【Mock 未产生最终回答｜未调用 DeepSeek】'; provider = 'mock';
    inferenceStatus = value.truncated === true ? 'mock_truncated_without_answer' : 'mock_without_answer';
  } else if (value.ok === true) {
    if (tool === 'health_check') {
      kind = 'server_status'; label = '【服务状态｜未调用 DeepSeek】'; inferenceStatus = 'not_requested';
    } else if (value.dry_run === true) {
      kind = 'cost_estimate'; label = '【费用估算｜未调用 DeepSeek】'; inferenceStatus = 'not_requested';
    } else if (value.mode === 'mock') {
      kind = 'mock_output'; label = '【Mock 返回｜未调用 DeepSeek】'; provider = 'mock'; inferenceStatus = 'mock';
    } else if (value.mode === 'live' && typeof value.answer === 'string') {
      kind = 'model_output'; label = `【DeepSeek 返回｜请求模型 ${value.model}】`;
      provider = 'deepseek'; inferenceStatus = value.truncated === true ? 'truncated'
        : value.answer_status === 'incomplete' ? 'incomplete' : 'completed';
    }
  }
  const structuredContent = { ...value, display_label: label, provenance: {
    kind, provider, inference_status: inferenceStatus, host_model_replaced: false,
  } };
  return { content: [{ type: 'text' as const, text: `${label}\n${JSON.stringify(structuredContent)}` }], structuredContent };
}
