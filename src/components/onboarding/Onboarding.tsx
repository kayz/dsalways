import clsx from 'clsx'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { verifyApiKey } from '../../services/api/client.js'
import { importHistory } from '../../services/chat/backup.js'
import { useChatStore } from '../../services/chat/store.js'
import { setApiKey, setOnboardingDone } from '../../services/settings.js'
import { openExternal, readClipboardText } from '../../utils/clipboard.js'
import { Button } from '../base/Button.js'
import { fileFromDrop, fileFromFiles } from './dropImport.js'
import { closeOnboarding, useOnboarding } from './onboardingState.js'
import styles from './Onboarding.module.css'

const KEY_PATTERN = /^sk-[A-Za-z0-9_-]{16,}$/
const PLATFORM_URL = 'https://platform.deepseek.com/api_keys'
const CHAT_URL = 'https://chat.deepseek.com/downloads'

const BrandMark = () => (
  <svg width="17" height="17" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path
      d="M3 4.6h7.2v6.8H3z"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
      fill="none"
    />
    <path d="M12.4 9.6V3.2H6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
)

/** 新手引导：三步完成「填 Key → 搬历史 → 开始」，可以随时跳过 */
export const Onboarding = () => {
  const open = useOnboarding((state) => state.open)
  return open ? <Wizard /> : null
}

const Wizard = () => {
  const t = useTranslate()
  const [step, setStep] = useState(0)
  const [keyReady, setKeyReady] = useState(false)
  const [imported, setImported] = useState<number | null>(null)

  const finish = () => {
    setOnboardingDone(true)
    closeOnboarding()
  }

  const steps = [
    { label: t('onbStepKey'), done: keyReady },
    { label: t('onbStepImport'), done: imported !== null },
    { label: t('onbStepStart'), done: false },
  ]

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={t('onbWelcome')}>
      <div className={styles.card}>
        <div className={styles.head}>
          <span className={styles.brandMark}>
            <BrandMark />
          </span>
          <span className={styles.brandName}>{t('appName')}</span>
          <span className={styles.headSpacer} />
          <button type="button" className={styles.later} onClick={finish}>
            {t('onbLater')}
          </button>
        </div>

        <ol className={styles.steps}>
          {steps.map((item, index) => (
            <li
              key={item.label}
              className={styles.stepItem}
              data-active={index === step}
              data-done={item.done && index !== step}
            >
              <span className={styles.stepDot}>{index + 1}</span>
              {item.label}
            </li>
          ))}
        </ol>

        <div className={styles.body}>
          {step === 0 ? (
            <KeyStep
              onReady={(ready) => {
                setKeyReady(ready)
                if (ready) {
                  setStep(1)
                }
              }}
            />
          ) : step === 1 ? (
            <ImportStep
              imported={imported}
              onImported={(count) => {
                setImported(count)
                setStep(2)
              }}
            />
          ) : (
            <DoneStep keyReady={keyReady} imported={imported} />
          )}
        </div>

        <div className={styles.foot}>
          {step > 0 ? (
            <Button variant="outlined" size="m" onClick={() => setStep(step - 1)}>
              {t('onbPrev')}
            </Button>
          ) : null}
          <span className={styles.footSpacer} />
          {step < 2 ? (
            <Button variant="outlined" size="m" onClick={() => setStep(step + 1)}>
              {step === 0 ? t('onbKeySkip') : t('onbSkip')}
            </Button>
          ) : null}
          {step === 2 ? (
            <Button size="m" onClick={finish}>
              {t('onbFinish')}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/** 第一步：填 Key。剪贴板里有就直接提示一键填入，省掉「复制到哪」的困惑。 */
const KeyStep = ({ onReady }: { onReady: (ready: boolean) => void }) => {
  const t = useTranslate()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [ok, setOk] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [candidate, setCandidate] = useState('')
  const checked = useRef(false)

  const probeClipboard = useCallback(async () => {
    const text = (await readClipboardText()).trim()
    if (KEY_PATTERN.test(text)) {
      setCandidate(text)
    }
  }, [])

  useEffect(() => {
    if (checked.current) {
      return
    }
    checked.current = true
    void probeClipboard()
  }, [probeClipboard])

  const submit = async (raw: string) => {
    const key = raw.trim()
    if (!key || busy) {
      return
    }
    if (!KEY_PATTERN.test(key)) {
      setError(t('apiKeyInvalid'))
      setOk(false)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await verifyApiKey(key)
      setOk(true)
      setApiKey(key)
      setCandidate('')
      onReady(true)
    } catch (failure) {
      setOk(false)
      setError(friendlyFailure(failure, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h2 className={styles.h2}>{t('onbKeyTitle')}</h2>
      <p className={styles.lead}>{t('onbKeyDesc')}</p>

      <div className={styles.guide}>
        <div className={styles.guideTitle}>{t('onbKeyHow')}</div>
        <ol className={styles.guideList}>
          <li>{t('onbKeyHowStep1')}</li>
          <li>{t('onbKeyHowStep2')}</li>
          <li>{t('onbKeyHowStep3')}</li>
        </ol>
        <Button variant="outlined" size="s" onClick={() => openExternal(PLATFORM_URL)}>
          {t('onbOpenPlatform')}
        </Button>
      </div>

      {candidate ? (
        <div className={styles.clipHint}>
          {t('onbClipboardHint')}
          <button
            type="button"
            onClick={() => {
              setValue(candidate)
              void submit(candidate)
            }}
          >
            {t('onbPaste')}
          </button>
        </div>
      ) : null}

      <div className={styles.field}>
        <input
          className={styles.input}
          value={value}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          placeholder="sk-..."
          onChange={(event) => {
            setValue(event.target.value)
            setError(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              void submit(value)
            }
          }}
        />
        <Button
          variant="outlined"
          size="m"
          style={{ flex: 'none', height: 42 }}
          onClick={() => {
            void (async () => {
              const text = (await readClipboardText()).trim()
              if (KEY_PATTERN.test(text)) {
                setValue(text)
                await submit(text)
              } else {
                setError(t('onbPasteEmpty'))
              }
            })()
          }}
        >
          {t('onbReadClipboard')}
        </Button>
        <Button
          size="m"
          disabled={busy || !value.trim()}
          onClick={() => void submit(value)}
          style={{ flex: 'none', height: 42 }}
        >
          {busy ? t('onbTesting') : t('onbTest')}
        </Button>
      </div>

      <div className={styles.statusRow} aria-live="polite">
        {busy ? <span className={styles.statusInfo}>{t('onbTesting')}</span> : null}
        {!busy && ok ? <span className={styles.statusOk}>{t('onbTestOk')}</span> : null}
        {!busy && error ? <span className={styles.statusErr}>{error}</span> : null}
      </div>

      <p className={styles.privacy}>{t('onbPrivacy')}</p>
      <p className={styles.disclaimer}>{t('onbDisclaimer')}</p>
    </>
  )
}

/** 把接口错误翻译成新手能看懂的一句话 */
const friendlyFailure = (failure: unknown, t: ReturnType<typeof useTranslate>): string => {
  const message = failure instanceof Error ? failure.message : String(failure)
  if (/401|unauthori|invalid.*key|auth/i.test(message)) {
    return t('apiKeyInvalid')
  }
  if (/network|fetch|Failed to fetch|ENOTFOUND|timeout/i.test(message)) {
    return t('commonNetworkErrorToast')
  }
  if (/402|balance|insufficient/i.test(message)) {
    return t('insufficientBalance')
  }
  if (/429|rate/i.test(message)) {
    return t('rateLimited')
  }
  return `${t('apiKeyVerificationFailed', { message })}`
}

/** 第二步：导入历史。整块区域都能拖，ZIP 与解压后的文件夹都收。 */
const ImportStep = ({
  imported,
  onImported,
}: {
  imported: number | null
  onImported: (count: number) => void
}) => {
  const t = useTranslate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const zipInput = useRef<HTMLInputElement>(null)
  const dirInput = useRef<HTMLInputElement>(null)
  const existing = useChatStore((state) => state.sessions.length)

  const run = async (file: File) => {
    if (busy) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      const count = await importHistory(file)
      onImported(count)
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure)
      setError(t('onbImportFail', { message: readableImportError(message, t) }))
    } finally {
      setBusy(false)
      setOver(false)
    }
  }

  return (
    <>
      <h2 className={styles.h2}>{t('onbImportTitle')}</h2>
      <p className={styles.lead}>{t('onbImportDesc')}</p>

      <div className={styles.guide}>
        <div className={styles.guideTitle}>{t('onbImportHow')}</div>
        <Button variant="outlined" size="s" onClick={() => openExternal(CHAT_URL)}>
          {t('onbOpenChat')}
        </Button>
      </div>

      <div
        className={styles.dropZone}
        data-over={over}
        onClick={() => zipInput.current?.click()}
        onDragOver={(event) => {
          event.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault()
          void fileFromDrop(event.dataTransfer).then((file) => {
            if (file) {
              void run(file)
            }
          })
        }}
      >
        <span className={styles.dropTitle}>{busy ? t('onbImporting') : t('onbDropZone')}</span>
        <span className={styles.dropHint}>{t('onbDropZoneHint')}</span>
        {existing > 0 ? (
          <span className={styles.dropHint}>当前已有 {existing} 个对话，导入会覆盖它们</span>
        ) : null}
      </div>

      <div className={styles.field} style={{ marginTop: 10 }}>
        <Button variant="outlined" size="s" onClick={() => zipInput.current?.click()}>
          选择 ZIP 文件
        </Button>
        <Button variant="outlined" size="s" onClick={() => dirInput.current?.click()}>
          选择文件夹
        </Button>
      </div>

      {error ? (
        <div className={clsx(styles.statusRow, styles.statusErr)} aria-live="polite">
          {error}
        </div>
      ) : imported !== null ? (
        <div className={clsx(styles.statusRow, styles.statusOk)}>
          {t('onbImported', { count: imported })}
        </div>
      ) : null}

      <input
        ref={zipInput}
        type="file"
        accept=".zip,application/zip"
        hidden
        onChange={(event) => {
          // 先取出数组再清空 value：清空会让 FileList 一起变空
          const picked = Array.from(event.target.files ?? [])
          event.target.value = ''
          void fileFromFiles(picked).then((file) => {
            if (file) {
              void run(file)
            }
          })
        }}
      />
      <input
        ref={dirInput}
        type="file"
        hidden
        // @ts-expect-error 非标准属性：Chromium 用它把选择器切换成文件夹模式
        webkitdirectory=""
        onChange={(event) => {
          const picked = Array.from(event.target.files ?? [])
          event.target.value = ''
          void fileFromFiles(picked).then((file) => {
            if (file) {
              void run(file)
            }
          })
        }}
      />
    </>
  )
}

const readableImportError = (message: string, t: ReturnType<typeof useTranslate>): string => {
  if (/format/i.test(message)) {
    return t('historyImportFailed')
  }
  return message
}

/** 第三步：确认清单，告诉用户接下来能做什么 */
const DoneStep = ({ keyReady, imported }: { keyReady: boolean; imported: number | null }) => {
  const t = useTranslate()
  return (
    <>
      <h2 className={styles.h2}>{t('onbStartTitle')}</h2>
      <p className={styles.lead}>{t('onbStartDesc')}</p>
      <div className={styles.summary}>
        <div className={styles.summaryRow}>
          <span className={clsx(styles.check, !keyReady && styles.checkMuted)}>
            {keyReady ? '✓' : '—'}
          </span>
          <span>
            API Key：<strong>{keyReady ? '已配置' : '未配置'}</strong>
          </span>
        </div>
        <div className={styles.summaryRow}>
          <span className={clsx(styles.check, imported === null && styles.checkMuted)}>
            {imported !== null ? '✓' : '—'}
          </span>
          <span>
            历史对话：
            <strong>{imported !== null ? `已导入 ${imported} 个` : '尚未导入'}</strong>
          </span>
        </div>
      </div>
      <p className={styles.privacy}>{t('onbStartTip')}</p>
    </>
  )
}
