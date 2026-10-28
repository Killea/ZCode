export type DetectedImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

export interface ParsedImageDataUrl {
  base64: string;
  data: Uint8Array;
  dataUrl: string;
  mediaType: string;
}

export interface ParseImageDataUrlOptions {
  allowWhitespace?: boolean;
}

export function detectImageMediaType(buffer: Uint8Array): DetectedImageMediaType | undefined {
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.length >= 3 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return "image/gif";
  }
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "image/webp";
  }
  return undefined;
}

export interface ImageDimensions {
  width: number;
  height: number;
}

// 尺寸探测只解码 base64 前缀：媒体预算对每个历史图片都要算 token，
// 完整解码 25MB 截图只为读 8 字节宽高是不可接受的常数级浪费。
const IMAGE_SIZE_PROBE_BASE64_CHARS = 256 * 1024; // ≈192 KiB decoded

/**
 * 从 image data URL 读取像素尺寸；解析不出（非 base64、未知格式、头部截断）
 * 返回 undefined，由调用方决定退化策略。
 */
export function readImageDataUrlSize(value: string): ImageDimensions | undefined {
  const dataUrl = value.trim();
  const commaIndex = dataUrl.indexOf(",");
  const headerEnd = "data:".length;
  if (
    dataUrl.slice(0, headerEnd).toLowerCase() !== "data:" ||
    commaIndex < 0 ||
    !/;base64$/i.test(dataUrl.slice(headerEnd, commaIndex))
  ) {
    return undefined;
  }
  const base64 = dataUrl.slice(commaIndex + 1);
  // 只对 4 对齐的前缀解码；探测长度取 4 的倍数后 partial quantum 不存在歧义。
  const probeChars = Math.min(base64.length, IMAGE_SIZE_PROBE_BASE64_CHARS) & ~3;
  const probe = Buffer.from(base64.slice(0, probeChars), "base64");
  if (probe.byteLength === 0) return undefined;
  switch (detectImageMediaType(probe)) {
    case "image/png":
      return readPngSize(probe);
    case "image/jpeg":
      return readJpegSize(probe);
    case "image/gif":
      return readGifSize(probe);
    case "image/webp":
      return readWebpSize(probe);
    default:
      return undefined;
  }
}

function readPngSize(buffer: Buffer): ImageDimensions | undefined {
  // PNG sig(8B) + IHDR len(4B) + "IHDR"(4B)，宽高从 offset 16 起各 4B BE。
  if (buffer.length < 24 || buffer.toString("ascii", 12, 16) !== "IHDR") return undefined;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function readGifSize(buffer: Buffer): ImageDimensions | undefined {
  // GIF header(6B) 后是 Logical Screen Descriptor：w/h 各 2B LE。
  if (buffer.length < 10) return undefined;
  return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
}

function readJpegSize(buffer: Buffer): ImageDimensions | undefined {
  // 顺序扫 marker 段直到 SOF（Start Of Frame）；段体 [len 2B BE][precision 1B][h 2B][w 2B]。
  let offset = 2; // 跳过 SOI (FF D8)
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) return undefined;
    const marker = buffer[offset + 1]!;
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (offset + 9 > buffer.length) return undefined;
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }
    // 无段体 marker：SOI/EOI/RST/TEM。
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (segmentLength < 2) return undefined;
    offset += 2 + segmentLength;
  }
  return undefined;
}

function readWebpSize(buffer: Buffer): ImageDimensions | undefined {
  // RIFF(12B) + chunk id(4B) + chunk size(4B)，payload 从 offset 20 起。
  if (buffer.length < 20) return undefined;
  const chunkId = buffer.toString("ascii", 12, 16);
  if (chunkId === "VP8X") {
    // VP8X：flags(1B)+rsv(3B)+w-1(3B LE)+h-1(3B LE)。
    if (buffer.length < 30) return undefined;
    return {
      width: (buffer[24]! | (buffer[25]! << 8) | (buffer[26]! << 16)) + 1,
      height: (buffer[27]! | (buffer[28]! << 8) | (buffer[29]! << 16)) + 1,
    };
  }
  if (chunkId === "VP8 ") {
    // Lossy：frame tag(3B) + 0x9D012A(3B) + w/h 各 2B LE 低 14 位。
    if (buffer.length < 30 || buffer[23] !== 0x9d || buffer[24] !== 0x01 || buffer[25] !== 0x2a) {
      return undefined;
    }
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunkId === "VP8L") {
    // Lossless：sig 0x2F + 14bit (w-1,h-1) 按位打包。
    if (buffer.length < 25 || buffer[20] !== 0x2f) return undefined;
    return {
      width: (buffer[21]! | ((buffer[22]! & 0x3f) << 8)) + 1,
      height: ((buffer[22]! >> 6) | (buffer[23]! << 2) | ((buffer[24]! & 0x0f) << 10)) + 1,
    };
  }
  return undefined;
}

export function parseImageDataUrl(
  value: string,
  options: ParseImageDataUrlOptions = {},
): ParsedImageDataUrl | undefined {
  const dataUrl = value.trim();
  const match = /^data:(image\/[a-z0-9.+_-]+);base64,([\s\S]+)$/i.exec(dataUrl);
  if (!match?.[1] || !match[2]) return undefined;

  const rawBase64 = match[2];
  if (!options.allowWhitespace && /\s/.test(rawBase64)) return undefined;
  const base64 = options.allowWhitespace ? rawBase64.replace(/\s/g, "") : rawBase64;
  if (!isValidBase64Payload(base64)) return undefined;

  const data = Buffer.from(base64, "base64");
  if (data.byteLength === 0) return undefined;

  const mediaType = normalizeImageMediaType(match[1]);
  return {
    base64,
    data,
    dataUrl: `data:${mediaType};base64,${base64}`,
    mediaType,
  };
}

export function normalizeImageMediaType(value: string): string {
  const lower = value.toLowerCase();
  return lower === "image/jpg" ? "image/jpeg" : lower;
}

function isValidBase64Payload(value: string): boolean {
  return value.length % 4 !== 1 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}
