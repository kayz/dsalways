import { useTranslate } from '../../i18n/index.js'
import { answerRecompact, useRecompact } from '../../services/assist/windowMigration.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'

/** 换到窗口更小的模型、旧摘要装不下时的确认弹窗。文案全部避开技术术语。 */
export const RecompactDialog = () => {
  const t = useTranslate()
  const request = useRecompact((state) => state.request)
  if (!request) {
    return null
  }
  return (
    <Modal
      title={t('recompactTitle')}
      onClose={() => answerRecompact(false)}
      footer={
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="outlined" size="m" onClick={() => answerRecompact(false)}>
            {t('recompactCancel')}
          </Button>
          <Button variant="primary" size="m" onClick={() => answerRecompact(true)}>
            {t('recompactConfirm')}
          </Button>
        </div>
      }
    >
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7 }}>{t('recompactBody')}</p>
    </Modal>
  )
}
