import { type NextRequest, NextResponse } from "next/server"
import { GoogleGenerativeAI } from "@google/generative-ai"

interface ContractParams {
  prompt: string
  parties: Array<{ name: string; address: string }>
  country: string
  currency: string
  deadline: string
  termination: string
}

interface GeneratedContract {
  contract: string
  summary: string[]
  riskAnalysis: Array<{ level: string; description: string }>
}

export async function POST(request: NextRequest) {
  try {
    const params: ContractParams = await request.json()

    // Use server-side environment variables
    const apiKey = process.env.GENAI_API_KEY || process.env.GENERATIVE_API_KEY || process.env.GEMINI_API_KEY

    if (!apiKey) {
      return NextResponse.json({ error: "API anahtarı yapılandırılmamış" }, { status: 500 })
    }

    const lang = detectLanguage(params.prompt)
    const langName = lang === "tr" ? "Türkçe" : "English"

    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" })

    const contractPrompt = `
You are a professional legal-drafting assistant. Respond in ${langName}.
User-supplied details below (do not invent missing legal identifiers).
Description: ${params.prompt}
Parties: ${params.parties.map((p) => `${p.name} (${p.address || "adres yok"})`).join("; ")}
Country: ${params.country}
Currency: ${params.currency}
Deadline: ${formatDateTR(params.deadline)}
Termination (days): ${params.termination || "Belirtilmemiş"}

OUTPUT INSTRUCTION (priority order):
1) Preferably return a valid JSON object ONLY (no code fences, no extra text) with keys:
   {
     "contract": "<full contract as markdown or plain text>",
     "summary": ["bullet1","bullet2",...],
     "riskAnalysis": [{"level":"High|Medium|Low","description":"..."}]
   }
   If you return JSON, ensure strings are not escaped JSON-within-JSON (return real JSON).

2) If you cannot return JSON, return CLEAN markdown in ${langName} with the following headings:
   # <TITLE>
   ## TARAFLAR (or PARTIES)
   ## PROJE KAPSAMI (or SCOPE)
   ## ÖDEME KOŞULLARI (or PAYMENT TERMS)
   ## TESLİM TARİHİ (or DELIVERY DATE)
   ## FİKRİ MÜLKİYET (or IP)
   ## FESİH KOŞULLARI (or TERMINATION)
   Then append:
   ## ÖZET (or SUMMARY) - 3 to 6 bullet points
   ## RISK ANALIZI (or RISK ANALYSIS) - up to 3 items like "High: reason"

IMPORTANT:
- If the user prompt is in Turkish, produce the contract and headings in Turkish. If in English, produce in English.
- Do not wrap the JSON in markdown code blocks. Do not output anything other than the JSON object if you can.
- If you cannot produce JSON, produce only the clean markdown described above.
`

    const result = await model.generateContent(contractPrompt)
    const response = await result.response
    const rawText = String(await response.text())

    // Process the response using the same logic as before
    const processedContract = processGeminiResponse(rawText)

    return NextResponse.json(processedContract)
  } catch (error) {
    console.error("Contract generation error:", error)
    return NextResponse.json({ error: "Sözleşme oluşturulurken hata oluştu" }, { status: 500 })
  }
}

// Helper functions moved from lib/gemini.ts
function formatDateTR(dateStr?: string) {
  if (!dateStr) return ""
  try {
    return new Date(dateStr).toLocaleDateString("tr-TR")
  } catch {
    return dateStr
  }
}

function detectLanguage(text?: string): "tr" | "en" {
  if (!text) return "tr"
  const sample = text.slice(0, 500).toLowerCase()

  const turkishWords = ["ve", "ile", "taraf", "sözleşme", "teslim", "fesh", "mücbir", "fatura", "tarih", "gün"]
  const englishWords = ["the", "and", "party", "agreement", "deliver", "termination", "due", "day", "contract"]

  let tScore = 0
  let eScore = 0

  for (const w of turkishWords) if (new RegExp(`\\b${w}\\b`, "i").test(sample)) tScore += 2
  for (const w of englishWords) if (new RegExp(`\\b${w}\\b`, "i").test(sample)) eScore += 2

  if (/[ğıüşöçİŞĞÜÖ]/.test(sample)) tScore += 3

  return tScore >= eScore ? "tr" : "en"
}

function processGeminiResponse(rawText: string): GeneratedContract {
  // Same processing logic as in the original lib/gemini.ts
  const jsonSub = extractJsonSubstring(rawText)
  if (jsonSub) {
    const parsed = tryParseJsonMaybe(jsonSub)
    if (parsed && (parsed.contract || parsed.summary || parsed.riskAnalysis)) {
      return normalizeParsedJson(parsed)
    }
  }

  const tryFull = tryParseJsonMaybe(rawText)
  if (tryFull && (tryFull.contract || tryFull.summary || tryFull.riskAnalysis)) {
    return normalizeParsedJson(tryFull)
  }

  const unescaped = unescapeText(rawText)
  const jsonSub2 = extractJsonSubstring(unescaped)
  if (jsonSub2) {
    const parsed2 = tryParseJsonMaybe(jsonSub2)
    if (parsed2 && (parsed2.contract || parsed2.summary || parsed2.riskAnalysis)) {
      return normalizeParsedJson(parsed2)
    }
  }

  const readable = unescaped.trim()
  return parseContractFromPlainText(readable)
}

function unescapeText(s: string) {
  if (!s) return s
  return s
    .replace(/\\r/g, "\r")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\u00([0-9A-Fa-f]{2})/g, (_m, p1) => String.fromCharCode(Number.parseInt(p1, 16)))
    .replace(/\\u([0-9A-Fa-f]{4})/g, (_m, p1) => String.fromCharCode(Number.parseInt(p1, 16)))
}

function extractJsonSubstring(text: string): string | null {
  if (!text) return null
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (fenced && fenced[1]) return fenced[1].trim()

  const first = text.indexOf("{")
  const last = text.lastIndexOf("}")
  if (first >= 0 && last > first) return text.slice(first, last + 1).trim()

  return null
}

function tryParseJsonMaybe(text: string): any | null {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    try {
      const t = unescapeText(text)
      return JSON.parse(t)
    } catch {
      const stripped = text.replace(/^\s*["'`]+\s*/, "").replace(/\s*["'`]+\s*$/, "")
      try {
        return JSON.parse(unescapeText(stripped))
      } catch {
        return null
      }
    }
  }
}

function parseContractFromPlainText(text: string): GeneratedContract {
  const contract = text.trim()
  let summary: string[] = []
  let riskAnalysis: Array<{ level: string; description: string }> = []

  const summaryMatch =
    text.match(/(?:^|\n)#{0,3}\s*ÖZET\s*[:-]?\s*([\s\S]*?)(?:\n#{1,3}\s|$)/i) ||
    text.match(/(?:^|\n)#{0,3}\s*Özet\s*[:-]?\s*([\s\S]*?)(?:\n#{1,3}\s|$)/i) ||
    text.match(/(?:^|\n)#{0,3}\s*SUMMARY\s*[:-]?\s*([\s\S]*?)(?:\n#{1,3}\s|$)/i)

  if (summaryMatch) {
    const bullets = summaryMatch[1]
      .split(/\n/)
      .map((l) => l.replace(/^\s*[-*]\s*/, "").trim())
      .filter(Boolean)
    if (bullets.length) summary = bullets.slice(0, 6)
  }

  if (summary.length === 0) {
    const bulletsAny = text.match(/(^|\n)\s*[-*]\s+.+/g)
    if (bulletsAny) {
      summary = bulletsAny.map((b) => b.replace(/(^|\n)\s*[-*]\s+/, "").trim()).slice(0, 6)
    }
  }

  const riskMatch =
    text.match(
      /(?:^|\n)#{0,3}\s*(Risk Analizi|RİSK|RISK|RİSK ANALİZİ|RISK ANALYSIS)\s*[:-]?\s*([\s\S]*?)(?:\n#{1,3}\s|$)/i,
    ) || text.match(/(?:^|\n)(RİSK|RISK)[\s\S]{0,200}/i)

  if (riskMatch && riskMatch[2]) {
    const lines = riskMatch[2]
      .split(/\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    for (const l of lines) {
      const m = l.match(/(High|Medium|Low|Yüksek|Orta|Mini)\s*[:\-–]\s*(.+)/i)
      if (m) {
        let level = m[1]
        const desc = m[2]
        if (/yüksek/i.test(level)) level = "High"
        if (/orta/i.test(level)) level = "Medium"
        if (/mini/i.test(level)) level = "Low"
        riskAnalysis.push({ level, description: desc })
      } else {
        riskAnalysis.push({ level: "Medium", description: l })
      }
    }
  }

  if (summary.length === 0) summary = ["Özet otomatik olarak üretilemedi."]
  if (riskAnalysis.length === 0)
    riskAnalysis = [{ level: "Medium", description: "Risk analizi otomatik olarak üretilemedi." }]

  return { contract, summary, riskAnalysis }
}

function normalizeParsedJson(parsed: any): GeneratedContract {
  const contractRaw = parsed.contract ?? parsed.text ?? parsed.content ?? ""
  const contract =
    typeof contractRaw === "string"
      ? unescapeText(contractRaw)
          .replace(/^"(.*)"$/s, "$1")
          .trim()
      : JSON.stringify(contractRaw)
  const summaryArr = Array.isArray(parsed.summary)
    ? parsed.summary.map(String)
    : parsed.summary
      ? [String(parsed.summary)]
      : ["Özet bulunamadı"]
  const riskArr = Array.isArray(parsed.riskAnalysis)
    ? parsed.riskAnalysis.map((r: any) => ({
        level: String(r.level ?? "Medium"),
        description: String(r.description ?? r),
      }))
    : [{ level: "Medium", description: "Risk analizi yok" }]

  return { contract, summary: summaryArr, riskAnalysis: riskArr }
}
