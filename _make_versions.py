"""把一张 64x32 皮肤转换成 64x32 修正版、64x64 经典版和 64x64 纤细版。

用法：python _make_versions.py <皮肤.png> <输出目录> [--prefix 233]
"""

import argparse
import os

from PIL import Image

parser = argparse.ArgumentParser(description="生成皮肤的三个版本")
parser.add_argument("skin", help="原始 64x32 皮肤 PNG 路径")
parser.add_argument("out_dir", help="输出目录")
parser.add_argument("--prefix", default="233", help="输出文件名前缀")
args = parser.parse_args()

os.makedirs(args.out_dir, exist_ok=True)

im = Image.open(args.skin).convert("RGBA")

# 原皮肤右臂顶面（44-48,16-20）最后一列误画成肤色，改成衣服的白色
for y in range(16, 20):
    im.putpixel((47, y), (255, 255, 255, 255))

# 64x32 没有帽子层，右上 32x16 是编辑器残留数据，清空
im.paste((0, 0, 0, 0), (32, 0, 64, 16))

im.save(os.path.join(args.out_dir, args.prefix + "-64x32-fixed.png"))

# 现代 64x64：原画不动，只补左臂/左腿
classic = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
classic.paste(im.crop((0, 0, 32, 16)), (0, 0))
classic.paste(im.crop((16, 16, 40, 32)), (16, 16))
classic.paste(im.crop((40, 16, 56, 32)), (40, 16))
classic.paste(im.crop((0, 16, 16, 32)), (0, 16))


def mirror_limb(src, src_u, src_v, dst_u, dst_v):
    w, d, h = 4, 4, 12
    faces = [
        ((src_u, src_v + d, d, h), (dst_u + d + w, dst_v + d)),
        ((src_u + d, src_v + d, w, h), (dst_u + d, dst_v + d)),
        ((src_u + d + w, src_v + d, d, h), (dst_u, dst_v + d)),
        ((src_u + d + w + d, src_v + d, w, h), (dst_u + d + w + d, dst_v + d)),
        ((src_u + d, src_v, w, d), (dst_u + d, dst_v)),
        ((src_u + d + w, src_v, w, d), (dst_u + d + w, dst_v)),
    ]
    for (sx, sy, sw, sh), (dx, dy) in faces:
        face = src.crop((sx, sy, sx + sw, sy + sh)).transpose(Image.FLIP_LEFT_RIGHT)
        classic.paste(face, (dx, dy))


mirror_limb(im, 40, 16, 32, 48)
mirror_limb(im, 0, 16, 16, 48)
classic.save(os.path.join(args.out_dir, args.prefix + "-64x64-original.png"))

# 纤细版：手臂 4px 面压成 3px（前/后/顶/底取 3 列，侧面保持 4px），空列透明
slim = classic.copy()

# right arm
slim.paste((0, 0, 0, 0), (40, 16, 56, 32))
slim.paste(classic.crop((40, 20, 44, 32)), (40, 20))  # outer
slim.paste(classic.crop((44, 20, 47, 32)), (44, 20))  # front
slim.paste(classic.crop((48, 20, 52, 32)), (47, 20))  # inner / left side
slim.paste(classic.crop((52, 20, 55, 32)), (51, 20))  # back
slim.paste(classic.crop((44, 16, 47, 20)), (44, 16))  # top
slim.paste(classic.crop((48, 16, 51, 20)), (47, 16))  # bottom

# left arm
slim.paste((0, 0, 0, 0), (32, 48, 48, 64))
slim.paste(classic.crop((32, 52, 36, 64)), (32, 52))  # inner
slim.paste(classic.crop((36, 52, 39, 64)), (36, 52))  # front
slim.paste(classic.crop((40, 52, 44, 64)), (39, 52))  # outer
slim.paste(classic.crop((44, 52, 47, 64)), (43, 52))  # back
slim.paste(classic.crop((36, 48, 39, 52)), (36, 48))  # top
slim.paste(classic.crop((40, 48, 43, 52)), (39, 48))  # bottom

slim.save(os.path.join(args.out_dir, args.prefix + "-64x64-slim.png"))

print("saved %s-64x32-fixed.png, %s-64x64-original.png, %s-64x64-slim.png" % ((args.prefix,) * 3))
