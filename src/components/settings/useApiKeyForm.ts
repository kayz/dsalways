import { useState } from 'react'
import { ApiError, verifyApiKey } from '../../services/api/client.js'
import { verifySiliconFlowKey } from '../../services/api/siliconflow.js'
import { classifyApiError } from '../../services/api/errors.js'
import { setApiKey, setSiliconflowKey } from '../../services/settings.js'
import { useTranslate } from '../../i18n/index.js'

export type KeyFormOptions = {
  /** 校验方式，默认用官方 GET /models */
  verify?: (apiKey: string) => Promise<void>
  /** 保存方式，默认存官方 Key */
  save?: (apiKey: string) => void
}

/** 输入 API Key 后先校验，通过才保存 */
export const useApiKeyForm = (onSaved?: () => void, options?: KeyFormOptions) => {
  const t = useTranslate()
  const [value, setValue] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [failure, setFailure] = useState<{ cause: unknown } | null>(null)
  const cause = failure?.cause
  const error =
    failure === null
      ? null
      : classifyApiError(cause) === 'unauthorized'
        ? t('apiKeyInvalid')
        : classifyApiError(cause) === 'network'
          ? t('commonNetworkErrorToast')
          : t('apiKeyVerificationFailed', {
              message:
                cause instanceof ApiError && cause.localMessage
                  ? t(cause.localMessage.key, cause.localMessage.params)
                  : cause instanceof Error
                    ? cause.message
                    : String(cause),
            })

  const submit = async () => {
    const apiKey = value.trim()
    if (!apiKey || verifying) {
      return
    }
    setVerifying(true)
    setFailure(null)
    try {
      await (options?.verify ?? verifyApiKey)(apiKey)
      ;(options?.save ?? setApiKey)(apiKey)
      setValue('')
      onSaved?.()
    } catch (e) {
      setFailure({ cause: e })
    } finally {
      setVerifying(false)
    }
  }

  return { value, setValue, verifying, error, submit }
}

/** 硅基流动的 Key：同一个输入框、不同的校验地址与保存位置 */
export const useSiliconFlowKeyForm = (onSaved?: () => void) =>
  useApiKeyForm(onSaved, {
    verify: verifySiliconFlowKey,
    save: (apiKey) => setSiliconflowKey(apiKey),
  })
