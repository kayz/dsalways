import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useAssistRuntime, rebuildMemories } from '../../services/assist/runtime.js'
import {
  clearMemories,
  loadMemories,
  removeMemory,
  toggleMemoryPin,
  useMemory,
} from '../../services/assist/memory.js'
import { fmtTokens } from '../../services/assist/tokens.js'
import { useChatStore } from '../../services/chat/store.js'
import {
  setCompressAt,
  setContextLimit,
  setKeepRecent,
  setMemoryEnabled,
  setMemoryEvery,
  setPersona,
  activeKey,
  useSettings,
} from '../../services/settings.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { closeAssist, useAssistDialog } from './assistDialogState.js'
import styles from './Assist.module.css'

export const AssistDialog = () => {
  const open = useAssistDialog((state) => state.open)
  useEffect(() => {
    if (open) {
      void loadMemories()
    }
  }, [open])
  return open ? <AssistContent /> : null
}

const AssistContent = () => {
  const t = useTranslate()
  return (
    <Modal
      title={t('assistTitle')}
      closable
      className={styles.dialog}
      mainClassName={styles.scroll}
      onClose={closeAssist}
    >
      <MemorySection />
      <PersonaSection />
      <ContextSection />
    </Modal>
  )
}

/** 记忆列表：可以置顶、删除，也可以立刻把当前对话整理一遍 */
const MemorySection = () => {
  const t = useTranslate()
  const facts = useMemory((state) => state.facts)
  const extracting = useMemory((state) => state.extracting)
  const enabled = useSettings((state) => state.memoryEnabled)
  // 记忆抽取按当前通道的 Key 判断，切到硅基流动后也能整理
  const apiKey = useSettings((state) => activeKey(state))
  const activeId = useChatStore((state) => state.activeId)
  const session = useChatStore((state) =>
    state.activeId !== null && Object.hasOwn(state.sessionCache, state.activeId)
      ? state.sessionCache[state.activeId]
      : undefined
  )
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [confirming, setConfirming] = useState(false)

  const organize = async () => {
    if (!apiKey) {
      setStatus({ ok: false, text: t('memoryNeedKey') })
      return
    }
    if (!session) {
      setStatus({ ok: false, text: t('memoryNeedsSession') })
      return
    }
    setStatus(null)
    const result = await rebuildMemories({
      sessionId: session.id,
      history: session.messages,
    })
    setStatus(
      result.added + result.updated > 0
        ? {
            ok: true,
            text: t('memoryExtracted', { added: result.added, updated: result.updated }),
          }
        : { ok: true, text: t('memoryExtractNothing') }
    )
  }

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.sectionTitle}>{t('assistTabMemory')}</span>
        <span className={styles.chip}>{t('memoryTotal', { count: facts.length })}</span>
        <span className={styles.spacer} />
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setMemoryEnabled(event.target.checked)}
          />
          {t('memoryEnabled')}
        </label>
      </div>
      <p className={styles.sectionDesc}>{t('memoryEnabledDesc')}</p>

      {facts.length === 0 ? (
        <div className={styles.empty}>{t('memoryEmpty')}</div>
      ) : (
        <ul className={styles.facts}>
          {facts.map((fact) => (
            <li key={fact.id} className={styles.fact} data-pinned={!!fact.pinned}>
              <span className={styles.chip}>{fact.category}</span>
              <span className={styles.factText}>{fact.text}</span>
              <span className={styles.factActions}>
                <button
                  type="button"
                  className={styles.iconBtn}
                  onClick={() => void toggleMemoryPin(fact.id)}
                >
                  {fact.pinned ? t('memoryUnpin') : t('memoryPin')}
                </button>
                <button
                  type="button"
                  className={styles.iconBtn}
                  onClick={() => void removeMemory(fact.id)}
                >
                  {t('delete')}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.actions}>
        <Button
          variant="outlined"
          size="s"
          disabled={extracting !== null || !activeId}
          onClick={() => void organize()}
        >
          {extracting ? t('memoryExtracting') : t('memoryExtract')}
        </Button>
        {facts.length > 0 ? (
          <Button variant="dangerOutlined" size="s" onClick={() => setConfirming(true)}>
            {t('memoryClear')}
          </Button>
        ) : null}
      </div>
      {status ? (
        <div className={clsx(styles.status, status.ok ? styles.statusOk : styles.statusErr)}>
          {status.text}
        </div>
      ) : null}

      {confirming ? (
        <Modal
          title={t('memoryClear')}
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Button variant="outlined" size="m" onClick={() => setConfirming(false)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                size="m"
                onClick={() => {
                  void clearMemories()
                  setConfirming(false)
                }}
              >
                {t('memoryClear')}
              </Button>
            </>
          }
        >
          {t('memoryClearConfirm')}
        </Modal>
      ) : null}
    </section>
  )
}

/** 人格设定：追加在默认人格之后 */
const PersonaSection = () => {
  const t = useTranslate()
  const persona = useSettings((state) => state.persona)
  const [value, setValue] = useState(persona)
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.sectionTitle}>{t('personaTitle')}</span>
      </div>
      <p className={styles.sectionDesc}>{t('personaDesc')}</p>
      <textarea
        className={styles.textarea}
        value={value}
        placeholder={t('personaPlaceholder')}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => setPersona(value)}
      />
    </section>
  )
}

/** 上下文参数与上次请求的构成 */
const ContextSection = () => {
  const t = useTranslate()
  const contextLimit = useSettings((state) => state.contextLimit)
  const compressAt = useSettings((state) => state.compressAt)
  const keepRecent = useSettings((state) => state.keepRecent)
  const memoryEvery = useSettings((state) => state.memoryEvery)
  const activeId = useChatStore((state) => state.activeId)
  const stats = useAssistRuntime((state) => (activeId ? state.stats[activeId] : undefined))
  const compressing = useAssistRuntime((state) =>
    activeId ? state.compressing === activeId : false
  )
  const hitRates = useAssistRuntime((state) => (activeId ? state.hitRates[activeId] : undefined))

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.sectionTitle}>{t('assistTabContext')}</span>
      </div>

      <div className={styles.row}>
        <span className={styles.rowText}>
          <div className={styles.rowLabel}>{t('contextLimit')}</div>
          <div className={styles.rowDesc}>{t('contextLimitDesc')}</div>
        </span>
        <input
          type="number"
          className={styles.numInput}
          value={contextLimit}
          min={8000}
          max={1000000}
          step={8000}
          onChange={(event) => setContextLimit(Number(event.target.value) || 128000)}
        />
      </div>

      <div className={styles.row}>
        <span className={styles.rowText}>
          <div className={styles.rowLabel}>{t('contextCompressAt')}</div>
          <div className={styles.rowDesc}>{t('contextCompressAtDesc')}</div>
        </span>
        <input
          type="number"
          className={styles.numInput}
          value={Math.round(compressAt * 100)}
          min={30}
          max={95}
          step={5}
          onChange={(event) =>
            setCompressAt(Math.min(0.95, Math.max(0.3, Number(event.target.value) / 100)))
          }
        />
      </div>

      <div className={styles.row}>
        <span className={styles.rowText}>
          <div className={styles.rowLabel}>{t('contextKeepRecent')}</div>
          <div className={styles.rowDesc}>{t('contextKeepRecentDesc')}</div>
        </span>
        <input
          type="number"
          className={styles.numInput}
          value={keepRecent}
          min={2}
          max={200}
          step={2}
          onChange={(event) => setKeepRecent(Number(event.target.value) || 20)}
        />
      </div>

      <div className={styles.row}>
        <span className={styles.rowText}>
          <div className={styles.rowLabel}>{t('contextMemoryEvery')}</div>
          <div className={styles.rowDesc}>{t('contextMemoryEveryDesc')}</div>
        </span>
        <input
          type="number"
          className={styles.numInput}
          value={memoryEvery}
          min={1}
          max={100}
          step={1}
          onChange={(event) => setMemoryEvery(Number(event.target.value) || 6)}
        />
      </div>

      <div className={clsx(styles.row, styles.stack)}>
        <span className={styles.rowText}>
          <div className={styles.rowLabel}>{t('contextLastRequest')}</div>
        </span>
        <span className={styles.stats}>
          {stats ? (
            <>
              <span className={styles.statPill}>
                {t('contextStatHistory', { rounds: stats.historyRounds })}
              </span>
              <span className={styles.statPill}>
                {t('contextStatFacts', { facts: stats.factsUsed })}
              </span>
              {stats.summary > 0 ? (
                <span className={styles.statPill}>
                  {t('contextStatSummary', { tokens: fmtTokens(stats.summary) })}
                </span>
              ) : null}
              {stats.droppedRounds > 0 ? (
                <span className={styles.statPillAccent}>
                  {t('contextDropped', { rounds: stats.droppedRounds })}
                </span>
              ) : null}
              <span className={styles.statPill}>
                {t('contextStatTotal', {
                  total: fmtTokens(stats.total),
                  limit: fmtTokens(stats.limit),
                })}
              </span>
            </>
          ) : (
            <span className={styles.statPill}>{t('contextNoStats')}</span>
          )}
        </span>
      </div>

      <div className={clsx(styles.row, styles.stack)}>
        <span className={styles.rowText}>
          <div className={styles.rowLabel}>{t('cacheHitTitle')}</div>
          <div className={styles.rowDesc}>{t('cacheHitDesc')}</div>
        </span>
        <span className={styles.stats}>
          {hitRates?.length ? (
            <>
              <span className={styles.statPill}>
                {t('cacheHitLast', { rate: hitRates[hitRates.length - 1] })}
              </span>
              <span className={styles.hitBars}>
                {hitRates.map((rate, index) => (
                  <span
                    key={index}
                    className={styles.hitBar}
                    style={{ height: `${Math.max(6, rate)}%` }}
                    title={`${rate}%`}
                  />
                ))}
              </span>
            </>
          ) : (
            <span className={styles.statPill}>{t('cacheHitEmpty')}</span>
          )}
        </span>
      </div>

      {compressing ? <div className={styles.compressing}>{t('contextCompressing')}</div> : null}
    </section>
  )
}
