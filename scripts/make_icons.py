#!/usr/bin/env python3
"""Generate placeholder PNG icons (48, 96, 128) for the extension."""

from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "icons"
OUT.mkdir(exist_ok=True)

ACCENT = (124, 92, 255, 255)       # matches popup.css --accent
ACCENT_DARK = (105, 76, 230, 255)
WHITE = (255, 255, 255, 255)


def make_icon(size: int) -> Image.Image:
    # Render at 4x for crispness, then downscale.
    s = size * 4
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Rounded-square background.
    radius = int(s * 0.22)
    d.rounded_rectangle((0, 0, s, s), radius=radius, fill=ACCENT)

    # Subtle inner highlight (top half).
    overlay = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.rounded_rectangle(
        (0, 0, s, s * 0.5),
        radius=radius,
        fill=(255, 255, 255, 28),
    )
    img.alpha_composite(overlay)

    # White calendar page: rounded rect with a header bar.
    pad = int(s * 0.22)
    cal_top = pad + int(s * 0.08)
    cal_bot = s - pad
    cal_left = pad
    cal_right = s - pad
    cal_radius = int(s * 0.06)
    d.rounded_rectangle(
        (cal_left, cal_top, cal_right, cal_bot),
        radius=cal_radius,
        fill=WHITE,
    )
    # Header bar (purple).
    header_h = int(s * 0.18)
    d.rounded_rectangle(
        (cal_left, cal_top, cal_right, cal_top + header_h),
        radius=cal_radius,
        fill=ACCENT_DARK,
    )
    # Cover the bottom of the header so only the top is rounded.
    d.rectangle(
        (cal_left, cal_top + cal_radius, cal_right, cal_top + header_h),
        fill=ACCENT_DARK,
    )
    # Two "binder rings" peeking out the top.
    ring_w = int(s * 0.04)
    ring_h = int(s * 0.12)
    ring_y0 = cal_top - ring_h // 2
    ring_y1 = ring_y0 + ring_h
    cx1 = cal_left + int((cal_right - cal_left) * 0.32)
    cx2 = cal_left + int((cal_right - cal_left) * 0.68)
    d.rounded_rectangle(
        (cx1 - ring_w // 2, ring_y0, cx1 + ring_w // 2, ring_y1),
        radius=ring_w // 2,
        fill=ACCENT_DARK,
    )
    d.rounded_rectangle(
        (cx2 - ring_w // 2, ring_y0, cx2 + ring_w // 2, ring_y1),
        radius=ring_w // 2,
        fill=ACCENT_DARK,
    )
    # Three "text lines" inside.
    line_x0 = cal_left + int(s * 0.10)
    line_x1 = cal_right - int(s * 0.10)
    line_h = max(2, int(s * 0.025))
    line_radius = line_h // 2
    lines_y_start = cal_top + header_h + int(s * 0.10)
    line_gap = int(s * 0.08)
    for i in range(3):
        y = lines_y_start + i * line_gap
        x1 = line_x1 if i < 2 else line_x0 + int((line_x1 - line_x0) * 0.55)
        d.rounded_rectangle(
            (line_x0, y, x1, y + line_h),
            radius=line_radius,
            fill=(40, 38, 60, 255),
        )

    # Downscale with high-quality filter.
    return img.resize((size, size), Image.LANCZOS)


for size in (48, 96, 128):
    icon = make_icon(size)
    path = OUT / f"icon-{size}.png"
    icon.save(path, "PNG", optimize=True)
    print(f"wrote {path} ({size}x{size})")
