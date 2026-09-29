"""Re-renders the hand-drawn README diagrams from their SVG sources in docs/images/ — the lifecycle, the
architecture and the two terminal windows — and makes everything outside each one's rounded card
transparent, so no white corner shows on GitHub's dark theme. Needed only after editing one of the SVGs;
nothing in them is drawn from the page.

Usage: python3 render-diagrams.py [--no-copy] [name ...]      (default: all four)
Renders through the diagrams skill's render.py (qlmanage on macOS, rsvg-convert elsewhere).
"""
import os
import re
import shutil
import subprocess
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
IMAGES = os.path.join(os.path.dirname(HERE), 'docs', 'images')
BUILD = os.path.join(HERE, 'build', 'diagrams')
DIAGRAMS = ['lifecycle', 'architecture', 'terminal-setup', 'terminal-init']
RENDERER = os.path.expanduser('~/.claude/skills/diagrams/scripts/render.py')
MASK_SUPERSAMPLING = 4
RIM_BAND_PIXELS = 2


def attribute_of(element, name, fallback=None):
    match = re.search(rf'\s{name}="([^"]+)"', element)
    return float(match.group(1)) if match else fallback


def card_of(svg_text):
    view_box = re.search(r'viewBox="([^"]+)"', svg_text).group(1).split()
    card = re.search(r'<rect\b[^>]*\brx="[^"]+"[^>]*>', svg_text).group(0)
    stroke_width = attribute_of(card, 'stroke-width', 1.0) if 'stroke=' in card else 0.0
    edge_colour = re.search(r'\sstroke="(#[0-9A-Fa-f]{6})"', card) or re.search(r'\sfill="(#[0-9A-Fa-f]{6})"', card)
    return {
        'edgeColour': tuple(int(edge_colour.group(1)[i:i + 2], 16) for i in (1, 3, 5)),
        'viewBoxWidth': float(view_box[2]),
        'left': attribute_of(card, 'x', 0.0) - stroke_width / 2,
        'top': attribute_of(card, 'y', 0.0) - stroke_width / 2,
        'right': attribute_of(card, 'x', 0.0) + attribute_of(card, 'width') + stroke_width / 2,
        'bottom': attribute_of(card, 'y', 0.0) + attribute_of(card, 'height') + stroke_width / 2,
        'radius': attribute_of(card, 'rx') + stroke_width / 2,
    }


def masked_to_card(png_path, card):
    image = Image.open(png_path).convert('RGBA')
    scale = image.width / card['viewBoxWidth']
    large = Image.new('L', (image.width * MASK_SUPERSAMPLING, image.height * MASK_SUPERSAMPLING), 0)
    factor = scale * MASK_SUPERSAMPLING
    ImageDraw.Draw(large).rounded_rectangle(
        [card['left'] * factor, card['top'] * factor, card['right'] * factor - 1, card['bottom'] * factor - 1],
        radius=card['radius'] * factor, fill=255)
    mask = large.resize(image.size, Image.LANCZOS)
    # The renderer paints white outside the card, so the rim's pixels are blended with white; repainting a band
    # along the rim in the card's own stroke colour keeps a light fringe off GitHub's dark theme.
    rim_band = ImageChops.subtract(mask, mask.filter(ImageFilter.MinFilter(RIM_BAND_PIXELS * 2 + 1)))
    rim_band = rim_band.point(lambda value: 255 if value > 0 else 0)
    image.paste(Image.new('RGBA', image.size, (*card['edgeColour'], 255)), (0, 0), rim_band)
    alpha = Image.composite(image.getchannel('A'), Image.new('L', image.size, 0), mask)
    image.putalpha(alpha)
    image.save(png_path, optimize=True)


def render(name, copy_into_docs):
    source = os.path.join(IMAGES, f'{name}.svg')
    os.makedirs(BUILD, exist_ok=True)
    working_copy = os.path.join(BUILD, f'{name}.svg')
    shutil.copyfile(source, working_copy)
    subprocess.run([sys.executable, RENDERER, working_copy], check=True)
    rendered = os.path.join(BUILD, f'{name}.png')
    with open(source) as file:
        masked_to_card(rendered, card_of(file.read()))
    if copy_into_docs:
        shutil.copyfile(rendered, os.path.join(IMAGES, f'{name}.png'))
    print(f'{name}.png: {Image.open(rendered).size[0]}x{Image.open(rendered).size[1]}' + (' → docs/images/' if copy_into_docs else f' in {BUILD}'))


if __name__ == '__main__':
    arguments = sys.argv[1:]
    copy_into_docs = '--no-copy' not in arguments
    names = [argument for argument in arguments if argument != '--no-copy'] or DIAGRAMS
    unknown = [name for name in names if name not in DIAGRAMS]
    if unknown:
        raise SystemExit(f'unknown diagram(s): {", ".join(unknown)}; choose from {", ".join(DIAGRAMS)}')
    if not os.path.exists(RENDERER):
        raise SystemExit(f'the diagrams skill renderer is missing: {RENDERER}')
    for diagram_name in names:
        render(diagram_name, copy_into_docs)
