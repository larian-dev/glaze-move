import { t } from '../i18n';
import type { Lang } from '../i18n';
import { el } from './dom';

/** The joke "Pricing" clip, emitted by Vite like the chart backdrops. */
const PRICING_VIDEO = new URL('../assets/pricing.mp4', import.meta.url).href;

export type PricingOverlay = {
  /** The nav entry that opens the overlay — a button, not a route. */
  navEntry(lang: Lang): HTMLElement;
  /** Opens the overlay and plays the clip once, from the start. */
  open(): void;
  setLang(lang: Lang): void;
};

/**
 * The Pricing easter egg: the nav entry reads like a page, but nothing is
 * routed — a click shows the clip once, in place, and the overlay closes when
 * it ends. Escape, or a click on the dimmed area, closes it early.
 */
export function createPricingOverlay(): PricingOverlay {
  const video = el('video', {
    class: 'pricing-video',
    attrs: { src: PRICING_VIDEO, playsinline: '', preload: 'metadata' },
  });
  const dialog = el('dialog', { class: 'pricing-dialog' }, [video]);
  document.body.append(dialog);

  const open = (): void => {
    // Every click is a fresh run; the click itself is the user gesture, so the
    // play call never waits on autoplay policy.
    video.currentTime = 0;
    dialog.showModal();
    void video.play().catch(() => {
      // A decode failure just leaves the first frame on screen; the overlay
      // still closes the usual ways.
    });
  };

  // The dialog box is exactly the video; a click outside lands on the dialog
  // element itself.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  video.addEventListener('ended', () => dialog.close());
  dialog.addEventListener('close', () => video.pause());

  return {
    navEntry(lang: Lang): HTMLElement {
      const entry = el('button', {
        type: 'button',
        class: 'app-link app-link--button',
        text: t(lang, 'app.nav.pricing'),
        attrs: { 'aria-haspopup': 'dialog' },
      });
      entry.addEventListener('click', open);
      return entry;
    },
    open,
    setLang(lang: Lang): void {
      dialog.setAttribute('aria-label', t(lang, 'app.nav.pricing'));
    },
  };
}
