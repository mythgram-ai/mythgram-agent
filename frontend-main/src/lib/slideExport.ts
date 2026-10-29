import type { SlideProject } from "@/lib/slides";

/** Download formats offered for a slide deck. */
export type SlideExportFormat = "pptx" | "pdf" | "png";

export interface SlideExportProgress {
  completed: number;
  total: number;
}

const EXPORT_WIDTH = 1280;
const EXPORT_HEIGHT = 720;

/**
 * Export work runs entirely in the user's browser: each slide's HTML is mounted in
 * an offscreen, same-document sandbox, rasterized to a PNG, and then packaged as
 * PPTX (one full-bleed image per slide), PDF (one 16:9 page per slide), or a ZIP of
 * PNG files. No headless browser or server-side renderer is required.
 */
export async function exportSlideProject(
  project: SlideProject,
  format: SlideExportFormat,
  onProgress?: (progress: SlideExportProgress) => void,
): Promise<void> {
  if (!project.slides.length) throw new Error("This slide project has no slides to export.");

  const baseName = safeBaseName(project.name);
  const total = project.slides.length;

  if (format === "pptx") {
    const PptxGenJS = (await import("pptxgenjs")).default;
    const pptx = new PptxGenJS();
    pptx.defineLayout({ name: "MYTHGRAM_16_9", width: 13.333, height: 7.5 });
    pptx.layout = "MYTHGRAM_16_9";
    pptx.author = "Mythgram";
    pptx.subject = project.name;
    pptx.title = project.name;

    for (let index = 0; index < total; index += 1) {
      const slide = project.slides[index]!;
      const dataUrl = await renderSlideToPng(slide.html, 1.5);
      const page = pptx.addSlide();
      page.addImage({ data: dataUrl, x: 0, y: 0, w: 13.333, h: 7.5 });
      onProgress?.({ completed: index + 1, total });
    }

    await pptx.writeFile({ fileName: `${baseName}.pptx` });
    return;
  }

  if (format === "pdf") {
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF({
      orientation: "landscape",
      unit: "px",
      format: [EXPORT_WIDTH, EXPORT_HEIGHT],
      compress: true,
    });

    for (let index = 0; index < total; index += 1) {
      const slide = project.slides[index]!;
      const dataUrl = await renderSlideToPng(slide.html, 1.5);
      if (index > 0) pdf.addPage([EXPORT_WIDTH, EXPORT_HEIGHT], "landscape");
      pdf.addImage(dataUrl, "PNG", 0, 0, EXPORT_WIDTH, EXPORT_HEIGHT, undefined, "FAST");
      onProgress?.({ completed: index + 1, total });
    }

    pdf.save(`${baseName}.pdf`);
    return;
  }

  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const pad = String(total).length;
  for (let index = 0; index < total; index += 1) {
    const slide = project.slides[index]!;
    const dataUrl = await renderSlideToPng(slide.html, 2);
    const base64 = dataUrl.split(",")[1];
    if (!base64) throw new Error(`Slide ${index + 1} could not be rendered.`);
    zip.file(`slide-${String(index + 1).padStart(pad, "0")}.png`, base64, { base64: true });
    onProgress?.({ completed: index + 1, total });
  }
  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(blob, `${baseName}-png.zip`);
}

/** Rasterize one standalone slide HTML document to a PNG data URL. */
export async function renderSlideToPng(html: string, pixelRatio: number): Promise<string> {
  const mounted = mountSlideForExport(html);
  const host = mounted.host;
  try {
    const { toPng } = await import("html-to-image");
    // Two frames give the browser a chance to apply fonts and layout before capture.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    return await toPng(host, {
      width: EXPORT_WIDTH,
      height: EXPORT_HEIGHT,
      canvasWidth: EXPORT_WIDTH,
      canvasHeight: EXPORT_HEIGHT,
      pixelRatio,
      backgroundColor: "#ffffff",
      cacheBust: true,
      skipAutoScale: true,
    });
  } finally {
    mounted.cleanup();
  }
}

/**
 * Mount a slide HTML document into the current page so html-to-image can inspect
 * its real computed styles. The document's `<style>` rules are scoped to this
 * offscreen wrapper (no global style leakage) and scripts are never executed.
 */
function mountSlideForExport(html: string): { host: HTMLElement; cleanup: () => void } {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const css = Array.from(parsed.querySelectorAll("style"))
    .map((style) => style.textContent ?? "")
    .join("\n");
  const scopedCss = scopeSlideCss(css, ".slide-export-root");

  // The stage is a zero-size, clipped fixed layer: the full-size slide is mounted inside
  // it, but it can never widen the page, create a scrollbar, or shift the app's layout.
  const stage = document.createElement("div");
  stage.style.cssText =
    "position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;pointer-events:none;z-index:-1;";

  const host = document.createElement("div");
  host.className = "slide-export-root";
  if (parsed.body.className) host.className += ` ${parsed.body.className}`;
  host.setAttribute("data-slide-export", "true");
  host.style.cssText = [
    `position:relative`,
    `width:${EXPORT_WIDTH}px`,
    `height:${EXPORT_HEIGHT}px`,
    `overflow:hidden`,
    `margin:0`,
    `padding:0`,
    parsed.body.getAttribute("style") ?? "",
  ].join(";");

  const style = document.createElement("style");
  style.textContent = scopedCss;
  host.appendChild(style);

  const content = document.createElement("div");
  content.style.cssText = `width:${EXPORT_WIDTH}px;height:${EXPORT_HEIGHT}px;position:relative;overflow:hidden;`;
  content.innerHTML = parsed.body.innerHTML;
  // Scripts inserted with innerHTML do not execute; strip inline handlers anyway.
  content.querySelectorAll("script").forEach((node) => node.remove());
  content.querySelectorAll("*").forEach((node) => {
    for (const attribute of Array.from(node.attributes)) {
      if (/^on/i.test(attribute.name)) node.removeAttribute(attribute.name);
    }
  });
  host.appendChild(content);
  stage.appendChild(host);
  document.body.appendChild(stage);

  // html-to-image ignores the background painted by the clone's ROOT element. Copy
  // the slide document's body background onto the inner content layer so themes
  // (dark backgrounds, gradients) are always preserved in the exported image.
  const bodyStyle = getComputedStyle(host);
  content.style.backgroundColor = bodyStyle.backgroundColor;
  content.style.backgroundImage = bodyStyle.backgroundImage;
  content.style.backgroundSize = bodyStyle.backgroundSize;
  content.style.backgroundPosition = bodyStyle.backgroundPosition;
  content.style.backgroundRepeat = bodyStyle.backgroundRepeat;
  content.style.fontFamily = bodyStyle.fontFamily;
  content.style.color = bodyStyle.color;

  return { host, cleanup: () => stage.remove() };
}

/**
 * Scope EVERY selector in the slide's stylesheet to the offscreen export wrapper.
 *
 * This is critical: a standalone slide document contains global selectors (`*`,
 * `h1`, `p`, `.card`, `.grid`, ...). Injecting them unscoped would temporarily
 * restyle the whole app during export and cause visible layout glitches.
 */
function scopeSlideCss(css: string, scope: string): string {
  if (!css.trim()) return "";
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    scopeCssRules(sheet.cssRules, scope);
    return Array.from(sheet.cssRules)
      .map((rule) => rule.cssText)
      .join("\n");
  } catch {
    // Older engines without constructable stylesheets: keep exports functional while
    // still rewriting the root selectors. Modern browsers always take the CSSOM path.
    return css.replace(/:root\b/g, scope);
  }
}

function scopeCssRules(rules: CSSRuleList, scope: string): void {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule) {
      rule.selectorText = splitSelectorList(rule.selectorText)
        .map((selector) => scopeSelector(selector, scope))
        .join(", ");
      continue;
    }
    const grouping = rule as CSSRule & { cssRules?: CSSRuleList };
    if (grouping.cssRules) scopeCssRules(grouping.cssRules, scope);
  }
}

function scopeSelector(selector: string, scope: string): string {
  let next = selector.trim();
  if (!next) return next;
  next = next.replace(/:root\b/g, scope);
  next = next.replace(
    /(^|[\s>+~])(html|body)(?=$|[\s>+~.#:[,])/g,
    (_match, prefix: string) => `${prefix}${scope}`,
  );
  if (next !== scope && !next.startsWith(`${scope}`)) next = `${scope} ${next}`;
  return next;
}

/** Split a selector list on top-level commas (commas inside :is(), :not(), etc. survive). */
function splitSelectorList(selectorText: string): string[] {
  const out: string[] = [];
  let current = "";
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < selectorText.length; index += 1) {
    const char = selectorText[index]!;
    if (quote) {
      current += char;
      if (char === quote && selectorText[index - 1] !== "\\") quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) {
      if (current.trim()) out.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function safeBaseName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 80)
    .trim();
  return cleaned.length > 0 ? cleaned : "slides";
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}