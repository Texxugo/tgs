const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const SIGNATURE_STORAGE_DIR = path.resolve(process.cwd(), "storage", "forgotten-signatures");

function parseSignatureBase64(signatureBase64) {
  if (typeof signatureBase64 !== "string" || !signatureBase64.trim()) {
    throw new Error("Assinatura obrigatoria");
  }

  const normalized = signatureBase64.trim().replace(/^data:image\/png;base64,/, "");
  let buffer;

  try {
    buffer = Buffer.from(normalized, "base64");
  } catch {
    throw new Error("Assinatura invalida");
  }

  if (!buffer.length || !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error("Assinatura deve ser uma imagem PNG valida");
  }

  return {
    buffer,
    normalizedBase64: normalized,
  };
}

function saveSignaturePng(userId, buffer) {
  fs.mkdirSync(SIGNATURE_STORAGE_DIR, { recursive: true });

  const filename = `forgotten-${userId}-${Date.now()}-${crypto.randomUUID()}.png`;
  const absolutePath = path.join(SIGNATURE_STORAGE_DIR, filename);
  fs.writeFileSync(absolutePath, buffer);

  return path.relative(process.cwd(), absolutePath).replace(/\\/g, "/");
}

function readSignatureAsDataUrl(signaturePath) {
  if (!signaturePath) return null;

  const absolutePath = resolveStoredPath(signaturePath);
  const buffer = fs.readFileSync(absolutePath);
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

function resolveStoredPath(signaturePath) {
  return path.resolve(process.cwd(), signaturePath);
}

function buildForgottenOccurredAt(date, time) {
  if (!date || !time) return null;

  const normalizedDate = normalizeDateOnly(date);
  if (!normalizedDate) return null;

  return `${normalizedDate}T${time}:00`;
}

function inferRequestedType({ requestedType, entryTime, exitTime }) {
  if (requestedType) return requestedType;
  if (entryTime && !exitTime) return "IN";
  if (exitTime && !entryTime) return "OUT";
  return null;
}

module.exports = {
  buildForgottenOccurredAt,
  inferRequestedType,
  parseSignatureBase64,
  readSignatureAsDataUrl,
  resolveStoredPath,
  saveSignaturePng,
};

function normalizeDateOnly(value) {
  if (!value) return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;

  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
