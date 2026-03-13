'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Minus, Plus } from 'lucide-react'

const UNITS = ['stk', 'g', 'kg', 'dl', 'L', 'ml', 'pakke', 'porsjon']

export function parseQuantity(q: string): { amount: number; unit: string } {
  const trimmed = q.trim()
  if (/^\d+\.?\d*$/.test(trimmed)) {
    return { amount: parseFloat(trimmed) || 1, unit: 'stk' }
  }
  const match = trimmed.match(/^(\d+\.?\d*)\s+(\S+)$/)
  if (match) {
    const unit = UNITS.includes(match[2]) ? match[2] : 'stk'
    return { amount: parseFloat(match[1]) || 1, unit }
  }
  return { amount: 1, unit: 'stk' }
}

export function formatQuantityDisplay(q: string): string {
  if (q === '1') return '1'
  const { amount, unit } = parseQuantity(q)
  if (unit === 'stk') return `×${amount}`
  return `${amount} ${unit}`
}

interface Props {
  currentQuantity: string
  onSave: (quantity: string) => void
  onClose: () => void
}

export function QuantityPickerSheet({ currentQuantity, onSave, onClose }: Props) {
  const parsed = parseQuantity(currentQuantity)
  const [amount, setAmount] = useState(parsed.amount)
  const [unit, setUnit] = useState(parsed.unit)

  function handleSave() {
    const qty = unit === 'stk' ? String(amount) : `${amount} ${unit}`
    onSave(qty)
  }

  function handleAmountInput(val: string) {
    const n = parseFloat(val)
    if (!isNaN(n) && n > 0) setAmount(n)
  }

  function decrement() {
    setAmount((a) => {
      const step = unit === 'g' || unit === 'ml' ? 50 : unit === 'kg' ? 0.5 : 1
      return Math.max(step, parseFloat((a - step).toFixed(2)))
    })
  }

  function increment() {
    setAmount((a) => {
      const step = unit === 'g' || unit === 'ml' ? 50 : unit === 'kg' ? 0.5 : 1
      return parseFloat((a + step).toFixed(2))
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl px-6 pt-6 pb-8 w-full shadow-xl">
        <div className="w-10 h-1 bg-[#E2E8F0] rounded-full mx-auto mb-5" />
        <h3 className="text-base font-semibold text-[#0F172A] mb-5">Mengde</h3>

        {/* Stepper */}
        <div className="flex items-center justify-center gap-5 mb-6">
          <button
            onClick={decrement}
            className="h-11 w-11 rounded-full border-2 border-[#E2E8F0] flex items-center justify-center hover:border-primary transition-colors active:scale-95"
          >
            <Minus className="h-4 w-4 text-[#0F172A]" />
          </button>
          <input
            type="number"
            value={amount}
            onChange={(e) => handleAmountInput(e.target.value)}
            min={0.5}
            className="w-24 text-center text-3xl font-bold text-[#0F172A] border-b-2 border-primary focus:outline-none bg-transparent"
          />
          <button
            onClick={increment}
            className="h-11 w-11 rounded-full border-2 border-[#E2E8F0] flex items-center justify-center hover:border-primary transition-colors active:scale-95"
          >
            <Plus className="h-4 w-4 text-[#0F172A]" />
          </button>
        </div>

        {/* Unit chips */}
        <div className="flex flex-wrap gap-2 mb-6 justify-center">
          {UNITS.map((u) => (
            <button
              key={u}
              onClick={() => setUnit(u)}
              className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors ${
                unit === u
                  ? 'bg-primary text-white'
                  : 'bg-[#F1F5F9] text-[#64748B] hover:bg-[#E2E8F0]'
              }`}
            >
              {u}
            </button>
          ))}
        </div>

        <Button onClick={handleSave} className="w-full">
          Lagre
        </Button>
      </div>
    </div>
  )
}
