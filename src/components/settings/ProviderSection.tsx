import clsx from 'clsx'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { PROVIDERS, SILICONFLOW_MODELS, providerInfo, siliconFlowModel } from '../../services/providers.js'
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

const formatWindow = (tokens: number): string =>
  tokens >= 1000 ? `${Math.round((tokens / 1024) * 10) / 10}K` : String(tokens)

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
  const model = siliconFlowModel(useSettings((state) => state.siliconflowModel))

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
      {provider === 'siliconflow' && siliconflowKey.apiKey ? (
        <>
          <div className={clsx(styles.cell, styles.row)}>
            <div className={styles.text}>
              <div className={styles.label}>{t('siliconflowModelLabel')}</div>
              <div className={styles.description}>
                {model.label} · {t('siliconflowWindow', { size: formatWindow(model.contextWindow) })} ·{' '}
                {model.hint}
              </div>
            </div>
          </div>
          <div className={clsx(styles.cell, styles.row)}>
            <div className={styles.text}>
              <div className={styles.label}>{t('siliconflowModelSwitchHint')}</div>
              <div className={styles.description}>
                {SILICONFLOW_MODELS.map((item) => item.label).join(' / ')}
              </div>
            </div>
          </div>
        </>
      ) : null}
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
