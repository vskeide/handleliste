import { Fragment } from 'react'

// Long product names like "Kjøttkaker/karbonadedeig" have no spaces, so the browser
// can't wrap them and they push past the screen edge. Two fixes:
//  1. <ItemName> adds a line-break opportunity after "/" and "-" so the name
//     wraps at a natural point ("Kjøttkaker/" + "karbonadedeig"). Not after "(",
//     which would leave it dangling; the space before it already allows a break;
//  2. fitFontSize() shrinks big display text only when its longest unbreakable
//     part would still be wider than the screen.

const BREAK_AFTER = /([/-])/

/** An item name that wraps at spaces, after "/" and "-", and as a last resort anywhere. */
export function ItemName({ name, className }: { name: string; className?: string }) {
  const parts = name.split(BREAK_AFTER)
  return (
    <span className={`[overflow-wrap:anywhere] ${className ?? ''}`}>
      {parts.map((p, i) =>
        BREAK_AFTER.test(p) ? <Fragment key={i}>{p}<wbr /></Fragment> : <Fragment key={i}>{p}</Fragment>
      )}
    </span>
  )
}

/** Length in characters of the longest part that can't be wrapped. */
export function longestUnbreakable(name: string): number {
  return Math.max(1, ...name.split(/[\s/-]+/).map((w) => w.length))
}

/**
 * CSS font-size for large display text: `maxRem` normally, smaller when the longest
 * unbreakable part wouldn't fit in `widthVw` of the screen. Bold Inter runs about
 * 0.6 em per character; 0.65 and 80vw leave a margin for wide letters and padding.
 */
export function fitFontSize(name: string, maxRem: number, widthVw = 80): string {
  const chars = longestUnbreakable(name)
  return `min(${maxRem}rem, calc(${widthVw}vw / ${(chars * 0.65).toFixed(2)}))`
}
