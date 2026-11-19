import { Capacitor, registerPlugin } from '@capacitor/core';
import type { InvoicePdf } from './invoice-pdf';

/** Native bridge (android ShareFilePlugin.java): shares a PDF straight to WhatsApp, or to any app if WhatsApp is missing. */
interface ShareFilePlugin {
  sharePdf(options: { fileName: string; data: string; text?: string; phone?: string; mime?: string; chooser?: boolean }): Promise<void>;
}
const ShareFile = registerPlugin<ShareFilePlugin>('ShareFile');

/** Indian mobile numbers only: 10 digits (or with 91 in front) become the form WhatsApp wants. */
export function whatsappNumber(raw: string | undefined): string | undefined {
  const d = (raw ?? '').replace(/\D/g, '');
  if (d.length === 10) return '91' + d;
  if (d.length === 12 && d.startsWith('91')) return d;
  return undefined;
}

/** Returns null when handed over, otherwise a short message for the owner. */
export async function sharePdf(pdf: InvoicePdf, text: string, phone?: string): Promise<string | null> {
  if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('ShareFile')) {
    try {
      await ShareFile.sharePdf({ fileName: pdf.fileName, data: pdf.base64, text, phone });
      return null;
    } catch (e) {
      return `Could not open WhatsApp. (${e instanceof Error ? e.message : String(e)})`;
    }
  }
  // Browser: the phone's own share sheet if it can send files, otherwise download the PDF.
  const file = new File([pdf.blob], pdf.fileName, { type: 'application/pdf' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text });
      return null;
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null;
  }
  const url = URL.createObjectURL(pdf.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = pdf.fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'Invoice PDF saved. Attach it in WhatsApp.';
}

/** Shares any small file (for example the customer list as CSV) through the phone's share sheet. Returns null when handed over. */
export async function shareFile(file: { fileName: string; content: string; mime: string }, text = ''): Promise<string | null> {
  const blob = new Blob([file.content], { type: file.mime });
  if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('ShareFile')) {
    try {
      const bytes = new TextEncoder().encode(file.content);
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      await ShareFile.sharePdf({ fileName: file.fileName, data: btoa(s), text, mime: file.mime, chooser: true });
      return null;
    } catch (e) {
      return `Could not share the file. (${e instanceof Error ? e.message : String(e)})`;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'File saved to your downloads.';
}
