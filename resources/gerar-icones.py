#!/usr/bin/env python3
"""Gera os ícones legados (PNG) do app Android a partir do mesmo desenho do favicon do jogo (index.html).

Uso (na raiz do repo, requer Pillow):  python3 resources/gerar-icones.py

O ícone adaptativo (Android 8+) e a splash NÃO usam PNG: são vetores em
android/app/src/main/res/drawable/ic_launcher_foreground.xml e splash_marca.xml (mesma geometria).
Aqui só saem os PNGs de mipmap-*/ic_launcher.png e ic_launcher_round.png, usados no Android 5.1–7.1 (minSdk 22).
"""
from pathlib import Path
from PIL import Image, ImageDraw

RES = Path(__file__).resolve().parent.parent / "android/app/src/main/res"
FUNDO, AZUL, AMBAR = "#0b1120", "#3b82f6", "#f59e0b"  # cores do favicon
DENSIDADES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
SS = 8  # supersampling para suavizar as bordas


def desenhar(tam: int, redondo: bool) -> Image.Image:
    n = tam * SS
    u = n / 16  # o favicon é uma grade 16x16
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if redondo:
        d.ellipse((0, 0, n - 1, n - 1), fill=FUNDO)
    else:
        d.rounded_rectangle((0, 0, n - 1, n - 1), radius=3 * u, fill=FUNDO)
    d.rectangle((3 * u, 4 * u, 13 * u - 1, 7 * u - 1), fill=AZUL)
    d.rectangle((3 * u, 9 * u, 13 * u - 1, 12 * u - 1), fill=AMBAR)
    return img.resize((tam, tam), Image.LANCZOS)


for dens, tam in DENSIDADES.items():
    pasta = RES / f"mipmap-{dens}"
    desenhar(tam, redondo=False).save(pasta / "ic_launcher.png", optimize=True)
    desenhar(tam, redondo=True).save(pasta / "ic_launcher_round.png", optimize=True)
    print(f"mipmap-{dens}: {tam}px")
