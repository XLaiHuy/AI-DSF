'use client'

import type { ComponentProps } from 'react'
import { Input } from './input'

export function stripSpacedAmount(value: string) {
  return value.replace(/\s/g, '').replace(',', '.')
}

export function formatSpacedAmount(value: string) {
  const [whole, fraction] = stripSpacedAmount(value).split('.')
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (fraction === undefined ? '' : ',' + fraction)
}

type MoneyInputProps = Omit<ComponentProps<typeof Input>, 'type' | 'inputMode' | 'onChange' | 'value' | 'defaultValue'> & {
  value: string
  onAmountChange: (value: string) => void
  integerOnly?: boolean
}

export function MoneyInput({ value, onAmountChange, integerOnly = false, ...props }: MoneyInputProps) {
  const display = formatSpacedAmount(value)
  return <Input {...props} value={display} inputMode={integerOnly ? 'numeric' : 'decimal'} onChange={(event) => {
    const input = event.currentTarget
    let index = stripSpacedAmount(input.value.slice(0, input.selectionStart ?? input.value.length)).length
    let amount = stripSpacedAmount(input.value)
    const inputType = (event.nativeEvent as InputEvent).inputType
    // Deleting a generated space should delete the digit on that side of the caret.
    if (amount === value && input.value.length === display.length - 1 &&
        (inputType === 'deleteContentBackward' || inputType === 'deleteContentForward')) {
      const digit = inputType === 'deleteContentBackward' ? index - 1 : index
      if (/\d/.test(amount.charAt(digit))) {
        amount = amount.slice(0, digit) + amount.slice(digit + 1)
        index = digit
      }
    }
    const valid = integerOnly ? /^\d{0,16}$/ : /^\d{0,16}(?:\.\d{0,2})?$/
    if (!valid.test(amount)) amount = value
    if (amount.startsWith('.')) {
      amount = '0' + amount
      index++
    }

    const formatted = formatSpacedAmount(amount)
    let caret = 0
    while (caret < formatted.length && index > 0) {
      if (formatted[caret] !== ' ') index--
      caret++
    }
    if (input.value !== formatted) {
      input.value = formatted
      input.setSelectionRange(caret, caret)
    }
    if (amount !== value) onAmountChange(amount)
  }} />
}
