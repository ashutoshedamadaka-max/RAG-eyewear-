import json, os

frames = json.load(open("/home/claude/eyewear/out/catalog.json"))
img_dir = "/home/claude/eyewear/out/images"

cards = []
for f in frames:
    svg = open(os.path.join(img_dir, f"{f['frame_id']}.svg")).read()
    svg = svg.replace('width="460" height="210"', 'width="100%" height="auto"')
    tags = "".join(f'<span class="tag">{t.replace("_"," ")}</span>'
                   for t in f["purpose_tags"])
    flags = []
    if f["progressive_ready"]: flags.append("progressive")
    if f["polarized"]: flags.append("polarised")
    if f["blue_light_ready"]: flags.append("blue-light")
    if f["wrap_angle"] >= 12: flags.append(f'wrap {f["wrap_angle"]}°')
    if not f["in_stock"]: flags.append("out of stock")
    flagstr = "".join(f'<span class="flag">{x}</span>' for x in flags)
    cards.append(f'''<article class="card" data-type="{f['product_type']}"
      data-band="{f['price_band']}" data-purpose="{' '.join(f['purpose_tags'])}"
      data-stock="{int(f['in_stock'])}">
  <div class="shot">{svg}</div>
  <div class="meta">
    <div class="row"><h3>{f['brand']} {f['model']}</h3><span class="price">₹{f['price_frame_only']:,}</span></div>
    <p class="sub">{f['frame_id']} · {f['shape'].replace('_',' ')} · {f['rim_type']}-rim · {f['material']} · {f['color'].replace('_',' ')}</p>
    <p class="spec">{f['lens_width_mm']}□{f['bridge_mm']}-{f['temple_mm']} · h{f['lens_height_mm']} · {f['weight_g']}g · {f['face_width_fit']} fit · max {f['max_power_supported']}D · {f['nose_pad_type'].replace('_',' ')}</p>
    <div class="tags">{tags}{flagstr}</div>
  </div>
</article>''')

purposes = sorted({p for f in frames for p in f["purpose_tags"]})
pbtns = "".join(f'<button data-f="purpose" data-v="{p}">{p.replace("_"," ")}</button>'
                for p in purposes)

html = f'''<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Frame catalog — 100 frames</title>
<style>
*{{box-sizing:border-box}}
:root{{--ink:#101A20;--mut:#5A6B75;--line:#D5DEE3;--bg:#F6F8F9;--card:#fff;--acc:#0E5A63}}
body{{margin:0;background:var(--bg);color:var(--ink);
 font:15px/1.5 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif}}
header{{padding:28px 32px 18px;border-bottom:1px solid var(--line);background:#fff}}
h1{{margin:0;font-size:20px;letter-spacing:-.01em}}
header p{{margin:6px 0 0;color:var(--mut);font-size:13px}}
.bar{{display:flex;flex-wrap:wrap;gap:6px;padding:14px 32px;background:#fff;
 border-bottom:1px solid var(--line);position:sticky;top:0;z-index:5}}
.bar button{{font:inherit;font-size:12.5px;padding:5px 11px;border:1px solid var(--line);
 background:#fff;border-radius:100px;cursor:pointer;color:var(--mut)}}
.bar button:hover{{border-color:var(--acc);color:var(--acc)}}
.bar button.on{{background:var(--acc);border-color:var(--acc);color:#fff}}
.bar .sep{{width:1px;background:var(--line);margin:2px 8px}}
#count{{margin-left:auto;align-self:center;font-size:12.5px;color:var(--mut);
 font-variant-numeric:tabular-nums}}
main{{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));
 gap:16px;padding:22px 32px 60px}}
.card{{background:var(--card);border:1px solid var(--line);border-radius:12px;
 overflow:hidden;display:flex;flex-direction:column}}
.shot{{background:#EEF1F3;display:block;line-height:0}}
.shot svg{{display:block}}
.meta{{padding:13px 15px 15px}}
.row{{display:flex;justify-content:space-between;align-items:baseline;gap:10px}}
h3{{margin:0;font-size:14.5px;font-weight:600}}
.price{{font-size:14px;font-weight:600;color:var(--acc);
 font-variant-numeric:tabular-nums;white-space:nowrap}}
.sub{{margin:3px 0 0;font-size:12px;color:var(--mut)}}
.spec{{margin:7px 0 0;font-size:11.5px;color:var(--mut);
 font-family:ui-monospace,"SF Mono",Menlo,monospace;line-height:1.55}}
.tags{{margin-top:10px;display:flex;flex-wrap:wrap;gap:4px}}
.tag,.flag{{font-size:10.5px;padding:2.5px 7px;border-radius:4px;letter-spacing:.01em}}
.tag{{background:#E7EEF0;color:#2A4A52}}
.flag{{background:#FFF3E0;color:#8A5A17}}
@media(max-width:640px){{header,.bar,main{{padding-left:16px;padding-right:16px}}}}
</style></head><body>
<header><h1>Frame catalog</h1>
<p>100 synthetic frames · images rendered parametrically from each row's own
measurements, so no image can contradict its spec</p></header>
<div class="bar">
  <button data-f="type" data-v="eyeglasses">eyeglasses</button>
  <button data-f="type" data-v="sunglasses">sunglasses</button>
  <button data-f="type" data-v="computer">computer</button>
  <button data-f="type" data-v="reading">reading</button>
  <span class="sep"></span>
  <button data-f="band" data-v="1">₹1–2.5k</button>
  <button data-f="band" data-v="2">₹2.5–4.5k</button>
  <button data-f="band" data-v="3">₹4.5–7k</button>
  <button data-f="band" data-v="4">₹7–10k</button>
  <span class="sep"></span>{pbtns}
  <span class="sep"></span>
  <button data-f="stock" data-v="1">in stock</button>
  <span id="count"></span>
</div>
<main id="grid">{"".join(cards)}</main>
<script>
const state={{type:null,band:null,purpose:null,stock:null}};
const cards=[...document.querySelectorAll('.card')];
function apply(){{
  let n=0;
  cards.forEach(c=>{{
    const ok=(!state.type||c.dataset.type===state.type)
      &&(!state.band||c.dataset.band===state.band)
      &&(!state.purpose||c.dataset.purpose.split(' ').includes(state.purpose))
      &&(!state.stock||c.dataset.stock==='1');
    c.style.display=ok?'':'none'; if(ok)n++;
  }});
  document.getElementById('count').textContent=n+' of 100 frames';
}}
document.querySelectorAll('.bar button').forEach(b=>b.onclick=()=>{{
  const f=b.dataset.f,v=b.dataset.v;
  const on=state[f]===v; state[f]=on?null:v;
  document.querySelectorAll(`.bar button[data-f="${{f}}"]`).forEach(x=>x.classList.remove('on'));
  if(!on)b.classList.add('on');
  apply();
}});
apply();
</script></body></html>'''

open("/home/claude/eyewear/out/catalog_browser.html", "w").write(html)
print("built", len(cards), "cards")
