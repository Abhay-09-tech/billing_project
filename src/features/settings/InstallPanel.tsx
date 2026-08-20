import { useEffect, useState } from 'react'
import { CheckCircle2, Download, Share, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/layout'

/**
 * "Install app" for the shop's own devices.
 *
 * Three different situations, because browsers genuinely differ:
 *
 *  · Chrome/Edge fire `beforeinstallprompt`, so a real one-tap button works.
 *  · iOS Safari has no such event — installing is a manual Share-sheet step,
 *    so we show those instructions rather than a button that does nothing.
 *  · Already installed — say so instead of offering it again.
 */

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS reports installed state on navigator, not via matchMedia.
    (window.navigator as { standalone?: boolean }).standalone === true
  )
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent)
}

export function InstallPanel() {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(isStandalone)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onPrompt = (e: Event) => {
      // Chrome shows its own mini-infobar otherwise; we want the button to be
      // the single, predictable place staff look.
      e.preventDefault()
      setPromptEvent(e as InstallPromptEvent)
    }
    const onInstalled = () => {
      setInstalled(true)
      setPromptEvent(null)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  async function handleInstall() {
    if (!promptEvent) return
    setBusy(true)
    try {
      await promptEvent.prompt()
      const { outcome } = await promptEvent.userChoice
      if (outcome === 'accepted') setInstalled(true)
      // The event can only be used once, whatever the answer.
      setPromptEvent(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader title="Install on this device" />
      <div className="space-y-4 p-4 sm:p-5">
        <p className="text-sm leading-relaxed text-brand-700">
          Install Perfect Vision on the shop's phone or tablet and it opens like a normal app —
          full screen, its own icon, no browser address bar. It still needs internet; installing
          only removes the browser around it.
        </p>

        {installed ? (
          <p className="flex items-center gap-2 rounded-lg bg-success-50 px-3 py-2.5 text-sm font-medium text-success-700">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Already installed on this device.
          </p>
        ) : promptEvent ? (
          <Button size="lg" className="w-full sm:w-auto" loading={busy} onClick={() => void handleInstall()}>
            <Download className="h-4 w-4" />
            Install app
          </Button>
        ) : isIos() ? (
          <div className="rounded-lg bg-cream-100 p-3.5">
            <p className="flex items-center gap-2 text-sm font-medium text-brand-900">
              <Share className="h-4 w-4 shrink-0" />
              On iPhone and iPad
            </p>
            <ol className="mt-2 space-y-1.5 text-sm text-brand-700">
              <li>1. Tap the Share button at the bottom of Safari</li>
              <li>2. Scroll down and tap “Add to Home Screen”</li>
              <li>3. Tap “Add”</li>
            </ol>
            <p className="mt-2 text-xs text-brand-600">
              Safari does not allow apps to install themselves, so this one is manual. It must be
              Safari — Chrome on iPhone cannot install web apps.
            </p>
          </div>
        ) : (
          <div className="rounded-lg bg-cream-100 p-3.5">
            <p className="flex items-center gap-2 text-sm font-medium text-brand-900">
              <Smartphone className="h-4 w-4 shrink-0" />
              Install from the browser menu
            </p>
            <ol className="mt-2 space-y-1.5 text-sm text-brand-700">
              <li>1. Open the browser menu (⋮ on Android, or the icon in the address bar)</li>
              <li>2. Choose “Install app” or “Add to Home screen”</li>
            </ol>
            <p className="mt-2 text-xs text-brand-600">
              The one-tap button appears here when the browser offers it. Some browsers only offer
              installation after a few visits, and private/incognito windows never do.
            </p>
          </div>
        )}

        <p className="rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700">
          Updates install themselves — staff never need to reinstall or check a version.
        </p>
      </div>
    </Card>
  )
}
