const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

const PDF_STORAGE_DIR = path.resolve(process.cwd(), "storage", "forgotten-pdfs");
const PAGE_MARGIN = 44;
const PAGE_WIDTH = 595.28;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;
const TEXT_COLOR = "#111111";
const MUTED_COLOR = "#666666";
const LINE_COLOR = "#bbbbbb";
const INTEGRITY_ALGORITHM = "SHA-256";

function generateForgottenApprovalPdf({ request, reviewerName, signatureAbsolutePath }) {
  fs.mkdirSync(PDF_STORAGE_DIR, { recursive: true });

  const relativePath = getForgottenApprovalPdfRelativePath(request.id);
  const absolutePath = resolveForgottenApprovalPdfPath(request.id);
  const integrityData = buildIntegrityData({
    request,
    reviewerName,
    signatureAbsolutePath,
  });

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: PAGE_MARGIN,
      info: {
        Title: `Solicitacao de ajuste manual de ponto #${request.id}`,
        Author: "Sistema de Ponto",
      },
    });

    const stream = fs.createWriteStream(absolutePath);
    doc.pipe(stream);

    try {
      drawForgottenApprovalPdf(doc, {
        request,
        reviewerName,
        signatureAbsolutePath,
        integrityData,
      });
      doc.end();
    } catch (error) {
      stream.destroy();
      try {
        fs.unlinkSync(absolutePath);
      } catch {}
      reject(error);
      return;
    }

    stream.on("finish", () => {
      try {
        const metadata = {
          request_id: Number(request.id),
          algorithm: INTEGRITY_ALGORITHM,
          payload_sha256: integrityData.payloadSha256,
          pdf_sha256: hashFile(absolutePath),
          signature_sha256: integrityData.signatureSha256,
          generated_at: new Date().toISOString(),
          payload: integrityData.payload,
        };
        fs.writeFileSync(
          resolveForgottenApprovalIntegrityPath(request.id),
          `${JSON.stringify(metadata, null, 2)}\n`,
          "utf8",
        );

        resolve({
          relativePath,
          integrity: metadata,
        });
      } catch (error) {
        try {
          fs.unlinkSync(absolutePath);
        } catch {}
        reject(error);
      }
    });

    stream.on("error", (error) => {
      try {
        fs.unlinkSync(absolutePath);
      } catch {}
      reject(error);
    });
  });
}

function drawForgottenApprovalPdf(doc, {
  request,
  reviewerName,
  signatureAbsolutePath,
  integrityData,
}) {
  const approvalDate = request.reviewed_at || new Date();
  const signedAt = request.signed_at || new Date();
  const forgottenDate = request.forgotten_date;
  const employeeName = request.user_name || request.employee_name || "Colaborador";
  const employeeDocument = request.user_cpf || request.user_id
    ? formatEmployeeDocument(request)
    : "Nao informado";
  const reviewer = reviewerName || request.reviewed_by_name || "Departamento de Escalas";
  const entryTime = formatTimeValue(request.entry_time);
  const exitTime = formatTimeValue(request.exit_time);

  drawTitle(doc, "AUTORIZACAO DE AJUSTE MANUAL DE PONTO");
  drawMetaLine(doc, `Solicitacao #${request.id}`);
  drawMetaLine(doc, `Documento gerado em ${formatDateTimeBr(new Date())}`);
  drawDivider(doc);

  drawSectionTitle(doc, "DADOS DA SOLICITACAO");
  writeField(doc, "Colaborador", employeeName);
  writeField(doc, "Documento", employeeDocument);
  writeField(doc, "Data esquecida", formatDateBr(forgottenDate));
  writeField(doc, "Entrada solicitada", entryTime || "Nao informada");
  writeField(doc, "Saida solicitada", exitTime || "Nao informada");
  writeField(doc, "Posto/local", cleanText(request.workplace));
  writeField(doc, "Confirmacao do colaborador", request.confirmed_by_employee ? "Sim" : "Nao");
  writeField(doc, "Assinada em", formatDateTimeBr(signedAt));
  writeField(doc, "Status", "Aprovada");
  writeField(doc, "Aprovada em", formatDateTimeBr(approvalDate));

  drawSectionTitle(doc, "DESCRICAO DO AJUSTE");
  writeParagraph(
    doc,
    buildAdjustmentSummary({
      employeeName,
      forgottenDate,
      entryTime,
      exitTime,
    }),
  );

  drawSectionTitle(doc, "JUSTIFICATIVA DO COLABORADOR");
  writeParagraph(doc, cleanText(request.reason));

  drawSectionTitle(doc, "OBSERVACOES COMPLEMENTARES");
  writeParagraph(doc, cleanText(request.notes));

  drawSectionTitle(doc, "ANALISE ADMINISTRATIVA");
  writeParagraph(doc, cleanText(request.review_note));
  writeField(doc, "Responsavel pela aprovacao", reviewer);

  drawSectionTitle(doc, "ASSINATURA DO COLABORADOR");
  drawSignatureBlock(doc, {
    signatureAbsolutePath,
    employeeName,
    signedAt,
  });

  drawSectionTitle(doc, "CONTROLE DE INTEGRIDADE");
  writeField(doc, "Algoritmo", INTEGRITY_ALGORITHM);
  writeField(doc, "Hash do conteudo aprovado", integrityData.payloadSha256);
  if (integrityData.signatureSha256) {
    writeField(doc, "Hash da assinatura capturada", integrityData.signatureSha256);
  }
  writeParagraph(
    doc,
    "Este codigo permite verificar a integridade tecnica dos dados aprovados e da assinatura armazenada no sistema. Ele nao substitui, por si so, assinatura eletronica qualificada ou carimbo do tempo ICP-Brasil.",
  );

  ensurePageSpace(doc, 80);
  drawSectionTitle(doc, "VALIDACAO FINAL");
  writeParagraph(
    doc,
    `A solicitacao acima foi analisada e aprovada no painel administrativo por ${reviewer} em ${formatDateTimeBr(approvalDate)}.`,
  );
}

function buildIntegrityData({ request, reviewerName, signatureAbsolutePath }) {
  const reviewer = reviewerName || request.reviewed_by_name || "Departamento de Escalas";
  const payload = {
    version: 1,
    document_type: "forgotten_request_approval",
    request_id: Number(request.id),
    user_id: request.user_id != null ? Number(request.user_id) : null,
    employee_name: request.user_name || request.employee_name || null,
    employee_document: request.user_cpf || null,
    forgotten_date: normalizeDateOnly(request.forgotten_date),
    entry_time: formatTimeValue(request.entry_time),
    exit_time: formatTimeValue(request.exit_time),
    reason: cleanText(request.reason),
    workplace: cleanText(request.workplace),
    notes: cleanText(request.notes),
    confirmed_by_employee: !!request.confirmed_by_employee,
    signed_at: normalizeIsoDateTime(request.signed_at),
    review_note: cleanText(request.review_note),
    reviewed_at: normalizeIsoDateTime(request.reviewed_at),
    reviewer_name: reviewer,
    reviewed_by: request.reviewed_by != null ? Number(request.reviewed_by) : null,
    signature_sha256: signatureAbsolutePath && fs.existsSync(signatureAbsolutePath)
      ? hashFile(signatureAbsolutePath)
      : null,
  };

  return {
    payload,
    payloadSha256: hashString(stableStringify(payload)),
    signatureSha256: payload.signature_sha256,
  };
}

function drawTitle(doc, title) {
  doc
    .fillColor(TEXT_COLOR)
    .font("Helvetica-Bold")
    .fontSize(16)
    .text(title, PAGE_MARGIN, doc.y, {
      width: CONTENT_WIDTH,
      align: "left",
    });
  doc.moveDown(0.4);
}

function drawMetaLine(doc, text) {
  doc
    .fillColor(MUTED_COLOR)
    .font("Helvetica")
    .fontSize(9)
    .text(text, PAGE_MARGIN, doc.y, {
      width: CONTENT_WIDTH,
    });
}

function drawDivider(doc) {
  doc.moveDown(0.4);
  const y = doc.y;
  doc
    .moveTo(PAGE_MARGIN, y)
    .lineTo(PAGE_MARGIN + CONTENT_WIDTH, y)
    .lineWidth(1)
    .strokeColor(LINE_COLOR)
    .stroke();
  doc.moveDown(0.8);
}

function drawSectionTitle(doc, title) {
  ensurePageSpace(doc, 42);
  doc.moveDown(0.35);
  doc
    .fillColor(TEXT_COLOR)
    .font("Helvetica-Bold")
    .fontSize(11)
    .text(title, PAGE_MARGIN, doc.y, {
      width: CONTENT_WIDTH,
    });
  doc.moveDown(0.2);
}

function writeField(doc, label, value) {
  ensurePageSpace(doc, 22);
  doc
    .fillColor(TEXT_COLOR)
    .font("Helvetica-Bold")
    .fontSize(10)
    .text(`${label}: `, PAGE_MARGIN, doc.y, {
      continued: true,
    })
    .font("Helvetica")
    .text(value || "-", {
      width: CONTENT_WIDTH,
    });
}

function writeParagraph(doc, text) {
  const safeText = text || "Nao informado.";
  ensurePageSpace(doc, estimateParagraphHeight(doc, safeText));
  doc
    .fillColor(TEXT_COLOR)
    .font("Helvetica")
    .fontSize(10)
    .text(safeText, PAGE_MARGIN, doc.y, {
      width: CONTENT_WIDTH,
      lineGap: 2,
      align: "left",
    });
  doc.moveDown(0.4);
}

function estimateParagraphHeight(doc, text) {
  return doc
    .font("Helvetica")
    .fontSize(10)
    .heightOfString(text || "Nao informado.", {
      width: CONTENT_WIDTH,
      lineGap: 2,
    }) + 18;
}

function drawSignatureBlock(doc, { signatureAbsolutePath, employeeName, signedAt }) {
  ensurePageSpace(doc, 160);

  if (signatureAbsolutePath && fs.existsSync(signatureAbsolutePath)) {
    doc.image(signatureAbsolutePath, PAGE_MARGIN, doc.y, {
      fit: [220, 70],
      align: "left",
      valign: "top",
    });
    doc.y += 78;
  } else {
    doc
      .fillColor(MUTED_COLOR)
      .font("Helvetica-Oblique")
      .fontSize(10)
      .text("Assinatura digital nao disponivel.", PAGE_MARGIN, doc.y, {
        width: CONTENT_WIDTH,
      });
    doc.moveDown(1.2);
  }

  const lineY = doc.y + 8;
  doc
    .moveTo(PAGE_MARGIN, lineY)
    .lineTo(PAGE_MARGIN + 260, lineY)
    .lineWidth(1)
    .strokeColor(TEXT_COLOR)
    .stroke();

  doc.y = lineY + 6;
  doc
    .fillColor(TEXT_COLOR)
    .font("Helvetica")
    .fontSize(10)
    .text(employeeName || "-", PAGE_MARGIN, doc.y, {
      width: 260,
      align: "left",
    });
  doc
    .fillColor(MUTED_COLOR)
    .fontSize(9)
    .text(`Assinatura registrada em ${formatDateTimeBr(signedAt)}`, PAGE_MARGIN, doc.y, {
      width: CONTENT_WIDTH,
      align: "left",
    });
}

function ensurePageSpace(doc, requiredHeight) {
  const limit = doc.page.height - PAGE_MARGIN;
  if (doc.y + requiredHeight <= limit) return;
  doc.addPage();
  doc.y = PAGE_MARGIN;
}

function buildAdjustmentSummary({ employeeName, forgottenDate, entryTime, exitTime }) {
  const day = formatDateBr(forgottenDate);
  if (entryTime && exitTime) {
    return `${employeeName} solicitou o lancamento manual de entrada as ${entryTime} e de saida as ${exitTime}, referentes ao dia ${day}.`;
  }
  if (entryTime) {
    return `${employeeName} solicitou o lancamento manual da batida de entrada as ${entryTime}, referente ao dia ${day}.`;
  }
  if (exitTime) {
    return `${employeeName} solicitou o lancamento manual da batida de saida as ${exitTime}, referente ao dia ${day}.`;
  }
  return `${employeeName} solicitou um ajuste manual de ponto referente ao dia ${day}.`;
}

function formatEmployeeDocument(request) {
  if (request.user_cpf) return request.user_cpf;
  if (request.user_id) return `ID ${request.user_id}`;
  return "Nao informado";
}

function cleanText(value) {
  const text = value == null ? "" : String(value).trim();
  return text || "Nao informado.";
}

function getForgottenApprovalPdfRelativePath(requestId) {
  return path
    .join("storage", "forgotten-pdfs", `forgotten-request-${requestId}.pdf`)
    .replace(/\\/g, "/");
}

function resolveForgottenApprovalPdfPath(requestId) {
  return path.resolve(process.cwd(), getForgottenApprovalPdfRelativePath(requestId));
}

function forgottenApprovalPdfExists(requestId) {
  return fs.existsSync(resolveForgottenApprovalPdfPath(requestId));
}

function getForgottenApprovalIntegrityRelativePath(requestId) {
  return path
    .join("storage", "forgotten-pdfs", `forgotten-request-${requestId}.integrity.json`)
    .replace(/\\/g, "/");
}

function resolveForgottenApprovalIntegrityPath(requestId) {
  return path.resolve(process.cwd(), getForgottenApprovalIntegrityRelativePath(requestId));
}

function forgottenApprovalIntegrityExists(requestId) {
  return fs.existsSync(resolveForgottenApprovalIntegrityPath(requestId));
}

function readForgottenApprovalIntegrity(requestId) {
  const absolutePath = resolveForgottenApprovalIntegrityPath(requestId);
  const raw = fs.readFileSync(absolutePath, "utf8");
  return JSON.parse(raw);
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function hashString(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function normalizeDate(value) {
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function normalizeDateOnly(value) {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return formatDateIso(normalizeDate(value));
}

function normalizeIsoDateTime(value) {
  if (!value) return null;
  return normalizeDate(value).toISOString();
}

function formatDateIso(date) {
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateBr(value) {
  const date = normalizeDate(value);
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = String(date.getUTCFullYear());
  return `${day}/${month}/${year}`;
}

function formatDateTimeBr(value) {
  const date = normalizeDate(value);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear());
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${day}/${month}/${year} ${hour}:${minute}`;
}

function formatTimeValue(value) {
  if (!value) return null;
  return String(value).slice(0, 5);
}

module.exports = {
  forgottenApprovalIntegrityExists,
  forgottenApprovalPdfExists,
  generateForgottenApprovalPdf,
  getForgottenApprovalIntegrityRelativePath,
  getForgottenApprovalPdfRelativePath,
  readForgottenApprovalIntegrity,
  resolveForgottenApprovalIntegrityPath,
  resolveForgottenApprovalPdfPath,
};
