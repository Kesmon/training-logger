export type DeliveryResult = 'shared' | 'downloaded'

/**
 * Gets a generated file off the phone.
 *
 * On iOS the share sheet is the path that actually works — it offers Files,
 * iCloud Drive and Mail. `<a download>` is the desktop fallback. Share must run
 * under user activation, and the caller has usually awaited a database read by
 * the time we get here, so any failure quietly falls back to a download rather
 * than losing the export.
 */
export async function deliverFile(
  filename: string,
  contents: string,
  mime: string,
): Promise<DeliveryResult> {
  const blob = new Blob([contents], { type: `${mime};charset=utf-8` })

  if (typeof navigator !== 'undefined' && 'canShare' in navigator) {
    try {
      const file = new File([blob], filename, { type: mime })
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename })
        return 'shared'
      }
    } catch (err) {
      // AbortError means the user dismissed the sheet — that is not a failure,
      // and re-downloading behind their back would be surprising.
      if (err instanceof DOMException && err.name === 'AbortError') return 'shared'
    }
  }

  download(blob, filename)
  return 'downloaded'
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Opens the system file picker and returns the chosen file's text. */
export function pickTextFile(accept: string): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.style.position = 'fixed'
    input.style.left = '-9999px'
    document.body.appendChild(input)

    let settled = false
    const finish = (value: { name: string; text: string } | null) => {
      if (settled) return
      settled = true
      input.remove()
      resolve(value)
    }

    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (!file) return finish(null)
      file
        .text()
        .then((text) => finish({ name: file.name, text }))
        .catch(() => finish(null))
    })

    // iOS fires no event when the picker is cancelled; this keeps the promise
    // from hanging forever and leaking the detached input.
    window.addEventListener(
      'focus',
      () => setTimeout(() => finish(null), 1500),
      { once: true },
    )

    input.click()
  })
}

export function todayStamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
