/**
 * Shared coordinate-first table engine.
 *
 * All parsers use this module to turn pdf.js text items into visual cells.
 * The engine deliberately does not understand "computo" or "elenco prezzi":
 * it only understands X boundaries, cells and spill-over between adjacent cells.
 */
export function cleanText(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

function rowText(items) {
  return cleanText(items.map(i => i.text).join(' '));
}

function columnIndexAt(x, boundaries) {
  for (let i = 0; i < boundaries.length; i++) {
    if (x < boundaries[i]) return i;
  }
  return boundaries.length;
}

function pushCell(cells, idx, part) {
  if (idx < 0 || idx >= cells.length) return;
  const value = cleanText(part.text);
  if (!value) return;
  cells[idx].push({ ...part, text: value });
}

/**
 * Split a pdf.js item when its visual box crosses one or more cell boundaries.
 * pdf.js sometimes emits "CAM26_E01 Rinterro" as one item even though the two
 * tokens are visually in different cells. We estimate token boxes inside the
 * original item and then classify every token independently.
 */
function splitCrossingItem(item, boundaries, columnCount) {
  const left = Number(item.x || 0);
  const width = Math.max(0, Number(item.width || 0));
  const right = left + width;
  const start = columnIndexAt(left + 0.01, boundaries);
  const end = columnIndexAt(Math.max(left + 0.01, right - 0.01), boundaries);

  if (start === end || width <= 0 || !/\s/.test(item.text)) {
    const cx = left + width / 2;
    return [{ col: columnIndexAt(cx, boundaries), text: item.text, x:left, width, height:item.height || 0 }];
  }

  const raw = String(item.text);
  const tokens = [...raw.matchAll(/\S+/g)];
  if (tokens.length < 2) {
    const cx = left + width / 2;
    return [{ col: columnIndexAt(cx, boundaries), text:item.text, x:left, width, height:item.height || 0 }];
  }

  // Character positions are more reliable than assigning the whole merged item
  // by its centre. Include whitespace in the denominator because pdf.js width
  // includes the visual gap between words.
  const chars = Math.max(1, raw.length);
  return tokens.map(match => {
    const token = match[0];
    const i0 = match.index ?? 0;
    const i1 = i0 + token.length;
    const tx = left + width * (i0 / chars);
    const tw = Math.max(width * ((i1 - i0) / chars), 0.01);
    const tcx = tx + tw / 2;
    return { col:Math.min(columnCount - 1, columnIndexAt(tcx, boundaries)), text:token, x:tx, width:tw, height:item.height || 0 };
  });
}

/**
 * Segment one visual row into named columns.
 * profile = { names:[...], boundaries:[x...], repairRow?: fn }
 */
export function segmentRow(row, profile) {
  const names = profile.names;
  const boundaries = profile.boundaries;
  const cells = names.map(() => []);

  for (const item of row.items) {
    const parts = splitCrossingItem(item, boundaries, names.length);
    for (const part of parts) pushCell(cells, part.col, part);
  }

  let out = { y:row.y, all:rowText(row.items), _cells:{} };
  names.forEach((name, idx) => {
    cells[idx].sort((a,b) => a.x - b.x);
    out[name] = cleanText(cells[idx].map(p => p.text).join(' '));
    out._cells[name] = cells[idx];
  });

  if (typeof profile.repairRow === 'function') {
    out = profile.repairRow(out, { cleanText }) || out;
  }
  return out;
}

/** Segment all rows in a page using one shared engine. */
export function segmentPage(page, profileFactory) {
  const profile = typeof profileFactory === 'function' ? profileFactory(page) : profileFactory;
  return page.rows.map(row => segmentRow(row, profile));
}

/**
 * Generic helper for the common "identifier/tariff + description" first pair.
 * Moves a suffix of plain-language words accidentally captured in the first
 * column into the beginning of the description. The accepted-token callback
 * remains profile-specific, while the repair algorithm is shared.
 */
export function repairIdentifierDescription(row, {
  first='first', desc='desc', acceptsIdentifierToken,
} = {}) {
  const firstText = cleanText(row[first]);
  if (!firstText || typeof acceptsIdentifierToken !== 'function') return row;

  const tokens = firstText.split(/\s+/);
  let cut = tokens.length;
  for (let i = 0; i < tokens.length; i++) {
    if (!acceptsIdentifierToken(tokens[i], i, tokens)) { cut = i; break; }
  }
  if (cut >= tokens.length) return row;

  const keep = cleanText(tokens.slice(0, cut).join(' '));
  const spill = cleanText(tokens.slice(cut).join(' '));
  if (!spill) return row;
  row[first] = keep;
  row[desc] = cleanText(`${spill} ${row[desc] || ''}`);
  return row;
}

/** Infer recurring X anchors for unknown tables. */
export function inferColumnAnchors(page, { step=8, minGap=28, maxColumns=12 } = {}) {
  const quantize = v => Math.round(v / step) * step;
  const freq = new Map();
  for (const row of page.rows) {
    const seen = new Set(row.items.map(item => quantize(item.x)));
    for (const x of seen) freq.set(x, (freq.get(x) || 0) + 1);
  }
  const minRows = Math.max(3, Math.round(page.rows.length * 0.08));
  const candidates = [...freq.entries()]
    .filter(([,count]) => count >= minRows)
    .map(([x]) => x).sort((a,b) => a-b);
  const merged = [];
  for (const x of candidates) {
    if (!merged.length || x - merged.at(-1) >= minGap) merged.push(x);
    else merged[merged.length - 1] = Math.min(merged.at(-1), x);
  }
  return merged.filter(x => x > 8 && x < page.width - 8).slice(0, maxColumns);
}

/** Convert starting anchors to inter-column boundaries. */
export function anchorsToBoundaries(anchors, pageWidth) {
  if (anchors.length < 2) return [];
  const boundaries = [];
  for (let i=0; i<anchors.length-1; i++) boundaries.push((anchors[i] + anchors[i+1]) / 2);
  return boundaries.filter(x => x > 0 && x < pageWidth);
}

/**
 * Select real PDF vector rules near the expected column separators.
 * Falls back per-boundary to the expected position when no trustworthy rule is
 * close enough. This lets profiles keep semantic expectations while geometry
 * comes from the document itself whenever possible.
 */
export function vectorBoundariesNear(page, expectedRatios, {
  toleranceRatio=0.035,
  minRuleScore=0,
} = {}) {
  const rules = (page.verticalRules || [])
    .filter(r => (r.maxLength || 0) >= page.height * 0.08 || (r.totalLength || 0) >= page.height * 0.25 || (r.segments || 0) >= 3)
    .map(r => ({ ...r, score:(r.maxLength || 0) + (r.totalLength || 0) * 0.25 + (r.segments || 0) * 6 }));

  const used = new Set();
  const source = [];
  const boundaries = expectedRatios.map(ratio => {
    const expected = page.width * ratio;
    const tol = page.width * toleranceRatio;
    let best = null;
    rules.forEach((r, idx) => {
      if (used.has(idx) || r.score < minRuleScore) return;
      const d = Math.abs(r.x - expected);
      if (d > tol) return;
      if (!best || d < best.d || (Math.abs(d-best.d) < 0.5 && r.score > best.r.score)) best={idx,r,d};
    });
    if (best) {
      used.add(best.idx);
      source.push({ expected, actual:best.r.x, detected:true, distance:best.d });
      return best.r.x;
    }
    source.push({ expected, actual:expected, detected:false, distance:null });
    return expected;
  });
  return { boundaries, source, detectedCount:source.filter(s=>s.detected).length };
}

/** Return interior vector rules that look like column separators for generic tables. */
export function vectorColumnRules(page, { minGap=18, maxColumns=16 } = {}) {
  const rules = (page.verticalRules || [])
    .map(r=>r.x)
    .filter(x=>x > page.width*0.015 && x < page.width*0.985)
    .sort((a,b)=>a-b);
  const merged=[];
  for (const x of rules) {
    if (!merged.length || x - merged.at(-1) >= minGap) merged.push(x);
    else merged[merged.length-1] = (merged.at(-1)+x)/2;
  }
  // outer table borders are not boundaries between data columns
  if (merged.length >= 3) return merged.slice(1,-1).slice(0,maxColumns-1);
  return merged.slice(0,maxColumns-1);
}
