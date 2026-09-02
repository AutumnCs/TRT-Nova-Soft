import { readFileSync, writeFileSync } from 'fs';
const ip = readFileSync('TRT-Nova-植宠IP升级版.html','utf8');
const yq = readFileSync('TRT-Nova-植宠元气版.html','utf8');
let hd = readFileSync('TRT-Nova-植宠合订版.html','utf8');

/* ===== 工具 ===== */
function extractTpls(html, startMarker, endMarker){
  const s = html.indexOf(startMarker);
  const e = html.indexOf(endMarker);
  const region = html.slice(s, e);
  const tpls = {};
  const re = /<div data-tpl="(p\d+)">/g;
  let m; const starts = [];
  while ((m = re.exec(region))) starts.push({tpl:m[1], idx:m.index});
  for (let i=0;i<starts.length;i++){
    let seg = region.slice(starts[i].idx, i+1<starts.length ? starts[i+1].idx : undefined);
    seg = seg.replace(/\n+<!--[\s\S]*?-->\s*$/,'');
    seg = seg.replace(/\n+$/,'\n');
    tpls[starts[i].tpl] = seg;
  }
  return tpls;
}
function topRules(css){
  const rules=[]; let depth=0, buf='';
  for (const ch of css){
    if (ch==='{'){depth++;buf+=ch;}
    else if (ch==='}'){depth--;buf+=ch;if(depth===0){rules.push(buf);buf='';}}
    else if (buf.length||ch!=='}'){buf+=ch;}
  }
  if (buf.trim())rules.push(buf);
  return rules.filter(r=>r.includes('{'));
}
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

/* ===== 1. 全局颜色重映射：星语晚安 → 萤火温室 ===== */
const cmap = [
  ['#0A1322','#0C1410'],['#101E33','#132019'],['#152742','#1A2C21'],['#1F3252','#26402F'],
  ['#2B4266','#31523B'],['#16304F','#183723'],['#0D1B30','#0E1B13'],
  ['#FFD98E','#F5D98B'],['#F2C169','#F5D98B'],
  ['#A9C6E8','#A9E8C6'],['#8FB4DC','#8FDCB4'],
  ['#FFB199','#E8A05F'],['#FF8B7A','#F08E82'],
  ['#E8EFF8','#EAF3EA'],['#8DA0BF','#93A896'],
  ['rgba(255,217,142,','rgba(245,217,139,'],['rgba(169,198,232,','rgba(169,232,198,'],
  ['rgba(255,177,153,','rgba(232,160,95,'],['rgba(255,139,122,','rgba(240,142,130,'],
  ['rgba(232,239,248,','rgba(234,243,234,'],['rgba(141,160,191,','rgba(147,168,150,'],
];
for (const [a,b] of cmap) hd = hd.split(a).join(b);

/* ===== 2. 重写深色变量块（元气萤火温室 + IP 变量） ===== */
const darkVars = `body.theme-dark{
  --bg:#0C1410; --dot:rgba(127,224,168,.05);
  --jelly:#132019; --jelly2:#1A2C21; --line:#26402F; --line2:#31523B;
  --text:#EAF3EA; --text2:#93A896;
  --matcha:#7FE0A8; --matcha-deep:#5EC98A; --matcha-soft:rgba(127,224,168,.13); --matcha-ink:#0A2318;
  --peach:#F5B87A; --peach-deep:#E8A05F; --peach-soft:rgba(245,184,122,.12);
  --gold:#F5D98B; --gold-soft:rgba(245,217,139,.13);
  --warn:#E8A05F; --warn-soft:rgba(232,160,95,.12);
  --danger:#F08E82; --danger-soft:rgba(240,142,130,.10);
  --sky:radial-gradient(130% 100% at 50% 0%,#183723 0%,#0E1B13 62%,#0A120D 100%);
  --shadow:0 18px 44px rgba(0,0,0,.5),0 0 0 1px rgba(127,224,168,.04); --shadow-sm:0 8px 22px rgba(0,0,0,.35);
  --glow:0 10px 28px rgba(127,224,168,.22);
  --radius-card:24px; --radius-mid:18px; --radius-input:14px; --radius-pill:999px;
  --surface:#132019; --surface2:#1A2C21; --border:#26402F; --border2:#31523B;
  --accent:#7FE0A8; --accent-deep:#5EC98A; --accent-soft:rgba(127,224,168,.13); --accent-ink:#0A2318;
  --plant:#7FE0A8; --plant-soft:rgba(127,224,168,.12);
  --warm:#F5B87A; --warm-soft:rgba(245,184,122,.12);
  --bg-glow:rgba(127,224,168,.07);
  --stage:radial-gradient(130% 100% at 50% 0%,#183723 0%,#0E1B13 62%,#0A120D 100%);
  --cta-glow:0 10px 28px rgba(127,224,168,.25);
}`;
hd = hd.replace(/body\.theme-dark\{[^}]+\}/, darkVars);

/* ===== 3. 提取模板 ===== */
const ipDark = extractTpls(ip, '<div id="tpls-dark" hidden>', '</div><!-- /tpls-dark -->');
const yqLight = extractTpls(yq, '<div id="tpls" hidden>', '</div><!-- /tpls -->');
// 合订版深色模板（已做颜色映射；p5/p7 保留用）
const ds = hd.indexOf('<div id="tpls-dark" hidden>');
const de = hd.indexOf('</div><!-- /tpls-dark -->');
const hdDarkRegion = hd.slice(ds, de);
const hdDark = extractTpls(hd, '<div id="tpls-dark" hidden>', '</div><!-- /tpls-dark -->');

/* ===== 4. IP p3 书架：给缺 bmark 的书补标记 ===== */
let p3 = ipDark.p3;
p3 = p3.replace(/(<div class="d-book">\s*)(?!<span class="bmark">)/g, '$1<span class="bmark"></span>\n          ');

/* ===== 5. p9 深色记录本：元气浅色 p9 → 夜记本配色 ===== */
const p9map = [
  ['#FAF8F1','#132019'],['#F7F5EE','#101B14'],['#EAE6D9','#1A2C21'],
  ['#3A423C','rgba(127,224,168,.3)'],['#23282F','rgba(127,224,168,.5)'],['#2D3A2E','rgba(127,224,168,.4)'],
  ['#9A9280','rgba(147,168,150,.6)'],['#C8C2B2','rgba(147,168,150,.3)'],
  ['rgba(35,40,47,.06)','rgba(127,224,168,.07)'],
];
let p9n = yqLight.p9;
p9n = p9n.replace(/#fff\b/gi, '#0E1B13');
for (const [a,b] of p9map) p9n = p9n.split(a).join(b);
p9n = p9n.replace(/<span class="no">PAGE 09 · 日<\/span><h2>[^<]*<\/h2><p>[^<]*<\/p>/,
  '<span class="no">PAGE 09 · 夜</span><h2>成长手记 · 夜记本</h2><p>元气版记录本排布 × 萤火温室配色：左页成长日历 + 右页今日卡与和纸胶带，夜里翻开也顺手。</p>');

/* ===== 6. 重建合订版 tpls-dark（IP 模板 + 元气保留页） ===== */
const order = ['p10','p14','p1','p2','p3','p12','p5','p6','p7','p8','p9','p4','p11','p13'];
const src = {
  p10:ipDark.p10, p14:ipDark.p14, p1:ipDark.p1, p2:ipDark.p2, p3, p12:ipDark.p12,
  p5:hdDark.p5, p6:ipDark.p6, p7:hdDark.p7, p8:ipDark.p8, p9:p9n,
  p4:ipDark.p4, p11:ipDark.p11, p13:ipDark.p13,
};
const newDark = '<div id="tpls-dark" hidden>\n\n' + order.map(k=>src[k]).join('\n\n') + '\n\n</div><!-- /tpls-dark -->';
hd = hd.slice(0, ds) + newDark + hd.slice(de + '</div><!-- /tpls-dark -->'.length);

/* ===== 7. 浅色 p14 换回元气货架 ===== */
const ls = hd.indexOf('<div id="tpls" hidden>');
const le = hd.indexOf('</div><!-- /tpls -->');
let lightRegion = hd.slice(ls, le);
const p14s = lightRegion.indexOf('<div data-tpl="p14">');
const p14eNext = lightRegion.indexOf('\n<div data-tpl="', p14s+10);
lightRegion = lightRegion.slice(0, p14s) + yqLight.p14 + '\n' + lightRegion.slice(p14eNext + 1);
hd = hd.slice(0, ls) + lightRegion + hd.slice(le);

/* ===== 8. 追加 CSS：IP 缺失类规则 + 新 keyframes + p9 夜记本类 ===== */
// 重新计算缺失类（替换后的 hd CSS）
const hdCss = hd.match(/<style>([\s\S]*?)<\/style>/)[1];
const ipCss = ip.match(/<style>([\s\S]*?)<\/style>/)[1];
const newDarkHtml = order.map(k=>src[k]).join('\n');
const classes = new Set();
for (const m of newDarkHtml.matchAll(/class="([^"]+)"/g)) m[1].split(/\s+/).forEach(c=>classes.add(c));
const defined = new Set();
for (const m of hdCss.matchAll(/\.([a-zA-Z][\w-]*)/g)) defined.add(m[1]);
const missing = [...classes].filter(c=>!defined.has(c));
// p9 夜记本类也加入（p9n 中未定义的全部类）
const p9nCls = new Set();
for (const m of p9n.matchAll(/class="([^"]+)"/g)) m[1].split(/\s+/).forEach(c=>p9nCls.add(c));
for (const c of p9nCls) if (!missing.includes(c)) missing.push(c);

const ipRules = topRules(ipCss);
// 提取范围：IP 模板用到的全部类 ∪ 缺失类（残留浅色同名规则需被深色作用域规则覆盖）
const ipTplsHtml = ['p10','p14','p1','p2','p3','p12','p6','p8','p4','p11','p13'].map(k=>src[k]).join('\n');
const ipCls = new Set();
for (const m of ipTplsHtml.matchAll(/class="([^"]+)"/g)) m[1].split(/\s+/).forEach(c=>ipCls.add(c));
const missRes = [...new Set([...ipCls, ...missing])].map(c=>new RegExp('\\.'+esc(c)+'(?![\\w-])'));
// 选择器加 body.theme-dark 作用域（覆盖合订版残留的浅色同名规则，且不影响浅色面板）
function scopeSel(sel){
  sel = sel.trim();
  if (!sel || sel.startsWith('@') || /^body\.theme-(dark|light)/.test(sel)) return sel;
  return 'body.theme-dark ' + sel;
}
function scopeRule(rule){
  const head = rule.slice(0, rule.indexOf('{'));
  if (/^\s*@media/.test(head.replace(/\/\*[\s\S]*?\*\//g,'').trim())){
    return rule.replace(/([^{},]+)(\{[^{}]*\})/g, (mm,s,b)=>scopeSel(s)+b);
  }
  const brace = rule.indexOf('{');
  const h = rule.slice(0, brace);
  const comment = (h.match(/^\s*\/\*[\s\S]*?\*\//)||[''])[0];
  const sel = h.slice(comment.length);
  return comment + sel.split(',').map(s=>scopeSel(s)).join(', ') + rule.slice(brace);
}
const picked = ipRules.filter(r=>{
  const brace = r.indexOf('{');
  if (brace<0) return false;
  const sel = r.slice(0,brace).replace(/\/\*[\s\S]*?\*\//g,'').trim();
  if (/^body\.theme-light/.test(sel)) return false;
  return missRes.some(re=>re.test(sel));
}).map(r=>{
  for (const [a,b] of cmap) r = r.split(a).join(b);
  return scopeRule(r);
});
// keyframes 差集
const hdKf = new Set([...hdCss.matchAll(/@keyframes\s+([\w-]+)/g)].map(m=>m[1]));
const kfRules = ipRules.filter(r=>{
  const m = r.match(/@keyframes\s+([\w-]+)/);
  return m && !hdKf.has(m[1]);
});
// p9 夜记本类：从元气浅色 CSS 提取转深色
const yqCss = yq.match(/<style>([\s\S]*?)<\/style>/)[1];
const yqRules = topRules(yqCss);
const p9cls = [...p9nCls].filter(c=>missing.includes(c));
const p9picked = yqRules.filter(r=>{
  const brace = r.indexOf('{'); if (brace<0) return false;
  const sel = r.slice(0,brace).replace(/\/\*[\s\S]*?\*\//g,'').trim();
  if (!sel.startsWith('body.theme-light')) return false;
  return p9cls.some(c=>new RegExp('\\.'+esc(c)+'(?![\\w-])').test(sel));
}).map(r=>{
  r = r.replace(/body\.theme-light/g,'body.theme-dark');
  for (const [a,b] of p9map) r = r.split(a).join(b);
  r = r.replace(/#fff\b/gi,'#0E1B13');
  return r;
});

const inject = '\n/* ===== 移植 · IP 升级版深色（萤火温室）组件 ===== */\n' + picked.join('\n')
  + '\n/* ===== 移植 · IP 深色动画 ===== */\n' + kfRules.join('\n')
  + '\n/* ===== p9 夜记本（元气记录本 × 萤火温室） ===== */\n' + p9picked.join('\n') + '\n';
hd = hd.replace('</style>', inject + '</style>');

/* ===== 9. 缺失 SVG symbol 搬运 ===== */
const usedIcons = new Set();
for (const m of newDarkHtml.matchAll(/href="#([\w-]+)"/g)) usedIcons.add(m[1]);
for (const m of yqLight.p14.matchAll(/href="#([\w-]+)"/g)) usedIcons.add(m[1]);
const hdSyms = new Set([...hd.matchAll(/<symbol id="([\w-]+)"/g)].map(m=>m[1]));
const missSyms = [...usedIcons].filter(i=>!hdSyms.has(i));
let symAdd = '';
for (const s of missSyms){
  const re = new RegExp('<symbol id="'+esc(s)+'"[\\s\\S]*?</symbol>');
  const m = ip.match(re) || yq.match(re);
  if (m) symAdd += '    ' + m[0] + '\n';
}
if (symAdd) hd = hd.replace('</defs>', '    ' + symAdd + '  </defs>');

/* ===== 10. 恢复主题切换 + 更新文案 ===== */
hd = hd.replace('<div class="hero">\n  <div class="kicker">',
  `<div class="hero">
  <div class="theme-switch">
    <button id="btnLight" class="on">☀ 纸感标本</button>
    <button id="btnDark">🌙 萤火温室</button>
  </div>
  <div class="kicker">`);
hd = hd.replace(`  // 折叠 / 打卡（爱心/星星由 CSS 字形呈现）`,
`  // 主题切换
  var bL=document.getElementById('btnLight'),bD=document.getElementById('btnDark');
  function setTheme(t){
    document.body.className='theme-'+t;
    bL.classList.toggle('on',t==='light');
    bD.classList.toggle('on',t==='dark');
  }
  bL.addEventListener('click',function(){setTheme('light')});
  bD.addEventListener('click',function(){setTheme('dark')});
  // 折叠 / 打卡（爱心/星星由 CSS 字形呈现）`);
// hero 文案
hd = hd.replace(/<div class="sub">[\s\S]*?<\/div>/, `<div class="sub">元气版与 IP 升级版的合订精选。<b>浅色 · 纸感标本</b>——成长手记取自 IP 升级版，其余（含潮玩社陈列货架）均为元气版排布；<b>深色 · 萤火温室</b>——墨绿夜幕 × 荧光绿：登录、潮玩社、首页、AI 电台、夜读书架、文章夜读、设备详情、花园、我的、名片、关于取自 IP 升级版，设备管理与设备设置保留元气排布、配色统一萤火温室，成长手记是元气记录本的夜记本版。功能一页不少。</div>`);
hd = hd.replace('<span class="meta-pill">◆ 13 页 · 浅色纸感标本</span>', '<span class="meta-pill">◆ 14 页 × 双状态</span>');
hd = hd.replace('<span class="meta-pill">潮玩社 + 成长手记 <b>IP 升级版</b></span>', '<span class="meta-pill">成长手记 <b>IP 升级版</b> · 潮玩社 <b>元气版</b></span>');
hd = hd.replace('记录墙 / 窗台视图 / 记录本 / 档案卡 / 名片 / 产品信息页。</div>', '记录墙 / 窗台视图 / 档案卡 / 名片 / 产品信息页；成长手记取 IP 升级版标本册，潮玩社取元气版陈列货架。</div>');
hd = hd.replace(/<div class="board-tag"><b>深色版 · 星语晚安<\/b>[\s\S]*?<\/div>/, `<div class="board-tag"><b>深色版 · 萤火温室</b>——墨绿夜幕 × 荧光绿，IP 升级版夜巡时序为主体：温室之门、午夜首发、星空首页、深夜电台、夜读书架、监控大屏与黎明；设备管理与设置保留元气排布、统一萤火温室配色；成长手记是元气记录本的夜记本版。</div>`);

writeFileSync('TRT-Nova-植宠合订版.html', hd);
console.log('OK');
console.log('missing classes patched:', missing.length);
console.log('picked rules:', picked.length, '| keyframes:', kfRules.length, '| p9 rules:', p9picked.length);
console.log('missing symbols:', missSyms.join(', ') || 'none');
console.log('p3 bmark count:', (p3.match(/bmark/g)||[]).length);
