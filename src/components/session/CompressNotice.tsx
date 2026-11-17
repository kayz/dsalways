import { useTranslate } from '../../i18n/index.js'
import { useAssistRuntime } from '../../services/assist/runtime.js'
import styles from './CompressNotice.module.css'

/**
 * 压缩提示：长对话第一次发送时，服务端要先把早前轮次压成摘要才能开始回答，
 * 这一步可能要几十秒。没有提示的话用户会以为卡住了，所以显式告诉他正在做什么、
 * 做到哪一段，而不是只转圈。
 */
export const CompressNotice = ({ sessionId }: { sessionId: string }) => {
  const t = useTranslate()
  const compress = useAssistRuntime((state) =>
    state.compress?.sessionId === sessionId ? state.compress : null
  )
  if (!compress) {
    return null
  }
  return (
    <div className={styles.notice} role="status" aria-live="polite">
      <span className={styles.spinner} aria-hidden />
      <div className={styles.text}>
        <div className={styles.title}>{t('compressNoticeTitle')}</div>
        <div className={styles.hint}>
          {compress.total > 0
            ? `${t('compressNoticeProgress', { done: compress.done, total: compress.total })} · `
            : ''}
          {t('compressNoticeHint')}
        </div>
      </div>
    </div>
  )
}
