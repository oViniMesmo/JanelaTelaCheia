import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = __dirname;
const distDir = path.join(projectRoot, "dist");

function dateToDos(date) {
  const d = date || new Date();
  const time =
    ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
  const dt =
    (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) &
    0xffff;
  return { time, dt };
}

function createZipBuffer(files) {
  const localChunks = [];
  const cdChunks = [];
  let offset = 0;
  const now = new Date();
  const { time, dt } = dateToDos(now);

  for (const file of files) {
    const nameBuf = Buffer.from(file.name.replace(/\\/g, "/"), "utf8");
    const content = Buffer.isBuffer(file.content)
      ? file.content
      : Buffer.from(file.content, "utf8");
    const crc = zlib.crc32(content);
    const compressed = zlib.deflateRawSync(content);

    // Local Header (30 bytes)
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); // Local file header signature
    lh.writeUInt16LE(20, 4); // Version needed to extract (2.0)
    lh.writeUInt16LE(0x0800, 6); // General purpose bit flag (UTF-8)
    lh.writeUInt16LE(8, 8); // Compression method (Deflate)
    lh.writeUInt16LE(time, 10);
    lh.writeUInt16LE(dt, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(compressed.length, 18);
    lh.writeUInt32LE(content.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28); // Extra field length

    localChunks.push(lh, nameBuf, compressed);

    // Central Directory Header (46 bytes)
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); // Central file header signature
    cd.writeUInt16LE(20, 4); // Version made by
    cd.writeUInt16LE(20, 6); // Version needed to extract
    cd.writeUInt16LE(0x0800, 8); // UTF-8 flag
    cd.writeUInt16LE(8, 10); // Deflate
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(dt, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(compressed.length, 20);
    cd.writeUInt32LE(content.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30); // Extra field length
    cd.writeUInt16LE(0, 32); // File comment length
    cd.writeUInt16LE(0, 34); // Disk number start
    cd.writeUInt16LE(0, 36); // Internal file attributes
    cd.writeUInt32LE(0, 38); // External file attributes
    cd.writeUInt32LE(offset, 42); // Relative offset of local header

    cdChunks.push(cd, nameBuf);

    offset += lh.length + nameBuf.length + compressed.length;
  }

  const cdStart = offset;
  let cdSize = 0;
  for (const c of cdChunks) cdSize += c.length;

  // End of Central Directory Record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(0, 4); // Number of this disk
  eocd.writeUInt16LE(0, 6); // Disk where central directory starts
  eocd.writeUInt16LE(files.length, 8); // Number of central directory records on this disk
  eocd.writeUInt16LE(files.length, 10); // Total number of central directory records
  eocd.writeUInt32LE(cdSize, 12); // Size of central directory
  eocd.writeUInt32LE(cdStart, 16); // Offset of start of central directory
  eocd.writeUInt16LE(0, 20); // Comment length

  return Buffer.concat([...localChunks, ...cdChunks, eocd]);
}

function collectFiles(dir, relativeTo = dir) {
  const result = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...collectFiles(fullPath, relativeTo));
    } else {
      const relPath = path.relative(relativeTo, fullPath).replace(/\\/g, "/");
      const content = fs.readFileSync(fullPath);
      result.push({ name: relPath, content });
    }
  }

  return result;
}

export function build() {
  console.log("Iniciando build do JanelaTelaCheia...");

  // 1. Limpa e cria pasta dist/
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
  fs.mkdirSync(distDir, { recursive: true });

  const firefoxDir = path.join(distDir, "firefox");
  const chromeDir = path.join(distDir, "chrome");
  fs.mkdirSync(firefoxDir, { recursive: true });
  fs.mkdirSync(chromeDir, { recursive: true });

  // 2. Arquivos base comuns
  const commonFiles = ["background.js", "content.js", "content.css"];
  const iconsDir = path.join(projectRoot, "icons");

  // Lê manifest original
  const manifestBase = JSON.parse(
    fs.readFileSync(path.join(projectRoot, "manifest.json"), "utf8")
  );

  // --- BUILD FIREFOX ---
  console.log("Construindo versão Firefox...");
  for (const file of commonFiles) {
    fs.copyFileSync(path.join(projectRoot, file), path.join(firefoxDir, file));
  }
  if (fs.existsSync(iconsDir)) {
    fs.cpSync(iconsDir, path.join(firefoxDir, "icons"), { recursive: true });
  }

  const firefoxManifest = { ...manifestBase };
  // Firefox usa background.scripts e browser_specific_settings gecko
  firefoxManifest.background = {
    scripts: ["background.js"]
  };
  fs.writeFileSync(
    path.join(firefoxDir, "manifest.json"),
    JSON.stringify(firefoxManifest, null, 2) + "\n"
  );

  const firefoxFiles = collectFiles(firefoxDir);
  const firefoxZip = createZipBuffer(firefoxFiles);
  fs.writeFileSync(path.join(distDir, "JanelaTelaCheia-firefox.zip"), firefoxZip);
  console.log(
    `✓ Firefox gerado: dist/firefox/ e dist/JanelaTelaCheia-firefox.zip (${(
      firefoxZip.length / 1024
    ).toFixed(1)} KB)`
  );

  // --- BUILD CHROME / CHROMIUM ---
  console.log("Construindo versão Chrome / Chromium...");
  for (const file of commonFiles) {
    fs.copyFileSync(path.join(projectRoot, file), path.join(chromeDir, file));
  }
  if (fs.existsSync(iconsDir)) {
    fs.cpSync(iconsDir, path.join(chromeDir, "icons"), { recursive: true });
  }

  const chromeManifest = { ...manifestBase };
  // Chrome MV3 usa service_worker e não suporta browser_specific_settings
  chromeManifest.background = {
    service_worker: "background.js"
  };
  delete chromeManifest.browser_specific_settings;

  fs.writeFileSync(
    path.join(chromeDir, "manifest.json"),
    JSON.stringify(chromeManifest, null, 2) + "\n"
  );

  const chromeFiles = collectFiles(chromeDir);
  const chromeZip = createZipBuffer(chromeFiles);
  fs.writeFileSync(path.join(distDir, "JanelaTelaCheia-chrome.zip"), chromeZip);
  console.log(
    `✓ Chrome gerado: dist/chrome/ e dist/JanelaTelaCheia-chrome.zip (${(
      chromeZip.length / 1024
    ).toFixed(1)} KB)`
  );

  console.log("\nBuild concluído com sucesso!");
}

// Executa se chamado diretamente via CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  build();
}
