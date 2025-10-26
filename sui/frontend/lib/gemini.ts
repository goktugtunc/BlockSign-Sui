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

/** helper: pretty date for TR */
function formatDateTR(dateStr?: string) {
  if (!dateStr) return ""
  try {
    return new Date(dateStr).toLocaleDateString("tr-TR")
  } catch {
    return dateStr
  }
}

/** Basic heuristic language detector (TR / EN). Returns 'tr' or 'en' or 'tr' fallback. */
function detectLanguage(text?: string): "tr" | "en" {
  if (!text) return "tr"
  const sample = text.slice(0, 500).toLowerCase()

  // Turkish indicator words
  const turkishWords = ["ve", "ile", "taraf", "sözleşme", "teslim", "fesh", "mücbir", "fatura", "tarih", "gün"]
  const englishWords = ["the", "and", "party", "agreement", "deliver", "termination", "due", "day", "contract"]

  let tScore = 0
  let eScore = 0

  for (const w of turkishWords) if (new RegExp(`\\b${w}\\b`, "i").test(sample)) tScore += 2
  for (const w of englishWords) if (new RegExp(`\\b${w}\\b`, "i").test(sample)) eScore += 2

  // presence of Turkish-specific chars
  if (/[ğıüşöçİŞĞÜÖ]/.test(sample)) tScore += 3

  return tScore >= eScore ? "tr" : "en"
}

/** helper: try to unescape common JSON-escaped sequences so text becomes readable */
function unescapeText(s: string) {
  if (!s) return s
  return (
    s
      .replace(/\\r/g, "\r")
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      // decode simple \u00XX escapes
      .replace(/\\u00([0-9A-Fa-f]{2})/g, (_m, p1) => String.fromCharCode(Number.parseInt(p1, 16)))
      // decode full \uXXXX escapes
      .replace(/\\u([0-9A-Fa-f]{4})/g, (_m, p1) => String.fromCharCode(Number.parseInt(p1, 16)))
  )
}

/** extract first JSON-like substring (naive) */
function extractJsonSubstring(text: string): string | null {
  if (!text) return null
  // try fenced block first
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (fenced && fenced[1]) return fenced[1].trim()

  // try to find substring that starts with { and ends with matching }
  // This is naive: find first "{" and last "}" and return substring — then parse attempts will validate
  const first = text.indexOf("{")
  const last = text.lastIndexOf("}")
  if (first >= 0 && last > first) return text.slice(first, last + 1).trim()

  return null
}

/** try parse JSON with some fallbacks */
function tryParseJsonMaybe(text: string): any | null {
  if (!text) return null
  // direct parse
  try {
    return JSON.parse(text)
  } catch {
    // try unescape then parse
    try {
      const t = unescapeText(text)
      return JSON.parse(t)
    } catch {
      // strip wrapping quotes/backticks and try
      const stripped = text.replace(/^\s*["'`]+\s*/, "").replace(/\s*["'`]+\s*$/, "")
      try {
        return JSON.parse(unescapeText(stripped))
      } catch {
        return null
      }
    }
  }
}

/** Try to extract the human-readable contract + summary + risks from free text */
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

  // fallback: search for any bullet list near top
  if (summary.length === 0) {
    const bulletsAny = text.match(/(^|\n)\s*[-*]\s+.+/g)
    if (bulletsAny) {
      summary = bulletsAny.map((b) => b.replace(/(^|\n)\s*[-*]\s+/, "").trim()).slice(0, 6)
    }
  }

  // risk extraction
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

/** Normalize result object to GeneratedContract with safe defaults */
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

/** main function */
export async function generateContract(params: ContractParams): Promise<GeneratedContract> {
  try {
    const response = await fetch("/api/generate-contract", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || "Sözleşme oluşturulurken hata oluştu")
    }

    return await response.json()
  } catch (error) {
    console.error("Contract generation error:", error)

    // Fallback response
    return {
      contract: `# UYARI: Otomatik sözleşme oluşturulamadı\n\nSistem bir hata ile karşılaşıldı; lütfen daha sonra tekrar deneyin.\n\n(Hata: ${String(error)})`,
      summary: ["Sistemsel hata nedeniyle sözleşme oluşturulamadı."],
      riskAnalysis: [{ level: "High", description: "AI çağrısı sırasında hata oluştu." }],
    }
  }
}
