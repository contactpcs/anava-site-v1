#!/usr/bin/env python3
"""Generate the tech-summit QR code (PNG for screens/print, SVG for print vendors).

    python3 scripts/generate-summit-qr.py                  # https://anavaclinics.com/summit
    python3 scripts/generate-summit-qr.py <other-url>

Needs the `qrcode` and `Pillow` packages. Output goes to qr/ (not deployed).
"""
import sys
from pathlib import Path

import qrcode
import qrcode.image.svg
from qrcode.constants import ERROR_CORRECT_Q

URL = sys.argv[1] if len(sys.argv) > 1 else "https://anavaclinics.com/summit"
OUT = Path(__file__).resolve().parent.parent / "qr"
OUT.mkdir(exist_ok=True)

def build():
    qr = qrcode.QRCode(error_correction=ERROR_CORRECT_Q, border=4, box_size=40)
    qr.add_data(URL)
    qr.make(fit=True)
    return qr

qr = build()
qr.make_image(fill_color="#1F3B34", back_color="white").save(OUT / "anava-summit-qr.png")
build().make_image(image_factory=qrcode.image.svg.SvgPathImage).save(OUT / "anava-summit-qr.svg")
print(f"QR for {URL} -> {OUT}/anava-summit-qr.(png|svg)")
