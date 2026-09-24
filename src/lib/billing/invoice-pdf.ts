import "server-only";

export type BillingInvoicePdfInput = {
  invoiceNumber: string;
  issuedAt: Date;
  customerName: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  packageName: string;
  description: string;
  amount: number;
  currency: string;
  expiresAt?: Date | null;
  provider: string;
  merchantOrderId?: string | null;
  transactionId?: string | null;
};

function escapePdfText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^\x20-\x7E]/g, " ")
    .trim();
}

function formatDate(value?: Date | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(value);
}

function formatCurrency(currency: string, amount: number) {
  const normalizedCurrency = currency.trim().toUpperCase() || "INR";
  const formatted = new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
  return `${normalizedCurrency} ${formatted}`;
}

function text(x: number, y: number, size: number, value: string, options: { font?: "F1" | "F2"; color?: string } = {}) {
  const font = options.font ?? "F1";
  const color = options.color ?? "0.92 0.95 0.98";
  return `${color} rg BT /${font} ${size} Tf ${x} ${y} Td (${escapePdfText(value)}) Tj ET\n`;
}

function rect(x: number, y: number, width: number, height: number, color: string) {
  return `${color} rg ${x} ${y} ${width} ${height} re f\n`;
}

function strokeRect(x: number, y: number, width: number, height: number, color: string) {
  return `${color} RG 1 w ${x} ${y} ${width} ${height} re S\n`;
}

function line(x1: number, y1: number, x2: number, y2: number, color: string) {
  return `${color} RG 1 w ${x1} ${y1} m ${x2} ${y2} l S\n`;
}

function buildContent(input: BillingInvoicePdfInput) {
  const amount = formatCurrency(input.currency, input.amount);
  const caption = input.description || input.packageName;
  const orderReference = input.merchantOrderId || input.transactionId || input.invoiceNumber;

  let content = "";
  content += rect(0, 0, 595, 842, "0.035 0.045 0.055");
  content += rect(36, 732, 523, 74, "0.80 1 0");
  content += text(58, 776, 24, "GIGXOMI", { font: "F2", color: "0.02 0.03 0.04" });
  content += text(58, 754, 11, "Payment Receipt / Tax Invoice", { font: "F2", color: "0.02 0.03 0.04" });
  content += text(402, 779, 10, "Invoice", { font: "F2", color: "0.02 0.03 0.04" });
  content += text(402, 758, 13, input.invoiceNumber, { font: "F2", color: "0.02 0.03 0.04" });

  content += rect(36, 624, 250, 86, "0.075 0.085 0.098");
  content += strokeRect(36, 624, 250, 86, "0.18 0.23 0.28");
  content += text(56, 684, 10, "BILL TO", { font: "F2", color: "0.62 0.68 0.75" });
  content += text(56, 662, 14, input.customerName || "Gigxomi customer", { font: "F2" });
  content += text(56, 642, 10, input.customerPhone ? `Phone: ${input.customerPhone}` : "Phone: -", { color: "0.66 0.72 0.80" });
  content += text(56, 628, 10, input.customerEmail ? `Email: ${input.customerEmail}` : "Email: -", { color: "0.66 0.72 0.80" });

  content += rect(309, 624, 250, 86, "0.075 0.085 0.098");
  content += strokeRect(309, 624, 250, 86, "0.18 0.23 0.28");
  content += text(329, 684, 10, "PAYMENT", { font: "F2", color: "0.62 0.68 0.75" });
  content += text(329, 662, 11, `Date: ${formatDate(input.issuedAt)}`, { font: "F2" });
  content += text(329, 644, 10, `Provider: ${input.provider}`, { color: "0.66 0.72 0.80" });
  content += text(329, 628, 10, `Order: ${orderReference}`, { color: "0.66 0.72 0.80" });

  content += text(44, 572, 10, "DESCRIPTION", { font: "F2", color: "0.98 0.99 1" });
  content += text(274, 572, 10, "PRICE", { font: "F2", color: "0.98 0.99 1" });
  content += text(360, 572, 10, "EXPIRE DATE", { font: "F2", color: "0.98 0.99 1" });
  content += text(484, 572, 10, "TOTAL", { font: "F2", color: "0.98 0.99 1" });
  content += rect(36, 556, 523, 2, "0.80 1 0");

  content += rect(36, 493, 523, 50, "0.070 0.080 0.092");
  content += strokeRect(36, 493, 523, 50, "0.20 0.24 0.30");
  content += text(44, 520, 12, caption.slice(0, 56), { font: "F2" });
  content += text(44, 503, 9, input.packageName.slice(0, 66), { color: "0.66 0.72 0.80" });
  content += text(274, 514, 11, amount, { font: "F2" });
  content += text(360, 514, 11, formatDate(input.expiresAt), { font: "F2" });
  content += text(484, 514, 11, amount, { font: "F2" });

  content += line(360, 448, 559, 448, "0.24 0.29 0.34");
  content += text(379, 424, 12, "Total paid", { font: "F2", color: "0.72 0.78 0.85" });
  content += text(476, 424, 16, amount, { font: "F2", color: "0.80 1 0" });

  content += rect(36, 112, 523, 86, "0.055 0.065 0.076");
  content += strokeRect(36, 112, 523, 86, "0.16 0.20 0.25");
  content += text(56, 172, 11, "Receipt note", { font: "F2", color: "0.80 1 0" });
  content += text(56, 150, 10, "This receipt was generated automatically after successful PhonePe payment.", { color: "0.68 0.74 0.82" });
  content += text(56, 132, 10, "Keep this PDF for subscription and billing reference.", { color: "0.68 0.74 0.82" });

  content += text(36, 62, 9, "Gigxomi.com | Generated by Gigxomi billing system", { color: "0.50 0.56 0.64" });
  return content;
}

export function buildBillingInvoicePdf(input: BillingInvoicePdfInput) {
  const content = buildContent(input);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    `<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}endstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, "utf8");
}
