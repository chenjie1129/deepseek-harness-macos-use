/** Plugin-owned settings controls; every edit remains staged until Save. */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { CardFieldState, CardShell } from './card-form.ts'
import type { MacosUseKey } from './locales.ts'
import css from './styles.module.css'

/** Translator restricted to the macOS-use locale namespace. */
export type Translate = (key: MacosUseKey) => string

/** Expandable settings-card shell with staged Save and Discard actions. */
export function SettingsCard(props: {
  t: Translate
  title: MacosUseKey
  description: MacosUseKey
  state: CardShell
  onSave: () => void
  onDiscard: () => void
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const saveStarted = useRef(false)
  useEffect(() => {
    if (props.state.saving) {
      saveStarted.current = true
      return
    }
    if (!saveStarted.current) return
    saveStarted.current = false
    if (!props.state.dirty && !props.state.failed) setOpen(false)
  }, [props.state.dirty, props.state.failed, props.state.saving])
  if (!props.state.available) return null
  const title = props.t(props.title)
  return (
    <li className={css.card} data-open={open || undefined}>
      <button
        type="button"
        className={css.cardHeader}
        aria-expanded={open}
        aria-label={`${props.t(open ? 'common.collapse' : 'common.expand')}: ${title}`}
        onClick={() => { setOpen(value => !value) }}
      >
        <span className={css.cardHeading}>
          <span className={css.cardTitle}>{title}</span>
          <span className={css.cardDescription}>{props.t(props.description)}</span>
        </span>
        {props.state.dirty ? <span className={css.pending}>{props.t('common.unsaved')}</span> : null}
        <span className={css.chevron} aria-hidden="true">⌄</span>
      </button>
      {open ? (
        <div className={css.cardBody}>
          {!props.state.writable ? <p className={css.readOnly}>{props.t('common.readOnly')}</p> : null}
          {props.children}
          <div className={css.cardFooter}>
            {props.state.failed ? <p className={css.error}>{props.t('common.saveFailed')}</p> : null}
            <button
              type="button"
              className={css.secondaryButton}
              disabled={!props.state.dirty || props.state.saving}
              onClick={props.onDiscard}
            >
              {props.t('common.discard')}
            </button>
            <button
              type="button"
              className={css.primaryButton}
              disabled={!props.state.dirty || props.state.invalid || props.state.saving}
              onClick={props.onSave}
            >
              {props.t(props.state.saving ? 'common.saving' : 'common.save')}
            </button>
          </div>
        </div>
      ) : null}
    </li>
  )
}

interface FieldProps {
  id: string
  t: Translate
  label: MacosUseKey
  hint: MacosUseKey
  state: CardFieldState
  disabled: boolean
  onEdit: (text: string) => void
  onReset: () => void
}

function FieldHead(props: Pick<FieldProps, 'id' | 't' | 'label' | 'state' | 'disabled' | 'onReset'>) {
  return (
    <div className={css.fieldHead}>
      <label className={css.fieldLabel} htmlFor={props.id}>{props.t(props.label)}</label>
      {props.state.overridden ? (
        <span className={css.badges}>
          <span className={css.badge}>{props.t('common.overridden')}</span>
          <button type="button" className={css.reset} disabled={props.disabled} onClick={props.onReset}>
            {props.t('common.reset')}
          </button>
        </span>
      ) : null}
    </div>
  )
}

/** One-line text or numeric field with override reset and validation state. */
export function ValueField(props: FieldProps & { numeric?: boolean }) {
  return (
    <div className={css.field}>
      <FieldHead {...props} />
      <input
        id={props.id}
        className={props.state.invalid ? css.inputInvalid : css.input}
        type="text"
        {...props.numeric === true ? { inputMode: 'numeric' as const } : {}}
        {...props.state.invalid ? { 'aria-invalid': true } : {}}
        value={props.state.text}
        disabled={props.disabled}
        onChange={(event) => { props.onEdit(event.target.value) }}
      />
      <p className={props.state.invalid ? css.error : css.hint}>
        {props.t(props.state.invalid ? 'common.invalid' : props.hint)}
      </p>
    </div>
  )
}

/** Multi-line settings field for application policy lists. */
export function TextAreaField(props: FieldProps) {
  return (
    <div className={css.field}>
      <FieldHead {...props} />
      <textarea
        id={props.id}
        className={props.state.invalid ? css.inputInvalid : css.textarea}
        rows={4}
        {...props.state.invalid ? { 'aria-invalid': true } : {}}
        value={props.state.text}
        disabled={props.disabled}
        onChange={(event) => { props.onEdit(event.target.value) }}
      />
      <p className={props.state.invalid ? css.error : css.hint}>
        {props.t(props.state.invalid ? 'common.invalid' : props.hint)}
      </p>
    </div>
  )
}

/** Accessible boolean switch with override reset. */
export function SwitchField(props: FieldProps) {
  const labelId = `${props.id}-label`
  const checked = props.state.text === 'true'
  return (
    <div className={css.field}>
      <div className={css.fieldHead}>
        <span className={css.fieldLabel} id={labelId}>{props.t(props.label)}</span>
        {props.state.overridden ? (
          <span className={css.badges}>
            <span className={css.badge}>{props.t('common.overridden')}</span>
            <button type="button" className={css.reset} disabled={props.disabled} onClick={props.onReset}>
              {props.t('common.reset')}
            </button>
          </span>
        ) : null}
        <button
          id={props.id}
          type="button"
          className={css.switch}
          role="switch"
          aria-checked={checked}
          aria-labelledby={labelId}
          disabled={props.disabled}
          onClick={() => { props.onEdit(String(!checked)) }}
        >
          <span className={css.switchThumb} aria-hidden="true" />
        </button>
      </div>
      <p className={css.hint}>{props.t(props.hint)}</p>
    </div>
  )
}

/** Write-only credential field with configured-state feedback. */
export function SecretField(props: {
  id: string
  t: Translate
  label: MacosUseKey
  hint: MacosUseKey
  state: CardFieldState
  disabled: boolean
  configured: boolean
  onEdit: (text: string) => void
  onRemove: () => void
}) {
  return (
    <div className={css.field}>
      <div className={css.fieldHead}>
        <label className={css.fieldLabel} htmlFor={props.id}>{props.t(props.label)}</label>
        <span className={css.badges}>
          <span className={props.configured ? css.badge : css.badgeMuted}>
            {props.t(props.configured ? 'guiModel.apiKeySet' : 'guiModel.apiKeyUnset')}
          </span>
          {props.configured ? (
            <button type="button" className={css.reset} disabled={props.disabled} onClick={props.onRemove}>
              {props.t('guiModel.apiKeyRemove')}
            </button>
          ) : null}
        </span>
      </div>
      <input
        id={props.id}
        className={css.input}
        type="password"
        autoComplete="off"
        value={props.state.text}
        disabled={props.disabled}
        onChange={(event) => { props.onEdit(event.target.value) }}
      />
      <p className={css.hint}>{props.t(props.hint)}</p>
    </div>
  )
}
