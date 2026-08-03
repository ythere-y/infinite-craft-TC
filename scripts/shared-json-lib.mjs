import { readFile } from "node:fs/promises";

const STRICT_UTF8_DECODER = new TextDecoder("utf-8", {
  fatal: true,
  ignoreBOM: true,
});

export async function readStrictJson(path, label) {
  let bytes;
  try {
    bytes = await readFile(path);
  } catch (error) {
    throw new Error(`${label} could not be read: ${error.message}`);
  }

  let source;
  try {
    source = STRICT_UTF8_DECODER.decode(bytes);
  } catch (error) {
    throw new Error(`${label} is invalid UTF-8: ${error.message}`);
  }

  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${error.message}`);
  }
}
