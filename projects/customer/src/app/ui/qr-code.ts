import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import qrcode from 'qrcode-generator';

/** A QR code drawn as SVG (no images, no network). */
@Component({
  selector: 'app-qr',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [attr.viewBox]="'0 0 ' + qr().size + ' ' + qr().size" role="img" [attr.aria-label]="label()" shape-rendering="crispEdges" class="qrsvg">
      <rect width="100%" height="100%" fill="#fff" />
      <path [attr.d]="qr().path" fill="#000" />
    </svg>
  `,
  styles: `
    .qrsvg { width: 100%; height: auto; display: block; }
  `,
})
export class QrCode {
  readonly value = input.required<string>();
  readonly label = input('QR code');

  protected readonly qr = computed(() => {
    const q = qrcode(0, 'M');
    q.addData(this.value());
    q.make();
    const n = q.getModuleCount();
    const m = 4; // quiet zone
    let path = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) path += `M${c + m} ${r + m}h1v1h-1z`;
    return { size: n + m * 2, path };
  });
}
