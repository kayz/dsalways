import { useState } from 'react'
import { IconEditOutline16 } from '../base/icons.js'
import { useSettings } from '../../services/settings.js'
import { useIsMobile } from '../../app/viewport.js'
import { IconButton } from '../base/IconButton.js'
import { useApiKeyForm, useSiliconFlowKeyForm } from './useApiKeyForm.js'
import { useTranslate } from '../../i18n/index.js'
import styles from './Settings.module.css'

/** 已保存的 Key 只显示掩码，点编辑才能重新输入 */
export const KeyRow = ({
  label,
  placeholder,
  saved,
  editing,
  setEditing,
  form,
}: {
  label: string
  placeholder: string
  saved: string | null
  editing: boolean
  setEditing: (value: boolean) => void
  form: ReturnType<typeof useApiKeyForm>
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const showInput = !saved || editing

  return (
    <div className={styles.cell}>
      <div className={styles.apiKey}>
        <div className={styles.label}>{label}</div>
        {saved && !editing ? (
          <div className={styles.apiKeySaved}>
            <span className={styles.apiKeyMask}>{'*'.repeat(saved.length)}</span>
            <IconButton
              tone="primary"
              icon={<IconEditOutline16 />}
              tooltip={t('apiKeyEdit')}
              onClick={() => setEditing(true)}
            />
          </div>
        ) : (
          <div className={styles.apiKeyInput}>
            <input
              type="password"
              placeholder={placeholder}
              autoComplete="off"
              spellCheck={false}
              // 移动端打开设置时不弹键盘，点编辑后才聚焦
              autoFocus={!isMobile || editing}
              value={form.value}
              onChange={(event) => form.setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  void form.submit()
                }
              }}
              onBlur={() => {
                // 修改时没输入就离开，回到已保存的状态
                if (saved && !form.value.trim()) {
                  setEditing(false)
                }
              }}
            />
            {!isMobile && form.value.trim() ? (
              <>
                <span className={styles.divider} />
                <button
                  type="button"
                  className={styles.confirm}
                  disabled={form.verifying}
                  // 保持输入框焦点
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => void form.submit()}
                >
                  {form.verifying ? t('apiKeyVerifying') : t('confirm')}
                </button>
              </>
            ) : null}
          </div>
        )}
        {showInput && form.error ? <div className={styles.error}>{form.error}</div> : null}
      </div>
    </div>
  )
}

/** 移动端：输入 API Key 时在选项下方显示整行「确定」 */
export const KeyConfirm = ({ editing, form }: { editing: boolean; form: ReturnType<typeof useApiKeyForm> }) => {
  const t = useTranslate()
  return editing && form.value.trim() ? (
    <button
      type="button"
      className={styles.mobileConfirm}
      disabled={form.verifying}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => void form.submit()}
    >
      {form.verifying ? t('apiKeyVerifying') : t('confirm')}
    </button>
  ) : null
}

/** API Key 的编辑状态：输入框与移动端底部的「确定」按钮共用 */
export const useApiKeyEditor = () => {
  const apiKey = useSettings((state) => state.apiKey)
  const [editing, setEditing] = useState(false)
  const form = useApiKeyForm(() => setEditing(false))
  return {
    apiKey,
    editing,
    setEditing,
    form,
    showInput: !apiKey || editing,
    confirm: <KeyConfirm editing={!apiKey || editing} form={form} />,
  }
}

type ApiKeyEditor = ReturnType<typeof useApiKeyEditor>

export const ApiKeyField = ({ editor }: { editor: ApiKeyEditor }) => {
  const t = useTranslate()
  return (
    <KeyRow
      label={t('apiKeyStart')}
      placeholder={t('apiKeyPlaceholder')}
      saved={editor.apiKey}
      editing={editor.editing}
      setEditing={editor.setEditing}
      form={editor.form}
    />
  )
}

/** 硅基流动的 Key：与官方 Key 分开存，切换通道不丢 */
export const useSiliconFlowKeyEditor = () => {
  const key = useSettings((state) => state.siliconflowKey)
  const [editing, setEditing] = useState(false)
  const form = useSiliconFlowKeyForm(() => setEditing(false))
  return {
    apiKey: key,
    editing,
    setEditing,
    form,
    showInput: !key || editing,
    confirm: <KeyConfirm editing={!key || editing} form={form} />,
  }
}

export const SiliconFlowKeyField = ({
  editor,
}: {
  editor: ReturnType<typeof useSiliconFlowKeyEditor>
}) => {
  const t = useTranslate()
  return (
    <KeyRow
      label={t('siliconflowKeyLabel')}
      placeholder={t('siliconflowKeyPlaceholder')}
      saved={editor.apiKey}
      editing={editor.editing}
      setEditing={editor.setEditing}
      form={editor.form}
    />
  )
}
