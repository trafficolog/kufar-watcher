import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { format } from 'prettier'

function numbered(lines: string[], start: number, end: number): string {
  return lines
    .slice(start, end)
    .map((line, index) => `${String(start + index + 1).padStart(4, ' ')} | ${line}`)
    .join('\n')
}

describe('Prettier diagnostic', () => {
  it('prints the formatter delta for the Telegram reconnect service test', async () => {
    const target = new URL('./telegram-bot-service.test.ts', import.meta.url)
    const source = await readFile(target, 'utf8')
    const formatted = await format(source, { filepath: target.pathname })
    const sourceLines = source.split('\n')
    const formattedLines = formatted.split('\n')

    let start = 0
    while (
      start < sourceLines.length &&
      start < formattedLines.length &&
      sourceLines[start] === formattedLines[start]
    ) {
      start += 1
    }

    let sourceEnd = sourceLines.length - 1
    let formattedEnd = formattedLines.length - 1
    while (
      sourceEnd >= start &&
      formattedEnd >= start &&
      sourceLines[sourceEnd] === formattedLines[formattedEnd]
    ) {
      sourceEnd -= 1
      formattedEnd -= 1
    }

    const contextStart = Math.max(0, start - 3)
    const sourceContextEnd = Math.min(sourceLines.length, sourceEnd + 4)
    const formattedContextEnd = Math.min(formattedLines.length, formattedEnd + 4)

    console.log(
      [
        'PRETTIER_DIAGNOSTIC_SOURCE',
        numbered(sourceLines, contextStart, sourceContextEnd),
        'PRETTIER_DIAGNOSTIC_FORMATTED',
        numbered(formattedLines, contextStart, formattedContextEnd),
      ].join('\n'),
    )

    expect(source).toBe(formatted)
  })
})
