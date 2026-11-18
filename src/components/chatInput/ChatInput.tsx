import clsx from 'clsx'
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  IconGlobeLanguageOutline14,
  IconPaperclipOutline16,
  IconSendOutline16,
  IconStopFill16,
  IconThinkOutline14,
} from '../base/icons.js'
import {
  setDeepseekModel,
  setProvider,
  setSearch,
  setSiliconflowModel,
  setThinking,
  useSettings,
} from '../../services/settings.js'
import {
  DEEPSEEK_MODELS,
  SILICONFLOW_MODELS,
  effectiveContextLimit,
  siliconFlowModel,
  type WindowSettings,
} from '../../services/providers.js'
import { askRecompact, needsRecompact } from '../../services/assist/windowMigration.js'
import { useIsMobile } from '../../app/viewport.js'
import {
  sendMessage,
  sessionPrefixEnabled,
  setSessionPrefix,
  stopReply,
  useChatStore,
} from '../../services/chat/store.js'
import {
  addDraftFiles,
  EMPTY_DRAFT,
  getDraft,
  prepareDraftMessage,
  removeDraftAttachment,
  retryDraftAttachment,
  setDraftText,
  useDrafts,
} from '../../services/chat/drafts.js'
import { stopReadAloud } from '../../services/speech/readAloud.js'
import { IconButton } from '../base/IconButton.js'
import { Select } from '../base/Select.js'
import { Tooltip } from '../base/Tooltip.js'
import { ensureApiKey } from '../settings/settingsDialogState.js'
import { DragMask, useFileDrop } from './DragMask.js'
import { showToast } from '../base/toastState.js'
import { ACCEPT, useUploads } from '../../services/attachments.js'
import { DraftAttachments } from './DraftAttachments.js'
import { useVoiceInput } from './useVoiceInput.js'
import { VoiceButton } from './VoiceButton.js'
import { Spectrum } from './Spectrum.js'
import { useTranslate } from '../../i18n/index.js'
import styles from './ChatInput.module.css'

/** 输入框：自适应高度的文本框 + 文件 + 深度思考与智能搜索开关 + 语音输入 + 发送 / 停止 */
export const ChatInput = memo(function ChatInput({ sessionId }: { sessionId: string | null }) {
  // 切换目标时释放录音、转写和 DOM 状态；文字与附件由草稿服务保留。
  return <Input key={sessionId === null ? 'new' : `session:${sessionId}`} sessionId={sessionId} />
})

const Input = ({ sessionId }: { sessionId: string | null }) => {
  const t = useTranslate()
  const draft = useDrafts((state) => state.drafts.get(sessionId) ?? EMPTY_DRAFT)
  const { text, attachments } = draft
  const setText = (value: string) => setDraftText(sessionId, value)
  const draftReady = useUploads((state) => prepareDraftMessage(draft, state.tasks) !== null)
  const streaming = useChatStore(
    (state) => sessionId !== null && Object.hasOwn(state.streaming, sessionId)
  )
  const thinking = useSettings((state) => state.thinking)
  const importingHistory = useChatStore((state) => state.importingHistory)
  const isMobile = useIsMobile()
  const search = useSettings((state) => state.search)
  const siliconflowModelId = useSettings((state) => state.siliconflowModel)
  const siliconflow = useSettings((state) => state.provider === 'siliconflow')
  const modelInfo = siliconFlowModel(siliconflowModelId)
  const deepseekModelId = useSettings((state) => state.deepseekModel)
  const hasDeepseekKey = useSettings((state) => Boolean(state.apiKey))
  /**
   * 两个通道的 5 个模型放在同一个下拉里，标签带通道前缀，
   * 用户一眼能看出「现在用的是哪个渠道的哪个模型」，选到别的通道时顺带切通道。
   */
  const modelOptions = [
    ...DEEPSEEK_MODELS.map((item) => ({
      value: item.id,
      label: `${t('channelOfficialShort')} · ${item.label}`,
    })),
    ...SILICONFLOW_MODELS.map((item) => ({
      value: item.id,
      label: `${t('channelSiliconflowShort')} · ${item.label}`,
    })),
  ]
  /** 当前选中的模型 id（跨通道唯一） */
  const selectedModelId = siliconflow ? siliconflowModelId : deepseekModelId
  /** 选模型即选通道：模型名和通道是一一对应的 */
  const pickModel = async (value: string) => {
    const current = useSettings.getState()
    const official = DEEPSEEK_MODELS.find((item) => item.id === value)
    const sfModel = SILICONFLOW_MODELS.find((item) => item.id === value)
    if (!official && !sfModel) {
      return
    }
    const target: WindowSettings = {
      provider: official ? 'deepseek' : 'siliconflow',
      contextLimit: current.contextLimit,
      siliconflowModel: sfModel?.id ?? current.siliconflowModel,
      deepseekModel: official?.id ?? current.deepseekModel,
    }
    // 换到窗口更小的模型且旧摘要装不下时，先弹窗确认；取消则什么都不改，完整回退
    const shrinking = effectiveContextLimit(target) < effectiveContextLimit(current)
    const sessionId = useChatStore.getState().activeId
    if (shrinking && sessionId && (await needsRecompact(sessionId, target))) {
      const ok = await askRecompact({
        sessionId,
        toLabel: official?.label ?? sfModel?.label ?? '',
      })
      if (!ok) {
        return
      }
    }
    if (official) {
      setProvider('deepseek')
      setDeepseekModel(official.id)
    } else if (sfModel) {
      setProvider('siliconflow')
      setSiliconflowModel(sfModel.id)
    }
    // 目标通道还没填 Key：直接打开设置页，别等发送时才报错
    ensureApiKey()
  }
  const prefixPrompt = useSettings((state) => state.prefixPrompt)
  const prefixDefault = useSettings((state) => state.prefixEnabled)
  const [prefixOn, setPrefixOn] = useState(
    () => sessionPrefixEnabled(sessionId ?? '') ?? prefixDefault
  )
  // 思考开关只在 V3.2 这类支持切换的模型上可用；R1 始终思考，V4.1 不思考
  const thinkingLocked = siliconflow && modelInfo.thinking !== 'switchable'
  const thinkingActive = siliconflow && modelInfo.thinking === 'always' ? true : thinking
  const thinkingTip = !siliconflow
    ? t('deactivatedThinkTooltip')
    : modelInfo.thinking === 'always'
      ? t('thinkingAlwaysOn')
      : modelInfo.thinking === 'none'
        ? t('thinkingUnsupported')
        : t('deactivatedThinkTooltip')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const togglesRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const toggles = togglesRef.current
    if (!toggles) {
      return
    }

    const updateLabels = () => {
      toggles.classList.remove(styles.collapsedToggles)
      toggles.classList.toggle(styles.collapsedToggles, toggles.scrollWidth > toggles.clientWidth)
    }

    updateLabels()
    const observer = new ResizeObserver(updateLabels)
    observer.observe(toggles)
    return () => observer.disconnect()
  }, [t])

  const acceptFiles = (files: File[]) => {
    if (files.length === 0 || useChatStore.getState().importingHistory || !ensureApiKey()) {
      return
    }
    const error = addDraftFiles(sessionId, files, useSettings.getState().apiKey ?? '')
    if (error) {
      showToast(error)
    }
  }
  const retryFile = useCallback(
    (id: string) => {
      if (!useChatStore.getState().importingHistory && ensureApiKey()) {
        retryDraftAttachment(sessionId, id, useSettings.getState().apiKey ?? '')
      }
    },
    [sessionId]
  )
  const removeFile = useCallback(
    (id: string) => {
      if (!useChatStore.getState().importingHistory) {
        removeDraftAttachment(sessionId, id)
      }
    },
    [sessionId]
  )
  const dragging = useFileDrop(acceptFiles)

  /** 转写结果插入到光标处，并把光标移到插入内容之后 */
  const voice = useVoiceInput((transcript) => {
    const textarea = textareaRef.current
    const current = getDraft(sessionId).text
    const start = textarea?.selectionStart ?? current.length
    const end = textarea?.selectionEnd ?? current.length
    setText(current.slice(0, start) + transcript + current.slice(end))
    requestAnimationFrame(() => {
      textarea?.focus({ preventScroll: true })
      textarea?.setSelectionRange(start + transcript.length, start + transcript.length)
    })
  })

  // 欢迎页导入后会话 ID 不变，不能依赖卸载取消语音；订阅开始事件也覆盖快速完成的导入。
  const cancelVoice = voice.cancel
  useEffect(
    () =>
      useChatStore.subscribe((state, previous) => {
        if (state.importingHistory && !previous.importingHistory) {
          cancelVoice()
        }
      }),
    [cancelVoice]
  )

  // 移动端录音时用频谱替代输入框内容
  const recording = voice.status === 'recording'

  // 排队、上传中或上传失败的附件都留在输入框，全部上传成功后才能发送
  const canSend = !importingHistory && !streaming && voice.status === 'idle' && draftReady

  const send = () => {
    if (
      useChatStore.getState().importingHistory ||
      voice.status !== 'idle' ||
      !prepareDraftMessage(getDraft(sessionId), useUploads.getState().tasks)
    ) {
      return
    }
    // 文本与上传完成态由提交动作读取最新快照，不使用上一次渲染的草稿。
    if (!ensureApiKey() || !sendMessage(sessionId)) {
      return
    }
    stopReadAloud()
    if (isMobile) {
      textareaRef.current?.blur()
    } else {
      textareaRef.current?.focus()
    }
  }

  return (
    <div
      className={clsx(styles.wrapper, sessionId === null ? styles.home : styles.session)}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          textareaRef.current?.focus({ preventScroll: true })
        }
      }}
    >
      <DraftAttachments items={attachments} onRetry={retryFile} onRemove={removeFile} />
      <div className={styles.textareaWrapper}>
        <textarea
          ref={textareaRef}
          className={clsx(styles.textarea, recording && isMobile && styles.textareaHidden)}
          placeholder={t('chatInputPlaceholderChat')}
          rows={2}
          // 移动端不自动聚焦，避免一打开就弹出键盘
          autoFocus={!isMobile}
          disabled={importingHistory}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onMouseDown={(event) => {
            // 首次点击时手动聚焦，避免 Safari 把整个页面滚到输入框位置。
            if (isMobile && event.button === 0 && document.activeElement !== event.currentTarget) {
              event.preventDefault()
              event.currentTarget.focus({ preventScroll: true })
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              send()
            }
          }}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files)
            if (files.length > 0) {
              event.preventDefault()
              acceptFiles(files)
            }
          }}
        />
        {recording && isMobile ? <Spectrum getAnalyser={voice.getAnalyser} /> : null}
        <div className={styles.mirror} aria-hidden>
          {`${text}\n`}
        </div>
      </div>
      <div className={styles.functionRow}>
        {/* 深度思考 / 智能搜索开关，tooltip 在按钮上方 */}
        <div ref={togglesRef} className={styles.toggles}>
          <Select
            value={selectedModelId}
            options={modelOptions}
            onChange={pickModel}
            ariaLabel={t('modelSwitchLabel')}
            className={styles.modelSelect}
          />
          <Tooltip content={thinkingTip}>
            <button
              type="button"
              className={clsx(styles.toggle, thinkingActive && styles.selected)}
              aria-label={t('thinkingSwitch')}
              aria-pressed={thinkingActive}
              disabled={thinkingLocked || importingHistory}
              onClick={() => setThinking(!thinking)}
            >
              <IconThinkOutline14 />
              <span className={styles.toggleLabel}>{t('thinkingSwitch')}</span>
            </button>
          </Tooltip>
          <Tooltip content={siliconflow ? t('searchUnsupported') : t('deactivatedSearchTooltip')}>
            <button
              type="button"
              className={clsx(styles.toggle, search && !siliconflow && styles.selected)}
              aria-label={t('search')}
              aria-pressed={search && !siliconflow}
              disabled={siliconflow || importingHistory}
              onClick={() => setSearch(!search)}
            >
              <IconGlobeLanguageOutline14 />
              <span className={styles.toggleLabel}>{t('search')}</span>
            </button>
          </Tooltip>
          {prefixPrompt.trim() ? (
            <Tooltip content={t('prefixSessionTooltip')}>
              <button
                type="button"
                className={clsx(styles.toggle, prefixOn && styles.selected)}
                aria-label={t('prefixSession')}
                aria-pressed={prefixOn}
                onClick={() => {
                  if (sessionId) {
                    setSessionPrefix(sessionId, !prefixOn)
                  }
                  setPrefixOn(!prefixOn)
                }}
              >
                <span className={styles.toggleLabel}>{t('prefixSession')}</span>
              </button>
            </Tooltip>
          ) : null}
        </div>
        <div className={styles.right}>
          <VoiceButton
            status={voice.status}
            // 语音走官方接口：硅基流动下只有另配了官方 Key 才可用
            disabled={!voice.available || (siliconflow && !hasDeepseekKey)}
            seconds={voice.seconds}
            onClick={() => {
              if (
                voice.status !== 'idle' ||
                (!useChatStore.getState().importingHistory && ensureApiKey())
              ) {
                void voice.toggle()
              }
            }}
          />
          <IconButton
            size="m"
            tone="primary"
            icon={<IconPaperclipOutline16 />}
            tooltip={siliconflow ? t('siliconflowAttachHint') : t('uploadFile')}
            disabled={importingHistory || siliconflow}
            onClick={() => !siliconflow && ensureApiKey() && fileInputRef.current?.click()}
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            accept={ACCEPT}
            onChange={(event) => {
              acceptFiles(Array.from(event.target.files ?? []))
              event.target.value = ''
            }}
          />
          {streaming && sessionId ? (
            <button
              type="button"
              className={styles.sendButton}
              aria-label={t('chatInputStopButtonTooltip')}
              onClick={() => {
                stopReadAloud()
                stopReply(sessionId)
              }}
            >
              <IconStopFill16 />
            </button>
          ) : (
            <button
              type="button"
              className={clsx(styles.sendButton, !canSend && styles.disabled)}
              aria-label={t('send')}
              aria-disabled={!canSend}
              onClick={send}
            >
              <IconSendOutline16 />
            </button>
          )}
        </div>
      </div>
      {dragging ? <DragMask /> : null}
    </div>
  )
}
