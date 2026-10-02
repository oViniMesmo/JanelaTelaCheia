import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const iconsDir = path.join(projectRoot, "icons");

if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// -------------------------------------------------------------
// Pure Node.js Standard PNG Encoder (Zero External Dependencies)
// -------------------------------------------------------------
function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);

  const typeAndData = Buffer.concat([typeBuf, data]);
  const crcVal = zlib.crc32(typeAndData);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crcVal >>> 0, 0);

  return Buffer.concat([lenBuf, typeAndData, crcBuf]);
}

function encodePng(width, height, rgbaBuffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR chunk: 13 bytes
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth: 8
  ihdr[9] = 6; // color type: 6 (RGBA)
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter: standard
  ihdr[12] = 0; // interlace: none
  const ihdrChunk = makeChunk("IHDR", ihdr);

  // Scanlines with filter type 0 (None)
  const rowSize = 1 + width * 4;
  const rawData = Buffer.alloc(height * rowSize);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0; // Filter 0 (None)
    rgbaBuffer.copy(rawData, rowOffset + 1, y * width * 4, (y + 1) * width * 4);
  }

  const idatChunk = makeChunk("IDAT", zlib.deflateSync(rawData, { level: 9 }));
  const iendChunk = makeChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// -------------------------------------------------------------
// 2D Geometric Math & SDF Functions
// -------------------------------------------------------------
function distToRoundedBox(px, py, x0, y0, x1, y1, r) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const hw = (x1 - x0) / 2;
  const hh = (y1 - y0) / 2;
  const rad = Math.min(r, Math.min(hw, hh));
  const dx = Math.abs(px - cx) - (hw - rad);
  const dy = Math.abs(py - cy) - (hh - rad);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - rad;
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function pointInTriangle(px, py, x1, y1, x2, y2, x3, y3) {
  const d1 = (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2);
  const d2 = (px - x3) * (y2 - y3) - (x2 - x3) * (py - y3);
  const d3 = (px - x1) * (y3 - y1) - (x3 - x1) * (py - y1);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function lerp(a, b, t) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

function blendColor(dst, src) {
  // standard alpha compositing over dst: src over dst
  const srcA = src[3] / 255;
  const dstA = dst[3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA <= 0) return [0, 0, 0, 0];
  const outR = Math.round((src[0] * srcA + dst[0] * dstA * (1 - srcA)) / outA);
  const outG = Math.round((src[1] * srcA + dst[1] * dstA * (1 - srcA)) / outA);
  const outB = Math.round((src[2] * srcA + dst[2] * dstA * (1 - srcA)) / outA);
  return [outR, outG, outB, Math.round(outA * 255)];
}

// -------------------------------------------------------------
// Procedural High-Tech Icon Shader / Sampler
// -------------------------------------------------------------
function sampleIcon(px, py, S) {
  let color = [0, 0, 0, 0];

  // Specific pixel-perfect tuning for 16x16
  if (S === 16) {
    const dBox = distToRoundedBox(px, py, 0.5, 0.5, 15.5, 15.5, 3.2);
    if (dBox > 0.5) return color;

    // Rich gradient
    const tGrad = (px + py) / 32;
    let bgR, bgG, bgB;
    if (tGrad < 0.5) {
      bgR = lerp(15, 30, tGrad * 2);
      bgG = lerp(23, 40, tGrad * 2);
      bgB = lerp(45, 95, tGrad * 2);
    } else {
      bgR = lerp(30, 2, (tGrad - 0.5) * 2);
      bgG = lerp(40, 132, (tGrad - 0.5) * 2);
      bgB = lerp(95, 199, (tGrad - 0.5) * 2);
    }

    const boxAlpha = Math.max(0, Math.min(1, 0.5 - dBox));
    color = [bgR, bgG, bgB, Math.round(boxAlpha * 255)];

    // Top window bar tint
    if (py <= 4.2) {
      color = blendColor(color, [255, 255, 255, Math.round(25 * boxAlpha)]);
    }

    // 4 Corner Brackets & Outward Expansion Points
    const strokeW = 1.25;
    let minD = 999;
    // TL
    minD = Math.min(minD, distToSegment(px, py, 2.5, 2.5, 5.8, 2.5));
    minD = Math.min(minD, distToSegment(px, py, 2.5, 2.5, 2.5, 5.8));
    minD = Math.min(minD, distToSegment(px, py, 2.5, 2.5, 5.0, 5.0));

    // TR
    minD = Math.min(minD, distToSegment(px, py, 13.5, 2.5, 10.2, 2.5));
    minD = Math.min(minD, distToSegment(px, py, 13.5, 2.5, 13.5, 5.8));
    minD = Math.min(minD, distToSegment(px, py, 13.5, 2.5, 11.0, 5.0));

    // BL
    minD = Math.min(minD, distToSegment(px, py, 2.5, 13.5, 5.8, 13.5));
    minD = Math.min(minD, distToSegment(px, py, 2.5, 13.5, 2.5, 10.2));
    minD = Math.min(minD, distToSegment(px, py, 2.5, 13.5, 5.0, 11.0));

    // BR
    minD = Math.min(minD, distToSegment(px, py, 13.5, 13.5, 10.2, 13.5));
    minD = Math.min(minD, distToSegment(px, py, 13.5, 13.5, 13.5, 10.2));
    minD = Math.min(minD, distToSegment(px, py, 13.5, 13.5, 11.0, 11.0));

    const dStroke = minD - (strokeW / 2);
    if (dStroke <= 0.5) {
      const a = Math.max(0, Math.min(1, 0.5 - dStroke));
      color = blendColor(color, [103, 232, 249, Math.round(a * 255)]);
    }

    // Centered Play Triangle
    if (pointInTriangle(px, py, 6.2, 5.8, 10.8, 8.0, 6.2, 10.2)) {
      color = blendColor(color, [255, 255, 255, 255]);
    }

    // Squircle Cyan Border
    const dBorder = Math.abs(dBox) - 0.5;
    if (dBorder <= 0.5) {
      const a = Math.max(0, Math.min(1, 0.5 - dBorder)) * boxAlpha;
      color = blendColor(color, [56, 189, 248, Math.round(a * 230)]);
    }

    return color;
  }

  // Coordinates normalized relative to 128 for 32, 48, 128
  const scale = S / 128;

  // Window squircle geometry
  const pad = Math.max(1, 6 * scale);
  const rx = Math.max(5, 24 * scale);
  const borderW = Math.max(1.2, 2.5 * scale);
  const dBox = distToRoundedBox(px, py, pad, pad, S - pad, S - pad, rx);

  // If outside squircle, return transparent
  if (dBox > 0.5) return color;

  // 1. Base Gradient Fill
  const tGrad = Math.max(0, Math.min(1, (px + py) / (2 * S)));
  let bgR, bgG, bgB;
  if (tGrad < 0.35) {
    const k = tGrad / 0.35;
    bgR = lerp(15, 30, k);
    bgG = lerp(23, 27, k);
    bgB = lerp(42, 75, k);
  } else if (tGrad < 0.70) {
    const k = (tGrad - 0.35) / 0.35;
    bgR = lerp(30, 30, k);
    bgG = lerp(27, 58, k);
    bgB = lerp(75, 138, k);
  } else {
    const k = (tGrad - 0.70) / 0.30;
    bgR = lerp(30, 2, k);
    bgG = lerp(58, 132, k);
    bgB = lerp(138, 199, k);
  }

  // Squircle edge anti-aliasing
  const boxAlpha = Math.max(0, Math.min(1, 0.5 - dBox));
  color = [bgR, bgG, bgB, Math.round(boxAlpha * 255)];

  // 2. Title bar separator & dots (for S >= 32)
  const titleY = 32 * scale;
  // Glass highlight in title bar
  if (py < titleY) {
    color = blendColor(color, [255, 255, 255, Math.round(18 * boxAlpha)]);
  }

  // Title divider line
  const dTitleLine = Math.abs(py - titleY);
  if (dTitleLine <= 0.8 * scale && px >= pad + 2 && px <= S - pad - 2) {
    const lineAlpha = Math.max(0, 1 - dTitleLine / (0.8 * scale));
    color = blendColor(color, [56, 189, 248, Math.round(lineAlpha * 90)]);
  }

  // Traffic light dots
  const dotY = 19 * scale;
  const dotR = Math.max(1.2, 3.5 * scale);
  const dot1X = 22 * scale;
  const dot2X = 32 * scale;
  const dot3X = 42 * scale;

  const dDot1 = Math.hypot(px - dot1X, py - dotY) - dotR;
  if (dDot1 <= 0.5) {
    const a = Math.max(0, Math.min(1, 0.5 - dDot1));
    color = blendColor(color, [248, 113, 113, Math.round(a * 240)]);
  }
  const dDot2 = Math.hypot(px - dot2X, py - dotY) - dotR;
  if (dDot2 <= 0.5) {
    const a = Math.max(0, Math.min(1, 0.5 - dDot2));
    color = blendColor(color, [251, 191, 36, Math.round(a * 240)]);
  }
  const dDot3 = Math.hypot(px - dot3X, py - dotY) - dotR;
  if (dDot3 <= 0.5) {
    const a = Math.max(0, Math.min(1, 0.5 - dDot3));
    color = blendColor(color, [52, 211, 153, Math.round(a * 240)]);
  }

  // Header tab pill (for S >= 48)
  if (S >= 48) {
    const dPill = distToRoundedBox(px, py, 56 * scale, 15 * scale, 84 * scale, 23 * scale, 4 * scale);
    if (dPill <= 0.5) {
      const a = Math.max(0, Math.min(1, 0.5 - dPill));
      color = blendColor(color, [255, 255, 255, Math.round(a * 25)]);
    }
  }

  // 3. Central Video Player
  const cardW = S === 32 ? 12.5 : 38 * scale;
  const cardH = S === 32 ? 9.5 : 28 * scale;
  const cardX0 = (S - cardW) / 2;
  const cardY0 = (76 * scale) - (cardH / 2);
  const cardX1 = cardX0 + cardW;
  const cardY1 = cardY0 + cardH;
  const cardR = S === 32 ? 2.5 : Math.max(2, 7 * scale);

  const dCard = distToRoundedBox(px, py, cardX0, cardY0, cardX1, cardY1, cardR);
  if (dCard <= 0.5) {
    const a = Math.max(0, Math.min(1, 0.5 - dCard));
    color = blendColor(color, [15, 23, 42, Math.round(a * 235)]);
  }

  // Player card border
  const cardStrokeW = S === 32 ? 1.0 : Math.max(1.0, 1.8 * scale);
  const dCardStroke = Math.abs(dCard) - (cardStrokeW / 2);
  if (dCardStroke <= 0.5) {
    const a = Math.max(0, Math.min(1, 0.5 - dCardStroke));
    color = blendColor(color, [56, 189, 248, Math.round(a * 220)]);
  }

  // Play triangle inside player
  const triCx = S === 32 ? 16.3 : (cardX0 + cardX1) / 2 + (1.2 * scale);
  const triCy = S === 32 ? (cardY0 + cardY1) / 2 : (cardY0 + cardY1) / 2;
  const triH = S === 32 ? 4.5 : Math.max(4, 13 * scale);
  const triW = S === 32 ? 4.0 : Math.max(3.5, 11 * scale);

  const p1x = triCx - triW * 0.45;
  const p1y = triCy - triH * 0.5;
  const p2x = triCx + triW * 0.55;
  const p2y = triCy;
  const p3x = triCx - triW * 0.45;
  const p3y = triCy + triH * 0.5;

  if (pointInTriangle(px, py, p1x, p1y, p2x, p2y, p3x, p3y)) {
    color = blendColor(color, [255, 255, 255, 255]);
  }

  // 4. 4 Corner Expansion Brackets & Directional Arrows
  const strokeW = Math.max(1.5, 3.8 * scale);
  const halfStroke = strokeW / 2;

  // Bracket points in 128-normalized space:
  const tl_x = 24 * scale, tl_y = 46 * scale;
  const tl_armX = 38 * scale, tl_armY = 60 * scale;
  const tl_diagX = 39 * scale, tl_diagY = 61 * scale;

  const tr_x = 104 * scale, tr_y = 46 * scale;
  const tr_armX = 90 * scale, tr_armY = 60 * scale;
  const tr_diagX = 89 * scale, tr_diagY = 61 * scale;

  const bl_x = 24 * scale, bl_y = 106 * scale;
  const bl_armX = 38 * scale, bl_armY = 92 * scale;
  const bl_diagX = 39 * scale, bl_diagY = 91 * scale;

  const br_x = 104 * scale, br_y = 106 * scale;
  const br_armX = 90 * scale, br_armY = 92 * scale;
  const br_diagX = 89 * scale, br_diagY = 91 * scale;

  let minSegDist = 999;
  minSegDist = Math.min(minSegDist, distToSegment(px, py, tl_x, tl_y, tl_armX, tl_y));
  minSegDist = Math.min(minSegDist, distToSegment(px, py, tl_x, tl_y, tl_x, tl_armY));
  minSegDist = Math.min(minSegDist, distToSegment(px, py, tl_x + 1, tl_y + 1, tl_diagX, tl_diagY));

  minSegDist = Math.min(minSegDist, distToSegment(px, py, tr_x, tr_y, tr_armX, tr_y));
  minSegDist = Math.min(minSegDist, distToSegment(px, py, tr_x, tr_y, tr_x, tr_armY));
  minSegDist = Math.min(minSegDist, distToSegment(px, py, tr_x - 1, tr_y + 1, tr_diagX, tr_diagY));

  minSegDist = Math.min(minSegDist, distToSegment(px, py, bl_x, bl_y, bl_armX, bl_y));
  minSegDist = Math.min(minSegDist, distToSegment(px, py, bl_x, bl_y, bl_x, bl_armY));
  minSegDist = Math.min(minSegDist, distToSegment(px, py, bl_x + 1, bl_y - 1, bl_diagX, bl_diagY));

  minSegDist = Math.min(minSegDist, distToSegment(px, py, br_x, br_y, br_armX, br_y));
  minSegDist = Math.min(minSegDist, distToSegment(px, py, br_x, br_y, br_x, br_armY));
  minSegDist = Math.min(minSegDist, distToSegment(px, py, br_x - 1, br_y - 1, br_diagX, br_diagY));

  const dStroke = minSegDist - halfStroke;
  if (dStroke <= 0.5) {
    const a = Math.max(0, Math.min(1, 0.5 - dStroke));
    const arrowR = Math.round(lerp(56, 255, 0.65));
    const arrowG = Math.round(lerp(189, 255, 0.75));
    const arrowB = 255;
    color = blendColor(color, [arrowR, arrowG, arrowB, Math.round(a * 255)]);
  }

  // 5. Squircle Glowing Border
  const dBorder = Math.abs(dBox) - (borderW / 2);
  if (dBorder <= 0.5) {
    const a = Math.max(0, Math.min(1, 0.5 - dBorder)) * boxAlpha;
    const bGrad = (px + py) / (2 * S);
    const bR = Math.round(lerp(56, 6, bGrad));
    const bG = Math.round(lerp(189, 182, bGrad));
    const bB = Math.round(lerp(248, 212, bGrad));
    color = blendColor(color, [bR, bG, bB, Math.round(a * 230)]);
  }

  return color;
}

// -------------------------------------------------------------
// Supersampled Icon Generator
// -------------------------------------------------------------
function generateIconImage(size) {
  const S = size;
  const rgbaBuffer = Buffer.alloc(S * S * 4);

  // SSAA sampling grid: 4x4 (16 samples per pixel)
  const samples = 4;
  const step = 1 / samples;
  const totalSamples = samples * samples;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let rSum = 0, gSum = 0, bSum = 0, aSum = 0;

      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const sampleX = x + (sx + 0.5) * step;
          const sampleY = y + (sy + 0.5) * step;
          const [sr, sg, sb, sa] = sampleIcon(sampleX, sampleY, S);
          rSum += sr * (sa / 255);
          gSum += sg * (sa / 255);
          bSum += sb * (sa / 255);
          aSum += sa;
        }
      }

      const avgA = aSum / totalSamples;
      let finalR = 0, finalG = 0, finalB = 0;
      if (avgA > 0) {
        finalR = Math.min(255, Math.round((rSum / totalSamples) / (avgA / 255)));
        finalG = Math.min(255, Math.round((gSum / totalSamples) / (avgA / 255)));
        finalB = Math.min(255, Math.round((bSum / totalSamples) / (avgA / 255)));
      }

      const idx = (y * S + x) * 4;
      rgbaBuffer[idx] = finalR;
      rgbaBuffer[idx + 1] = finalG;
      rgbaBuffer[idx + 2] = finalB;
      rgbaBuffer[idx + 3] = Math.round(avgA);
    }
  }

  return encodePng(S, S, rgbaBuffer);
}

// -------------------------------------------------------------
// Main execution: Generate 16, 32, 48, 128 PNG icons
// -------------------------------------------------------------
const SIZES = [16, 32, 48, 128];
console.log("🎨 Gerando ícones modernos JanelaTelaCheia...");

for (const size of SIZES) {
  const start = performance.now();
  const pngData = generateIconImage(size);
  const outPath = path.join(iconsDir, `icon-${size}.png`);
  fs.writeFileSync(outPath, pngData);
  const ms = (performance.now() - start).toFixed(1);
  console.log(`  ✓ ${path.relative(projectRoot, outPath)} (${size}x${size}, ${pngData.length} bytes, ${ms}ms)`);
}

console.log("✨ Todos os ícones PNG foram gerados com sucesso!");
