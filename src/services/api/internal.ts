import { completeText } from './client.js'
import { completeSiliconFlowText } from './siliconflow.js'
import type { CreateMessageRequest } from './types.js'
import { siliconFlowModel } from '../providers.js'
import { activeKey, useSettings } from '../settings.js'

/**
 * 内部请求（摘要、记忆抽取）用的模型。
 * 硅基流动上一律用最便宜的 Flash，与用户在对话框里选的模型无关——
 * 压缩一轮可能要调几十次，不能让 R1 去干这件事。
 */
const INTERNAL_MODEL = siliconFlowModel('deepseek-ai/DeepSeek-V4.1-Flash')

/**
 * 内部请求统一入口：按当前通道自动选择实现。
 * body 仍是官方格式，硅基流动分支会把 messages 转成 OpenAI 格式。
 */
export const completeInternal = async (
  body: CreateMessageRequest,
  signal: AbortSignal
): Promise<string> => {
  const settings = useSettings.getState()
  const key = activeKey(settings)
  if (!key) {
    throw new Error('missing api key')
  }
  if (settings.provider === 'siliconflow') {
    return completeSiliconFlowText(
      {
        apiKey: key,
        model: INTERNAL_MODEL,
        system: body.system,
        messages: body.messages,
        thinking: false,
      },
      signal
    )
  }
  return completeText(key, body, signal)
}
