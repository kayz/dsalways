import clsx from 'clsx'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import {
  DEEPSEEK_MODELS,
  PROVIDERS,
  SILICONFLOW_MODELS,
  officialModel,
  providerInfo,
  siliconFlowModel,
} from '../../services/providers.js'
import {
  setPrefixEnabled,
  setPrefixPrompt,
  setProvider,
  useSettings,
} from '../../services/settings.js'
import { desktop } from '../../utils/desktop.js'
import { Button } from '../base/Button.js'
import {
  ApiKeyField,
  SiliconFlowKeyField,
  useApiKeyEditor,
  useSiliconFlowKeyEditor,
} from './ApiKeyField.js'
import styles from './Settings.module.css'

/** 1048576 → 1M，163840 → 160K */
const formatWindow = (tokens: number): string => {
  if (tokens >= 1048576) {
    return `${Math.round((tokens / 1048576) * 10) / 10}M`
  }
  return tokens >= 1000 ? `${Math.round((tokens / 1024) * 10) / 10}K` : String(tokens)
}

/**
 * 模型接入：通道选择 + 对应通道的 Key + 前置指令。
 * 两个通道的 Key 分开保存，切回旧通道不用重新填。
 */
export const ProviderSection = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const provider = useSettings((state) => state.provider)
  const prefixPrompt = useSettings((state) => state.prefixPrompt)
  const prefixEnabled = useSettings((state) => state.prefixEnabled)
  // 两个编辑器都创建，切换通道时正在输入的内容不会丢
  const deepseekKey = useApiKeyEditor()
  const siliconflowKey = useSiliconFlowKeyEditor()
  const info = providerInfo(provider)
  const deepseekModelId = useSettings((state) => state.deepseekModel)
  /** 当前通道的选中项：官方两个，硅基流动白名单三个 */
  const currentModel =
    provider === 'siliconflow'
      ? siliconFlowModel(useSettings((state) => state.siliconflowModel))
      : officialModel(deepseekModelId)
  /** 当前通道的简称，模型行前面带上它，用户才知道自己在用哪个渠道 */
  const channelLabel =
    provider === 'siliconflow' ? t('channelSiliconflowShort') : t('channelOfficialShort')
  /** 两个通道的模型都列出来，与对话框下拉保持一致 */
  const modelGroups = [
    `${t('channelOfficialShort')}：${DEEPSEEK_MODELS.map((item) => item.label).join(' / ')}`,
    `${t('channelSiliconflowShort')}：${SILICONFLOW_MODELS.map((item) => item.label).join(' / ')}`,
  ]

  return (
    <>
      <div className={styles.cell}>
        <div className={styles.label}>{t('providerLabel')}</div>
        <div className={styles.providerRow}>
          {PROVIDERS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={provider === item.id}
              className={clsx(
                styles.providerOption,
                provider === item.id && styles.providerOptionActive
              )}
              onClick={() => setProvider(item.id)}
            >
              <span className={styles.providerName}>{item.label}</span>
              <span className={styles.description}>{item.summary}</span>
            </button>
          ))}
        </div>
      </div>
      {provider === 'deepseek' ? (
        <ApiKeyField editor={deepseekKey} />
      ) : (
        <SiliconFlowKeyField editor={siliconflowKey} />
      )}
      <div className={clsx(styles.cell, styles.row)}>
        <div className={styles.text}>
          <div className={styles.label}>{t('modelCurrentLabel')}</div>
          <div className={styles.description}>
            {channelLabel} · {currentModel.label} ·{' '}
            {t('modelWindow', { size: formatWindow(currentModel.contextWindow) })} ·{' '}
            {currentModel.hint}
          </div>
        </div>
      </div>
      <div className={clsx(styles.cell, styles.row)}>
        <div className={styles.text}>
          <div className={styles.label}>{t('modelSwitchHint')}</div>
          {modelGroups.map((line) => (
            <div key={line} className={styles.description}>
              {line}
            </div>
          ))}
        </div>
      </div>
      {provider === 'siliconflow' ? (
        <>
          <div className={clsx(styles.cell, styles.row)}>
            <div className={styles.text}>
              <div className={styles.label}>{t('providerSignup')}</div>
              <div className={styles.description}>{info.signupUrl}</div>
            </div>
            <Button
              variant="outlined"
              size="m"
              className={styles.cellButton}
              onClick={() => void desktop()?.openExternal?.(info.signupUrl)}
            >
              {t('providerSignupAction')}
            </Button>
          </div>
          <div className={styles.cell}>
            <div className={styles.description}>{t('siliconflowAttachHint')}</div>
          </div>
        </>
      ) : null}
      <div className={styles.cell}>
        <div className={styles.label}>{t('prefixLabel')}</div>
        <textarea
          className={styles.prefixInput}
          rows={4}
          spellCheck={false}
          placeholder={t('prefixPlaceholder')}
          value={prefixPrompt}
          onChange={(event) => setPrefixPrompt(event.target.value)}
        />
        <div className={styles.description}>{t('prefixHint')}</div>
      </div>
      <div className={clsx(styles.cell, styles.row)}>
        <div className={styles.text}>
          <div className={styles.label}>{t('prefixDefault')}</div>
          <div className={styles.description}>{t('prefixDefaultHint')}</div>
        </div>
        <Button
          variant={prefixEnabled ? 'primary' : 'outlined'}
          size="m"
          className={styles.cellButton}
          onClick={() => setPrefixEnabled(!prefixEnabled)}
        >
          {prefixEnabled ? t('prefixOn') : t('prefixOff')}
        </Button>
      </div>
      {isMobile ? (provider === 'deepseek' ? deepseekKey.confirm : siliconflowKey.confirm) : null}
    </>
  )
}
