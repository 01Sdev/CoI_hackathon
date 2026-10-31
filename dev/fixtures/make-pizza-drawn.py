# dev/fixtures/pizza-drawn.mp4 생성기. 사진이 아니라 PIL로 그린 피자(크러스트·소스·치즈·페퍼로니)라 저작권·초상권이 없다.
# 0~2초 빈 탁자, 2~10초 가운데 피자(조금씩 움직임). 실제 시연 영상(public/demo/)이 오기 전 0단계·포착 확인용.
# 실행: python3 make-pizza-drawn.py <프레임 폴더> 뒤
#   ffmpeg -framerate 30 -i <프레임 폴더>/%04d.png -c:v libx264 -profile:v high -pix_fmt yuv420p -an -movflags +faststart -crf 26 pizza-drawn.mp4
import sys, os, math, random
from PIL import Image, ImageDraw, ImageFilter
random.seed(7)
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
R = 300
pie = Image.new('RGBA', (2*R+20, 2*R+20), (0,0,0,0))
d = ImageDraw.Draw(pie)
c = R+10
d.ellipse([c-R, c-R, c+R, c+R], fill=(196, 132, 62))
d.ellipse([c-R+28, c-R+28, c+R-28, c+R-28], fill=(200, 60, 30))
cheese = Image.new('RGBA', pie.size, (0,0,0,0)); cd = ImageDraw.Draw(cheese)
for _ in range(1600):
    a = random.uniform(0, 2*math.pi); r = (R-40) * math.sqrt(random.random())
    x, y = c + r*math.cos(a), c + r*math.sin(a); s = random.uniform(6, 16)
    col = random.choice([(250, 214, 120), (245, 200, 95), (252, 226, 150)])
    cd.ellipse([x-s, y-s*0.8, x+s, y+s*0.8], fill=col+(235,))
pie = Image.alpha_composite(pie, cheese.filter(ImageFilter.GaussianBlur(1.2)))
d = ImageDraw.Draw(pie)
for _ in range(14):
    a = random.uniform(0, 2*math.pi); r = (R-80) * math.sqrt(random.random())
    x, y = c + r*math.cos(a), c + r*math.sin(a)
    d.ellipse([x-30, y-30, x+30, y+30], fill=(170, 40, 30), outline=(130, 30, 20), width=3)
    for _ in range(5):
        dx, dy = random.uniform(-18, 18), random.uniform(-18, 18)
        d.ellipse([x+dx-3, y+dy-3, x+dx+3, y+dy+3], fill=(120, 25, 18))
for k in range(4):
    a = k * math.pi / 4
    d.line([(c - (R-20)*math.cos(a), c - (R-20)*math.sin(a)), (c + (R-20)*math.cos(a), c + (R-20)*math.sin(a))], fill=(150, 90, 40), width=4)
pie = pie.filter(ImageFilter.GaussianBlur(0.8))
W, H, fps, secs = 720, 1280, 30, 10
for i in range(fps*secs):
    t = i / fps
    img = Image.new('RGB', (W, H), (176, 132, 92)); g = ImageDraw.Draw(img)
    for y in range(0, H, 40): g.line([(0, y), (W, y+8)], fill=(160, 118, 80), width=3)
    if t >= 2:
        dx = 25*math.sin(t*0.8); dy = 18*math.cos(t*0.6)
        img.paste(pie, (int(W/2 - c + dx), int(H/2 - c + dy)), pie)
    img.save(os.path.join(out, f'{i:04d}.png'))
