# Department Wins 2026 (v7)

Walang database. JSON at image folders lang.

```
data/departments.json        listahan ng departments (order + include flag = playlist)
data/playlist.json           options ng combined link (skipEnds, loop, autoplay)
data/<dept>/deck.json        lahat ng content, slides, style ng department
img/<dept>/*.webp            images ng department (hiwalay na folder bawat isa)
index.html                   viewer (iisang layout para sa lahat)
admin.html                   editor
server.js                    local server na nagsusulat sa JSON/images (walang dependencies)
```

## Gamitin
```
node server.js            # http://localhost:3000  (viewer)  ·  /admin  (editor)
```
- Viewer: `/` o `/it` = IT, `/hr` = HR, atbp. (`/?d=hr` gumagana rin)
- Admin: piliin ang department → i-edit slides/projects/media/style → **Save** (Ctrl+S).
  Naka-save sa `data/<dept>/deck.json`; ang uploads ay naka-convert sa WebP sa `img/<dept>/`.
- Pagkatapos mag-save: `git add . && git commit && git push` → Vercel auto-deploy.

## Seguridad
- Sa localhost, bukas ang saving. Kung ilalagay sa ibang machine: `ADMIN_KEY=sikreto node server.js`
  (hihingin ng admin ang key).
- Sa Vercel (static) **hindi makakapag-save** ang admin (read-only ang filesystem nila).
  Doon, gamitin ang “Download JSON” at ilagay sa `data/<dept>/deck.json`, o i-edit locally at mag-push.

## Bago sa v7
- **Effects bawat slide** (Effects section sa admin): transition (fade, zoom, flip, blur, wipe...), entrance ng content, speed, slow zoom sa images, confetti. May "Apply to all slides".
- Bagong slide type: **Images only** (puro larawan lang; hinahati-hati sa maraming slide ayon sa "Images per slide").
- **Isang link para sa lahat**: `/` ay nagpe-play ng LAHAT ng departments nang sunod-sunod (continuous autoplay + voice).
  `/it` = IT lang · `/?d=it,hr` = piling departments · `/#d-hr` = magsimula sa HR tapos tuloy-tuloy.
  Sa viewer: **T** = table of contents na naka-group per department, **[ ]** = lipat ng department, **L** = loop, **A** = autoplay.
- **Admin**: i-click ang **All departments** (taas) para ayusin ang order, i-on/off ang department, at kunin ang share link.
  Doon din ang options: skip "Thank you" sa gitna, loop, auto-start.
- Admin UI: visual pickers (layout cards, icon picker, image picker), live voice text, Checks tab,
  Undo/Redo (Ctrl+Z / Ctrl+Y), hide slide (eye), draft recovery, delete department.
- Sa Vercel (read-only): i-download ang `departments.json` at `playlist.json` mula sa admin at ilagay sa `data/`.
