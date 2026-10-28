import { describe, expect, it } from "vitest";

import { parseImageDataUrl, readImageDataUrlSize } from "../src/model/index.js";

const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

describe("model image media contracts", () => {
  it("exports image data URL parsing from the model subpath", () => {
    const parsed = parseImageDataUrl(`data:image/png;base64,${PNG_1X1_BASE64}`);

    expect(parsed?.mediaType).toBe("image/png");
    expect(parsed?.data.length).toBeGreaterThan(0);
  });
});

describe("readImageDataUrlSize", () => {
  it("reads dimensions from a real PNG payload", () => {
    expect(readImageDataUrlSize(`data:image/png;base64,${PNG_1X1_BASE64}`)).toEqual({
      width: 1,
      height: 1,
    });
  });

  it("reads dimensions from JPEG SOF, GIF LSD and WebP VP8X headers", () => {
    const jpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x04, 0x38, 0x07, 0x80, 0x03,
    ]);
    expect(
      readImageDataUrlSize(`data:image/jpeg;base64,${jpeg.toString("base64")}`),
    ).toEqual({ width: 1920, height: 1080 });

    const gif = Buffer.alloc(13);
    gif.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0); // "GIF89a"
    gif.writeUInt16LE(800, 6);
    gif.writeUInt16LE(600, 8);
    expect(readImageDataUrlSize(`data:image/gif;base64,${gif.toString("base64")}`)).toEqual({
      width: 800,
      height: 600,
    });

    const webp = Buffer.alloc(30);
    webp.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
    webp.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
    webp.set([0x56, 0x50, 0x38, 0x58], 12); // "VP8X"
    webp[24] = (640 - 1) & 0xff;
    webp[25] = ((640 - 1) >> 8) & 0xff;
    webp[27] = (480 - 1) & 0xff;
    webp[28] = ((480 - 1) >> 8) & 0xff;
    expect(readImageDataUrlSize(`data:image/webp;base64,${webp.toString("base64")}`)).toEqual({
      width: 640,
      height: 480,
    });
  });

  it("returns undefined for non-base64 or unrecognized payloads", () => {
    expect(readImageDataUrlSize("data:image/png;base64,")).toBeUndefined();
    expect(readImageDataUrlSize("data:image/png;base64,AAAA")).toBeUndefined();
    expect(readImageDataUrlSize("https://example.com/a.png")).toBeUndefined();
    expect(readImageDataUrlSize("data:image/png,raw-not-base64")).toBeUndefined();
  });
});
