# Fragrance Guide images: sources and licence

These images are used only on `learn.html` (the Fragrance Guide) and are served
locally from this folder. Nothing is hotlinked. The folder holds three
photographs from Unsplash and one piece of original artwork (see the last section).

## Photographs (Unsplash)

Each photograph was downloaded once. All three are licensed under the **Unsplash License**
(https://unsplash.com/license). Each photo page showed "Free to use under the
Unsplash License" on 2026-10-09, and each file came from `images.unsplash.com`,
the free-licence host. None are Unsplash+ (`plus.unsplash.com`) images.

The licence grants a free, worldwide, irrevocable right to download, copy,
modify, distribute and use the images, including commercially, without
permission or attribution. It does not allow selling an image without
significant modification, or compiling images to build a similar or competing
service. Attribution isn't required, but it is recorded here.

The photos were chosen because they show no brand names, logos or
identifiable people.

| File(s) | Subject | Photographer | Source page |
|---|---|---|---|
| `guide-crystal-bottle-640.webp`, `guide-crystal-bottle-1200.webp` | Cut-crystal perfume bottle on gold satin | Timothy L Brock | https://unsplash.com/photos/clear-glass-perfume-bottle-on-brown-textile-D1P-vxlB_K0 |
| `guide-star-anise-800.webp`, `guide-star-anise-1440.webp` | Close-up of dried star anise | Raul Ling | https://unsplash.com/photos/star-anise-aromatic-spice-qE88bkURl6k |
| `guide-rose-petals-900.webp`, `guide-rose-petals-1500.webp` | Dried rose petals | Zulfugar Karimov | https://unsplash.com/photos/dried-rose-petals-in-a-pile-FJM3wo0eCGY |

**Changes made to the originals:**
- cropped and resized: 4:5 for the bottle, 16:9 for the star anise and 3:1 for the rose petals;
- converted to WebP through Unsplash's own image service when downloaded;
- the rose-petal band is shown slightly desaturated with CSS (`filter: saturate(0.7)`);
- the files themselves are not otherwise edited.

## Original artwork

| File | Subject | Creator | Rights |
|---|---|---|---|
| `guide-maceration.jpg` | Maceration educational card: the heading "MACERATION", a one-sentence definition and the NeoFragrances wordmark (portrait, 4:5, 818 × 1024) | Original artwork created by the project owner (confirmed by the owner on 2026-11-14) | Held by the project owner. Not third-party or stock material |

Unlike the photographs above, this card shows the NeoFragrances name, the business's own brand.
The tool used and the creation date were not recorded.

**Changes made to the original card (2026-11-14):**
- two words in the card's text were changed to British spelling: "harmonize" → "harmonise" and
  "aging" → "ageing". Only the card's own letters were used (an "s" from the same card replaced the
  "z", and an "e" from the same line was inserted). Layout, colours, branding and the 818 × 1024 size are
  unchanged, and no other pixels changed;
- the pre-correction file is kept outside the repository, in
  `NeoFragrances-Frontend-Backups\p31-maceration-card-20261114-183517\`;
- `learn.html` shows the whole card (`object-fit: contain` in a 4:5 box, at most 440 px wide).
