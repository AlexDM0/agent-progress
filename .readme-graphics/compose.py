"""The README graphics' layout: which screenshots to take, how panels and window frames are composed from
them, and how the animated day is assembled. Crops come from measured element positions, not fixed
pixels, so a page that grows or shifts still yields the same framing.

Usage: python3 compose.py base-jobs|pages|gif|hero-gif|optimise|sheet <build folder>
"""
import json
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPOSITORY = os.path.dirname(HERE)

VIEWPORT_WIDTH = 1440
VIEWPORT_HEIGHT = 1000
STORY_DAY = '2026-09-24'
STORY_OFFSET = '+02:00'
FINAL_SNAPSHOT = '1336'
FINAL_CLOCK = '13:40'
DETAIL_TASK_IDENTIFIER = 2
HERO_LAST_ROW_SELECTOR = '#ap-rows > .ap-row:last-child'
TICKETS_OPENED_ROW_SELECTOR = '#ap-ticket-rows tr[data-ticket-id="004"]'
HERO_BOTTOM_PADDING = 23
TICKETS_BOTTOM_PADDING = 32
TICKETS_TOP_MARGIN = 13
# The side panel sits at the viewport's right edge; this much of the chart beside it keeps the crop from zooming in on the panel.
DETAIL_SIDE_MARGIN = 440
DETAIL_TOP_MARGIN = 13
RANGE_TOP_MARGIN = 11
KANBAN_TOP_MARGIN = 13
KANBAN_BOTTOM_PADDING = 24
# The lanes stretch with the viewport; this one ends them just below the To do lane's last card.
KANBAN_VIEWPORT_HEIGHT = 500
# The shot runs on past the board in page background, so the panel's taller window has no blank band.
KANBAN_SHOT_BOTTOM_PADDING = 400

GIF_WIDTH = 1200
# 29 frames: 750 + 27 × 250 + 2500 = 10 seconds a loop, the "sped up to ten seconds" the READMEs quote.
GIF_FIRST_FRAME_MILLISECONDS = 750
GIF_FRAME_MILLISECONDS = 250
GIF_LAST_FRAME_MILLISECONDS = 2500
GIF_FIRST_CLOCK = '09:10'
GIF_STEP_MINUTES = 10

# The animated hero: panel-watch with the Progress tab replayed inside its window.
HERO_ANIMATION_STEP_MINUTES = 3
HERO_ANIMATION_FIRST_FRAME_MILLISECONDS = 800
HERO_ANIMATION_FRAME_MILLISECONDS = 100
HERO_ANIMATION_LAST_FRAME_MILLISECONDS = 2500
GIF_TRANSPARENT_INDEX = 255

# story strip name -> the story time shown, rendered from the latest snapshot at or before it
STORY_MOMENTS = ['09:16', '10:25', '11:36', '12:12', '13:40']

PANEL_WIDTH = 1280
PANEL_HEIGHT = 800
PANEL_SCALE = 1.5
WINDOW_WIDTH = 1120
WINDOW_TOP = 214
WINDOW_BAR_HEIGHT = 34
FRAME_SCALE = 1.5

PANELS = [
    {'name': 'panel-watch', 'theme': 'light', 'headline': 'Watch your agents work.',
     'subhead': 'Every ticket is a row, every agent moves its own bar, and the page redraws on every command.',
     'layers': [{'image': 'hero-light.png', 'crop': 'hero'}]},
    {'name': 'panel-story', 'theme': 'light', 'headline': 'Click for the whole story.',
     'subhead': 'Each phase and how long it took, the ticket, and every log line that names it.',
     'layers': [{'image': 'detail-light.png', 'crop': 'dialog'}]},
    {'name': 'panel-tickets', 'theme': 'light', 'headline': 'Tickets an agent can build unasked.',
     'subhead': 'Report, Wanted, Acceptance and a Brief, rendered the way the builder reads them.',
     'layers': [{'image': 'tickets-light.png', 'crop': 'tickets'}]},
    {'name': 'panel-kanban', 'theme': 'light', 'headline': 'Every ticket on one board.',
     'subhead': 'From filed to delivered: what each card waits on, who reviews it, and what it cost.',
     'layers': [{'image': 'kanban-light.png', 'crop': 'kanban'}]},
    {'name': 'panel-themes', 'theme': 'split', 'headline': 'Light or dark. Your call.',
     'subhead': 'It follows your system, or pick Light or Dark and the page remembers.',
     'layers': [{'image': 'hero-light.png', 'crop': 'hero'},
                {'image': 'hero-dark.png', 'crop': 'hero', 'split': True}]},
    {'name': 'panel-cost', 'theme': 'dark', 'headline': 'Know what every agent cost.',
     'subhead': 'A hook adds each agent’s tokens to its row, and the log keeps the full receipt.',
     'layers': [{'image': 'hero-dark.png', 'crop': 'range'}]},
]

FRAMES = [
    ('frame-hero-light', 'light', 'hero-light.png', 'hero'),
    ('frame-hero-dark', 'dark', 'hero-dark.png', 'hero'),
    ('frame-tickets-light', 'light', 'tickets-light.png', 'tickets'),
    ('frame-tickets-dark', 'dark', 'tickets-dark.png', 'tickets'),
    ('frame-kanban-light', 'light', 'kanban-light.png', 'kanban'),
    ('frame-kanban-dark', 'dark', 'kanban-dark.png', 'kanban'),
    ('frame-detail-light', 'light', 'detail-light.png', 'dialog-to-viewport'),
    ('frame-detail-dark', 'dark', 'detail-dark.png', 'dialog-to-viewport'),
]

PALETTES = {
    'light': {'background': 'linear-gradient(180deg,#F4F1EA 0%,#ECE7DC 100%)', 'headline': '#1D1D1F', 'subhead': '#5F5E5A',
              'windowBar': '#ECECEC', 'windowTitle': '#6E6E73', 'windowBorder': 'rgba(0,0,0,.12)'},
    'split': {'background': 'linear-gradient(115deg,#F4F1EA 50%,#1C1D22 50%)', 'headline': '#1D1D1F', 'subhead': '#5F5E5A',
              'windowBar': '#ECECEC', 'windowTitle': '#6E6E73', 'windowBorder': 'rgba(0,0,0,.14)'},
    'dark': {'background': 'linear-gradient(180deg,#26272E 0%,#151519 100%)', 'headline': '#F5F5F7', 'subhead': '#A1A1A6',
             'windowBar': '#2C2C31', 'windowTitle': '#98989D', 'windowBorder': 'rgba(255,255,255,.10)'},
}
# The split background's edge at 115deg, as the percentages where it crosses the top and bottom of the window's content box.
SPLIT_ANGLE_TANGENT = 0.4663


def minutes_of(clock):
    hours, minutes = clock.split(':')
    return int(hours) * 60 + int(minutes)


def clock_of(minutes):
    return f'{minutes // 60:02d}:{minutes % 60:02d}'


def story_time(clock):
    return f'{STORY_DAY}T{clock}:00{STORY_OFFSET}'


def snapshot_at(build, clock):
    snapshots = sorted(name[:4] for name in os.listdir(f'{build}/snapshots') if name.endswith('.html'))
    earlier = [name for name in snapshots if minutes_of(f'{name[:2]}:{name[2:]}') <= minutes_of(clock)]
    if not earlier:
        raise SystemExit(f'no snapshot at or before {clock}')
    return f'{build}/snapshots/{earlier[-1]}.html'


def page_state(theme, tab):
    return {'agent-progress:theme': theme, 'agent-progress:tab': tab}


def write_json(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as file:
        json.dump(content, file, indent=1)


def base_jobs(build):
    final_page = f'{build}/snapshots/{FINAL_SNAPSHOT}.html'
    jobs = []
    for theme in ['light', 'dark']:
        common = {'html': final_page, 'width': VIEWPORT_WIDTH, 'height': VIEWPORT_HEIGHT, 'scale': 2, 'colorScheme': theme,
                  'frozenNow': story_time(FINAL_CLOCK)}
        jobs.append({**common, 'name': f'hero-{theme}', 'output': f'{build}/shots/hero-{theme}.png', 'localStorageEntries': page_state(theme, 'progress'),
                     # Shot down to the chart's frame, so a panel window taller than the rows (the range crop) has no blank band.
                     'clipBottomSelector': '#ap-chart', 'clipBottomPadding': HERO_BOTTOM_PADDING,
                     'measure': {'lastRow': HERO_LAST_ROW_SELECTOR, 'range': '.ap-range', 'tabBar': '.ap-tab-bar'}})
        jobs.append({**common, 'name': f'tickets-{theme}', 'output': f'{build}/shots/tickets-{theme}.png', 'localStorageEntries': page_state(theme, 'tickets'),
                     'actionScript': f"document.querySelector('{TICKETS_OPENED_ROW_SELECTOR}').click(); true",
                     'measure': {'tabBar': '.ap-tab-bar', 'table': '#ap-ticket-table', 'dialog': '#ap-detail'}})
        jobs.append({**common, 'height': KANBAN_VIEWPORT_HEIGHT, 'name': f'kanban-{theme}', 'output': f'{build}/shots/kanban-{theme}.png', 'localStorageEntries': page_state(theme, 'kanban'),
                     'clipBottomSelector': '#ap-kanban-frame', 'clipBottomPadding': KANBAN_SHOT_BOTTOM_PADDING,
                     'measure': {'tabBar': '.ap-tab-bar', 'board': '#ap-kanban-frame'}})
        jobs.append({**common, 'name': f'detail-{theme}', 'output': f'{build}/shots/detail-{theme}.png', 'localStorageEntries': page_state(theme, 'progress'),
                     'actionScript': f"document.querySelector('#ap-task-{DETAIL_TASK_IDENTIFIER}').click(); true",
                     'measure': {'dialog': '#ap-detail', 'tabBar': '.ap-tab-bar'}})
    write_json(f'{build}/jobs/base.json', jobs)


def crops(measurements):
    hero = measurements['hero-light']
    tickets = measurements['tickets-light']
    kanban = measurements['kanban-light']
    dialog = measurements['detail-light']['dialog']
    hero_height = round(hero['lastRow']['bottom'] + HERO_BOTTOM_PADDING)
    tickets_top = round(tickets['tabBar']['top'] - TICKETS_TOP_MARGIN)
    tickets_bottom = min(VIEWPORT_HEIGHT, round(max(tickets['table']['bottom'], tickets['dialog']['bottom']) + TICKETS_BOTTOM_PADDING))
    dialog_left = max(0, round(dialog['left'] - DETAIL_SIDE_MARGIN))
    dialog_right = min(VIEWPORT_WIDTH, round(dialog['right'] + DETAIL_SIDE_MARGIN))
    dialog_top = max(0, round(measurements['detail-light']['tabBar']['top'] - DETAIL_TOP_MARGIN))
    return {
        'hero': [0, 0, VIEWPORT_WIDTH, hero_height],
        'range': [0, round(hero['range']['top'] - RANGE_TOP_MARGIN), VIEWPORT_WIDTH, hero_height],
        'tickets': [0, tickets_top, VIEWPORT_WIDTH, tickets_bottom],
        'kanban': [0, round(kanban['tabBar']['top'] - KANBAN_TOP_MARGIN), VIEWPORT_WIDTH, round(kanban['board']['bottom'] + KANBAN_BOTTOM_PADDING)],
        'dialog': [dialog_left, dialog_top, dialog_right, VIEWPORT_HEIGHT],
        'dialog-to-viewport': [dialog_left, dialog_top, dialog_right, VIEWPORT_HEIGHT],
        'heroHeight': hero_height,
    }


def image_layer(layer_image, crop, window_width):
    left, top, right, _ = crop
    scale = window_width / (right - left)
    return (f'<img src="../shots/{layer_image}" style="position:absolute;left:{-left * scale}px;top:{-top * scale}px;'
            f'width:{VIEWPORT_WIDTH * scale}px">')


def window_markup(palette, content_height, layers_markup, bar_style='', title_style=''):
    return f'''<div class="window"><div class="bar" style="{bar_style}"><div class="dots"><i style="background:#FF5F57"></i><i style="background:#FEBC2E"></i><i style="background:#28C840"></i></div>
<div class="title" style="{title_style}">progress.html — Example Storefront</div></div>
<div class="content" style="height:{content_height}px">{layers_markup}</div></div>'''


PANEL_WINDOW_SHADOW = '0 24px 60px rgba(0,0,0,.22),0 6px 18px rgba(0,0,0,.10)'
FRAME_WINDOW_SHADOW = '0 22px 50px rgba(0,0,0,.20),0 5px 14px rgba(0,0,0,.08)'


def window_styles(palette, left, top, content_height, shadow=PANEL_WINDOW_SHADOW):
    return f'''.window{{position:absolute;left:{left}px;top:{top}px;width:{WINDOW_WIDTH}px;height:{content_height + WINDOW_BAR_HEIGHT}px;border-radius:12px;overflow:hidden;
  box-shadow:0 0 0 1px {palette['windowBorder']},{shadow}}}
.bar{{height:{WINDOW_BAR_HEIGHT}px;background:{palette['windowBar']};position:relative;text-align:center}}
.dots{{position:absolute;left:14px;top:11px;display:flex;gap:8px}}.dots i{{width:12px;height:12px;border-radius:50%;display:block}}
.title{{position:absolute;left:0;right:0;top:9px;font-size:13px;color:{palette['windowTitle']}}}
.content{{position:relative;overflow:hidden;background:#fff}}'''


FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',Helvetica,Arial,sans-serif"


def split_text(light, dark):
    return (f'background:linear-gradient(115deg,{light} 50%,{dark} 50%) fixed;-webkit-background-clip:text;'
            'background-clip:text;color:transparent')


def split_clip_polygon(content_top, content_height, window_left):
    """Where the panel background's diagonal crosses the window's content box, so the dark layer continues it."""
    centre_x, centre_y = PANEL_WIDTH / 2, PANEL_HEIGHT / 2

    def edge_x(y):
        return centre_x - SPLIT_ANGLE_TANGENT * (y - centre_y)

    top_percent = (edge_x(content_top) - window_left) / WINDOW_WIDTH * 100
    bottom_percent = (edge_x(content_top + content_height) - window_left) / WINDOW_WIDTH * 100
    return f'polygon({top_percent:.2f}% 0, 100% 0, 100% 100%, {bottom_percent:.2f}% 100%)'


def panel_page(panel, crop_table):
    palette = PALETTES[panel['theme']]
    window_left = (PANEL_WIDTH - WINDOW_WIDTH) // 2
    content_height = PANEL_HEIGHT - WINDOW_TOP - WINDOW_BAR_HEIGHT + 40
    content_top = WINDOW_TOP + WINDOW_BAR_HEIGHT
    layers = []
    for layer in panel['layers']:
        markup = image_layer(layer['image'], crop_table[layer['crop']], WINDOW_WIDTH)
        if layer.get('split'):
            markup = f'<div style="position:absolute;inset:0;clip-path:{split_clip_polygon(content_top, content_height, window_left)}">{markup}</div>'
        layers.append(markup)
    is_split = panel['theme'] == 'split'
    headline_style = split_text('#1D1D1F', '#F5F5F7') if is_split else ''
    subhead_style = split_text('#5F5E5A', '#A1A1A6') if is_split else ''
    bar_style = 'background:linear-gradient(115deg,#ECECEC 50%,#2C2C31 50%) fixed' if is_split else ''
    title_style = split_text('#6E6E73', '#98989D') if is_split else ''
    return f'''<!doctype html><html><head><meta charset="utf-8"><style>
html,body{{margin:0;background:transparent}}
.panel{{position:relative;width:{PANEL_WIDTH}px;height:{PANEL_HEIGHT}px;border-radius:28px;overflow:hidden;background:{palette['background']};font-family:{FONT};text-align:center}}
.headline{{position:absolute;left:0;right:0;top:62px;font-size:50px;font-weight:600;letter-spacing:-0.022em;color:{palette['headline']}}}
.subhead{{position:absolute;left:140px;right:140px;top:136px;font-size:21px;line-height:1.38;color:{palette['subhead']}}}
{window_styles(palette, window_left, WINDOW_TOP, content_height)}
</style></head><body><div class="panel">
<div class="headline" style="{headline_style}">{panel['headline']}</div>
<div class="subhead" style="{subhead_style}">{panel['subhead']}</div>
{window_markup(palette, content_height, ''.join(layers), bar_style, title_style)}
</div></body></html>'''


FRAME_BORDERS = {'light': 'rgba(0,0,0,.12)', 'dark': 'rgba(255,255,255,.12)'}


def frame_page(theme, image, crop):
    palette = {**PALETTES[theme], 'windowBorder': FRAME_BORDERS[theme]}
    left, top, right, bottom = crop
    content_height = round((bottom - top) * WINDOW_WIDTH / (right - left))
    canvas = (WINDOW_WIDTH + 80, content_height + WINDOW_BAR_HEIGHT + 80)
    html = f'''<!doctype html><html><head><meta charset="utf-8"><style>
html,body{{margin:0;background:transparent;font-family:{FONT}}}
{window_styles(palette, 40, 30, content_height, FRAME_WINDOW_SHADOW)}
</style></head><body>{window_markup(palette, content_height, image_layer(image, crop, WINDOW_WIDTH))}</body></html>'''
    return html, canvas


def pages(build):
    with open(f'{build}/measurements.json') as file:
        crop_table = crops(json.load(file))
    os.makedirs(f'{build}/pages', exist_ok=True)
    page_jobs = []
    for panel in PANELS:
        path = f'{build}/pages/{panel["name"]}.html'
        with open(path, 'w') as file:
            file.write(panel_page(panel, crop_table))
        page_jobs.append({'html': path, 'output': f'{build}/images/{panel["name"]}.png', 'width': PANEL_WIDTH, 'height': PANEL_HEIGHT,
                          'scale': PANEL_SCALE, 'transparentBackground': True, 'waitMilliseconds': 300,
                          'clip': {'x': 0, 'y': 0, 'width': PANEL_WIDTH, 'height': PANEL_HEIGHT}})
    for name, theme, image, crop_name in FRAMES:
        html, (canvas_width, canvas_height) = frame_page(theme, image, crop_table[crop_name])
        path = f'{build}/pages/{name}.html'
        with open(path, 'w') as file:
            file.write(html)
        page_jobs.append({'html': path, 'output': f'{build}/images/{name}.png', 'width': canvas_width, 'height': canvas_height,
                          'scale': FRAME_SCALE, 'transparentBackground': True, 'waitMilliseconds': 300,
                          'clip': {'x': 0, 'y': 0, 'width': canvas_width, 'height': canvas_height}})
    icon_page = f'{build}/pages/icon.html'
    with open(icon_page, 'w') as file:
        file.write('<!doctype html><html><head><style>html,body{margin:0;background:transparent}img{display:block;width:512px;height:512px}</style></head>'
                   f'<body><img src="/files{REPOSITORY}/docs/images/icon.svg"></body></html>')
    page_jobs.append({'html': icon_page, 'output': f'{build}/images/icon.png', 'width': 512, 'height': 512, 'scale': 1,
                      'transparentBackground': True, 'clip': {'x': 0, 'y': 0, 'width': 512, 'height': 512}})
    write_json(f'{build}/jobs/pages.json', page_jobs)

    frame_jobs = []
    first, last = minutes_of(GIF_FIRST_CLOCK), minutes_of(FINAL_CLOCK)
    clocks = sorted({first, first + 5, *range(first + 15, last, GIF_STEP_MINUTES), last})
    for index, minutes in enumerate(clocks):
        clock = clock_of(minutes)
        frame_jobs.append({'html': snapshot_at(build, clock), 'output': f'{build}/gif-frames/frame-{index:02d}.png', 'width': VIEWPORT_WIDTH,
                           'height': VIEWPORT_HEIGHT, 'scale': 1, 'colorScheme': 'light', 'frozenNow': story_time(clock),
                           'localStorageEntries': page_state('light', 'progress'), 'waitMilliseconds': 250,
                           'clip': {'x': 0, 'y': 0, 'width': VIEWPORT_WIDTH, 'height': crop_table['heroHeight']}})
    for clock in STORY_MOMENTS:
        frame_jobs.append({'html': snapshot_at(build, clock), 'output': f'{build}/images/story-{clock.replace(":", "")}.png', 'width': VIEWPORT_WIDTH,
                           'height': VIEWPORT_HEIGHT, 'scale': 2, 'colorScheme': 'light', 'frozenNow': story_time(clock),
                           'localStorageEntries': page_state('light', 'progress'), 'clipSelector': '#ap-chart'})
    window_scale = PANEL_SCALE * WINDOW_WIDTH / VIEWPORT_WIDTH
    visible_content_height = PANEL_HEIGHT - WINDOW_TOP - WINDOW_BAR_HEIGHT
    for index, minutes in enumerate(range(first, last + 1, HERO_ANIMATION_STEP_MINUTES)):
        clock = clock_of(minutes)
        frame_jobs.append({'html': snapshot_at(build, clock), 'output': f'{build}/hero-frames/frame-{index:02d}.png', 'width': VIEWPORT_WIDTH,
                           'height': VIEWPORT_HEIGHT, 'scale': window_scale, 'colorScheme': 'light', 'frozenNow': story_time(clock),
                           'localStorageEntries': page_state('light', 'progress'), 'waitMilliseconds': 250,
                           'clip': {'x': 0, 'y': 0, 'width': VIEWPORT_WIDTH, 'height': round(visible_content_height * VIEWPORT_WIDTH / WINDOW_WIDTH)}})
    write_json(f'{build}/jobs/frames.json', frame_jobs)


def assemble_gif(build):
    frame_paths = sorted(os.path.join(f'{build}/gif-frames', name) for name in os.listdir(f'{build}/gif-frames') if name.endswith('.png'))
    frames = [Image.open(path).convert('RGB') for path in frame_paths]
    frames = [frame.resize((GIF_WIDTH, round(frame.height * GIF_WIDTH / frame.width)), Image.LANCZOS) for frame in frames]
    durations = [GIF_FIRST_FRAME_MILLISECONDS] + [GIF_FRAME_MILLISECONDS] * (len(frames) - 2) + [GIF_LAST_FRAME_MILLISECONDS]
    # One palette for every frame, taken from frames across the day, so a colour that appears late is not remapped.
    sampled = frames[::3] + [frames[-1]]
    montage = Image.new('RGB', (GIF_WIDTH, sum(frame.height for frame in sampled)))
    offset = 0
    for frame in sampled:
        montage.paste(frame, (0, offset))
        offset += frame.height
    palette_source = montage.quantize(colors=255, method=Image.Quantize.MEDIANCUT)
    paletted = [frame.quantize(palette=palette_source, dither=Image.Dither.NONE) for frame in frames]
    os.makedirs(f'{build}/images', exist_ok=True)
    paletted[0].save(f'{build}/images/board-day.gif', save_all=True, append_images=paletted[1:], duration=durations, loop=0, optimize=True, disposal=1)


def assemble_hero_animation(build):
    """panel-watch.png with each hero frame laid into its window, the panel's rounded corners kept transparent."""
    panel = Image.open(f'{build}/images/panel-watch.png').convert('RGBA')
    window_left = round((PANEL_WIDTH - WINDOW_WIDTH) // 2 * PANEL_SCALE)
    content_top = round((WINDOW_TOP + WINDOW_BAR_HEIGHT) * PANEL_SCALE)
    content_size = (round(WINDOW_WIDTH * PANEL_SCALE), panel.height - content_top)
    frame_folder = f'{build}/hero-frames'
    frame_paths = sorted(os.path.join(frame_folder, name) for name in os.listdir(frame_folder) if name.endswith('.png'))
    composed = []
    for path in frame_paths:
        frame = Image.open(path).convert('RGBA')
        frame = frame.resize((content_size[0], round(frame.height * content_size[0] / frame.width)), Image.LANCZOS).crop((0, 0, *content_size))
        canvas = panel.copy()
        canvas.paste(frame, (window_left, content_top))
        canvas.putalpha(panel.getchannel('A'))
        composed.append(canvas)
    sampled = composed[::6] + [composed[-1]]
    montage = Image.new('RGB', (panel.width, panel.height * len(sampled)))
    for index, frame in enumerate(sampled):
        montage.paste(frame.convert('RGB'), (0, index * panel.height))
    # Median cut drops the rare colours (the red now-line, the green bars); octree keeps them.
    palette_source = montage.quantize(colors=GIF_TRANSPARENT_INDEX, method=Image.Quantize.FASTOCTREE)
    transparent = panel.getchannel('A').point(lambda alpha: 255 if alpha < 128 else 0)
    paletted = []
    for frame in composed:
        quantized = frame.convert('RGB').quantize(palette=palette_source, dither=Image.Dither.NONE)
        quantized.paste(GIF_TRANSPARENT_INDEX, mask=transparent)
        paletted.append(quantized)
    durations = ([HERO_ANIMATION_FIRST_FRAME_MILLISECONDS] + [HERO_ANIMATION_FRAME_MILLISECONDS] * (len(paletted) - 2)
                 + [HERO_ANIMATION_LAST_FRAME_MILLISECONDS])
    paletted[0].save(f'{build}/images/panel-watch.gif', save_all=True, append_images=paletted[1:], duration=durations, loop=0,
                     optimize=True, disposal=1, transparency=GIF_TRANSPARENT_INDEX)


def optimise(build):
    """Lossless recompression, so the PNG bytes depend on the pixels alone and an unchanged image stays unchanged in git."""
    for name in sorted(os.listdir(f'{build}/images')):
        if name.endswith('.png'):
            path = f'{build}/images/{name}'
            Image.open(path).save(path, optimize=True)


def contact_sheet(build):
    names = sorted(name for name in os.listdir(f'{build}/images') if name.endswith(('.png', '.gif')))
    thumbnail_width = 420
    thumbnails = []
    for name in names:
        image = Image.open(f'{build}/images/{name}').convert('RGBA')
        thumbnails.append((name, image.resize((thumbnail_width, max(1, round(image.height * thumbnail_width / image.width))))))
    columns = 4
    rows = [thumbnails[i:i + columns] for i in range(0, len(thumbnails), columns)]
    height = sum(max(image.height for _, image in row) + 20 for row in rows)
    sheet = Image.new('RGBA', (columns * (thumbnail_width + 20) + 20, height + 20), (150, 150, 150, 255))
    y = 20
    for row in rows:
        for column, (_, image) in enumerate(row):
            sheet.alpha_composite(image, (20 + column * (thumbnail_width + 20), y))
        y += max(image.height for _, image in row) + 20
    sheet.convert('RGB').save(f'{build}/contact-sheet.png')
    print(f'contact sheet of {len(names)} images: {build}/contact-sheet.png')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    step, build_folder = sys.argv[1], os.path.abspath(sys.argv[2])
    steps = {'base-jobs': base_jobs, 'pages': pages, 'gif': assemble_gif, 'hero-gif': assemble_hero_animation, 'optimise': optimise, 'sheet': contact_sheet}
    if step not in steps:
        raise SystemExit(__doc__)
    steps[step](build_folder)
