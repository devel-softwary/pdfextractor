import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

function normalizeText(s) {
  return String(s ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function groupRows(items, tolerance = 2.2) {
  const rows = [];
  for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    let row = rows.find(r => Math.abs(r.y - item.y) <= tolerance);
    if (!row) {
      row = { y: item.y, items: [] };
      rows.push(row);
    }
    row.items.push(item);
  }
  rows.sort((a, b) => b.y - a.y);
  for (const row of rows) row.items.sort((a, b) => a.x - b.x);
  return rows;
}

function mul(m1, m2) {
  // PDF/canvas affine matrix multiplication.
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}
function tp(m, x, y) {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/**
 * Extract vector line segments from the page operator list.
 * This is deliberately best-effort: if a PDF.js version or PDF encoding does
 * not expose paths in a usable form, text extraction still works unchanged.
 */
async function extractVectorGeometry(page, viewport) {
  const vertical = [];
  const horizontal = [];
  try {
    const opList = await page.getOperatorList();
    const OPS = pdfjsLib.OPS || {};
    const stack = [];
    let ctm = [1, 0, 0, 1, 0, 0];

    const addSeg = (p1, p2) => {
      const dx = Math.abs(p2.x - p1.x);
      const dy = Math.abs(p2.y - p1.y);
      const tol = 1.4;
      if (dx <= tol && dy >= 8) {
        vertical.push({ x:(p1.x+p2.x)/2, y1:Math.min(p1.y,p2.y), y2:Math.max(p1.y,p2.y), length:dy });
      } else if (dy <= tol && dx >= 8) {
        horizontal.push({ y:(p1.y+p2.y)/2, x1:Math.min(p1.x,p2.x), x2:Math.max(p1.x,p2.x), length:dx });
      }
    };

    for (let i = 0; i < opList.fnArray.length; i++) {
      const fn = opList.fnArray[i];
      const args = opList.argsArray[i] || [];
      if (fn === OPS.save) { stack.push([...ctm]); continue; }
      if (fn === OPS.restore) { ctm = stack.pop() || [1,0,0,1,0,0]; continue; }
      if (fn === OPS.transform && args.length >= 6) { ctm = mul(ctm, args.slice(0,6).map(Number)); continue; }
      if (fn !== OPS.constructPath) continue;

      const pathOps = Array.from(args[0] || []);
      const coords = Array.from(args[1] || []);
      let ci = 0;
      let cur = null;
      let start = null;

      for (const po of pathOps) {
        if (po === OPS.moveTo) {
          const p = tp(ctm, Number(coords[ci++]), Number(coords[ci++]));
          cur = p; start = p;
        } else if (po === OPS.lineTo) {
          const p = tp(ctm, Number(coords[ci++]), Number(coords[ci++]));
          if (cur) addSeg(cur, p);
          cur = p;
        } else if (po === OPS.rectangle) {
          const x = Number(coords[ci++]), y = Number(coords[ci++]);
          const w = Number(coords[ci++]), h = Number(coords[ci++]);
          const p1=tp(ctm,x,y), p2=tp(ctm,x+w,y), p3=tp(ctm,x+w,y+h), p4=tp(ctm,x,y+h);
          addSeg(p1,p2); addSeg(p2,p3); addSeg(p3,p4); addSeg(p4,p1);
          cur = p1; start = p1;
        } else if (po === OPS.closePath) {
          if (cur && start) addSeg(cur, start);
          cur = start;
        } else if (po === OPS.curveTo) {
          // Six coordinates; curves are irrelevant for table rules.
          ci += 6; cur = null;
        } else if (po === OPS.curveTo2 || po === OPS.curveTo3) {
          ci += 4; cur = null;
        }
      }
    }
  } catch (err) {
    return { vertical:[], horizontal:[], verticalRules:[], horizontalRules:[], warning:String(err?.message || err) };
  }

  const cluster = (segments, axis, spanKey, tolerance=1.6) => {
    const sorted = [...segments].sort((a,b)=>a[axis]-b[axis]);
    const groups=[];
    for (const s of sorted) {
      let g=groups.find(g=>Math.abs(g.pos-s[axis])<=tolerance);
      if (!g) { g={pos:s[axis], segs:[]}; groups.push(g); }
      g.segs.push(s);
      g.pos = g.segs.reduce((z,v)=>z+v[axis],0)/g.segs.length;
    }
    return groups.map(g=>({
      pos:g.pos,
      segments:g.segs.length,
      totalLength:g.segs.reduce((z,v)=>z+(v[spanKey]||v.length||0),0),
      maxLength:Math.max(...g.segs.map(v=>v[spanKey]||v.length||0)),
    }));
  };

  const vGroups = cluster(vertical, 'x', 'length');
  const hGroups = cluster(horizontal, 'y', 'length');
  // Table rules are normally long or repeated. Keep both so short segmented
  // lines that repeat down a table are not discarded.
  const verticalRules = vGroups
    .filter(g => g.maxLength >= viewport.height * 0.12 || g.totalLength >= viewport.height * 0.35 || g.segments >= 4)
    .map(g=>({ x:g.pos, ...g }))
    .filter(g=>g.x > 4 && g.x < viewport.width - 4)
    .sort((a,b)=>a.x-b.x);
  const horizontalRules = hGroups
    .filter(g => g.maxLength >= viewport.width * 0.18 || g.totalLength >= viewport.width * 0.5 || g.segments >= 4)
    .map(g=>({ y:g.pos, ...g }))
    .filter(g=>g.y > 4 && g.y < viewport.height - 4)
    .sort((a,b)=>a.y-b.y);

  return { vertical, horizontal, verticalRules, horizontalRules };
}

/** Extract native PDF text plus vector table geometry when available. */
export async function extractPdfPages(buffer) {
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const pages = [];

  for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
    const page = await doc.getPage(pageNo);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = content.items
      .filter(i => 'str' in i && normalizeText(i.str))
      .map(i => ({
        text: normalizeText(i.str),
        x: i.transform?.[4] ?? 0,
        y: i.transform?.[5] ?? 0,
        width: Math.abs(i.width ?? 0),
        height: Math.abs(i.height ?? i.transform?.[3] ?? 0),
      }));

    const rows = groupRows(items);
    const lines = rows.map(r => r.items.map(i => i.text).join(' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
    const geometry = await extractVectorGeometry(page, viewport);
    pages.push({ page: pageNo, width: viewport.width, height: viewport.height, items, rows, lines, ...geometry });
  }
  return pages;
}
