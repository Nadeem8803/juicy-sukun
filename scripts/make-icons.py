"""Regenerates the PWA icons (needs Pillow). Swap in the cafe's real logo by replacing the PNGs in projects/customer/public/icons."""
from PIL import Image, ImageDraw

def make(size, path, maskable=False):
    im = Image.new('RGB', (size, size), '#ff7a1a')
    d = ImageDraw.Draw(im)
    pad = size * (0.22 if maskable else 0.12)
    d.ellipse([pad, pad, size - pad, size - pad], fill='#fff8f0')
    r = size * (0.22 if maskable else 0.28)
    c = size / 2
    d.ellipse([c - r, c - r, c + r, c + r], fill='#2f9e44')
    d.ellipse([c - r * .55, c - r * .55, c + r * .55, c + r * .55], fill='#ff7a1a')
    im.save(path)

make(192, 'projects/customer/public/icons/icon-192.png')
make(512, 'projects/customer/public/icons/icon-512.png')
make(512, 'projects/customer/public/icons/icon-maskable-512.png', True)
