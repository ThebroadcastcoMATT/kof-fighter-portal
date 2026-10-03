"""Fighter photo pipeline: remove background, frame every fighter identically from the face,
grade to one look, save 800x1000 (4:5) transparent WebP.

Framing: the detected face box is scaled to FACE_H pixels tall and placed with its centre at
x = W/2 and its top at FACE_TOP, which gives a consistent head-to-waist portrait.
"""
import sys, os, glob
import numpy as np
import cv2
from PIL import Image, ImageEnhance, ImageOps
from rembg import new_session, remove

W, H = 800, 1000
FACE_H = 150
FACE_TOP = 110

session = new_session('birefnet-portrait')
cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')


def find_face(rgb, alpha):
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    faces = cascade.detectMultiScale(gray, scaleFactor=1.08, minNeighbors=6, minSize=(40, 40))
    # Keep faces that sit on the cut-out person, near the top of the figure (a chest or a shorts
    # print can pass for a face lower down), and take the biggest.
    ys = np.where(alpha > 128)[0]
    top, height = (ys.min(), ys.max() - ys.min()) if len(ys) else (0, rgb.shape[0])
    good = []
    for (x, y, w, h) in faces:
        cx, cy = x + w // 2, y + h // 2
        if (alpha[min(cy, alpha.shape[0] - 1), min(cx, alpha.shape[1] - 1)] > 128 and cy < top + height * 0.22
                and h < height * 0.25):  # a round logo behind the fighter isn't a face
            good.append((w * h, x, y, w, h))
    if not good:
        return None
    _, x, y, w, h = max(good)
    return x, y, w, h


def process(src, dst):
    img = ImageOps.exif_transpose(Image.open(src)).convert('RGB')  # phone photos: respect rotation
    cut = remove(img, session=session, post_process_mask=True)  # RGBA
    rgba = np.array(cut)
    # Keep only the fighter: drop scraps of background the matting left that don't touch them
    # (a bag, a flag, a logo on the wall).
    n, labels, stats, _ = cv2.connectedComponentsWithStats((rgba[:, :, 3] > 24).astype(np.uint8), 8)
    if n > 2:
        keep = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        rgba[:, :, 3][(labels != keep) & (labels != 0)] = 0
    face = find_face(np.array(img), rgba[:, :, 3])
    if face is None:
        # Fall back to the top of the silhouette: assume the head is the top 1/7 of the figure.
        ys, xs = np.where(rgba[:, :, 3] > 128)
        top, bottom = ys.min(), ys.max()
        head = (bottom - top) / 7
        cx = int(np.median(xs[ys < top + head]))
        face = (int(cx - head * 0.4), int(top + head * 0.15), int(head * 0.8), int(head * 0.85))
        print('  no face found, using silhouette', face)
    x, y, w, h = face
    s = FACE_H / h
    tx = W / 2 - (x + w / 2) * s
    ty = FACE_TOP - y * s
    M = np.float32([[s, 0, tx], [0, s, ty]])
    out = cv2.warpAffine(rgba, M, (W, H), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
    im = Image.fromarray(out, 'RGBA')
    # One grade for everyone: a touch less saturation, a touch more contrast (the poster's gritty look).
    rgb = im.convert('RGB')
    rgb = ImageEnhance.Color(rgb).enhance(0.82)
    rgb = ImageEnhance.Contrast(rgb).enhance(1.1)
    im = Image.merge('RGBA', (*rgb.split(), im.split()[3]))
    im.save(dst, 'WEBP', quality=90, method=6)
    print(f'{os.path.basename(src)} -> {os.path.basename(dst)} face={face} scale={s:.2f}')


if __name__ == '__main__':
    # cutout.py photo.jpg out.webp   (one photo; run one per process, the model is memory hungry)
    # cutout.py folder/ out_dir/     (every *_name.jpg in a folder)
    if sys.argv[2].endswith('.webp'):
        process(sys.argv[1], sys.argv[2])
        sys.exit(0)
    src, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    files = sorted(glob.glob(os.path.join(src, '*.jpg'))) if os.path.isdir(src) else [src]
    for f in files:
        name = os.path.splitext(os.path.basename(f))[0].split('_', 1)[1]
        process(f, os.path.join(out_dir, name + '.webp'))
