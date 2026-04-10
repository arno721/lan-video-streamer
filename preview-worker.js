const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { parentPort, workerData } = require("worker_threads");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function escapeXml(input) {
  return String(input || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildPlaceholderSvg(job) {
  const category = String(job.category || "other");
  const ext = String(job.extension || "").replace(".", "").toUpperCase() || "FILE";
  const title = escapeXml(job.fileName || "unknown").slice(0, 40);

  const colors = {
    video: "#1f7bd8",
    image: "#1f9c7a",
    audio: "#8f5ee8",
    document: "#d97d1f",
    archive: "#cb4f4f",
    code: "#3f6f9b",
    other: "#667085",
  };

  const color = colors[category] || colors.other;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <rect width="640" height="360" fill="#f4f7fb" />
  <rect x="26" y="26" width="588" height="308" rx="20" fill="${color}" opacity="0.15" />
  <rect x="46" y="48" width="170" height="52" rx="10" fill="${color}" />
  <text x="131" y="81" font-family="Arial, sans-serif" font-size="24" text-anchor="middle" fill="#fff">${category.toUpperCase()}</text>
  <text x="56" y="164" font-family="Arial, sans-serif" font-size="42" font-weight="700" fill="#0f172a">.${ext}</text>
  <text x="56" y="214" font-family="Arial, sans-serif" font-size="20" fill="#1f2937">${title}</text>
  <text x="56" y="250" font-family="Arial, sans-serif" font-size="16" fill="#334155">Preview generated</text>
</svg>`;
}

function writeSvgPreview(job, outputPath) {
  const svg = buildPlaceholderSvg(job);
  fs.writeFileSync(outputPath, svg, "utf8");
  return { outputPath, mimeType: "image/svg+xml" };
}

function tryGenerateWithFfmpeg(job, outputPath) {
  if (!job.ffmpegEnabled) {
    return null;
  }

  const args = ["-hide_banner", "-loglevel", "error", "-y"];
  if (job.category === "video") {
    args.push("-ss", "00:00:01");
  }
  args.push("-i", job.sourcePath, "-frames:v", "1", "-vf", "scale=720:-1", outputPath);

  const result = spawnSync(job.ffmpegPath || "ffmpeg", args, { encoding: "utf8", windowsHide: true });
  if (result.status === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
    return { outputPath, mimeType: "image/jpeg" };
  }

  return null;
}

function run(job) {
  ensureDir(job.targetDir);

  const jpgOutput = path.join(job.targetDir, `${job.previewKey}.jpg`);
  const svgOutput = path.join(job.targetDir, `${job.previewKey}.svg`);

  if ((job.category === "video" || job.category === "image") && fs.existsSync(jpgOutput) && fs.statSync(jpgOutput).size > 0) {
    return { ok: true, outputPath: jpgOutput, mimeType: "image/jpeg" };
  }

  if (job.category === "video" || job.category === "image") {
    const generated = tryGenerateWithFfmpeg(job, jpgOutput);
    if (generated) {
      if (fs.existsSync(svgOutput)) {
        try {
          fs.unlinkSync(svgOutput);
        } catch {
          // ignore stale svg cleanup failure
        }
      }
      return { ok: true, ...generated };
    }
  }

  if (fs.existsSync(svgOutput) && fs.statSync(svgOutput).size > 0) {
    return { ok: true, outputPath: svgOutput, mimeType: "image/svg+xml" };
  }

  const fallback = writeSvgPreview(job, svgOutput);
  return { ok: true, ...fallback };
}

try {
  const result = run(workerData);
  parentPort.postMessage(result);
} catch (err) {
  parentPort.postMessage({ ok: false, error: err.message || "preview worker failed" });
}
