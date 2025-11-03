// server.js — ECM Assistant (pure-JS version)
// ISO Timestamp: 🕒 2025-10-29T16:15:00Z
// ✅ Identical logic to Building Surveyor Assistant; text and file references updated for ECM Assistant

import express from "express";
import bodyParser from "body-parser";
import OpenAI from "openai";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { Buffer } from "buffer";
import { loadIndex, searchIndex } from "./vector_store.js";
import cors from "cors";

dotenv.config();
const app = express();
app.use(cors());
app.options("*", cors());

const PORT = process.env.PORT || 3002;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ------------------------- Cached FAISS Index --------------------------- */
let globalIndex = null;
(async () => {
  try {
    console.log("📦 Preloading FAISS vector index (all vectors)...");
    globalIndex = await loadIndex(10000); // ✅ changed from 10000 to 0
    console.log(`✅ Preloaded ${globalIndex.length.toLocaleString()} vectors.`);
  } catch (e) {
    console.error("❌ Preload failed:", e.message);
  }
})();

/* --------------------------- FAISS Search ----------------------------- */
async function queryFaissIndex(question) {
  try {
    const index = globalIndex || (await loadIndex(10000));
    const matches = await searchIndex(question, index);
    const filtered = matches.filter((m) => m.score >= 0.03);
    const texts = filtered.map((m) => m.text);
    console.log(`🔎 Found ${texts.length} chunks for “${question}”`);
    return { joined: texts.join("\n\n"), count: filtered.length };
  } catch (err) {
    console.error("❌ FAISS query failed:", err.message);
    return { joined: "", count: 0 };
  }
}

/* ----------------------- Report Generator ----------------------------- */
async function generateECMAssistant(query) {
  const { joined, count } = await queryFaissIndex(query);
  let context = joined;
  if (context.length > 50000) context = context.slice(0, 50000);

  const prompt = `

You are a UK corporate finance adviser specialising in Equity Capital Markets (ECM) and public company transactions.
You work to the professional standards of a London-based firm providing FCA-regulated ECM, financial and Takeover Code advisory services.

Use the verified UK Government, FCA, Takeover Panel, FRC, HMRC, AIM, Aquis and London Stock Exchange guidance provided in the Context section as your primary source.
If the Context is limited, you may supplement it with accurate, well-established professional knowledge of ECM practice,
but clearly indicate where information reflects market convention rather than specific regulatory text.

You must:
- Write only the finished report text.
- Do not offer to draft documents or perform legal tasks.
- Keep answers factual, neutral and practical.
- Reflect the tone and scope appropriate for FCA-regulated corporate finance advisers.
- Follow the exact structure shown.

Question: "${query}"

Structure:
1. Query
2. Applicability / Scope
3. Relevant Guidance
4. Evidence Requirements
5. Common Non-Compliance Factors
6. Key Reference Materials (FCA, Takeover Panel, FRC, HMRC, LSE, UK Gov, AIM, Aquis)
7. Practical Wrap-Up

Context:
${context}
`.trim();

  const completion = await openai.chat.completions.create({
    model: "gpt-5",
    messages: [{ role: "user", content: prompt }],
  });

  let text = completion.choices[0].message.content.trim();
  text = text.replace(/8\)\s*Appendix[\s\S]*$/gi, "").trim();

  // --- ISO 42001 fairness check ---
  let fairnessResult = "";
  try {
    const fairnessCheck = await openai.chat.completions.create({
      model: "gpt-5",
      messages: [
        {
          role: "system",
          content:
            "You are an ISO 42001 fairness auditor. Identify any gender, age, racial, or cultural bias in the text below. Respond 'No bias detected' if compliant.",
        },
        { role: "user", content: text },
      ],
    });
    fairnessResult = fairnessCheck.choices[0].message.content.trim();
    console.log("✅ Fairness verification:", fairnessResult);
  } catch (e) {
    fairnessResult = "Fairness verification not completed (" + e.message + ")";
  }

  // --- Generate random Reg. No. with FAISS chunk count ---
  const now = new Date();
  const dateSeed = `${String(now.getFullYear()).slice(2)}${String(
    now.getMonth() + 1
  ).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const randomPart = Math.floor(1000 + Math.random() * 9000);
  const regRand = `${dateSeed}-${randomPart}`;

  const footer = `

This report was prepared using the AIVS FAISS-indexed ECM knowledge base,
derived entirely from verified UK Government, HSE, DEFRA and professional manuals.
It is provided for internal compliance and advisory purposes only and should not
be relied upon as a substitute for professional environmental or compliance advice.

ISO 42001 Fairness Verification: ${fairnessResult}
Reg. No. AIVS/UK/${regRand}/${count}
© AIVS Software Limited 2025 — All rights reserved.`;

  return `${text}\n\n${footer}`;
}

/* --------------------------- PDF Helper ------------------------------- */
function sanitizeForPdf(txt = "") {
  return String(txt).replace(/[^\x09\x0A\x0D\x20-\x7E£–—]/g, "").trim();
}

async function buildPdfBufferStructured({ fullName, ts, question, reportText }) {
  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage();
  let { width, height } = page.getSize();
  const fontBody = await pdfDoc.embedStandardFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedStandardFont(StandardFonts.HelveticaBold);

  const fsTitle = 16,
    fsBody = 11,
    margin = 50,
    lh = fsBody * 1.4;
  const draw = (txt, x, y, size, font) =>
    page.drawText(txt || "", { x, y, size, font });

  let y = height - margin;
  const ensure = (need = lh) => {
    if (y - need < margin) {
      page = pdfDoc.addPage();
      ({ width, height } = page.getSize());
      y = height - margin;
    }
  };

  const wrap = (txt, x, maxWidth, size = fsBody, font = fontBody) => {
    const words = String(txt || "").split(/\s+/);
    let cur = "",
      rows = [];
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(test, size) > maxWidth && cur) {
        rows.push(cur);
        cur = w;
      } else cur = test;
    }
    rows.push(cur || "");
    return rows;
  };

  const para = (txt, x, size = fsBody, font = fontBody) => {
    const safe = sanitizeForPdf(txt);
    const rows = wrap(safe, x, width - x - margin, size, font);
    for (const r of rows) {
      ensure();
      draw(r, x, y, size, font);
      y -= lh;
    }
  };

  draw("ECM Assistant Report", margin, y, fsTitle, fontBold);
  y -= fsTitle * 1.4;
  para(`Prepared for: ${fullName || "N/A"}`, margin);
  para(`Timestamp (UK): ${ts}`, margin);
  y -= lh;
  para(question || "", margin);
  para(reportText, margin);

  const bytes = await pdfDoc.save();
  console.log(`📦 Created structured PDF (${bytes.length} bytes)`);
  return Buffer.from(bytes);
}

/* ------------------------------ /ask ---------------------------------- */
app.post("/ask", async (req, res) => {
  const { question, email, managerEmail, clientEmail } = req.body || {};
  console.log("🧾 /ask", { question, email, managerEmail, clientEmail });
  if (!question) return res.status(400).json({ error: "Missing question" });

  try {
    const ts = new Date().toISOString();
    const reportText = await generateECMAssistant(question);
    const pdfBuf = await buildPdfBufferStructured({
      fullName: email,
      ts,
      question,
      reportText,
    });

    const docParagraphs = [];

    docParagraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "ECM Assistant Report",
            bold: true,
            size: 32,
          }),
        ],
        alignment: "center",
        spacing: { after: 100 },
      })
    );

    docParagraphs.push(
      new Paragraph({
        children: [
          new TextRun({ text: `Generated ${ts}`, bold: true, size: 24 }),
        ],
        alignment: "center",
        spacing: { after: 300 },
      })
    );

    const lines = String(reportText || "")
      .replace(/\n{2,}/g, "\n")
      .split(/\n| {2,}/);

    for (const raw of lines) {
      const t = raw.trim();
      if (!t) {
        docParagraphs.push(new Paragraph(""));
        continue;
      }
      if (t.startsWith("This report was prepared using")) break;

      if (/^\d+[\).\s]/.test(t)) {
        docParagraphs.push(
          new Paragraph({
            children: [new TextRun({ text: t, bold: true, size: 28 })],
            spacing: { before: 200, after: 120 },
          })
        );
        continue;
      }

      if (/^[A-Z][\).\s]/.test(t)) {
        const cleaned = t.replace(/^[A-Z][\).\s]+/, "").trim();
        docParagraphs.push(
          new Paragraph({
            children: [new TextRun({ text: cleaned, bold: true, size: 24 })],
            spacing: { before: 120, after: 80 },
          })
        );
        continue;
      }

      if (/^[-•]?\s*[A-Z].*:\s*$/.test(t)) {
        const labelText = t.replace(/^[-•]\s*/, "").trim();
        docParagraphs.push(
          new Paragraph({
            children: [new TextRun({ text: labelText, bold: true, size: 24 })],
            spacing: { before: 120, after: 80 },
          })
        );
        continue;
      }

      if (/^[-•]/.test(t)) {
        const bulletText = t.replace(/^[-•]\s*/, "• ").trim();
        docParagraphs.push(
          new Paragraph({
            children: [new TextRun({ text: bulletText, size: 22 })],
            indent: { left: 680, hanging: 360 },
            spacing: { after: 60 },
          })
        );
        continue;
      }

      docParagraphs.push(
        new Paragraph({
          children: [new TextRun({ text: t, size: 22 })],
          spacing: { after: 120 },
        })
      );
    }

    const now = new Date();
    const dateSeed = `${String(now.getFullYear()).slice(2)}${String(
      now.getMonth() + 1
    ).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    const randomPart = Math.floor(1000 + Math.random() * 9000);
    const regRand = `${dateSeed}-${randomPart}`;

    const footerText = `
This report was prepared using the AIVS FAISS-indexed ECM knowledge base,
derived entirely from verified UK Government, HSE, DEFRA and professional manuals.
It is provided for internal compliance and advisory purposes only and should not
be relied upon as a substitute for professional environmental or compliance advice.

Reg. No. AIVS/UK/${regRand}/${globalIndex ? globalIndex.length : 0}
© AIVS Software Limited 2025 — All rights reserved.`;

    docParagraphs.push(
      new Paragraph({
        children: [new TextRun({ text: footerText, italics: true, size: 20 })],
        spacing: { before: 240 },
        alignment: "left",
      })
    );

    const doc = new Document({ sections: [{ children: docParagraphs }] });
    const docBuf = await Packer.toBuffer(doc);

    try {
      const mailjetRes = await fetch("https://api.mailjet.com/v3.1/send", {
        method: "POST",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(
              `${process.env.MJ_APIKEY_PUBLIC}:${process.env.MJ_APIKEY_PRIVATE}`
            ).toString("base64"),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          Messages: [
            {
              From: {
                Email: "noreply@securemaildrop.uk",
                Name: "Secure Maildrop",
              },
              To: [
                { Email: email },
                { Email: managerEmail },
                { Email: clientEmail },
              ].filter((r) => r.Email),
              Subject: "Your AI ECM Assistant Report",
              TextPart: reportText,
              HTMLPart: reportText
                .split("\n")
                .map((l) => `<p>${l}</p>`)
                .join(""),
              Attachments: [
                {
                  ContentType: "application/pdf",
                  Filename: `ecm-audit-${ts}.pdf`,
                  Base64Content: pdfBuf.toString("base64"),
                },
                {
                  ContentType:
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                  Filename: "ecm-report.docx",
                  Base64Content: docBuf.toString("base64"),
                },
              ],
            },
          ],
        }),
      });
      const mailResponse = await mailjetRes.json();
      console.log("📨 Mailjet response:", mailjetRes.status, mailResponse);
    } catch (e) {
      console.error("❌ Mailjet send failed:", e.message);
    }

    res.json({ question, answer: reportText, timestamp: ts });
  } catch (err) {
    console.error("❌ Report failed:", err);
    res.status(500).json({ error: "Report generation failed" });
  }
});

app.get("/", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "ecm.html"))
);

app.listen(Number(PORT), "0.0.0.0", () =>
  console.log(`🟢 ECM Assistant running on port ${PORT}`)
);
