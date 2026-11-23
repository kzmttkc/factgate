#!/usr/bin/env python3
"""Compose docs/thumbnail.png (1280x720) from existing screenshots."""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs/thumbnail.png"
LEFT_SRC = ROOT / "screenshots/block-glossy-stay-1440.png"
RIGHT_SRC = Path.home() / "factgate-peers/screenshots/steward-booked-vs0001-1440.png"
W, H = 1280, 720
PAD = 12
TOP_H = 72
BOTTOM_H = 52
LABEL_H = 28

def crop_card(img, top_ratio=0.0, bottom_ratio=1.0):
    w, h = img.size
    y0 = int(h * top_ratio)
    y1 = int(h * bottom_ratio)
    return img.crop((0, y0, w, y1))


def main():
    left = Image.open(LEFT_SRC).convert("RGB")
    right = Image.open(RIGHT_SRC).convert("RGB")
    left = crop_card(left, 0.0, 0.72)
    right = crop_card(right, 0.0, 0.85)
    img_h = H - TOP_H - BOTTOM_H - LABEL_H - PAD * 2
    half_w = (W - PAD * 3) // 2
    left = left.resize((half_w, img_h), Image.Resampling.LANCZOS)
    right = right.resize((half_w, img_h), Image.Resampling.LANCZOS)

    canvas = Image.new("RGB", (W, H), "#1a1a1a")
    draw = ImageDraw.Draw(canvas)
    try:
      title_font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 36)
      sub_font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 22)
      label_font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 18)
    except OSError:
      title_font = sub_font = label_font = ImageFont.load_default()

    top = "The nicer hotel was the trap."
    tw = draw.textlength(top, font=title_font)
    draw.text(((W - tw) / 2, 22), top, fill="#ffffff", font=title_font)

    y_img = TOP_H
    canvas.paste(left, (PAD, y_img))
    canvas.paste(right, (PAD * 2 + half_w, y_img))

    y_labels = y_img + img_h + 6
    labels = [
      ("Glossy Stay · the nicer demo hotel", PAD + half_w // 2),
      ("Verified Stay · booked after ALLOW", PAD * 2 + half_w + half_w // 2),
    ]
    for text, cx in labels:
      lw = draw.textlength(text, font=label_font)
      draw.text((cx - lw / 2, y_labels), text, fill="#cccccc", font=label_font)

    bottom = "FactGate · code decides, the model explains"
    bw = draw.textlength(bottom, font=sub_font)
    draw.text(((W - bw) / 2, H - BOTTOM_H + 14), bottom, fill="#e0e0e0", font=sub_font)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(OUT, "PNG")
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()