import type { ButtonHTMLAttributes } from 'react'

/** `danger` is a quiet red for a row action; `destructive` is the solid red of a final, irreversible confirmation. */
export type ButtonTone = 'primary' | 'neutral' | 'danger' | 'destructive' | 'quiet'
export type ButtonSize = 'regular' | 'small'

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  tone?: ButtonTone
  size?: ButtonSize
}

/** A real <button>, with an explicit tone and size instead of a pile of boolean flags. */
export function Button({ tone = 'neutral', size = 'regular', type = 'button', ...rest }: ButtonProps) {
  return <button {...rest} type={type} data-tone={tone} className={size === 'small' ? 'btn btn-small' : 'btn'} />
}
