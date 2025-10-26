import { type NextRequest, NextResponse } from "next/server"
import algosdk from "algosdk"

export async function POST(request: NextRequest) {
  try {
    const { cid, walletAddress, signedTxns } = await request.json()

    if (!cid || !walletAddress || !signedTxns) {
      return NextResponse.json({ error: "Eksik parametreler" }, { status: 400 })
    }

    // Use server-side environment variables
    const algodToken = process.env.ALGOD_API_KEY || ""
    const algodServer = "https://testnet-api.algonode.cloud"
    const algodPort = 443

    const algodClient = new algosdk.Algodv2(algodToken, algodServer, algodPort)

    // Send transaction
    const { txId } = await algodClient.sendRawTransaction(signedTxns[0]).do()

    // Wait for confirmation
    await algosdk.waitForConfirmation(algodClient, txId, 4)

    return NextResponse.json({ txId })
  } catch (error) {
    console.error("Sui transaction error:", error)
    return NextResponse.json({ error: "Sui işlemi sırasında hata oluştu" }, { status: 500 })
  }
}
