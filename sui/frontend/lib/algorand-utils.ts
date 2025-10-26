import algosdk from "algosdk"

export async function writeToAlgorand(
  cid: string,
  walletAddress: string,
  signTransaction: (txns: any[]) => Promise<Uint8Array[]>,
): Promise<string> {
  try {
    // Create transaction locally (no API key needed for this)
    const algodServer = "https://testnet-api.algonode.cloud"
    const algodPort = 443
    const algodClient = new algosdk.Algodv2("", algodServer, algodPort)

    // Get suggested parameters
    const suggestedParams = await algodClient.getTransactionParams().do()

    // Create transaction with IPFS CID in note field
    const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      from: walletAddress,
      to: walletAddress, // Self-transaction
      amount: 0, // Zero amount
      note: new Uint8Array(Buffer.from(cid)),
      suggestedParams,
    })

    // Sign transaction using wallet
    const signedTxns = await signTransaction([
      {
        txn: Buffer.from(algosdk.encodeUnsignedTransaction(txn)).toString("base64"),
      },
    ])

    // Send to server API for processing
    const response = await fetch("/api/algorand-transaction", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        cid,
        walletAddress,
        signedTxns,
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || "Algorand işlemi sırasında hata oluştu")
    }

    const { txId } = await response.json()
    return txId
  } catch (error) {
    console.error("Sui transaction error:", error)
    throw new Error("Sui işlemi sırasında hata oluştu")
  }
}
