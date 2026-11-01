// Lecture des documents du dossier docs/ (.md, .txt, .pdf) et découpage en chunks.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const EXT = new Set([".md", ".txt", ".markdown", ".pdf"]);

export function listDocs(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (EXT.has(path.extname(entry.name).toLowerCase())) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

/** Extrait le texte d'un PDF (pdf-parse). Nettoie les césures et les espaces multiples. */
export async function readPdf(file) {
  const pdfParse = require("pdf-parse/lib/pdf-parse.js");
  const data = await pdfParse(fs.readFileSync(file));
  const text = (data.text || "")
    .replace(/\r/g, "")
    .replace(/-\n(?=[a-zà-ÿ])/g, "")      // césure en fin de ligne
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/([^\n])\n(?!\n)/g, "$1 ")   // lignes coupées → espaces
    .replace(/ {2,}/g, " ");
  return { text, pages: data.numpages, info: data.info || {} };
}

/**
 * Découpe un texte en chunks d'environ `size` caractères avec chevauchement,
 * en respectant les paragraphes quand c'est possible.
 */
export function chunkText(text, { size = 1200, overlap = 200 } = {}) {
  const paragraphs = text.replace(/\r\n/g, "\n").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let current = "";
  for (const p of paragraphs) {
    if ((current + "\n\n" + p).length > size && current) {
      chunks.push(current);
      current = current.slice(-overlap) + "\n\n" + p;
    } else {
      current = current ? current + "\n\n" + p : p;
    }
    while (current.length > size * 1.5) {
      chunks.push(current.slice(0, size));
      current = current.slice(size - overlap);
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter((c) => c.replace(/\s+/g, "").length > 80);
}

/** Titre lisible : métadonnée PDF si elle est propre, sinon nom de fichier humanisé. */
export function cleanTitle(metaTitle, file) {
  const t = (metaTitle || "").trim();
  if (t && t.length > 3 && !/microsoft word|\.docx?$|\.pdf$|untitled|^\d+$/i.test(t)) return t;
  return path.basename(file).replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function loadChunks(dir, opts = {}) {
  const chunks = [];
  const docs = [];
  for (const file of listDocs(dir)) {
    const rel = path.relative(dir, file).replace(/\\/g, "/");
    const isPdf = path.extname(file).toLowerCase() === ".pdf";
    let text, title, pages = null;
    if (isPdf) {
      try {
        const r = await readPdf(file);
        text = r.text; pages = r.pages;
        title = cleanTitle(r.info.Title, file);
      } catch (err) {
        console.warn(`PDF illisible ${rel} : ${err.message}`);
        continue;
      }
    } else {
      text = fs.readFileSync(file, "utf8");
      title = (text.match(/^#\s+(.+)$/m) || [])[1] || path.basename(file);
    }
    const o = isPdf ? { size: opts.pdfSize || 1800, overlap: opts.overlap || 200 } : opts;
    const parts = chunkText(text, o);
    parts.forEach((content, i) => chunks.push({ id: `${rel}#${i}`, source: rel, title, index: i, content }));
    docs.push({ source: rel, title, chunks: parts.length, pages, chars: text.length, type: isPdf ? "pdf" : "md" });
  }
  return { chunks, docs };
}
