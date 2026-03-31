# Home promo carousel images

Place these files in **`public/`** (exact names):

| File | Slide |
|------|--------|
| `10 Pack Indonesia.jpg` | 10 voucher pack |
| `20 Pack Indonesia.jpg` | 20 voucher pack |
| `50 Pack Indonesia.png` | 50 voucher pack |

Paths are built with `encodeURIComponent` so spaces in filenames work in the browser.

If a file is missing, the card hides the image area automatically (`onError`).
